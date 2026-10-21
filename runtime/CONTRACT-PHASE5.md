# 阶段五共享契约（纯浏览器运行时）

阶段五范围：`runtime/` 纯浏览器原生 JS（Canvas + DOM）播放项目文件；不依赖 Electron/React/任何现有 VN 引擎。编辑器「演示」Tab 内嵌该运行时。

## 文件归属

| 角色 | 文件 |
|---|---|
| Lead | `runtime/CONTRACT-PHASE5.md`、`editor/src/features/preview/RuntimePreview.jsx`、`editor/src/screens/ProjectWorkspace.jsx`、`editor/vite.config.js`、`scripts/runtime-smoke.mjs`、`scripts/ui-smoke.mjs`、`tests/phase5/integration.test.mjs` |
| runtime-core | `runtime/expression.js`、`runtime/engine.js`、`runtime/timeline.js`、`tests/phase5/expression.test.mjs`、`tests/phase5/engine.test.mjs` |
| runtime-ui | `runtime/runtime.js`、`runtime/storage.js`、`runtime/index.html`、`runtime/runtime.css` |

不要修改 schema、editor 其他源码、package.json、阶段 1–4 测试。不要新增依赖。runtime 代码必须是原生 ESM，可直接静态服务器部署。

## 通用约定

- `runtime/*.js` 全部 ESM；`engine.js` / `expression.js` / `timeline.js` **不得引用 DOM / window / document / IndexedDB**，以便 Node 单元测试。
- 项目对象就是 schema 根对象（game.json）。资源路径是相对 `assets/` 的 `assets/...`。
- 运行时内部变量表使用 schema 的 typedValue（`{type,value}`）；表达式使用普通 JS 值。
- 时间单位毫秒；缓动只用 cubic-bezier 求值（不识别预设名）。
- 中文错误/警告，`console.warn`；引擎不得抛未捕获异常给 UI。

## runtime/expression.js

导出：
```js
export class ExpressionError extends Error {}           // 可不用
export function evaluateExpression(expression, variables) // variables: 普通对象
  // -> { ok:true, value } | { ok:false, error }
```
按 `schema/FIELDS.md` 第 8 节白名单语法完整实现：字面量（数字/单双引号字符串/true/false/null）、变量、括号、`!`/一元`-`、`+ - * / %`、`== != < <= > >=`、`&& ||`、`in`、`.` 成员访问、`[]` 下标、白名单函数 `len/type/isNumber/isString/isBoolean/isArray/isObject/isNull/abs/floor/ceil/round/min/max`。
- 禁止 `eval/Function`、赋值、原型链键（`__proto__/constructor/prototype` 一律 error）、任意函数。
- 未知标识符/语法错误/类型错误/除零 → `{ok:false,error}`；`==/!=` 深度相等、不同类型 false/true；`+` 数值或字符串拼接；`in` 数组包含（深比较）/字符串子串/对象自有键；真值规则见 FIELDS 8.7；成员/下标不存在返回 null。
- 兼容 `//` 无注释（不支持注释）。

## runtime/timeline.js

```js
export function cubicBezierY(p1, p2, t)            // 0–1 输入，返回 easing 后的进度
export function evaluateTrack(track, timeMs)       // 首帧前/末帧后保持，段内用目标帧 easing 插值
export function getTimeline(project, sceneNodeId)  // project.timelines[id] | null
export function resolveSceneValues(project, sceneNode, timeMs)
// 返回 { background, sprites, uiImages, textbox, audio, overridden:[...] }
// 规则与编辑器一致：时间轴覆盖蓝图静态值，未覆盖沿用蓝图；音频 volume 被 audio track 覆盖
export function sampleTimeline(project, sceneNodeId, timeMs) // 可选便捷函数
```

## runtime/engine.js（核心，必须严格按此 API）

```js
export const ENGINE_STATUS = { RUNNING:'running', ENDED:'ended', ERROR:'error' };
export function createEngine({ project, startNodeId, autoStart = false, save = null })
```
返回对象字段/方法：
```js
engine.project
engine.status        // 'running' | 'ended' | 'error'
engine.error         // string | null
engine.warnings      // string[]
engine.nodeId        // 当前节点 id
engine.variables     // typedValue map（内部）
engine.playtimeMs
engine.stage         // null | { sceneNodeId, timeMs }
engine.pending       // null | { type:'dialogue'|'scene'|'choice'|'minigame'|'video' }
engine.start()       // 从 startNodeId（或参数）开始；autoStart 时构造阶段可自动调用
engine.advance()     // dialogue/scene：沿 next 出口推进；其它类型返回 {ok:false,error}
engine.choose(exitId) // choice：按出口 id 推进
engine.submitMinigameResult(result) // result 必须 string（格式已由 UI 校验）；返回 {ok, matched, exitId?, error?}
engine.timeoutMinigame()            // 超时按无匹配处理（不写 last_minigame_result）
engine.completeVideo(outcome)       // 'completed' | 'skipped'
engine.tick(deltaMs)                // playtime + 当前 scene 时间轴时间（loop/clamp 到 duration）
engine.getCurrentNode()
engine.getNodeById(id)
engine.getRenderState()             // 见下
engine.serialize({ kind='manual', slot=1, projectTitle, thumbnailDataUrl=null, label=null })
engine.loadSave(saveState)          // 恢复变量/节点/时间轴进度/playtime；返回 {ok,error?}
```
### 推进语义

