# 阶段四共享契约（场景时间轴）

阶段四范围：仅当前选中场景节点内部的时间轴编辑（四类轨道、关键帧、贝塞尔缓动、播放/缩放/快捷键）。**不做**运行时时序播放（阶段五）、不做打包（阶段六）。

## 文件归属

| 角色 | 文件 |
|---|---|
| Lead | `editor/src/features/timeline/timelineUtils.js`、`editor/src/state/timelineMutations.js`、`editor/src/state/useProjectController.js`、`editor/src/screens/ProjectWorkspace.jsx`、`tests/phase4/**`、`scripts/ui-smoke.mjs` |
| ui-timeline | `editor/src/features/timeline/TimelineEditor.jsx`（可拆子组件到同目录）、`editor/src/styles/timeline.css` |

不要改其他文件；不要新增依赖；不要跑 Vite build（Lead 统一构建）。可 import UI 依赖之外的代码只用 `react`、`../../state/ProjectContext`、`./timelineUtils.js`。

## 数据与工具函数（Lead 已实现，必须复用）

文件：`editor/src/features/timeline/timelineUtils.js`

- 常量：`TRACK_KINDS`（sprite/background/audio/textbox 的 label/short）、`PROPERTY_META`（label/min/max/step/integer）、`PROPERTY_ALLOWED`、`EASING_PRESETS`（linear/easeIn/easeOut/easeInOut，含 p1/p2）、`EASING_PRESET_KEYS`、`DEFAULT_TIMELINE_DURATION`。
- 时间/缓动：`formatTime(ms)`、`intensityToBezier(presetKey, intensity)`、`easingToPreset(easing)`、`cubicBezierY(p1,p2,t)`、`evaluateTrack(track, timeMs)`。
- 轨道：`isTrackPropertyValid(kind,property)`、`propertyMeta`、`clampTrackValue`、`staticValueForTrack`、`createTimeline(sceneNodeId,durationMs?)`、`uniqueTrackId`、`hasTrackFor`、`createTrackDraft({sceneNode,timeline,kind,target,property})` → `{track}`/`{error}`、`removeTrackFromTimeline(timeline,trackId)`、`listTrackCandidates(sceneNode)`、`trackLabel/trackExpandedLabel(project,sceneNode,track)`。
- 关键帧：`addKeyframeToTrack(track,time,value,easing?)`、`updateKeyframeInTrack(track,keyframeTime,patch)`、`removeKeyframeFromTrack(track,keyframeTime)`、`prevKeyframeTime(track,time)`、`nextKeyframeTime(track,time)`。
- 覆盖求值：`resolveSceneValues(project,sceneNode,timeMs)`（时间轴覆盖蓝图，未覆盖沿用；返回 background/sprites/textbox/audio/overridden）。

状态操作（`useProjectController()` 的 `actions`）：
- `setTimeline(sceneNodeId, timeline)`：整体写入项目 `timelines[sceneNodeId]`。
- `setTimelineDuration(sceneNodeId, durationMs)`
- `removeTimeline(sceneNodeId)`
- `notify(message, kind)`。

## TimelineEditor 组件契约

```jsx
<TimelineEditor
  project={project}
  projectDir={projectDir}
  sceneNode={selectedNode /* 非 scene 或 null 时显示空状态 */}
  height={timelineHeight}
/>
```
组件内部 `useProjectController()`，不要接收动作回调。根元素必须有 class `vn-tl` 且 `tabIndex={0}`（便于快捷键判断焦点），整体 `height:100%` 填满底部面板。

### 必须实现的功能

1. **无选中场景**：居中提示「选中场景节点后在此编辑时间轴」。
2. **场景已选中、无 timeline**：显示「该场景还没有时间轴」+「创建时间轴」按钮（默认 5000ms），点击 `actions.setTimeline(scene.id, createTimeline(scene.id, 5000))`。
3. **工具栏**（timeline 存在时）：
   - 场景名 + `时间轴` 标识；时长数字输入（100–600000，整数；若小于现有最大关键帧时间则 notify 拒绝）、循环 checkbox；
   - 播放/暂停按钮（Space 同效）、当前时间 `formatTime(playhead)` / `formatTime(duration)`；
   - 缩放：`−` / `+` 按钮（缩放系数 0.5–4，步进 0.25），显示百分比；
   - 「+ 轨道」菜单：用 `listTrackCandidates(sceneNode)` 生成候选，按 kind 分组；已存在同 target+property 的候选置灰；显示 `trackExpandedLabel` 风格文案（立绘需带素材名：可由 project.assets.images 反查）；点击后 `createTrackDraft` 并 `actions.setTimeline(scene.id, {...timeline, tracks:[...timeline.tracks, track]})`，新轨道自动选中；
   - 「删除时间轴」按钮（二次确认 `window.confirm` 后 `actions.removeTimeline`），删除后回到创建态。
