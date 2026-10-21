# 阶段三共享契约（蓝图编辑器）

阶段三范围：React Flow 蓝图画布、命名出口端口、贝塞尔连线、拖拽生成、节点/连线属性面板。**不做**时间轴（阶段四）、运行时（阶段五）、打包（阶段六）。

## 文件归属

| 角色 | 文件 |
|---|---|
| Lead | `editor/src/features/blueprint/**`、`editor/src/state/projectMutations.js`、`editor/src/state/useProjectController.js`（增量 action）、`editor/src/screens/ProjectWorkspace.jsx`（集成）、`editor/src/components/AssetPanel.jsx`（加拖拽）、`editor/src/components/LeftBottomPanels.jsx`（结构面板可选中节点）、`tests/phase3/**` |
| ui-inspector | `editor/src/components/inspectors/NodeInspector.jsx`、`SceneInspector.jsx`、`EdgeInspector.jsx`、`controls.jsx`、`editor/src/styles/inspector.css` |

不要改 `editor/src/features/blueprint/**`（Lead 正在并行写）、`schema/`、`electron/**`、`package.json`、阶段一/二测试。

## 可用的项目状态接口

```jsx
import { useProjectController } from '../../state/ProjectContext';
const controller = useProjectController();
const { project, projectDir, actions, notify } = controller;
```
`actions` 在阶段二基础上新增（Lead 正在实现，按此调用）：
- `updateNode(nodeId, patch)`：浅合并节点字段。
- `addNode(node)`：追加完整节点对象（Inspector 一般不需要）。
- `removeNode(nodeId)`：删除节点并清理相关连线。
- `updateNodeExit(nodeId, exitId, patch)`：只改 name/label/description（id 不变）。
- `addNodeExit(nodeId, exit)`：追加出口（caller 提供唯一 id）。
- `removeNodeExit(nodeId, exitId)`：删除出口并清理该出口连线（UI 需保证 choice 至少 2 个）。
- `addEdge(edge)` / `updateEdge(edgeId, patch)` / `removeEdge(edgeId)`。
- `updateMeta/updateSettings/setVariables/updateLayout/updateEditor`（阶段二已有）。

## 组件契约

```jsx
<SceneInspector project={project} projectDir={projectDir} node={node} />
<NodeInspector  project={project} projectDir={projectDir} node={node} />
<EdgeInspector  project={project} edge={edge} />
```
- 三个组件都从 `useProjectController()` 取 actions/notify；不要要求父组件传回调（删除按钮点击 `actions.removeEdge` 等）。
- 组件自己 `import '../../styles/inspector.css'`（一次性）。
- 公共控件放 `controls.jsx`：`FieldNumber` / `FieldText` / `FieldTextArea` / `FieldSelect` / `FieldColor` / `AssetSelect` / `TypedValueEditor` / `Section` / `Row` / `Hint` 等，组件内部使用，不必导出契约。
- **只提交合法数据**：数字输入在 blur/Enter 时校验范围（非法回退并 notify 不提交）；文本最小长度校验；数组/对象用 JSON 文本编辑，失焦 parse 校验；编辑中不要调用 `updateNode` 造成 schema 非法（自动保存会失败）。
- 所有文案中文；类名前缀 `vn-node-insp-*` / `vn-scene-insp-*` / `vn-edge-insp-*` / `vn-insp-ctl-*`，样式只用 `styles/base.css` 变量。

## SceneInspector 分组（必须实现）

A 背景：`background` 可为 null；启用/清除；背景图下拉（`project.assets.images` 中 `role==='background'`）；`fit` cover/contain/stretch；`x/y` 0–1；`scale` 0.05–10；`opacity` 0–1。
B 立绘：`sprites` 列表（≤32）：资产下拉（role=sprite）、`x/y` 0–1、`scale`、`zIndex` 0–1000、`opacity`；添加（默认实例 id 唯一 `sp_1`…，位置 0.5/0.6）、删除、显示缩略图（可用 `assetDataUrl(projectDir, asset)`，允许）。可选：`uiImages` 同结构列表（schema 支持）。
C 文本框：`x/y` 0–1、`width/height` 0.05–1、`fontSizePx` 8–200、`color`、`background`、`backgroundOpacity`、`opacity`、`paddingPx` 0–200。
D 音频：`bgmAssetId`（null 或 role=bgm 资产）、`volume` 0–1、`loop`、`fadeInMs` 0–60000；`sfx[]` 列表（role=sfx 资产 + volume + loop，可增删）。
E 场景变量：`variables[]`：`key`（`^[A-Za-z_][A-Za-z0-9_]{0,63}$`，场景内不重复）、`value`（TypedValueEditor）、`description`；可增删。

节点通用区：名称（1–80，必填）、notes（≤2000）、id/type 只读。

## NodeInspector（按 node.type 分支）

- `dialogue`：text（≤20000，textarea）、speaker（可空 string ≤80，空串→null）、portrait（可关闭；assetId 来自 role=sprite 图片，expression ≤40，x/y 0–1，scale 0.05–10）、voice（可关闭；assetId role=voice，volume 0–1）、speedCps（可空 0–1000）、autoAdvanceMs（可空 0–600000）。`exits` 固定 next，只读展示。
- `choice`：prompt（≤500）；`exits` 列表：name（1–120）可改、id 只读、label 可选；添加出口（id `opt_<n>` 保证唯一，默认名“选项 N”，最多 12）；删除（至少保留 2 个，且需清理该出口连线——用 `actions.removeNodeExit`）；每条出口旁显示是否已连线（查 `project.edges`），未连线黄色提示。
- `minigame`：`minigameAssetId` 下拉（assets.minigames）；切换资产时若当前出口为空或用户点“按声明出口重建”，用资产 `declaredExits` 生成 exits（id `exit_<slug>` 唯一、name=声明串）；exits 可增删改名（id 不变）；`defaultExitId` 下拉（本节点 exit id 或 null）；`timeoutMs` 可空 1000–600000；`instructions` ≤1000；显示“缺失声明出口”错误提示（声明串未在 exits.name 中出现）。
- `video`：`videoAssetId` 下拉（assets.videos）；volume 0–1；loop；showSkipButton；skipAfterMs 可空 0–600000；两固定出口只读。
- `jump`：`targetNodeId` 下拉（项目所有节点；排除自身；显示节点名+类型）；无出口。
- `condition`：`expression` textarea 1–2000；简单静态检查：非空、括号/引号配平，显示“阶段 5 运行时会做完整白名单解析”提示；两个固定出口只读。
- `variable`：`assignments[]`：key（`variableKey`）、op（set/add/subtract/toggle/push）、value（TypedValueEditor；toggle 时隐藏/省略 value，其余必须）；可增删；≤64。
- 其他 type 给只读兜底。

## EdgeInspector

显示 from 节点名、源出口 name、to 节点名、kind（sequence/conditional/data，只读，派生规则见下）、data 字段原始 JSON 只读（若有）；删除按钮（二次确认后 `actions.removeEdge`）；提示：condition 出边为 conditional，其余为 sequence；data 连线第一版不创建。

## 验收

- `pnpm --filter @vn-studio/editor build` 成功。
- `pnpm test` 全绿（Lead 会补阶段三测试）。
- Lead 的 UI 冒烟会截图蓝图和各类属性面板；如样式需要微调，按 Lead 后续消息修改。