- 自动节点：`jump`→targetNodeId；`condition`→表达式 true/false 出口（求值错误 `console.warn` + warnings 并走 false）；`variable`→执行 assignments 后走 next。自动节点连续执行直到遇到可交互节点或错误/结束。
- 可交互节点：
  - `scene`：进入时应用场景 `variables`（**仅当全局变量表没有该 key 时**用其 typedValue 初始化）；stage={sceneNodeId,timeMs:0}；待 `advance()` 沿 next 推进。离开场景后 `stage` 保留（舞台继续显示，时间冻结），直到进入下一个 scene。
  - `dialogue`：待 `advance()`；沿 next。
  - `choice`：待 `choose(exit.id)`；出口不存在/无出边 → error。
  - `minigame`：待 `submitMinigameResult(result)`；result 字符串先写入 `last_minigame_result`（typed string）；用 result 与 `exit.name` **精确匹配**；无匹配走 `defaultExitId`，再没有则 status=error；随后沿匹配出口推进。`timeoutMinigame()` 不写 last_minigame_result，按无匹配走 defaultExitId/error。
  - `video`：待 `completeVideo('completed'|'skipped')`，沿固定出口推进。
- 出口→边：按 `edges` 中 `from===nodeId && port===exitId` 且 kind 为 sequence/conditional 的唯一边；data 忽略；找不到/多条 → error。`jump` 无出口。
- 变量操作语义：`set` 替换 typedValue；`add/subtract` 目标必须 number 且 value 必须 number 标签；`toggle` 目标必须 boolean；`push` 目标必须 array（追加 value.value）；类型不符/变量不存在 → `console.warn` + warnings 并跳过该条，不中断。`last_minigame_result` 只允许 string typedValue。
- `tick(deltaMs)`：playtimeMs += delta；若 engine.pending.type==='scene' 且 stage 存在：timeMs += delta；若该场景有 timeline：loop=true 时 timeMs %= durationMs，否则 clamp 到 durationMs。
- 时间轴求值使用 `resolveSceneValues(project, sceneNode, stage.timeMs)`；无场景时舞台用默认 textbox（与编辑器默认一致：x .5 y .84 width .92 height .22 fontSizePx 28 color #fff background #000 backgroundOpacity .55 opacity 1）和 settings.backgroundColor。
- 结束：没有可交互节点/显式无法推进 → status='ended' 或 'error'，UI 显示。

### getRenderState()

```js
{
  status, error, nodeId, nodeType,
  playtimeMs,
  stage: {
    sceneNodeId | null,
    timeMs,
    background: null | { assetId, fit, x, y, scale, opacity },
    sprites: [{ id, assetId, x, y, scale, zIndex, opacity }],
    uiImages: [{...}],
    textbox: {...},
    audio: { bgmAssetId, volume, loop, sfx }
  },
  dialogue: null | { speaker, text, portrait, voice, speedCps, autoAdvanceMs },
  choice: null | { prompt, options: [{ id, name, label }] },
  minigame: null | { nodeId, minigameAssetId, path, exits:[{id,name}], defaultExitId, timeoutMs, instructions, mode },
  video: null | { nodeId, videoAssetId, path, volume, loop, showSkipButton, skipAfterMs },
  ended: boolean
}
```
`node` 字段可加当前 node 对象（可选）。资源 path 从 project.assets 查。

### serialize / loadSave

- serialize 输出 **schema `$defs.saveState` 形状**：`{version:1,kind,slot,savedAt,projectId,schemaVersion:1,nodeId,variables, timeline: stage? {nodeId:stage.sceneNodeId,timeMs:Math.round(stage.timeMs)}:null, thumbnailDataUrl, playtimeMs, label?, projectTitle?}`；slot 规则由 UI 传参。
- loadSave：校验 `projectId===project.meta.id`、schemaVersion===1、nodeId 存在；恢复 variables（deep clone）、playtimeMs；进入保存节点（自动节点会重新推进，但**不要覆盖已有变量**），再恢复 stage：若 save.timeline 存在则 stage={sceneNodeId,timeMs}；若当前节点是 scene 则以该 scene 为 stage。返回 `{ok,error?}`。
- `startNewGame` 等价于 engine.start()。

## runtime-ui（runtime/runtime.js、storage.js、index.html、runtime.css）

