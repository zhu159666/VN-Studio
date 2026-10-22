# Command Bus（MCP-ready）

`editor/src/commands/` 是编辑器的 **AI 可调用操作层**：每个 command 对应一个未来可能被 MCP / AI 调用的编辑操作。它不依赖 React、DOM 或 Electron，只接受纯 JSON 参数并返回纯 JSON 结果，因此同一套 command 可以在渲染进程、主进程（MCP server）和 Node 测试里复用。

设计参考 MCP 的工具模型：工具名 + description + JSON Schema 输入，执行结果返回结构化内容（[MCP Tools 规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)）。

## 1. 契约

```js
import { executeCommand, listCommands, commandsToMcpTools } from './src/commands/index.js';

const result = executeCommand(project, 'blueprint.createNode', {
  type: 'dialogue',
  name: '雨夜独白',
});
```

成功：

```json
{
  "ok": true,
  "command": "blueprint.createNode",
  "affectedNodeIds": ["n_dialogue_ab12cd"],
  "affectedTrackIds": [],
  "warnings": [],
  "data": { "node": { "id": "n_dialogue_ab12cd", "type": "dialogue", "...": "..." } },
  "project": { "...": "更新后的完整项目（新对象，原 project 不被修改）" }
}
```

失败（不会抛异常）：

```json
{
  "ok": false,
  "command": "blueprint.connect",
  "affectedNodeIds": [],
  "affectedTrackIds": [],
  "warnings": [],
  "error": { "code": "E_CONNECTION_INVALID", "message": "源出口不存在" }
}
```

约定：

- 参数必须可 `JSON.stringify`；由 `inputSchema`（JSON Schema draft-07）校验。
- `project` 只在成功时返回，且是**新对象**；调用方负责持久化（编辑器 action 会标脏，MCP 侧需写回 `project.json`）。
- `affectedNodeIds` / `affectedTrackIds` 是本次操作影响到的 id（去重、只含字符串）。
- 命令是同步纯函数；`executeCommand` 捕获异常并转成 `E_COMMAND_FAILED`。
- 需要幂等重试时，创建类命令可显式传 `nodeId` / `edgeId` / 出口 `id`；否则每次生成新 id。

## 2. 命令列表

| command | 类别 | 作用 |
|---|---|---|
| `blueprint.createNode` | blueprint | 创建 8 类节点之一（`type` 必填，可指定 `nodeId` / `position` / `name` / minigame、video 的 `assetId`） |
| `blueprint.connect` | blueprint | 按 `fromNodeId` + `fromExitId` → `toNodeId` 连线；同出口旧连线会被替换并返回 `replacedEdgeId` |
| `blueprint.addExit` | blueprint | 给 choice / minigame 节点新增出口（自动 id：`opt_N` / `exit_N`，可显式指定） |
| `blueprint.updateExit` | blueprint | 改出口 `name`（固定出口不允许）/ `label` / `description` |
| `blueprint.removeExit` | blueprint | 删除出口并级联删连线；choice 最少 2 个、minigame 最少 1 个 |
| `blueprint.setDefaultExit` | blueprint | 设置 / 清空 minigame 的 `defaultExitId` |
| `timeline.addKeyframe` | timeline | 在场景时间轴加（或覆盖同一时间点）关键帧；可自动创建时间轴与轨道 |
| `timeline.updateKeyframe` | timeline | 修改已有 keyframe 的时间 / 数值 / 缓动 |
| `timeline.removeKeyframe` | timeline | 删除 keyframe（轨道至少保留 1 个） |
| `timeline.removeTrack` | timeline | 删除整条轨道 |

`listCommands()` 返回每个命令的 `name`、`mcpName`、`category`、`title`、`description`、`inputSchema`。

### 参数示例

```jsonc
// blueprint.createNode
{ "type": "scene", "name": "天台", "position": { "x": 400, "y": 120 } }

// blueprint.connect
{ "fromNodeId": "n_scene_a", "fromExitId": "next", "toNodeId": "n_dialogue_b" }

// blueprint.addExit
{ "nodeId": "n_choice_a", "name": "说实话", "label": "选项 3" }

// timeline.addKeyframe
{
  "sceneNodeId": "n_scene_a",
  "kind": "background",       // sprite / background / audio / textbox
  "property": "opacity",
  "time": 1200,
  "value": 0.6,
  "preset": "easeInOut",      // linear / easeIn / easeOut / easeInOut
  "intensity": 0.5
}
```