4. **轨道区**：左侧固定宽约 190px 的轨道标签列（label + 静态基线值 + 删除轨道小按钮），右侧可横向/纵向滚动的时间区：
   - 顶部标尺：按缩放画刻度（如 0.5s/1s/2s），显示时间文字（`formatTime` 或秒）；点击/拖拽标尺或空白处设置播放头（0–duration，整数 ms）。
   - 每个轨道一行（高约 34px），class `vn-tl-track`；关键帧渲染为菱形/圆点 `.vn-tl-key`，水平位置 `time / duration * 可用宽度`；选中关键帧明显高亮；轨道上显示当前播放头处插值值（`evaluateTrack`）与静态值对比。
   - 关键帧拖拽（pointerdown/move/up）：移动时间（10ms 步进或整数 ms，clamp 0–duration），松手时用 `updateKeyframeInTrack` + `actions.setTimeline` 提交；拖拽过程中可本地乐观显示。
   - 双击轨道空白处：在该时间添加关键帧，value 取该处插值值（`evaluateTrack`），easing 用 linear；选中它。
   - 点击关键帧：选中并设置播放头到该时间；联动下方「关键帧编辑」区。
   - 删除轨道：二次确认后 `removeTrackFromTimeline` + setTimeline。
5. **关键帧编辑区**（选中关键帧时显示，可放在轨道区下方固定 64–80px）：
   - 时间（ms 整数，0–duration）、value（按属性 min/max/step 校验，非法 notify + 回退）、删除关键帧按钮；
   - 缓动预设 4 个按钮；强度滑块 0–1（linear 时禁用并显示 100% 或“—”；非 linear 时显示百分比）；
   - 实时显示生成的贝塞尔：`p1 [x,y] p2 [x,y]`；修改后写入 `easing = intensityToBezier(presetKey, intensity)`。
   - 改动统一走 `updateKeyframeInTrack` 后 setTimeline。
6. **播放**：requestAnimationFrame 推进（真实时间），到 duration 时 `loop ? 回到 0 : 停止在末尾`；播放时按钮变「暂停」；卸载/切场景清理 rAF。
7. **快捷键**（焦点在 `.vn-tl` 内且 target 不是 input/textarea/select/contenteditable；在根节点 onKeyDown 处理）：
   - Space：播放/暂停，preventDefault；
   - K：在播放头给当前选中轨道添加关键帧（无选中轨道则第一条轨道；无轨道 notify 提示）；preventDefault；
   - ← / →：播放头跳到当前轨道（无则所有轨道）前/后一个关键帧时间；
   - Delete / Backspace：删除选中关键帧；
   - Ctrl/Cmd + 滚轮：缩放时间轴（clamp 0.5–4），preventDefault（用 onWheel + ctrlKey/metaKey）。
8. **滚动/缩放**：时间区横向滚动，缩放影响每秒像素宽（基准约 120px/s，乘缩放系数）；每行关键帧与标尺共用同一 px/ms 计算。
9. **样式**：根 `.vn-tl`；类前缀 `vn-tl-*`（如 `.vn-tl-toolbar`、`.vn-tl-tracks`、`.vn-tl-track`、`.vn-tl-key`、`.vn-tl-ruler`、`.vn-tl-playhead`、`.vn-tl-inspector`、`.vn-tl-menu`）。只用 `styles/base.css` 变量；与现有深色主题一致；文字 11–12px；不要覆盖全局。
10. **健壮性**：所有写入必须 schema 合法（time 整数、value 范围、easing p1x/p2x 0–1、轨道 property 合法）；timeline 切换/资源变化时重置本地选中状态；组件卸载清理 rAF 与事件监听。

### 验收参考（Lead 的 UI smoke 会操作）

- 选中场景节点 → 点击「创建时间轴」→ 添加「立绘 · X 位置」轨道 → 时间区双击加关键帧 → 工具栏/关键帧编辑区截图。
- 拖拽关键帧、K、←/→、Space、Delete、Ctrl+滚轮 都会在浏览器冒烟里抽查；控制台不得报错。

完成后汇报文件、覆盖功能、关键实现差异。若 Lead 的 utils 签名需要补，先按本契约实现并在汇报中说明，不要自行修改 utils。