### storage.js（IndexedDB 存档）
```js
export function createIndexedDbStorage({ dbName = 'vn-studio-runtime' } = {}) -> {
  async list(projectId)          // [{key,kind,slot,savedAt,...saveState}]
  async get(projectId,kind,slot) // saveState|null
  async put(saveState)           // 以 `${projectId}:${kind}:${slot}` 为 key
  async remove(projectId,kind,slot)
}
```
keyPath `key`；对象存储 `saves`。浏览器不支持 IndexedDB 时抛清晰错误（UI 提示）。

### runtime.js
```js
export function createRuntime({
  root,                    // HTMLElement
  project,                 // 项目对象
  assetBaseUrl = './',     // 默认相对此解析 assets
  resolveAssetUrl = null,  // 可选 async (relativePath)=>url；编辑器传 vnasset
  storage = null,          // 默认 createIndexedDbStorage()
  autoStart = false,
  showTitle = true,
  onStateChange = null,
}) -> runtime
runtime.startNewGame()
runtime.continueAuto()     // 读取 auto 存档
runtime.loadSlot({kind,slot})
runtime.openSaveMenu()
runtime.restart()          // 回到 startNode 重开（保留 UI）
runtime.getEngine()
runtime.destroy()
```
实现要求：
- Canvas 舞台：按 `settings.resolution` 内部尺寸；根元素内等比 contain；背景 cover/contain/stretch + x/y/scale/opacity；立绘按 zIndex 绘制（自然尺寸×scale，中心锚点）；uiImages 同；文本框图/背景/透明度/字号/颜色；台词逐字显示（settings.textSpeedCps 或 dialogue.speedCps，0 瞬显）；说话人；portrait 图片；对话框内自动折行。
- 场景动画：requestAnimationFrame → `engine.tick(dt)`；每帧用 `getRenderState()` 绘制舞台；离开 scene 后舞台冻结（引擎已冻结时间）。
- 点击舞台/Space/Enter：打字中 → 立即显示全文；已显示 → `engine.advance()`。
- 选项：DOM 按钮叠加（prompt + options label/name），数字键 1–9 可选；点击 `engine.choose(id)`。
- 小游戏：全屏 iframe 覆盖，`sandbox="allow-scripts"`（只此一个），src=resolveAssetUrl(asset.path)；监听 window message：来源必须是 iframe.contentWindow，data 必须是对象且 type==='minigame-result' 且 result 为 string；非法静默丢弃 + console.warn；合法调用 `engine.submitMinigameResult(result)`；按 node.timeoutMs（或 settings.runtime.defaultMinigameTimeoutMs）超时调 `engine.timeoutMinigame()`；显示 instructions；结果处理/节点切换后销毁 iframe。
- 视频：DOM `<video controls autoplay>` 覆盖 + 右上「跳过」按钮（showSkipButton），显示 controls/进度；播放期间暂停 BGM，`ended`→completeVideo('completed')，跳过→'skipped'（skipAfterMs 之前禁用跳过）；结束/卸载恢复 BGM。
- BGM：HTMLAudioElement；进入 scene 或有 bgmAssetId 变化时加载/切换；volume 每帧用 stage.audio.volume（含时间轴覆盖）；loop 按场景 audio.loop；fadeInMs 可选渐变。sfx：进入 scene 播放一次性（loop false）；voice：进入 dialogue 播放。
- 存档菜单：按钮（右上「菜单」）→ 覆盖层，包含「保存 / 读取」tab、手动槽位 1–9 + 自动存档（只读）+ 快速槽位；每槽显示时间/标题/缩略图（canvas.toDataURL('image/webp')）；保存已有槽二次确认；读取后恢复渲染；删除二次确认；关闭返回。自动存档：进入 scene 且 settings.autoSave.enabled !== false 时写入 kind='auto', slot=0（静默）。
- 标题界面（showTitle）：游戏标题/作者/描述 + 「开始游戏」「继续（自动存档）」「读取存档」；autoStart 时跳过标题直接新游戏。
- 结束界面：status ended/error 显示「重新开始 / 返回标题」。
- 资源 URL 统一 `resolveAssetUrl(relativePath)`（编辑器为 vnasset，独立运行时为 new URL(rel, assetBaseUrl)）；图片/音频/视频加载失败显示 console.warn + 占位。
- 样式：`runtime.css` 前缀 `vnrt-*`，深色、独立（不依赖编辑器 CSS）；`index.html` 提供 `#app` 与脚本：fetch `?game=` 或 `./game.json` → createRuntime({root, project, assetBaseUrl: 相对于 game.json, showTitle:true})；失败显示错误。
- 不依赖网络资源；不使用 eval；小游戏 iframe 不得加 allow-same-origin/popups/top-navigation。

## 验收

- `node --test "tests/phase5/*.test.mjs"` 全绿（runtime-core 提供表达式/引擎/时间轴测试；Lead 补集成）。
- `pnpm editor:build` 成功；编辑器「演示」Tab 可用 IPC mock 截图。
- `node scripts/runtime-smoke.mjs`：生成临时 game.json + 媒体，启动本地静态服务器，Edge headless 截图标题/舞台/选项/菜单，无控制台错误。