时间轴规则：

- `timeline.addKeyframe` 不传 `trackId` 时必须给 `kind` + `property`；轨道不存在会自动创建。
- `sprite` 轨道需要 `target`（场景 `sprites[].id`）。
- `time` 不得超出时间轴 `durationMs`（默认 5000ms）。
- 数值会按属性范围收敛（如 opacity 0–1），并通过 `warnings` 告知。
- `removeKeyframe` 不允许删掉轨道最后一个关键帧，需用 `removeTrack`。

出口规则：

- 固定出口类型（dialogue / scene / condition / video）不能增删出口或改 `name`，但可以改 `label` / `description`。
- jump 节点没有出口。
- choice：2–12 个出口；minigame：1–16 个出口。

## 3. MCP 映射

```js
import { commandsToMcpTools } from './src/commands/index.js';

const tools = commandsToMcpTools();
// [{ name: 'blueprint_createNode', description, inputSchema }, ...]
```

- `tools/list`：直接返回 `commandsToMcpTools()`。
- `tools/call`：

```js
const toolName = 'blueprint_createNode';       // MCP 工具名（下划线）
const args = JSON.parse(contentParams);
const result = executeCommand(project, toolName, args);
return { content: [{ type: 'text', text: JSON.stringify(result) }] };
```

- `executeCommand` 同时接受点号名 `blueprint.createNode` 和 MCP 下划线名 `blueprint_createNode`，`result.command` 始终是点号规范名。
- MCP 服务端负责：读取 `project.json` → 执行 → 成功时把 `result.project` 写回 → 返回 `result`（建议同时返回 `content` 文本与 `structuredContent`，便于客户端消费）。

## 4. 编辑器内的调用路径

- 渲染进程：`controller.actions.executeCommand(name, params)`；成功后会替换项目并标记 dirty（自动保存/手动保存流程不变）。
- 未来 MCP：主进程可直接 `import` 本目录的纯函数，对磁盘上的 `project.json` 执行 headless 操作，不依赖打开的编辑器。
- 可选扩展：新增 `commands:list` / `commands:execute` IPC，把主进程收到的 AI 操作转发给渲染进程的当前项目；现有纯函数层无需改动。

## 5. 错误码

| code | 含义 |
|---|---|
| `E_INVALID_PROJECT` | project 结构无效（缺 nodes / edges） |
| `E_UNKNOWN_COMMAND` | 未知 command |
| `E_INVALID_PARAMS` | 参数不符合 inputSchema |
| `E_NODE_NOT_FOUND` | 节点不存在 |
| `E_NOT_SCENE` | 时间轴操作目标不是场景节点 |
| `E_DUPLICATE_NODE_ID` | 显式 nodeId 冲突 |
| `E_DUPLICATE_EDGE_ID` | 显式 edgeId 冲突 |
| `E_CONNECTION_INVALID` | 源/目标节点或出口不存在、jump 无出口 |
| `E_FIXED_EXITS` | 固定出口节点不支持该操作 |
| `E_EXIT_NOT_FOUND` / `E_DUPLICATE_EXIT_ID` | 出口不存在 / id 冲突 |
| `E_EXIT_LIMIT` / `E_EXIT_MIN` | 超出出口数量上限 / 低于下限 |
| `E_INVALID_TRACK` | 轨道属性与素材类型不匹配、sprite 缺少 target |
| `E_TRACK_NOT_FOUND` / `E_TIMELINE_NOT_FOUND` | 轨道 / 时间轴不存在 |
| `E_TIME_OUT_OF_RANGE` | 关键帧时间超出时间轴时长 |
| `E_KEYFRAME_NOT_FOUND` / `E_DUPLICATE_TIME` | 关键帧不存在 / 目标时间已有关键帧 |
| `E_LAST_KEYFRAME` | 不允许删除轨道最后一个关键帧 |
| `E_ASSET_REQUIRED` / `E_ASSET_NOT_FOUND` | minigame / video 节点缺少或找不到素材 |
| `E_COMMAND_FAILED` | 命令内部异常（已捕获） |

## 6. 测试

```bash
node --test tests/phase8/commands.test.mjs
```

覆盖：描述可映射 MCP、8 类节点创建、连线与替换、choice/minigame 出口增删改与级联、固定出口保护、时间轴自动建轨道/增改删关键帧、轨道删除、JSON 结果结构、原项目不可变、schema 合法性。
