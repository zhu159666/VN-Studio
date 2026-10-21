# 视觉小说项目文件字段说明（schemaVersion = 1）

> 对应文件：`schema/schema.json`（JSON Schema draft 2020-12，66 个 `$defs`）。本文是字段说明与行为约定；**结构以 schema 为准**，两者冲突时以 schema 为准（机器可校验契约），行为语义以本文为准。
>
> 阶段：一/二（格式草案 + 项目文件与素材管理实现）。阶段一只定义文件格式与字段语义；阶段二在 `editor/` 实现项目读写与素材导入/管理。文中标注「编辑器约定」的内容是界面行为约定，不属于 schema 字段。
>
> 读者：作者（用编辑器写剧情）与开发者（实现编辑器 / 运行时）。所有字段名、枚举值、必填性、`pattern` 均与 `schema.json` 逐项对齐。

**标记约定**：✓ = schema `required`（必须出现）；— = 可选；「可空」= 必须出现但值可为 `null`；「编辑器约定」= 不属于 schema 的界面行为。

---

## 1. 概览与文件组织

### 1.1 项目目录

一个视觉小说项目在磁盘上的标准形态：

```text
my-project/
├─ project.json          # 编辑器项目文件（本 schema 根对象；导出后叫 game.json）
├─ assets/               # 最终素材：images/ audio/ videos/ minigames/
│  └─ .source/           # 原始导入文件（只读，不参与导出），供二次编辑重新烘焙
└─ saves/                # 运行时存档：slot_N.json / auto.json / quick.json
```
- **`project.json`**：编辑器中打开/保存的文件，对象结构就是 `schema/schema.json` 的根对象。
- **`game.json`**：点击导出后写入 Web 包的文件，**内容结构与 `project.json` 完全相同**（同一个 schema）。运行时只读 `game.json` + `assets/`。
- **`assets/`**：图片 / 音频 / 视频 / 小游戏文件。项目文件里只存引用（`assetId` + 相对路径），素材本体在目录中。图片与音频另有 `source` 字段指向 `assets/.source/` 下的原始导入文件；导出时只带最终文件，不带 `.source/`。
- **`saves/`**：运行时产物，**不属于项目文件**，schema 顶层没有 `saves` 字段；单个存档的结构由 `$defs.saveState` 定义（见第 10 节）。导出包不携带作者机器上的存档。
- 所有素材路径使用 `/` 分隔、禁止 `..` 逃逸（schema `assetPath` / `minigamePath` 已用 `pattern` 约束）。

### 1.2 schemaVersion = 1

`schemaVersion` 是**结构版本**，值为常量 `1`（schema 里是 `const: 1`）。它与 `meta.version`（作者维护的内容版本，形如 `1.2.0`）是两回事。递增与迁移规则见第 13 节。

### 1.3 编辑器与运行时共用同一份格式

| 字段组 | 编辑器 | 运行时 |
| --- | --- | --- |
| `meta` | 读写、展示标题/作者 | 忽略（可读取标题） |
| `settings` | 属性面板编辑 | 读取起始节点、分辨率、底色、文字速度、自动存档等 |
| `assets` | 导入、预览、编辑参数 | 按 `path` 加载素材 |
| `variables` | 变量面板编辑初值 | 作为变量表初值 |
| `nodes` / `edges` | 蓝图编辑 | 按 `startNodeId` + 出口推进流程 |
| `timelines` | 时间轴编辑 | 按场景节点 id 播放关键帧 |
| `layout` | **持久化**布局状态 | **忽略** |
| `editor` | **持久化**会话状态（选中、视口等） | **忽略** |

### 1.4 两套坐标系 + 时间单位（最容易混的地方）

| 坐标系/单位 | 出现在 | 范围与方向 | 运行时 |
| --- | --- | --- | --- |
| 蓝图坐标（像素） | 所有节点的 `position`（`graphPoint`） | 单位 px，蓝图 canvas 左上角为原点，x 向右、y 向下；只用于编辑器摆节点 | **忽略** |
| 舞台归一化坐标 | `background.x/y`、`sprite.x/y`、`textbox.x/y`、`portrait.x/y` | 0–1 相对坐标；舞台左上角为 (0,0)，x 向右、y 向下 | 使用 |
| 归一化尺寸 | `textbox.width/height`（0.05–1）、`sprite/background.scale`（0.05–10） | 相对舞台宽/高 | 使用 |
| 比例值 | `opacity`、`volume`、`backgroundOpacity` 等 | 0–1 | 使用 |
| 时间 | `timeline.durationMs`、`keyframe.time`、`audioAsset.durationMs`、`saveState.timeline.timeMs`、`playtimeMs` | **毫秒整数** | 使用 |
| 字号/速度 | `textbox.fontSizePx`（px）、`dialogue.speedCps`（字/秒） | — | 使用 |

> 记住三句话：**节点位置是像素（编辑器专用），画面位置是 0–1（运行时），所有时间是毫秒。**

### 1.5 本阶段范围

本阶段只定义格式（字段、枚举、必填性、引用关系、校验规则、表达式白名单、时间轴缓动等数据契约），不定义界面实现、运行时渲染/音频/存档代码。第 11 节是布局与快捷键的产品约定，供第二阶段实现；`schema/schema.json` 是结构权威，本文是字段与语义说明，`examples/demo-project.json` 是可校验的完整样例。

---

## 2. 顶层字段速查表

根对象 `additionalProperties: false`：**未知顶层字段会被 schema 拒绝**。根对象的 `required` 共 8 项：`schemaVersion`、`meta`、`settings`、`assets`、`variables`、`nodes`、`edges`、`timelines`。后两者虽然是必填键，但可以是空数组 / 空对象。

schema 共 66 个 `$defs`，本文按用途分组覆盖全部字段：基础模式 def（`isoDateTime` / `color` / `normalizedCoord` / `opacity` / 各 id 与路径 pattern）、`meta` / `settings` / `assets`、8 类节点（场景内部结构 `sceneBackground` / `sprite` / `textbox` / `sceneAudio` / `sfxRef` / `sceneVariable` 按 4.2 的属性面板分组说明）、`edge`、4 类轨道与 `keyframe` / `easing`、`layout` / `editorState`、`saveState`。

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `$schema` | string | — | 省略 | 可选，指向 schema 的路径/URL，供编辑器与 IDE 校验；运行时不用 |
| `schemaVersion` | integer，`const 1` | ✓ | — | 文件结构版本，见 1.2 / 第 13 节 |
| `meta` | object（`$defs.meta`） | ✓ | — | 项目元信息，见 2.1 |
| `settings` | object（`$defs.settings`） | ✓ | — | 项目级运行设置，见 2.2 |
| `assets` | object（`$defs.assets`） | ✓ | — | 素材库四张表，见 2.3 / 第 6 节 |
| `variables` | object（`$defs.variableMap`） | ✓ | 可为 `{}` | 全局变量名 → 带类型标签的值，见第 7 节 |
| `nodes` | array\<node\>，`minItems: 1` | ✓ | — | 全部蓝图节点（至少 1 个），见第 3、4 节 |
| `edges` | array\<edge\> | ✓ | 可为 `[]` | 统一连线表，见第 5 节 |
| `timelines` | object（`$defs.timelineMap`） | ✓ | 可为 `{}` | 键为场景节点 id，见第 9 节 |
| `layout` | object（`$defs.layout`） | — | 省略 = 编辑器内置默认 | **编辑器持久化，运行时忽略**，见第 11 节 |
| `editor` | object（`$defs.editorState`） | — | 省略 = 空会话 | **编辑器持久化，运行时忽略**，见第 11 节 |

> 关于「默认」：schema **没有使用 `default` 关键字**。表中默认值只登记 schema `description` 明文写出的默认（如布局宽度），其余「省略」语义是本文约定；不写某个可选字段就是省略它。

### 2.1 meta

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `projectId`（`^[A-Za-z][A-Za-z0-9_-]{7,63}$`） | ✓ | 项目稳定标识，创建时生成一次；存档用它防串档（第 10 节） |
| `title` | string，1–200 字符 | ✓ | 项目标题 |
| `author` | string，≤200 | — | 作者名 |
| `description` | string，≤2000 | — | 项目简介 |
| `version` | string，`^\d+\.\d+\.\d+$` | — | 内容版本（作者维护），区别于 `schemaVersion` |
| `createdAt` | `isoDateTime`（UTC，`YYYY-MM-DDTHH:mm:ss[.sss]Z`） | ✓ | 创建时间，`new Date().toISOString()` 格式 |
| `updatedAt` | `isoDateTime` | ✓ | 最近保存时间 |
| `tags` | array\<string ≤40\>，唯一，≤20 项 | — | 标签 |

### 2.2 settings

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `startNodeId` | `nodeId` 或 `null` | ✓（可空） | 游戏开始节点；`null` 时导出校验报错，编辑器必须先指认入口 |
| `resolution` | object `{width: integer 320–7680, height: integer 240–4320}` | ✓ | 运行时画布分辨率；编辑器按此比例预览 |
| `backgroundColor` | `color` | ✓ | 舞台底色（无背景图时可见） |
| `textSpeedCps` | number，0–1000 | ✓ | 默认文字速度（字/秒），0 = 瞬显；对话节点 `speedCps` 可覆盖 |
| `autoSave` | object，可选字段 `enabled`: boolean、`onSceneEnter`: boolean | — | 自动存档开关；自动存档写独立文件 `saves/auto.json` |
| `runtime` | object，可选字段 `allowSkipUnread`: boolean、`defaultMinigameTimeoutMs`: integer 1000–600000 | — | 运行时行为开关；小游戏节点 `timeoutMs` 优先于 `defaultMinigameTimeoutMs` |
| `locale` | string，`^[a-z]{2}(-[A-Z]{2})?$` | — | 界面语言提示，如 `zh-CN` |

### 2.3 assets（四张表）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `images` | array\<`imageAsset`\> | ✓ | 图片素材（背景 / 立绘 / UI / 其他） |
| `audio` | array\<`audioAsset`\> | ✓ | 音频素材（bgm / sfx / voice） |
| `videos` | array\<`videoAsset`\> | ✓ | 视频素材 |
| `minigames` | array\<`minigameAsset`\> | ✓ | 小游戏素材（自包含 HTML5） |

四个数组都必须存在（可为空数组）；**素材 id 在全库内唯一**（跨四个数组）。字段细节见第 6 节。

### 2.4 variables

`object`，键为 `variableKey`（`^[A-Za-z_][A-Za-z0-9_]{0,63}$`），值为 `typedValue`（带类型标签）。示例见第 7 节。

### 2.5 nodes（8 类联合）

| `type` | 语义 | 必填字段（除公共五项外） | 出口 | 详见 |
| --- | --- | --- | --- | --- |
| `dialogue` | 显示一句台词 | `text` | 固定 `next` ×1 | 4.1 |
| `scene` | 布置舞台 + 时间轴挂载点 | `background`、`sprites`、`textbox`、`audio`、`variables` | 固定 `next` ×1 | 4.2 |
| `choice` | 选项分支 | —（`prompt` 可选） | 作者出口 2–12 个 | 4.3 |
| `minigame` | 阻塞式小游戏 | `minigameAssetId`、`defaultExitId` | 作者出口 1–16 个 | 4.4 |
| `video` | 视频播放 | `videoAssetId` | 固定 `completed` / `skipped` ×2 | 4.5 |
| `jump` | 无画面跳转 | `targetNodeId` | 0 个（`exits: []`） | 4.6 |
| `condition` | 条件分支 | `expression` | 固定 `true` / `false` ×2 | 4.7 |
| `variable` | 变量操作 | `assignments` | 固定 `next` ×1 | 4.8 |

公共字段：`id`、`type`、`name`、`position`、`exits`（全部必填），`notes`（可选，≤2000 字符）。

### 2.6 edges

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `edgeId` | ✓ | 连线 id，项目内唯一 |
| `from` | `nodeId` | ✓ | 源节点 |
| `port` | `exitId` | ✓ | 源节点的**出口 id**（不是显示名） |
| `to` | `nodeId` | ✓ | 目标节点 |
| `kind` | `"sequence"` \| `"conditional"` \| `"data"` | ✓ | 连线语义 |
| `data` | object（任意键值） | — | 数据流预留载荷；第一版运行时忽略 |

语义与校验见第 5 节。

### 2.7 timelines

`object`，键必须是场景节点 id（`nodeId`），值为 `timeline`。只有 `type: "scene"` 的节点可以拥有时间轴。结构见第 9 节。

### 2.8 layout（编辑器持久化，运行时忽略）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `leftWidth` | number，200–480 | — | 左栏宽度 px，description 写明默认 280 |
| `rightWidth` | number，240–560 | — | 右栏宽度 px，默认 320 |
| `timelineHeight` | number，120–600 | — | 时间轴高度 px，默认 200 |
| `rightCollapsed` | boolean | — | 右栏是否折叠 |
| `leftBottomPanel` | `"variables"` \| `"structure"` \| `"minigameExits"` | — | 左栏下方面板三选一，默认 `variables` |
| `assetView` | `"list"` \| `"grid"` | — | 素材列表视图：列表 / 网格 |
| `assetTypeFilter` | `"all"` \| `"image"` \| `"audio"` \| `"video"` \| `"minigame"` | — | 素材类型筛选 |

### 2.9 editor（编辑器持久化，运行时忽略）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `viewport` | object `{x: number, y: number, zoom: number 0.1–4}` | — | 蓝图视口平移与缩放 |
| `selectedNodeIds` | array\<`nodeId`\>，唯一 | — | 当前选中的节点（支持多选） |
| `selectedEdgeId` | `edgeId` 或 `null` | — | 当前选中的连线 |
| `selectedAssetId` | `assetId` 或 `null` | — | 当前选中的素材 |
| `activeTab` | `"blueprint"` \| `"preview"` | — | 中栏当前 Tab：蓝图 / 演示 |
| `timelinePlayheadMs` | integer，≥0 | — | 时间轴播放头位置（毫秒） |

---

## 3. 统一命名出口模型

### 3.1 为什么所有节点都有 `exits` 数组

`nodes` 是 8 类节点的 `oneOf` 联合，但**每个节点的出口都统一成数组 `exits`**，连线统一写入 `edges[].port`。好处：

1. 运行时只有一套推进逻辑：拿到 `node.exits` 里某个 `exit.id` → 查 `edges` 中 `from=node.id && port=exit.id` 的边 → 走到 `to`。
2. 出口数量可变（choice / minigame）与固定（dialogue / video / condition）用同一结构表达，不需要为「多出口」单独设计节点类型。
3. 出口有稳定 id，作者改显示名不会断线。

### 3.2 exit 对象

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `exitId`（`^[A-Za-z][A-Za-z0-9_-]{0,63}$`） | ✓ | 出口 id。创建后**不可变**；`edge.port` 存的就是它 |
| `name` | string，1–120 字符 | ✓ | 出口显示名。choice 中即选项文本；minigame 中即上报 `result` 的精确匹配串；固定出口名被 schema 锁定（见 3.3） |
| `label` | string，≤120 | — | 可选显示别名（编辑器/运行时展示用）；不参与小游戏结果匹配与连线，匹配仍用 `name` |
| `description` | string，≤500 | — | 出口备注（作者可见，运行时不使用） |

**id 与 name 的分工**：`id` 是机器引用键（连线、校验、运行时路由），`name` 是人看的文本（选项文案、小游戏结果串）。改 `name` 不会断线；改 `id` 等于换了一个出口，必须同时迁移所有引用（编辑器禁止直接改 id）。

### 3.3 固定出口（schema 用 `const` 锁定 id 与 name）

固定出口使用 `fixedExitNext` / `fixedExitTrue` / `fixedExitFalse` / `fixedExitCompleted` / `fixedExitSkipped` 五个 def，对象的 `id`、`name` 都是常量，另允许可选 `label` 作为显示别名（不改变固定语义）。约束方式分三种：`dialogue` / `scene` / `variable` 用 `prefixItems` + `items: false` 锁死「恰好 1 项且内容固定」；`condition` / `video` 用 `contains` + `minContains` / `maxContains: 1` 保证两个固定出口**各恰好出现一次、顺序不敏感**；`jump` 用 `maxItems: 0`。

| 节点 | `exits` 数量 | 出口与顺序 |
| --- | --- | --- |
| `dialogue` | 1 | `next`，固定 |
| `scene` | 1 | `next`，固定 |
| `variable` | 1 | `next`，固定 |
| `condition` | 2 | `true`、`false` **各恰好一次**，顺序不敏感 |
| `video` | 2 | `completed`、`skipped` **各恰好一次**，顺序不敏感 |
| `jump` | 0 | `[]`（`maxItems: 0`） |

固定出口的 `id` / `name` 不可改；可用可选 `label` 提供显示别名，`description` 写备注。这是与「作者可改 exit.name」的边界，见第 14 节 D12。

### 3.4 八类节点出口表

| 节点 `type` | 出口数量 | 出口 id / name | `name` 可否改 | 连出边要求（详见第 12 节） |
| --- | --- | --- | --- | --- |
| `dialogue` | 1 | `next` / `next` | 否（const） | 通常 1 条 `sequence`；**允许留空表示剧情正常结束**（D31），有多条则错误 |
| `scene` | 1 | `next` / `next` | 否（const） | 通常 1 条 `sequence`；**允许留空表示剧情正常结束**（D31），有多条则错误 |
| `choice` | 2–12 | 作者自定义 `id`，`name` 为选项文本 | 是 | **每个选项恰好 1 条 `sequence` 出边**（缺失或重复为错误） |
| `minigame` | 1–16 | 作者自定义 `id`，`name` 为结果串（默认 `win` / `lose`） | 是 | **每个出口恰好 1 条 `sequence` 出边**，缺失或重复为错误 |
| `video` | 2 | `completed` / `completed`、`skipped` / `skipped`（顺序不敏感） | 否（const） | **两个出口各恰好 1 条 `sequence` 出边**，缺失或重复为错误 |
| `jump` | 0 | — | — | 不允许出边（用 `targetNodeId` 直接跳） |
| `condition` | 2 | `true` / `true`、`false` / `false`（顺序不敏感） | 否（const） | 两条出边都必须是 `conditional`；各恰好一条，缺失为错误 |
| `variable` | 1 | `next` / `next` | 否（const） | 恰好 1 条 `sequence`；缺失或重复为错误 |

统一规则：**除 `jump` 外，每个出口最多一条出边；choice/minigame/video/condition/variable 的出口必须接线，dialogue/scene 的 `next` 允许留空表示本幕结束**（第 12 节 E12 / D31）。

### 3.5 编辑器端口约定（编辑器约定，不是 schema）

- 端口画在节点**右侧**，按 `exits` 数组顺序自上而下排列；固定出口同样画在右侧。
- 端口标签显示 `exit.name`；choice 显示选项文本，minigame 显示结果串。
- **节点卡片宽度随出口数扩展**：卡片左侧信息区宽度固定，底部出口区按端口数量向右扩宽（不换行、不缩排）；出口数超过 3 个时卡片整体变宽，出口多时仍保持每行一个端口。
- 从端口按住拖出贝塞尔曲线；在空白处松开弹出「创建节点」菜单，选中的新节点自动连回该出口。
- 连线可单击选中，按 Delete 删除；允许连接被折叠/跨层级的节点。
- `jump` 无端口、不显示出口区。

### 3.6 不允许「先做单出口节点，后期再加多出口」

第一版即采用统一多出口模型：所有节点 `exits` 从第一版就是数组；固定出口的约束放在 schema 的 `prefixItems` 里而不是运行时特判；编辑器从第一版就按「端口列表」渲染节点，不做单出口特例。若 v1 先按单出口设计，v2 必须改节点结构、改连线引用、写迁移函数。

---

## 4. 各节点字段详解

### 4.0 所有节点共有的字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `nodeId`（`^[A-Za-z][A-Za-z0-9_-]{0,63}$`） | ✓ | 节点唯一 id；创建后不可变，连线/跳转/时间轴都用它 |
| `type` | 8 类常量之一 | ✓ | 节点类型判别字段 |
| `name` | string，1–80 字符 | ✓ | 节点显示名（蓝图标题、结构面板列表） |
| `position` | `graphPoint` `{x: number, y: number}` | ✓ | 蓝图像素坐标，**运行时忽略**（第 1.4 节） |
| `notes` | string，≤2000 | — | 作者备注，运行时不使用 |
| `exits` | array\<exit\> | ✓ | 出口数组，约束见第 3 节 |

### 4.1 dialogue（对话节点）

显示一条台词，然后沿唯一的 `next` 出口继续。

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `exits` | 固定 `[next]` | ✓ | — | 见 3.3 |
| `text` | string，≤20000 | ✓ | — | 台词正文（允许空串） |
| `speaker` | string（≤80）或 `null` | — | `null` | 说话人；`null` 时按旁白/无名显示 |
| `portrait` | `portraitRef` 或 `null` | — | `null` | 该句的立绘引用（可选） |
| `voice` | `voiceRef` 或 `null` | — | `null` | 该句语音（可选） |
| `speedCps` | number 0–1000 或 `null` | — | `null` | 覆盖 `settings.textSpeedCps`；0 = 瞬显 |
| `autoAdvanceMs` | integer 0–600000 或 `null` | — | `null` | 自动前进等待；`null` = 必须玩家点击 |

**portraitRef**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `assetId` | `assetId` | ✓ | 立绘图片素材（`role: "sprite"`） |
| `expression` | string，≤40 | — | 表情标签，仅编辑器分组用；运行时按 `assetId` 显示 |
| `x` / `y` | `normalizedCoord`（0–1） | — | 立绘**中心点**的归一化位置（0=左/上边缘，1=右/下边缘） |
| `scale` | number 0.05–10 | — | 缩放 |

**voiceRef**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `assetId` | `assetId` | ✓ | 语音素材（`role: "voice"`） |
| `volume` | `opacity`（0–1） | — | 该句音量 |

```json
{
  "id": "n_open",
  "type": "dialogue",
  "name": "开场",
  "position": { "x": 120, "y": 80 },
  "exits": [{ "id": "next", "name": "next" }],
  "text": "雨还在下。",
  "speaker": "旁白",
  "portrait": { "assetId": "sp_me_normal", "expression": "平静", "x": 0.5, "y": 0.5, "scale": 1 },
  "voice": { "assetId": "vo_open_01", "volume": 0.9 },
  "speedCps": 24,
  "autoAdvanceMs": null
}
```
### 4.2 scene（场景节点）

布置舞台：背景、立绘、文本框、BGM、场景变量；沿 `next` 继续。**场景节点是时间轴唯一的挂载点**（`timelines[sceneNodeId]`）。属性面板按下面 A–E 五组呈现。

**A. 背景 `background`（必填，可为 `null`）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `assetId` | `assetId` | ✓ | 背景图片（`role: "background"`） |
| `fit` | `"cover"` \| `"contain"` \| `"stretch"` | ✓ | 铺满方式 |
| `x` / `y` | `normalizedCoord` | ✓ | 背景**中心点**的归一化位置（0.5, 0.5 = 舞台中心） |
| `scale` | number 0.05–10 | ✓ | 缩放 |
| `opacity` | `opacity` 0–1 | ✓ | 背景透明度 |

**B. 立绘列表 `sprites`（必填，数组，≤32 项）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `instanceId`（`^[A-Za-z][A-Za-z0-9_-]{0,63}$`） | ✓ | **场景内实例 id**；同一场景内唯一，时间轴 `sprite` 轨道的 `target` 引用它 |
| `assetId` | `assetId` | ✓ | 立绘图片（`role: "sprite"`） |
| `x` / `y` | `normalizedCoord` | ✓ | 立绘**中心点**的归一化位置（与背景 / 文本框一致） |
| `scale` | number 0.05–10 | ✓ | 缩放 |
| `zIndex` | integer 0–1000 | ✓ | 层级，数值越大越靠上 |
| `opacity` | `opacity` 0–1 | ✓ | 透明度 |

> `sprites[].id` 是**实例 id**，不是素材 id：同一个立绘素材可以在场景里出现多次（不同位置/缩放），时间轴用实例 id 精确控制其中一张。实例 id 只在场景内唯一，不同场景可复用。

**B2. UI 图片层 `uiImages`（可选，数组，≤32 项，形状同 `sprites`）**

用于血条、遮罩、装饰等 UI 图片（`assetId` 指向 `role: "ui"` 的图片素材）。字段与 `sprites[]` 完全一致：`id` / `assetId` / `x` / `y` / `scale` / `zIndex` / `opacity`。第一版运行时按层级叠加显示；时间轴暂不提供独立 UI 轨道，可用 `zIndex` 控制前后关系。

**C. 文本框 `textbox`（必填）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `x` / `y` | `normalizedCoord` | ✓ | 文本框**中心点**的归一化位置 |
| `width` / `height` | number 0.05–1 | ✓ | 归一化宽/高（相对舞台） |
| `fontSizePx` | integer 8–200 | ✓ | 字号（像素） |
| `color` | `color` | ✓ | 文字颜色 |
| `background` | `color` | ✓ | 底框颜色 |
| `backgroundOpacity` | `opacity` 0–1 | ✓ | 底框透明度 |
| `opacity` | `opacity` 0–1 | ✓ | 整个文本框的透明度 |
| `paddingPx` | number 0–200 | — | 内边距（像素） |

**D. 音频 `audio`（必填）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `bgmAssetId` | `assetId` 或 `null` | ✓（可空） | 背景音乐素材（`role: "bgm"`）；`null` = 该场景无 BGM |
| `volume` | `opacity` 0–1 | ✓ | 音量（时间轴 `audio` 轨道可覆盖） |
| `loop` | boolean | ✓ | 是否循环 |
| `fadeInMs` | integer 0–60000 | — | 淡入时长（毫秒） |
| `sfx` | array\<`sfxRef`\>，≤8 项 | — | 进入场景时播放的音效；`sfxRef` 为 `{assetId, volume?, loop?}`，assetId 应指向 `role: "sfx"` 的音频素材。第一版运行时支持一次性播放（loop 预留） |

**E. 场景变量 `variables`（必填，数组，≤128 项）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `variableKey` | ✓ | 变量名 |
| `value` | `typedValue` | ✓ | 带类型标签的初值 |
| `description` | string，≤500 | — | 备注 |

同一场景内 `variables[].key` 不得重复（校验错误）。

语义见 7.5：**进入场景时若全局变量表没有该键才初始化，已有值不覆盖**。

```json
{
  "id": "n_scene_rain",
  "type": "scene",
  "name": "雨夜街道",
  "position": { "x": 480, "y": 120 },
  "exits": [{ "id": "next", "name": "next" }],
  "background": { "assetId": "bg_street_rain", "fit": "cover", "x": 0.5, "y": 0.5, "scale": 1, "opacity": 1 },
  "sprites": [{ "id": "char_me", "assetId": "sp_me_normal", "x": 0.35, "y": 0.62, "scale": 1, "zIndex": 10, "opacity": 1 }],
  "textbox": { "x": 0.5, "y": 0.84, "width": 0.92, "height": 0.22, "fontSizePx": 28, "color": "#ffffff", "background": "#000000", "backgroundOpacity": 0.55, "opacity": 1 },
  "audio": { "bgmAssetId": "bgm_rain_loop", "volume": 0.6, "loop": true, "fadeInMs": 800 },
  "variables": [{ "key": "met_clerk", "value": { "type": "boolean", "value": true } }]
}
```
### 4.3 choice（选项节点）

每个出口就是一个选项；`exit.name` 即选项文本，`edge.port` 指向 `exit.id`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `exits` | array\<`exit`\>，2–12 项，元素不重复 | ✓ | 每个选项一个出口；`id` 创建后不变，`name` 即选项文本（可改） |
| `prompt` | string，≤500 | — | 选项提示语（显示在选项上方） |

```json
{
  "id": "n_choice_umbrella",
  "type": "choice",
  "name": "买伞吗",
  "position": { "x": 760, "y": 220 },
  "prompt": "要买一把伞吗？",
  "exits": [{ "id": "buy", "name": "买伞", "description": "花 45 元买伞" }, { "id": "wait", "name": "在店里等雨停" }]
}
```
### 4.4 minigame（小游戏节点）

阻塞式播放小游戏；收到 `postMessage` 结果后按**出口 `name` 精确匹配** `result` 字符串。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `minigameAssetId` | `assetId` | ✓ | 引用 `assets.minigames[].id` |
| `exits` | array\<`exit`\>，1–16 项，元素不重复 | ✓ | 作者配置的出口字符串列表，`name` 即结果串；编辑器创建时默认 `win` / `lose`，可增删改名 |
| `defaultExitId` | `exitId` 或 `null` | ✓（可空） | 结果无匹配时使用的出口 id；`null` = 无兜底（运行时 `console.warn` 并停留在小游戏前） |
| `timeoutMs` | integer 1000–600000 或 `null` | — | 超时保护；超时按「无匹配结果」处理（再走 `defaultExitId`）。省略时用 `settings.runtime.defaultMinigameTimeoutMs` |
| `instructions` | string，≤1000 | — | 给玩家的说明，显示在 iframe 上方 |

```json
{
  "id": "n_minigame_umbrella",
  "type": "minigame",
  "name": "撑伞小游戏",
  "position": { "x": 1180, "y": 220 },
  "minigameAssetId": "mg_umbrella",
  "exits": [{ "id": "win", "name": "win" }, { "id": "lose", "name": "lose" }, { "id": "timeout", "name": "timeout" }],
  "defaultExitId": "timeout",
  "timeoutMs": 15000,
  "instructions": "在 15 秒内把伞撑开。"
}
```
### 4.5 video（视频节点）

独立播放器播放视频；出口固定 `completed` / `skipped`。播放时暂停 BGM，结束（或跳过）后恢复。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `videoAssetId` | `assetId` | ✓ | 引用 `assets.videos[].id` |
| `exits` | 固定两个出口 `completed` / `skipped` | ✓ | 各恰好一次，顺序不敏感（见 3.3） |
| `volume` | `opacity` 0–1 | — | 视频音量 |
| `loop` | boolean | — | 是否循环（循环时不会自动走 `completed`） |
| `showSkipButton` | boolean | — | 是否显示右上角跳过按钮 |
| `skipAfterMs` | integer 0–600000 或 `null` | — | 播放多久后允许跳过；`null`/省略 = 满足 `showSkipButton` 即可立即跳过 |

```json
{
  "id": "n_video_rain",
  "type": "video",
  "name": "雨景过场",
  "position": { "x": 940, "y": 520 },
  "videoAssetId": "vid_rain",
  "exits": [{ "id": "completed", "name": "completed" }, { "id": "skipped", "name": "skipped" }],
  "volume": 0.8,
  "loop": false,
  "showSkipButton": true,
  "skipAfterMs": 3000
}
```
### 4.6 jump（跳转节点）

无出口、无可见画面，直接把控制权交给目标节点；用于循环 / 回跳。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `exits` | 空数组 `[]` | ✓ | `maxItems: 0` |
| `targetNodeId` | `nodeId` | ✓ | 目标节点；必须存在且不能形成无出口死循环（第 12 节） |

```json
{
  "id": "n_jump_loop",
  "type": "jump",
  "name": "回到街道",
  "position": { "x": 1600, "y": 520 },
  "exits": [],
  "targetNodeId": "n_scene_rain"
}
```
### 4.7 condition（条件节点）

白名单表达式求值，固定 `true` / `false` 两个出口。求值失败按 `false` 处理并 `console.warn`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `expression` | string，1–2000 字符 | ✓ | 白名单表达式；语法见第 8 节 |
| `exits` | 固定两个出口 `true` / `false` | ✓ | 各恰好一次、顺序不敏感；两条出边 `kind` 必须是 `conditional` |

```json
{
  "id": "n_condition_result",
  "type": "condition",
  "name": "判断结果",
  "position": { "x": 1420, "y": 320 },
  "expression": "last_minigame_result == \"win\" && has_umbrella == true",
  "exits": [{ "id": "true", "name": "true" }, { "id": "false", "name": "false" }]
}
```
### 4.8 variable（变量操作节点）

**唯一允许修改运行时变量的节点类型**；小游戏不得直接改变量。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `exits` | 固定 `[next]` | ✓ | 见 3.3 |
| `assignments` | array\<`assignment`\>，1–64 项 | ✓ | 按数组顺序依次执行 |

**assignment**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `variableKey` | ✓ | 目标变量名 |
| `op` | `"set"` \| `"add"` \| `"subtract"` \| `"toggle"` \| `"push"` | ✓ | 操作 |
| `value` | `typedValue` | `set`/`add`/`subtract`/`push` 必填；`toggle` 必须省略 | 操作数（带类型标签） |

各 `op` 语义见 7.4。

```json
{
  "id": "n_var_buy",
  "type": "variable",
  "name": "买伞扣钱",
  "position": { "x": 700, "y": 420 },
  "exits": [{ "id": "next", "name": "next" }],
  "assignments": [
    { "key": "money", "op": "subtract", "value": { "type": "number", "value": 45 } },
    { "key": "has_umbrella", "op": "set", "value": { "type": "boolean", "value": true } },
    { "key": "inventory", "op": "push", "value": { "type": "string", "value": "umbrella" } }
  ]
}
```

---

## 5. 连线 edges 语义

### 5.1 统一结构

所有语义的连线都放在顶层 `edges` 数组里，用 `kind` 区分：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `edgeId`（`^[A-Za-z][A-Za-z0-9_-]{0,63}$`） | ✓ | 连线 id，项目内唯一；创建后不变 |
| `from` | `nodeId` | ✓ | 源节点 id |
| `port` | `exitId` | ✓ | 源节点的**出口 id**（不是显示名，不是下标） |
| `to` | `nodeId` | ✓ | 目标节点 id（每个节点只有一个隐式入口，任何节点都可作为目标） |
| `kind` | `"sequence"` \| `"conditional"` \| `"data"` | ✓ | 连线语义 |
| `data` | object，任意键值 | — | 仅 `kind: "data"` 时有意义；第一版预留，运行时忽略 |

```json
{
  "id": "e18_condition_success",
  "from": "n_condition_result",
  "port": "true",
  "to": "n_dialogue_success",
  "kind": "conditional"
}
```
`edge` 也是 `additionalProperties: false`，除上表六个键外不允许出现别的键。

### 5.2 三种 kind

| `kind` | 来源节点 | 运行时行为 | 第一版状态 |
| --- | --- | --- | --- |
| `sequence` | 所有带 `next` 出口的节点、choice 的选项、minigame 的出口、video 的 completed/skipped | 当前节点动作完成后沿此边推进到 `to` | 实现 |
| `conditional` | 仅 condition 节点 | 表达式为 `true` / `false` 时走对应出口的边 | 实现 |
| `data` | 任意（schema 不限制） | **不沿 data 边推进流程** | 仅 schema 预留；不实现连线 UI，运行时不读取 |

> data 边的 `data` 字段自由结构，建议约定 `{fromProperty, toProperty, valueType}`；这些键**不在 schema 里约束**，属于以后版本的约定。

### 5.3 交互约定（编辑器约定，不是 schema）

- 从节点右侧端口按住拖出**贝塞尔曲线**，落在合法节点上高亮；在空白处松开弹出「创建节点」菜单，选定后创建节点并自动连回该出口。
- 连线可单击选中、按 Delete 删除；允许跨层级（分组、折叠、视口外）连线；每个节点只有一个隐式入口，连线只需指定源出口。
- 出口已有合法出边时端口显示「已连接」；再次拖出需二次确认后替换。

### 5.4 连线合法性（运行时/导出前必须成立，详见第 12 节）

| 规则 | 级别 |
| --- | --- |
| `from`、`to` 指向的节点存在 | 错误 |
| `port` 是 `from` 节点 `exits[].id` 中的真实出口 | 错误 |
| 节点 id 项目内唯一；连线 id 项目内唯一 | 错误 |
| 同一出口最多一条 `sequence` / `conditional` 出边（`data` 边不参与） | 错误 |
| 除 `jump` 外，每个出口都必须有出边且恰好一条（不是「最多一条」而是「必须一条」） | 错误 |
| `condition` 的 `true` / `false` 出边 `kind` 必须是 `conditional` | 错误 |
| 其他节点的出边 `kind` 必须是 `sequence`（不允许普通节点出 `conditional`） | 错误 |
| `video` 的 `completed`、`skipped` 两个出口都必须有出边 | 错误 |
| `minigame` 的每个出口都必须有出边 | 错误 |
| `minigame.defaultExitId` 必须是本节点 `exits[].id` 之一（或 `null`） | 错误 |
| `jump.targetNodeId` 指向的节点存在 | 错误 |
| `settings.startNodeId` 指向的节点存在（且不为 `null`） | 错误 |
| 存在 `kind: "data"` 的边 | 警告（第一版不生效） |

### 5.5 id 与唯一性约定

- `edge.id` 创建时生成一次，之后不随端点变化。
- 唯一性键是 `(from, port, kind)`：同一出口的 `sequence` / `conditional` 边只允许一条；`data` 边第一版不参与流程，不做该约束。
- 允许 `from === to`（自环）在 schema 层合法，但会进入第 12 节的环检测：含可交互节点的环只警告，纯逻辑环（只有 condition / variable / jump）为错误，避免运行时死循环。

---

## 6. 素材 assets

### 6.1 总览

| 数组 | 元素类型 | 说明 |
| --- | --- | --- |
| `assets.images` | `imageAsset` | 图片；`role` 区分背景 / 立绘 / UI / 其他 |
| `assets.audio` | `audioAsset` | 音频；`role` 区分 BGM / 音效 / 语音 |
| `assets.videos` | `videoAsset` | 视频；mp4 / webm |
| `assets.minigames` | `minigameAsset` | 小游戏；assets/ 下的自包含 HTML |

四类素材的 `id`（`assetId`）**全库唯一**；节点、时间轴、存档都通过 id 引用。所有路径必须是 `assets/` 开头的相对路径（`assetPath` / `minigamePath` 已限制，`..` 会被拒绝）。另外 `imageAsset` / `audioAsset` / `videoAsset` 用 `allOf` 强制 **`path` 扩展名与 `format` 一致**（例如 `format: "webp"` 的路径必须以 `.webp` 结尾）。

**原始文件与二次编辑**：图片与音频导入时会把原始文件复制到 `assets/.source/images|audio/`（schema 可选字段 `source`，路径必须匹配 `assets/.source/...`）。`path` 指向最终烘焙文件（图片 png/webp、音频 ogg/mp3）；`edit` / `trim` / `gainDb` 等参数始终相对 `source` 计算，因此反复调整不会叠加损耗。导出包不带 `.source/`。旧数据没有 `source` 时，编辑器回退到 `path` 作为编辑源并提示。

### 6.2 图片 imageAsset

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `assetId` | ✓ | 素材 id，创建后不变 |
| `kind` | `const "image"` | ✓ | 类型判别 |
| `name` | string，1–200 | ✓ | 显示名 |
| `role` | `"background"` \| `"sprite"` \| `"ui"` \| `"other"` | ✓ | 用途；决定拖到蓝图时的默认行为 |
| `path` | `assetPath` | ✓ | 相对路径，如 `assets/images/bg.webp` |
| `width` / `height` | integer 1–32768 | ✓ | 像素尺寸 |
| `format` | `"png"` \| `"webp"` | ✓ | 最终文件格式；`path` 扩展名必须一致（`.png` / `.webp`，schema `allOf` 强制）。导入的 jpg / 其他格式在保存时转码为 png 或 webp |
| `sizeBytes` | integer ≥0 | — | 文件大小 |
| `importedAt` | `isoDateTime` | — | 导入时间 |
| `edit` | `imageEdit` | — | 编辑参数（见下） |
| `source` | `assetSource` / `null` | — | 原始导入文件：`{path（assets/.source/…）, format, width?, height?, sizeBytes?}`；用于二次编辑与重新烘焙 |

**role 语义**

| role | 用途 | 可以填到 |
| --- | --- | --- |
| `background` | 背景 | `scene.background.assetId` |
| `sprite` | 立绘 | `scene.sprites[].assetId`、`dialogue.portrait.assetId` |
| `ui` | 通用 UI 图片 | 第一版没有节点字段引用（预留，见第 14 节 D18） |
| `other` | 其他图片 | 同样暂不参与节点引用 |

**imageEdit（全部可选，`null` 表示不启用）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `crop` | `null` 或 `{x, y, width, height}`（像素整数；x/y ≥0，width/height ≥1） | 裁剪框（相对源图） |
| `removeBackground` | `null` 或 `{color, tolerance, softness?}` | 去除纯色背景：`color` 为 `color`；`tolerance` 0–1；`softness` 羽化半径 0–20 px |
| `adjustments` | `null` 或 `{brightness?, contrast?}` | 亮度 / 对比度，-100–100，0 为原图 |

编辑模型是「**烘焙**」：裁剪 / 去背景 / 亮度对比度在导入时把结果写进 `path` 指向的新文件，`edit` 只保留参数以便二次调整；**不做图层、蒙版、滤镜链、饱和度**。素材只产出 **png / webp**；jpg 仅是允许导入的输入格式，落盘即转码。

```json
{
  "id": "bg_street_rain", "kind": "image", "name": "雨夜街道", "role": "background",
  "path": "assets/images/bg_street_rain.webp", "width": 1920, "height": 1080,
  "format": "webp", "sizeBytes": 482113, "importedAt": "2026-10-21T02:10:00Z",
  "edit": { "crop": { "x": 0, "y": 80, "width": 1920, "height": 920 }, "removeBackground": null, "adjustments": { "brightness": 4, "contrast": 12 } }
}
```
### 6.3 音频 audioAsset

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `assetId` | ✓ | 素材 id |
| `kind` | `const "audio"` | ✓ | 类型判别 |
| `name` | string，1–200 | ✓ | 显示名 |
| `role` | `"bgm"` \| `"sfx"` \| `"voice"` | ✓ | 背景音乐 / 音效 / 语音 |
| `path` | `assetPath` | ✓ | 相对路径 |
| `format` | `"ogg"` \| `"mp3"` | ✓ | 最终文件格式（符合“导出 ogg/mp3”范围）；`path` 扩展名必须一致（schema `allOf` 强制）。导入的 wav 等格式在保存时转码 |
| `durationMs` | integer ≥1 | ✓ | 时长（毫秒，源文件） |
| `sizeBytes` | integer ≥0 | — | 文件大小 |
| `importedAt` | `isoDateTime` | — | 导入时间 |
| `trim` | `null` 或 `{startMs: integer ≥0, endMs: integer ≥0}` | — | 截取片段（相对源文件）；编辑器校验 `endMs > startMs` |
| `gainDb` | number -60–24 | — | 增益（dB），0 为原始音量 |
| `loop` | boolean | — | 素材默认是否循环；场景 `audio.loop` 优先 |
| `source` | `assetSource` / `null` | — | 原始音频文件：`{path（assets/.source/…）, format, durationMs, sizeBytes}`；trim/gain 始终基于它重新烘焙 |

- 截取与增益同样**烘焙**进导出文件，`trim` / `gainDb` 只作为编辑参数保留。
- 第一版**不做多轨混音、不做效果器、不支持 MIDI**；同一时刻只有场景 BGM 一条主音轨（对话语音按句播放）。
- `role: "sfx"` 目前没有节点字段可以播放（见第 14 节 D17），属于预留类别。

```json
{
  "id": "bgm_rain_loop", "kind": "audio", "name": "雨声循环", "role": "bgm",
  "path": "assets/audio/bgm_rain_loop.ogg", "format": "ogg", "durationMs": 62000,
  "sizeBytes": 993210, "importedAt": "2026-10-21T02:12:00Z",
  "trim": { "startMs": 0, "endMs": 60000 }, "gainDb": -3, "loop": true
}
```
### 6.4 视频 videoAsset

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `assetId` | ✓ | 素材 id |
| `kind` | `const "video"` | ✓ | 类型判别 |
| `name` | string，1–200 | ✓ | 显示名 |
| `path` | `assetPath` | ✓ | 相对路径 |
| `format` | `"mp4"` \| `"webm"` | ✓ | 容器格式；`path` 扩展名必须一致（schema `allOf` 强制） |
| `durationMs` | integer ≥1 | — | 时长；编辑器用探测结果填充 |
| `width` / `height` | integer ≥1 | — | 分辨率 |
| `codec` | `"h264"` \| `"vp8"` \| `"vp9"` | — | 编码；**支持矩阵**：mp4→h264，webm→vp8/vp9 |
| `hasAudio` | boolean | — | 是否含音轨 |
| `sizeBytes` | integer ≥0 | — | 文件大小 |
| `importedAt` | `isoDateTime` | — | 导入时间 |

- 导入时校验容器与编码：`mp4` 只接受 h264，`webm` 只接受 vp8 / vp9；不支持的编码**提示用户自行转码**，编辑器不做转码。
- 视频节点播放时暂停 BGM，播放结束或跳过时恢复（行为由运行时实现，不属于素材字段）。

```json
{
  "id": "vid_rain", "kind": "video", "name": "雨景过场",
  "path": "assets/videos/rain_cut.mp4", "format": "mp4", "durationMs": 8000,
  "width": 1280, "height": 720, "codec": "h264", "hasAudio": true,
  "sizeBytes": 5120000, "importedAt": "2026-10-21T02:20:00Z"
}
```
### 6.5 小游戏 minigameAsset

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `assetId` | ✓ | 素材 id |
| `kind` | `const "minigame"` | ✓ | 类型判别 |
| `name` | string，1–200 | ✓ | 显示名 |
| `path` | `minigamePath`（必须是 `assets/` 下 `.html`） | ✓ | 入口 HTML 路径 |
| `declaredExits` | array\<string 1–64\>，1–32 项，唯一 | ✓ | 小游戏声明的出口字符串，**必须来自 `window.MINIGAME_EXITS`** |
| `mode` | `const "blocking"` | — | 第一版仅阻塞式；写则只能是 blocking |
| `description` | string，≤1000 | — | 说明 |
| `sizeBytes` | integer ≥0 | — | 文件大小 |
| `importedAt` | `isoDateTime` | — | 导入时间 |

```json
{
  "id": "mg_umbrella", "kind": "minigame", "name": "撑伞",
  "path": "assets/minigames/umbrella.html",
  "declaredExits": ["win", "lose", "timeout"], "mode": "blocking",
  "description": "限时撑伞，上报 win / lose / timeout。"
}
```
### 6.6 `declaredExits` 与节点 `exits` 的关系

两者是**两套出口**：素材声明自己能上报哪些结果字符串，节点决定这些结果分别接到哪条流程。

| 规则 | 级别 |
| --- | --- |
| 导入小游戏时读取 `window.MINIGAME_EXITS`，缺失该数组直接拒绝导入 | 导入错误 |
| `declaredExits` 的每一项都必须能在节点的 `exits[].name` 中找到（保存时报告，导出前强制） | 错误（保存时提示，导出被阻止） |
| 节点 `exits[].name` 在节点内唯一（否则 `result` 精确匹配有歧义） | 错误 |
| 节点出口可以多于 `declaredExits`（作者自定义兜底/调试出口），但永远收不到对应 `result` | 警告（永不命中） |
| 节点出口可以改名（`name` 改），但必须重新覆盖 `declaredExits` | 错误（未覆盖时） |
| `defaultExitId` 必须指向本节点某个 `exit.id` | 错误 |

例：素材声明 `["win","lose","timeout"]`，节点三个出口 `win/lose/timeout`（name 与声明一致）即覆盖完整；若节点把 `timeout` 出口改名为 `超时`，则 `timeout` 结果不再有映射，保存被阻止。

---

## 7. 变量系统

### 7.1 typedValue：六种类型标签

变量表的每个值都是带标签的对象 `{type, value}`（`additionalProperties: false`，只允许这两个键）：

| `type` 标签 | `value` 的 JSON 类型 | JSON 示例 | 说明 |
| --- | --- | --- | --- |
| `"number"` | number | `{"type":"number","value":120}` | 整数/小数统一 number |
| `"string"` | string | `{"type":"string","value":"林"}` | 任意文本 |
| `"boolean"` | boolean | `{"type":"boolean","value":false}` | true / false |
| `"array"` | array | `{"type":"array","value":["umbrella","ticket"]}` | 第一版内部不做递归类型标签 |
| `"object"` | object | `{"type":"object","value":{"loop":2,"route":"rain"}}` | 第一版内部不做递归类型标签 |
| `"null"` | null | `{"type":"null","value":null}` | 空值；与「变量不存在」不同 |

**没有**的标签：`undefined`、`date`、`color`、`vec2`、`enum`。变量值只能来自上表六类。

### 7.2 variableMap 与变量名

`variables` 是 `object`：变量名 → `typedValue`。变量名必须匹配 `^[A-Za-z_][A-Za-z0-9_]{0,63}$`：字母或下划线开头，后续字母/数字/下划线，1–64 字符；**中文变量名不合法**。

```json
{
  "money": { "type": "number", "value": 120 },
  "has_umbrella": { "type": "boolean", "value": false },
  "inventory": { "type": "array", "value": [] },
  "run_stats": { "type": "object", "value": { "loop": 0 } },
  "last_seen_ending": { "type": "null", "value": null }
}
```
### 7.3 保留变量 `last_minigame_result`

- 运行时在小游戏结束、收到合法 `result` 后，把 **原始结果字符串** 写入 `last_minigame_result`，供下游 condition 节点判断。
- 第一版**只允许字符串值**：schema 的 `variableMap` 已为 `last_minigame_result` 单独锁定 `type: "string"`，非 string 会被结构校验直接拒绝；编辑器草稿层另有提示（见第 12 节 W09）。
- 超时或上报格式非法时**不写入**，保留上一次的值。
- 作者可以在 `variables` 里给初值，但只能是 string 类型；运行时行为不依赖初值。
- 第二版扩展 payload（例如附带数值/对象）时再新增保留变量或改类型，第一版不做。

### 7.4 assignments 的操作语义

`assignments` 按数组顺序**依次执行**：

| `op` | `value` 要求 | 语义 | 目标类型不符时 |
| --- | --- | --- | --- |
| `set` | 必须带 `typedValue` | 用 `value` 的标签与值替换目标变量（允许改变类型） | 不会不符（直接替换） |
| `add` | 必须带，且标签必须是 `number` | 目标 = 目标 + value（数值加法） | 目标不是 number 或 value 不是 number：跳过并 `console.warn` |
| `subtract` | 必须带，且标签必须是 `number` | 目标 = 目标 - value | 同上 |
| `toggle` | **必须省略** | 目标 boolean 取反 | 目标不是 boolean：跳过并 `console.warn` |
| `push` | 必须带任意 `typedValue` | 目标数组末尾追加 `value.value`（数组内元素不再带标签） | 目标不是 array：跳过并 `console.warn` |

- 类型不符的处理是「跳过该条赋值、记录 `console.warn`、继续执行后续赋值」，不让整个流程中断（第 14 节 D22）。
- `add` / `subtract` 只接受数值标签，不做字符串拼接。
- 变量不存在时：`set` 直接创建；`add` / `subtract` / `toggle` / `push` 视为类型不符并警告（不会隐式创建）。

### 7.5 场景 `variables` 的语义（「缺失才初始化」）

场景节点的 `variables` 是**声明**，不是每进场景重写的赋值：

1. 进入场景节点时，逐条遍历 `scene.variables`；
2. 若全局变量表中**没有**该 `key`，按声明的 `typedValue`（标签 + 值）写入；
3. 若全局变量表中**已有**该 `key`，**保持已有值不覆盖**（即使类型不同）；
4. 场景声明不会主动修改任何已有变量；运行时改变量仍然只能通过 `variable` 节点。

因此场景变量适合做「第一次到某场景时给变量一个初值」，重玩/回跳同一场景时不会把玩家进度重置。示例：场景 A 声明 `{key:"met_clerk", value:{type:"boolean",value:true}}`，第一次进入后 `met_clerk=true`；之后玩家在别处把它改成 `false`，再回场景 A 也不会被改回 `true`。

### 7.6 编辑器里的 array / object 编辑（第一版）

`type: "array"` / `type: "object"` 的值用 **JSON 文本框**编辑，保存时 `JSON.parse` 校验、非法 JSON 阻止保存；内部不做递归类型标签，数组元素/对象属性都是普通 JSON 值，类型在表达式求值时按 JSON 类型推断。其他四种类型用数字输入框 / 文本框 / 开关 / 空值占位。

---

## 8. 表达式白名单（condition 节点）

### 8.1 目标

条件节点的 `expression` 只允许一个**安全的、无副作用的子集**：不执行任意代码、不访问对象原型链、不读写变量以外的状态。求值器是手写解析器 + 白名单函数表；**禁止 `eval` / `new Function` / 任意函数调用**。

### 8.2 完整 EBNF 语法

```ebnf
expression      = or_expr ;
or_expr         = and_expr { "||" and_expr } ;
and_expr        = equality { "&&" equality } ;
equality        = relational { ( "==" | "!=" ) relational } ;
relational      = additive { ( "<" | "<=" | ">" | ">=" | "in" ) additive } ;
additive        = multiplicative { ( "+" | "-" ) multiplicative } ;
multiplicative  = unary { ( "*" | "/" | "%" ) unary } ;
unary           = ( "!" | "-" ) unary | postfix ;
postfix         = primary { "." IDENT | "[" expression "]" } ;
primary         = NUMBER | STRING | "true" | "false" | "null"
                | "[" [ expression { "," expression } ] "]"
                | IDENT "(" [ expression { "," expression } ] ")"
                | IDENT
                | "(" expression ")" ;
NUMBER          = digit+ [ "." digit+ ] ;
STRING          = '"' { char | escape } '"' | "'" { char | escape } "'" ;
IDENT           = ( letter | "_" ) { letter | digit | "_" } ;
escape          = "\\" | "\"" | "\'" | "\n" | "\t" | "\r" | "\u" hexdigit hexdigit hexdigit hexdigit ;
```
说明：

- **不支持** `//` 或 `/* */` 注释（保持语法最小）。
- 支持**数组字面量**（如 `["buy", "wait"]`，元素为任意表达式），用于成员判断（8.5 / 8.11 示例）；不支持对象字面量、解构、模板字符串等更宽语法。
- 函数调用只能写白名单函数名（8.8），`IDENT(...)` 中 `IDENT` 不在白名单 → 求值错误。
- 成员访问 `.` 与下标 `[]` 只能读取**自有属性/数组元素**，不能沿原型链查找。
- 字符串支持单/双引号；转义仅限上表列出的字符。

### 8.3 优先级与结合性（高 → 低）

| 级别 | 运算符 | 结合性 |
| --- | --- | --- |
| 1 | `()` 分组、函数调用、`.`、`[]` | 左 |
| 2 | 一元 `!`、一元 `-` | 右 |
| 3 | `*`、`/`、`%` | 左 |
| 4 | `+`、`-` | 左 |
| 5 | `<`、`<=`、`>`、`>=`、`in` | 左 |
| 6 | `==`、`!=` | 左 |
| 7 | `&&` | 左（短路） |
| 8 | `\|\|` | 左（短路） |

### 8.4 字面量

| 字面量 | 示例 | 说明 |
| --- | --- | --- |
| 数字 | `0`、`42`、`3.14` | 十进制，可带小数；不支持科学计数法、十六进制、`NaN`、`Infinity` |
| 字符串 | `"win"`、`'雨夜'` | 单/双引号均可；转义见 8.2 |
| 布尔 | `true`、`false` | — |
| 数组 | `["buy", "wait"]`、`[1, 2, 3]` | 元素可为任意表达式；仅用于 `in` / `len` 等只读场景，不支持对象字面量 |
| 空值 | `null` | 表示空变量 / 缺失成员 |

### 8.5 `in` 的三种语义

| 左侧 | 右侧 | 结果 |
| --- | --- | --- |
| 任意值 | array | **数组包含**：按类型与值做深度相等比较，命中返回 `true` |
| string | string | **子串**：左侧是右侧的子串则 `true` |
| string | object | **自有键**：右侧对象拥有该自有属性（不看原型）则 `true` |
| 其他组合 | 其他组合 | `false`（不报错） |

### 8.6 运算语义

| 运算 | 规则 |
| --- | --- |
| `+` | 两侧都是 number → 数值相加；**任一侧是 string** → 字符串拼接（另一侧按 8.7 的 display 规则转字符串） |
| `-` `*` `/` `%` | 两侧必须都是 number；`/` 或 `%` 右侧为 0 → 求值错误 |
| 一元 `-` | 操作数必须是 number |
| `!` | 按 8.7 真值表取反，返回 boolean |
| `&&` `\|\|` | 短路求值，两操作数按真值表判断，**结果返回 boolean**（不是操作数本身） |
| `==` `!=` | 同类型比较；不同类型直接 `false` / `true`，**不做隐式转换** |
| `<` `<=` `>` `>=` | 仅 number-number 或 string-string；string 按 Unicode 码点字典序；其他组合返回 `false`（不报错） |

### 8.7 比较、字符串拼接与真值规则

**相等比较**：

- number：数值相等（`1 == 1.0` 为 true）；
- string：逐字符相等；
- boolean / null：同值相等；
- array / object：**深度相等**（递归比较 JSON 值，键顺序无关）；
- 不同类型：`==` 为 false，`!=` 为 true。

**字符串拼接（`+` 的 display 转换）**：

| 另一侧类型 | 转成字符串 |
| --- | --- |
| string | 原样 |
| number | 十进制表示（整数不带 `.0`；小数保留可读位数） |
| boolean | `"true"` / `"false"` |
| null | `"null"` |
| array / object | 不允许拼接 → 求值错误 |

**真值表**：

| 值 | 真？ |
| --- | --- |
| `false` | 假 |
| `0`（含 `-0`） | 假 |
| `""`（空串） | 假 |
| `null` | 假 |
| 其他 number / string | 真 |
| `true` | 真 |
| 任意 array（含 `[]`） | 真 |
| 任意 object（含 `{}`） | 真 |

### 8.8 内置函数白名单

只有下列函数可调用；未知函数名 → 求值错误。

| 函数 | 参数 | 返回 | 说明 / 类型不符时 |
| --- | --- | --- | --- |
| `len(x)` | 1 个 | number | string → 字符数（Unicode 码点）；array → 元素数；object → 自有键数；其他 → 求值错误 |
| `type(x)` | 1 个 | string | `"number"` / `"string"` / `"boolean"` / `"array"` / `"object"` / `"null"` |
| `isNumber(x)` | 1 个 | boolean | 标签判断，不报错 |
| `isString(x)` | 1 个 | boolean | 同上 |
| `isBoolean(x)` | 1 个 | boolean | 同上 |
| `isArray(x)` | 1 个 | boolean | 同上 |
| `isObject(x)` | 1 个 | boolean | 同上 |
| `isNull(x)` | 1 个 | boolean | 同上 |
| `abs(n)` | 1 个 number | number | 绝对值；非 number → 求值错误 |
| `floor(n)` | 1 个 number | number | 向下取整 |
| `ceil(n)` | 1 个 number | number | 向上取整 |
| `round(n)` | 1 个 number | number | 四舍五入，半数向 +∞ 取整 |
| `min(a, b, ...)` | ≥1 个 number | number | 最小值；参数不足或非 number → 求值错误 |
| `max(a, b, ...)` | ≥1 个 number | number | 最大值；同上 |

### 8.9 禁止项

| 禁止 | 说明 |
| --- | --- |
| `eval` / `Function` / `new` / `import` | 不解析、不执行 |
| 任意赋值 / 自增自减（`=`、`+=`、`++`） | 表达式只读，无副作用 |
| 任意函数调用 | 只允许 8.8 白名单；`Math.*`、`JSON.*`、`window.*` 均不可用 |
| 原型链属性 | `.` 与 `[]` 只能读自有属性；`__proto__`、`constructor`、`prototype` 键名一律拒绝并求值错误 |
| 全局对象 | `window` / `document` / `globalThis` / `console` 等标识符未定义（除非作者声明同名变量） |
| 正则、模板字符串、箭头函数 | 语法不支持，解析阶段报错 |

### 8.10 未知标识符与求值错误处理

| 情况 | 处理 |
| --- | --- |
| 标识符不是已声明变量 | 求值错误：`console.warn("[expr] unknown identifier: xxx", expression)`，condition 按 **false** 走 |
| 语法错误 / 类型错误 / 参数个数错误 / 除零 / 原型链键 | 同上：`console.warn`，condition 按 **false** |
| 成员不存在 / 数组下标越界 | 返回 `null`（不算错误，方便判断 `isNull`） |
| 求值结果非 boolean | 按 8.7 真值表转 boolean 后决定走哪个出口 |

运行时不抛出到界面层，也不中断流程；一次求值最多记录一条警告（含表达式文本，便于作者定位）。

### 8.11 示例表达式

| 表达式 | 求值/用途 |
| --- | --- |
| `money >= 100` | 数值比较 |
| `has_umbrella == true && last_minigame_result == "win"` | 布尔与字符串比较（小游戏胜利且已买伞） |
| `last_choice in ["buy", "wait"]` | 数组包含 |
| `"rain" in weather` | 字符串子串（weather 为 string） |
| `"visited_rain" in run_stats` | 对象自有键 |
| `len(inventory) >= 2` | 数组长度 |
| `type(item) == "string"` | 类型判断 |
| `!isNull(last_seen_ending)` | 空值判断 |
| `min(money, max(0, 100 - cost)) > 25` | 嵌套函数调用 |
| `run_stats.loop == 2 && inventory[0] == "umbrella"` | 成员访问 + 下标 |

---

## 9. 时间轴与关键帧

### 9.1 挂载位置：timelineMap

`timelines` 是一个对象，**键必须是场景节点的 id**，值为 `timeline`：

- `timelines[sceneNodeId]` 存在 → 该场景有动画；
- 不存在 → 该场景使用蓝图静态值（合法，不需要空对象占位）；
- 键不是 `type: "scene"` 的节点 id → 校验错误（第 12 节 E21）；
- 一个场景最多一个时间轴（对象键天然唯一）。

### 9.2 timeline 对象

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `durationMs` | integer 100–600000 | ✓ | 时间轴总时长（毫秒） |
| `loop` | boolean | — | 是否循环播放；省略 = 不循环。`true` 时播放头到 `durationMs` 后回到 0 继续，`false` 时停在末帧 |
| `tracks` | array\<track\>，≤128 项 | ✓ | 轨道列表，可为空数组 |

### 9.3 四类轨道

| `kind` | `target` | `property` 枚举 | 基线值来自 | 说明 |
| --- | --- | --- | --- | --- |
| `"sprite"` | **必填**，场景内 `sprites[].id` | `x` / `y` / `scale` / `opacity` | 对应立绘条目 | 只控制目标实例 |
| `"background"` | 无 | `x` / `y` / `scale` / `opacity` | `scene.background` | 无 background 时轨道无意义（警告） |
| `"audio"` | 无 | `volume` | `scene.audio.volume` | 只控制 BGM 音量 |
| `"textbox"` | 无 | `x` / `y` / `width` / `height` / `opacity` / `fontSizePx` / `backgroundOpacity` | `scene.textbox` | 属性名与静态字段一致（`fontSizePx`、`backgroundOpacity`） |

轨道公共字段：`id`（`trackId`，时间轴内唯一）、`kind`、`property`、`keys`（至少 1 个关键帧）；`sprite` 轨道额外有 `target`。

> 同一时间轴内 `track.id` 不重复、同一 `(target, property)` 只允许一条轨道；否则两条轨道争抢同一属性、结果不确定（第 12 节 E23）。

### 9.4 关键帧 keyframe

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `time` | integer ≥0 | ✓ | **场景内绝对毫秒**（不是轨道内偏移） |
| `value` | number | ✓ | 数值；颜色、文本等非数值属性第一版不参与时间轴 |
| `easing` | `easing` | ✓ | **从前一关键帧到本帧**的缓动；首帧也必须写（习惯填 linear，运行时不使用） |
| `label` | string，≤80 | — | 关键帧备注，编辑器显示用 |

约束（编辑器与导出校验）：

- 同一轨道的 `keys` 必须按 `time` **严格升序**；
- 每个 `time` ≤ 所属 `timeline.durationMs`；
- 同一轨道内 `time` 不得重复（重复时间插值无法定义 → 错误）；
- `value` 必须落在该属性的合法域内：`opacity` / `backgroundOpacity` / `volume` 为 0–1；`scale` 为 0.05–10；`width` / `height` 为 0.05–1；`fontSizePx` 为 8–200；**位置类 `x` / `y` 的关键帧允许 -1–2**（支持从画面外滑入/滑出；蓝图静态值仍限 0–1），越界为错误；
- 播放位置早于首帧时取首帧值，晚于末帧时取末帧值；两帧之间按目标帧的 `easing` 从上一帧值插值到本帧值。

### 9.5 缓动 easing：运行时只认 cubic-bezier

```json
{
  "type": "bezier",
  "p1": [0.42, 0],
  "p2": [0.58, 1]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `const "bezier"` | ✓ | 第一版只有贝塞尔 |
| `p1` | `[number, number]` | ✓ | 控制点 1；**x 必须 0–1**（保证是时间函数），y 可越界（回弹/超调） |
| `p2` | `[number, number]` | ✓ | 控制点 2；x 必须 0–1，y 可越界 |

**运行时只计算 `cubic-bezier(p1[0], p1[1], p2[0], p2[1])`，不识别 `linear` / `easeIn` / `easeOut` / `easeInOut` 等预设名**；预设名只存在于编辑器 UI，保存时换算成控制点。

预设 ↔ 控制点对照：

| 预设 | `p1` | `p2` |
| --- | --- | --- |
| `linear` | `[0, 0]` | `[1, 1]` |
| `easeIn` | `[0.42, 0]` | `[1, 1]` |
| `easeOut` | `[0, 0]` | `[0.58, 1]` |
| `easeInOut` | `[0.42, 0]` | `[0.58, 1]` |

强度滑块 0–1 → 控制点（线性插值，s=0 退化为 linear，s=1 等于预设）：

```text
p1 = [ s * p1x预设, s * p1y预设 ]
p2 = [ 1 + s * (p2x预设 - 1), 1 + s * (p2y预设 - 1) ]
```
例（s = 0.5）：

| 预设 | 计算出的 `p1` | 计算出的 `p2` |
| --- | --- | --- |
| `easeIn` | `[0.21, 0]` | `[1, 1]` |
| `easeOut` | `[0, 0]` | `[0.79, 1]` |
| `easeInOut` | `[0.21, 0]` | `[0.79, 1]` |

### 9.6 优先级：时间轴覆盖蓝图

| 情况 | 取值 |
| --- | --- |
| 某属性有对应轨道（且播放位置有值） | **时间轴关键帧值覆盖**蓝图静态值 |
| 某属性没有任何轨道 | 沿用蓝图静态值 |
| 轨道 target 指向的立绘不存在 | 校验错误；运行时忽略该轨道并 `console.warn` |
| 场景没有 background 但存在 background 轨道 | 校验警告；运行时不生效 |
| 时间轴 `loop: true` | 播放头到 `durationMs` 后回到 0 循环；`loop: false` 停在末帧 |

### 9.7 时间轴示例

`timelines["n_scene_rain"]` 的值（立绘横移 + BGM 音量渐强）：

```json
{
  "durationMs": 5000,
  "loop": false,
  "tracks": [
    { "id": "tr_sprite_x", "kind": "sprite", "target": "char_me", "property": "x",
      "keys": [
        { "time": 0, "value": 0.35, "easing": { "type": "bezier", "p1": [0, 0], "p2": [1, 1] } },
        { "time": 1200, "value": 0.5, "easing": { "type": "bezier", "p1": [0.42, 0], "p2": [0.58, 1] } }
      ] },
    { "id": "tr_bgm_volume", "kind": "audio", "property": "volume",
      "keys": [
        { "time": 0, "value": 0.2, "easing": { "type": "bezier", "p1": [0, 0], "p2": [1, 1] } },
        { "time": 2000, "value": 0.7, "easing": { "type": "bezier", "p1": [0, 0], "p2": [0.58, 1] } }
      ] }
  ]
}
```
### 9.8 时间轴编辑器操作与焦点

时间轴快捷键（Space / K / ←→ / Cmd/Ctrl+滚轮 / Delete）与 Space 焦点分发见 11.3、11.4；时间轴只播放「当前选中的场景节点」的 `timelines[sceneNodeId]`，中栏未选中 scene 节点时显示提示占位。

---

## 10. 存档 saveState

### 10.1 槽位与文件

| `kind` | 文件（Electron） | `slot` | 触发 |
| --- | --- | --- | --- |
| `"manual"` | `saves/slot_N.json`（N = 1–999） | 1–999 | 玩家手动存档 / 覆盖存档 |
| `"auto"` | `saves/auto.json` | `0` | 自动存档（`settings.autoSave` 控制，如进入场景时） |
| `"quick"` | `saves/quick.json` | `0` | 快速存档（独立槽位，不占手动槽位） |

`auto` 与 `quick` 是独立槽位，`slot` 固定 `0`（schema 用 `allOf` 约束：`manual` 时 `slot ≥ 1`，其他时 `slot = 0`）。

### 10.2 字段表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | `const 1` | ✓ | 存档结构版本 |
| `kind` | `"manual"` \| `"auto"` \| `"quick"` | ✓ | 槽位类型 |
| `slot` | integer 0–999 | ✓ | 手动 1–999；auto/quick 固定 0 |
| `savedAt` | `isoDateTime` | ✓ | 存档时间（UTC ISO） |
| `projectId` | `projectId` | ✓ | 存档所属项目，与 `meta.id` 比对防串档 |
| `projectTitle` | string，≤200 | — | 冗余标题，存档列表展示用 |
| `schemaVersion` | `const 1` | ✓ | 存档对应项目文件的结构版本 |
| `label` | string，≤100 | — | 槽位备注，如「第二章分歧点」 |
| `nodeId` | `nodeId` | ✓ | 当前所在蓝图节点 id |
| `variables` | `variableMap` | ✓ | 变量快照（含 `last_minigame_result`） |
| `timeline` | `null` 或 `{nodeId, timeMs}` | ✓（可空） | 舞台场景 + 时间轴播放进度；不在任何场景舞台内时为 `null`。即使该场景没有 timeline 条目，也记录舞台场景与播放头，便于读档恢复画面 |
| `thumbnailDataUrl` | `null` 或 `data:image/(png\|webp\|jpeg);base64,...` | — | 存档缩略图，**内嵌 data URL**（Electron 与 Web 共用） |
| `playtimeMs` | integer ≥0 | ✓ | 累计游玩时长（毫秒） |

随存档一起写入的 `timeline` 只记录「哪个场景节点 + 播放到多少毫秒」，不复制整条时间轴（时间轴本体在项目文件里）。

### 10.3 存储位置与结构一致性

| 环境 | 存储 | 结构 |
| --- | --- | --- |
| Electron 编辑器 / 桌面运行时 | 项目目录 `saves/*.json` 文件 | 同一个 `saveState` |
| 纯浏览器运行时（Web 预览/导出包） | IndexedDB（键建议 `projectId + kind + slot`） | 同一个 `saveState`，字段完全一致 |

Web 与 Electron 的存档可以互相导入导出（同一个 JSON 对象），这是把缩略图内嵌为 data URL 的原因。

### 10.4 运行时职责

| 操作 | 职责 |
| --- | --- |
| 写入 | 收集 `nodeId`、变量快照、时间轴进度、`playtimeMs`、缩略图，构造 `saveState` 写入对应槽位；`savedAt` 用当前 UTC 时间 |
| 读取 | 先校验结构（schema）、再校验 `projectId === meta.id`、再校验 `schemaVersion`；通过后恢复变量、跳到 `nodeId`、恢复时间轴进度 |
| 删除 | 删除对应文件 / IndexedDB 记录；不影响项目文件 |
| 覆盖确认 | 手动槽位已有存档时，UI 必须二次确认后才覆盖 |
| 自动存档 | 按 `settings.autoSave`（如 `onSceneEnter`）写 `auto.json`，静默覆盖，不弹确认 |
| 快速存档 | 写 `quick.json`，静默覆盖；与自动存档互不影响（两个文件） |

### 10.5 projectId 防串档

- 项目 `meta.id` 在创建时生成一次，之后不变；
- 存档写入时记录该 `projectId`；
- 读取时与当前项目 `meta.id` 比对：不一致 → 拒绝加载并提示「存档属于其他项目」，不做变量/节点恢复；
- `schemaVersion` 不一致时：低于当前版本按第 13 节迁移；高于当前版本拒绝加载（避免数据丢失）；
- 存档与项目文件互相独立：删除项目文件不会自动删除 `saves/`，删除存档不影响项目。

存档样例见 `examples/save-sample.json`（手动存档，`slot: 1`，含变量快照、时间轴进度与缩略图）。

---

## 11. 编辑器布局与快捷键

### 11.1 三栏布局

```text
顶部工具栏（保存 / 新建 / 打开 / 导出 / 撤销 / 重做）
左栏 280px：素材列表 + 下方面板（variables / structure / minigameExits）
中栏：蓝图 / 演示 Tab + 蓝图画布 + 时间轴 200px
右栏 320px（可折叠）：属性面板，随选中对象切换
```

| 区域 | 默认尺寸 | 持久化字段 | 内容 |
| --- | --- | --- | --- |
| 左栏 | 280 px（200–480） | `layout.leftWidth` | 上：素材列表（搜索框 + 类型筛选 + 列表/网格切换）；下：三选一面板 `variables` / `structure` / `minigameExits`，**默认 `variables`** |
| 中栏 | 剩余宽度 | — | 顶部 Tab `blueprint` / `preview`；下方时间轴，默认 200 px（120–600），字段 `layout.timelineHeight` |
| 右栏 | 320 px（240–560） | `layout.rightWidth`、`layout.rightCollapsed` | 属性面板，随当前选中对象（节点 / 连线 / 素材）切换内容 |

- 左栏素材视图默认与筛选：`layout.assetView`（`list` / `grid`）与 `layout.assetTypeFilter`（`all` / `image` / `audio` / `video` / `minigame`）。
- 素材拖拽到蓝图的生成规则见 11.5；开始界面与打包入口见 11.6。
- **搜索框内容不持久化**（schema 没有对应字段），只是会话内状态；类型筛选、视图模式才写入 `layout`。
- 中栏未选中场景节点时，时间轴显示「选中一个场景节点以编辑时间轴」提示，不显示空轨道。
- 三个分隔条（左/中、中/右、中/时间轴）都可拖拽，拖拽结束写回 `layout` 对应字段；宽度受 schema 的 `minimum`/`maximum` 限制。

### 11.2 面板与选中联动

| 选中对象 | 右栏属性面板 |
| --- | --- |
| 场景节点 | A 背景 / B 立绘列表 / C 文本框 / D 音频 / E 场景变量（第 4.2 节五组） |
| 对话节点 | 台词、说话人、立绘、语音、语速、自动前进 |
| 选项节点 | 提示语 + 选项列表（增删出口、改 `name`、编辑映射） |
| 小游戏节点 | 素材、出口映射、默认出口、超时、说明 |
| 视频节点 | 素材、音量、循环、跳过按钮与时机、两出口 |
| 跳转节点 | 目标节点选择器 |
| 条件节点 | 表达式编辑器（语法高亮/校验）+ 两出口 |
| 变量节点 | 赋值列表（key / op / 带类型值） |
| 连线 | `kind`、源出口（只读）、目标节点、删除 |
| 素材 | 图片编辑参数 / 音频截取与增益 / 视频信息 / 小游戏声明出口 |

### 11.3 快捷键全表

**全局**

| 快捷键 | 作用 |
| --- | --- |
| Cmd/Ctrl + S | 保存项目 |
| Cmd/Ctrl + N | 新建项目 |
| Cmd/Ctrl + O | 打开项目 |
| Cmd/Ctrl + Shift + E | 导出 Web 包 |
| Cmd/Ctrl + Z | 撤销 |
| Cmd/Ctrl + Shift + Z | 重做 |
| Delete / Backspace | 删除当前焦点对象（选中节点/连线/素材/关键帧，按焦点区域分发） |
| Cmd/Ctrl + A | 全选：蓝图聚焦时选中所有节点；输入控件内为文本全选 |
| Space | 按焦点区域分发，见 11.4 |

**蓝图**

| 快捷键 | 作用 |
| --- | --- |
| 中键拖拽 或 Space + 左键拖拽 | 平移画布 |
| Cmd/Ctrl + 滚轮 | 以指针为中心缩放（写回 `editor.viewport.zoom`，0.1–4） |
| F | 适应全部节点（fit all） |
| 双击空白 | 打开创建节点菜单 |
| 左键拖拽空白 | 框选多个节点 |
| 从右侧端口拖出 | 创建连线；空白处松开弹出创建节点菜单 |
| Delete | 删除选中节点（连同其连线）或选中连线 |

**时间轴**

| 快捷键 | 作用 |
| --- | --- |
| Space | 播放 / 暂停（仅时间轴聚焦） |
| K | 在播放头位置加关键帧 |
| ← / → | 跳到上一个 / 下一个关键帧 |
| Cmd/Ctrl + 滚轮 | 缩放时间轴刻度 |
| Delete | 删除选中关键帧 |

### 11.4 Space 焦点分发规则

全局键盘处理器先读 `document.activeElement`：

| 焦点区域 | Space 行为 |
| --- | --- |
| `input` / `textarea` / `contenteditable` 元素 | 输入空格字符；**不触发**播放或平移 |
| 时间轴面板聚焦 | 播放 / 暂停 |
| 蓝图画布聚焦 | 作为平移修饰键：按住 Space + 左键拖拽平移；单独短按不触发播放 |
| 素材库 / 结构 / 变量面板聚焦 | 保持列表默认滚动行为，不绑定播放 |
| 右栏属性面板（非输入控件） | 无绑定 |

其他全局快捷键同理：焦点在输入控件内时优先让输入控件处理（例如 Cmd/Ctrl + A 是文本全选），否则才走全局命令。

### 11.5 素材拖拽生成规则（编辑器约定，不是 schema）

| 拖拽源 | 落点 | 结果 |
| --- | --- | --- |
| 图片素材 `role: "background"` | 蓝图空白处 | 新建 `scene` 节点并设置 `background.assetId`；节点位置取落点 |
| 图片素材 `role: "sprite"` | 蓝图空白处 | 新建 `scene` 节点，并把该图加入 `sprites`（默认 `x: 0.5, y: 0.6, scale: 1, zIndex: 10, opacity: 1`） |
| 图片素材 `role: "sprite"` | 已有 `scene` 节点 | 弹出「位置 / 表情」选择面板，确认后追加到该场景 `sprites`；取消则不写数据 |
| 图片素材 `role: "background"` | 已有 `scene` 节点 | 替换该场景 `background`（覆盖确认） |
| 音频素材 `role: "bgm"` | `scene` 节点 | 设置该场景 `audio.bgmAssetId`；`volume` / `loop` 缺失时补默认 0.8 / true |
| 音频素材 `role: "voice"` | `dialogue` 节点 | 设置该节点 `voice.assetId` |
| 音频素材 `role: "sfx"` | 任意节点 | 第一版没有音效播放字段，提示「第一版不支持节点级音效」并拒绝落盘（见 D17） |
| 视频素材 | 蓝图空白处 | 新建 `video` 节点并设置 `videoAssetId`；`completed` / `skipped` 暂未接线，导出校验会报 E15 |
| 小游戏素材 | 蓝图空白处 | 新建 `minigame` 节点：按素材 `declaredExits` 生成 `exits[].name`（文件声明优先；默认 `win` / `lose`），`defaultExitId` 置 `null` |

拖拽只创建/修改节点字段，不自动补边；所有未接线出口按 E12/E15/E16 在第 12.5 节的时机报告。

### 11.6 开始界面与打包入口（编辑器约定）

应用启动先进入开始界面，四个入口复用同一套项目 / 素材 / 导出模块，不新增 schema 字段：

| 入口 | 行为 |
| --- | --- |
| 创建项目 | 新建 `project.json`（默认 `settings` / `layout`、空 `assets` 目录结构、`startNodeId: null` 待指认） |
| 音乐管理 | 直接打开素材库并筛选 `audio`：导入、截取片段、调增益、导出 ogg / mp3 |
| 立绘 / 背景管理 | 直接打开素材库并筛选 `images`：导入、裁剪预设尺寸、去纯色背景、亮度对比度、导出 png / webp |
| 打包 | 导出 Web 包：`index.html` + `assets/` + `game.json`，可部署静态服务器；桌面打包（electron-builder）属第二阶段，不改变项目文件结构 |

中栏「演示」Tab 内嵌运行时预览（与导出包同一运行时、只读当前项目），用于不离开编辑器检查流程与时间轴；不改变 schema。 

---

## 12. 校验规则清单

### 12.1 两级

| 级别 | 含义 | 行为 |
| --- | --- | --- |
| **错误（E）** | 数据不合法或运行时必然出错 | **阻止导出**；保存时只报告不阻断（允许未完成接线的 WIP，见 12.5），编辑器定位到具体字段 |
| **警告（W）** | 数据合法但很可能不是作者想要 | 允许保存/导出，编辑器提示但不阻止 |

### 12.2 错误（阻止导出；保存时报告）

| 编号 | 规则 |
| --- | --- |
| E01 | 结构不满足 `schema/schema.json`（类型、枚举、`pattern`、必填、`additionalProperties`） |
| E02 | `schemaVersion` 不是 1（高于当前版本或无法识别） |
| E03 | 节点 `id` 项目内重复 |
| E04 | 连线 `id` 项目内重复 |
| E05 | 素材 `id` 跨四个数组重复 |
| E06 | 同一节点内 `exits[].id` 重复 |
| E07 | 同一节点内 `exits[].name` 重复（小游戏精确匹配会歧义） |
| E08 | `settings.startNodeId` 为 `null` 或指向不存在的节点 |
| E09 | `edge.from` / `edge.to` 指向不存在的节点 |
| E10 | `edge.port` 不是源节点真实 `exit.id` |
| E11 | 同一出口存在多条 `sequence` / `conditional` 出边 |
| E12 | 除 `jump` 外，任一节点的出口存在多条出边（每个出口最多一条）；choice 每个选项、video / minigame 每个出口、condition 的 true/false、variable 的 next 缺失或重复为错误。**dialogue / scene 的 next 允许留空 = 剧情正常结束**（D31） |
| E13 | `condition` 的出边 `kind` 不是 `conditional` |
| E14 | 非 `condition` 节点的出边 `kind` 不是 `sequence` |
| E15 | `video` 的 `completed` / `skipped` 出口没有全部接线 |
| E16 | `minigame` 有出口未接线 |
| E17 | `minigame.defaultExitId` 不是本节点 `exits[].id` 之一（且不为 `null`） |
| E18 | `jump.targetNodeId` 指向不存在的节点 |
| E19 | 素材引用不存在，或引用类型/`role` 不匹配（如背景位填了立绘素材） |
| E20 | 路径逃逸或非法：不以 `assets/` 开头、包含 `..`、小游戏不是 `.html`、素材扩展名与 `format` 不一致 |
| E21 | `timelines` 的键不是 `type: "scene"` 的节点 id |
| E22 | `sprite` 轨道的 `target` 不在该场景 `sprites[].id` 中 |
| E23 | 同一时间轴内轨道 `id` 重复，或同一 `(target, property)` 有多条轨道 |
| E24 | 关键帧 `time` 乱序、重复，或超过 `durationMs` |
| E25 | 关键帧数值超出属性合法域（`opacity` / `backgroundOpacity` / `volume` 0–1、`scale` 0.05–10、`width` / `height` 0.05–1、`fontSizePx` 8–200、位置类 `x` / `y` 关键帧 -1–2 等） |
| E26 | 小游戏节点出口未覆盖素材的 `declaredExits`（保存时报告，导出阻止，见 6.6） |
| E27 | 小游戏接入不合规（见 12.4：非自包含、缺 `MINIGAME_EXITS`、不走 `postMessage`、操作 `window.parent` 等） |
| E28 | 视频编码与容器不匹配或不在支持矩阵内（mp4→h264，webm→vp8/vp9） |
| E29 | 存档文件结构非法（`slot` 与 `kind` 不符、缩略图不是合法 data URL 等） |
| E30 | 纯逻辑环：环中只有 `condition` / `variable` / `jump`，运行时无限循环 |

### 12.3 警告（允许保存/导出）

| 编号 | 规则 |
| --- | --- |
| W01 | 节点从 `startNodeId` 不可达 |
| W02 | 环中包含可交互节点（scene / dialogue / choice / minigame / video），玩家可能绕圈（不一定错） |
| W03 | 存在 `kind: "data"` 的连线（第一版运行时不推进） |
| W04 | 素材文件在磁盘上缺失（编辑期） |
| W05 | 素材未被任何节点/时间轴引用 |
| W06 | 节点 `name` 重复（id 不重复，仅显示混淆） |
| W07 | choice 选项文案重复 |
| W08 | minigame 节点存在 `declaredExits` 之外的出口（`result` 永远不会命中，只能靠默认出口兜底） |
| W09 | 作者在编辑器里手动修改保留变量 `last_minigame_result`（运行时会被小游戏结果覆盖；schema 仅允许 string） |
| W10 | 场景声明变量与全局已有变量类型不一致（不覆盖，但可能不是作者预期） |

### 12.4 小游戏硬性接入要求

**对小游戏 HTML 的要求**

1. **自包含 HTML5**：允许 `assets/` 下的本地资源（同目录脚本/图片/音频），**禁止远程资源**（`http://`、`https://`、`//` 协议相对地址、远程字体/接口）。
2. 必须声明全局数组 `window.MINIGAME_EXITS = ["win", "lose", ...]`，且与素材 `declaredExits` 完全一致；导入时读取，缺失直接拒绝导入。
3. 结果上报唯一通道：`window.parent.postMessage({ type: "minigame-result", result: "<string>" }, "*")`。
4. **不得操作 `window.parent`**：不读写 `parent.document`、不调用父页面方法、不修改父页面状态。
5. 仅阻塞式（导入后 `mode` 只能是 `blocking`）；不设计非阻塞/后台并行模式。

**编辑器导入校验**

| 检查 | 失败处理 |
| --- | --- |
| 路径必须是 `assets/` 下的 `.html` | 拒绝导入 |
| `window.MINIGAME_EXITS` 存在且为非空字符串数组 | 拒绝导入 |
| 扫描 HTML/JS 中的远程 URL 引用 | 拒绝导入并列出违规片段 |
| 在隔离 iframe 中加载并读取 `declaredExits`（超时/报错） | 拒绝导入并提示 |
| 同一素材 id 已存在 / 文件名冲突 | 拒绝并提示改名 |

**运行时 iframe 约束**

| 项 | 要求 |
| --- | --- |
| `sandbox` | 只能是 `allow-scripts` |
| 禁止项 | `allow-same-origin`、`allow-popups`、`allow-top-navigation`、`allow-forms`、`allow-modals` 等一律不加 |
| 加载路径 | 仅 `assets/` 下本地 HTML（`minigamePath`） |
| 阻塞语义 | 小游戏播放期间流程停在本节点，不推进；收到合法结果或超时后才继续 |

**结果校验与出口匹配**

| 步骤 | 规则 |
| --- | --- |
| 1. 格式 | 必须是对象且 `type === "minigame-result"`、`result` 是 string；不合法**静默丢弃**并 `console.warn`，流程不变 |
| 2. 精确匹配 | 用 `result` 与各 `exit.name` **逐字符精确匹配**（区分大小写、不 trim、不做模糊） |
| 3. 兜底 | 无匹配时走 `defaultExitId`；`defaultExitId` 为 `null` → `console.warn` 并报运行时错误（停留在小游戏前，不猜出口） |
| 4. 超时 | 到达 `timeoutMs`（省略时用 `settings.runtime.defaultMinigameTimeoutMs`）视为无匹配结果，走兜底 |
| 5. 变量 | 收到合法结果时写入 `last_minigame_result`（字符串）；小游戏不得直接改变量 |
| 6. 生命周期 | 结果处理完销毁 iframe；同一节点重复进入重新加载 |

### 12.5 校验时机

| 时机 | 执行内容 |
| --- | --- |
| 编辑时（实时） | E03–E07、E10–E14、E19、E20、E21、E22、E23、E24、E25、E26；表达式语法解析；路径与 id 即时标红 |
| 保存时 | 运行全部 E 规则并显示问题清单，**不阻止保存**（允许未完成接线的 WIP；只有数据无法序列化为合法 JSON 时拒绝写盘）；W 提示；保存前写 `meta.updatedAt` |
| 导出时 | 全部 E 规则 + 资源完整性（文件存在、视频编码、小游戏覆盖与自包含）+ `startNodeId` 非空；失败列出清单并阻止导出 |
| 运行时 | 存档结构（E29）、`projectId` 比对、结果格式（12.4）、表达式求值错误（8.10，`console.warn` 不中断） |

---

## 13. 版本与迁移

### 13.1 schemaVersion 递增规则

| 变更类型 | `schemaVersion` | 例子 |
| --- | --- | --- |
| 结构不兼容：删字段、改字段类型、改枚举语义、改必填性、改 `pattern` 语义 | **+1**，并配套迁移函数 | 把 `exits` 从数组改成对象；删除某节点类型 |
| 新增可选字段 / 新增枚举值 | **+1**，并配套迁移函数 | 旧版 schema 是 `additionalProperties: false`，会把新字段/新枚举值判为非法，旧编辑器无法安全打开新文件 |
| 纯文档/描述修正、bug 修复、默认值调整 | 不变 | 修改字段说明 |
| 存档结构 | 由 `saveState.version` 独立管理 | 存档增加字段 |

- `meta.version`（作者内容版本，如 `1.2.0`）与 `schemaVersion` 无关，不要混用。
- 旧编辑器打开高版本文件：拒绝并提示升级，不能静默丢弃未知字段。

### 13.2 未知字段策略

| 场景 | 策略 |
| --- | --- |
| schema 校验 | 根对象与绝大多数对象 `additionalProperties: false` → 未知字段直接校验失败 |
| 编辑器加载同版本但含未知字段 | 视为文件异常或更高版本编辑器产物：**只读打开**并提示，禁止保存（避免丢字段） |
| 编辑器保存 | 只写当前 schema 定义的字段；若检测到未知字段，先提示确认 |
| 运行时读取 | 宽松：忽略未知字段，只读已知字段，保证旧运行时能打开新文件的基础部分 |
| 导出 | 只导出当前 schema 字段；未知字段必须提示后才丢弃 |

### 13.3 迁移函数签名建议

```ts
type MigrationStep = (doc: unknown) => unknown; // 纯函数：输入 vN，返回 vN+1
const MIGRATIONS: Record<number, MigrationStep>; // 键 = 源版本号

// 逐级迁移：v1 → v2 → ... → targetVersion；每步后做结构校验
function migrateProject(raw: unknown, targetVersion: number): Project;
```
迁移实现要求：

- 逐级、不跳级；每步迁移后立即用对应版本 schema 校验；纯函数、不联网、幂等；
- 迁移前把原文件备份为 `*.bak`，失败时保留原文件并报错；存档迁移同理：`saveState.schemaVersion` 逐级迁移、`projectId` 不变，迁移失败按「损坏存档」处理（可删除，不影响项目）。

---

## 14. 设计决策与待确认清单

### 14.1 本草案已定的取舍

| 编号 | 决策 | 状态 | 说明 |
| --- | --- | --- | --- |
| D1 | 选项节点最少 2 个出口 | 已定 | 单选项没有选择意义；schema `minItems: 2` |
| D2 | 条件节点固定 `true` / `false` 两个出口 | 已定 | 不做多路条件；复杂分支用多个条件节点串联 |
| D3 | 跳转节点 0 出口 | 已定 | 目标写在 `targetNodeId`，不产生连线 |
| D4 | 对话 / 场景 / 变量节点固定 `next` 出口 | 已定 | 统一推进模型，schema 用 `const` 锁死 |
| D5 | 场景 `variables` 采用「缺失才初始化」声明语义 | 已定 | 重玩/回跳不重置玩家进度 |
| D6 | 小游戏按 `exit.name` 精确匹配 `result` | 已定 | 区分大小写、不 trim；结果串由作者在出口名里维护 |
| D7 | 存档缩略图内嵌 data URL | 已定 | Electron 文件与 Web IndexedDB 共用同一结构 |
| D8 | 时间轴 `value` 只支持数值 | 已定 | 颜色等非数值第一版不参与；后续版本再扩展 |
| D9 | `data` 连线仅 schema 预留 | 已定 | 第一版不实现连线 UI、运行时不推进 |
| D10 | array/object 值用原始 JSON 编辑 | 已定 | 内部不做递归类型标签，降低第一版复杂度 |
| D11 | 蓝图自由布局，`position` 为像素坐标 | 已定 | 运行时忽略该字段；与舞台归一化坐标是两套系统 |
| D12 | 固定出口名（`next` / `true` / `false` / `completed` / `skipped`）不可改，但提供可选 `label` 显示别名 | 已定 | 需求规定这些节点的出口固定；`label` 只影响展示，不参与匹配与连线；choice / minigame 的 `exit.name` 仍可改 |
| D13 | choice 每个选项**恰好一条**出边，缺失即错误 | 已定 | 与非 jump 出口统一（E12），保证每个选项可玩 |
| D14 | condition 出口未接线为错误 | 已定 | 与非 jump 出口统一（E12），不是警告 |
| D15 | 环检测：含可交互节点警告，纯逻辑环错误 | 待确认 | 防止运行时死循环，又允许合法的剧情回环 |
| D16 | 小游戏出口未覆盖 `declaredExits`：保存时校验并提示，**导出时阻止** | 已定 | 需求为「保存时校验、缺失阻止导出」，与 12.5 一致；编辑器提供一键补映射 |
| D17 | `role: "sfx"` 音频已有节点引用字段 | 已定 | 场景 `audio.sfx[]`（`sfxRef`：assetId/volume/loop），进入场景时播放；第一版只做一次性播放 |
| D18 | `role: "ui"` 图片已有节点引用字段 | 已定 | 场景 `uiImages[]`（形状同 `sprite`），按 zIndex 叠加显示 |
| D19 | 视频 `codec` 枚举收紧为 `h264` / `vp8` / `vp9`（已移除 av1） | 已定 | 与支持矩阵一致；其他编码导入时提示转码 |
| D20 | 时间轴文本框轨道属性统一为 `fontSizePx`，并新增 `backgroundOpacity` | 已定 | 属性名与静态字段一致，避免两套命名 |
| D21 | schema 没有 `default`；`uniqueItems` 只比较整个出口对象；`last_minigame_result` 已由 `variableMap` 锁定 string | 已定 | 默认值写在 description 或编辑器创建时填；`exit.id` 唯一由导出校验兜底（schema 无法表达） |
| D22 | 赋值类型不符时跳过并 `console.warn` | 已定 | 不中断流程，避免一处笔误卡死整段剧情 |
| D23 | 小游戏超时不写 `last_minigame_result` | 已定 | 保留上一次值；只有合法 `result` 才写入 |
| D24 | sprite 的 `x` / `y` 统一为立绘**中心点**（schema description 已写明），portrait 同 | 已定 | 与 background / textbox 的「中心点」约定一致 |
| D25 | 素材最终格式收紧：图片仅 `png` / `webp`，音频仅 `ogg` / `mp3`；导入的 jpg / wav 在保存时转码 | 已定 | 与素材模块「导出 png/webp、ogg/mp3」范围一致；不把源格式混进项目 |
| D26 | 保存允许 WIP（未接线也可保存），导出严格校验 | 已定 | 避免未完成接线时无法保存；小游戏出口覆盖缺失在导出时阻止（D16） |
| D27 | 原始导入文件保留在 `assets/.source/`，schema 用可选 `source` 字段记录 | 已定（阶段二新增） | 图片/音频二次编辑始终基于原始文件，避免反复烘焙损耗；导出不带 `.source/` |
| D28 | 通用出口与固定出口新增可选 `label` 显示别名 | 已定（阶段二新增） | 解决固定出口 name 不可改但作者想改显示文案的问题；匹配/连线仍用 id/name |
| D29 | 场景新增 `uiImages[]` 与 `audio.sfx[]` 引用字段 | 已定（阶段二新增） | 落实 D17/D18；运行时在阶段 5 实现渲染/播放 |
| D30 | 表达式支持数组字面量（如 `["buy","wait"]`）作为安全超集 | 已定（阶段五新增） | `in` / `len` 等只读场景需要；不支持对象字面量与任意函数表达式 |
| D31 | 运行时结束语义：`dialogue` / `scene` 无 `next` 出边 → 正常结束；其他节点出口缺边 → 运行时错误 | 已定（阶段五新增） | 项目没有独立结束节点类型，最后一幕允许不接线；`jump` 目标无效、condition/choice/minigame/video 缺边仍视为错误 |
| D32 | 存档存储：编辑器中内嵌运行时经 IPC 写项目 `saves/*.json`；独立 Web 运行时写 IndexedDB | 已定（阶段五新增） | 两种存储共用同一 `saveState` 结构；缩略图内嵌 data URL |
| D33 | Web 包结构：包根放 `index.html` + runtime 文件 + `game.json` + `assets/`；`game.json` 去掉 `$schema` / `layout` / `editor`；不复制 `assets/.source/`；导出前跑 E 规则、warnings 允许 | 已定（阶段六新增） | 与 runtime 静态入口和 schema 的 optional 字段一致；导出失败不生成包 |

### 14.2 已确认决策（用户确认）

四项原待确认问题已确认（2026-10-21，用户回复“1，2，3，4 可以”），按以下结论实现：

1. **D12**：固定出口增加可选 `label` 显示别名，`id` / `name` 仍不可改。
2. **D17 / D18**：新增场景 `audio.sfx[]` 与 `uiImages[]` 引用字段（D29）。
3. **保存阻断策略**：维持「保存允许 WIP、导出严格校验」（D16 / D26）。
4. **素材格式**：图片最终只允许 png / webp、音频最终只允许 ogg / mp3（导入时转码，D25）。

---

## 15. 附录

### 15.1 完整示例索引

| 文件 | 内容 |
| --- | --- |
| `examples/demo-project.json` | 完整示例项目：17 个节点（8 类节点全部覆盖）、21 条连线、2 条时间轴、10 个素材（图片 4 / 音频 4 / 视频 1 / 小游戏 1）、9 个变量；已通过 `schema.json` 校验（可用 `node scripts/check-schema.mjs` 复跑） |
| `examples/save-sample.json` | `$defs.saveState` 示例：手动槽位 `slot: 1`，含变量快照、时间轴进度与缩略图 |
| `schema/schema.json` | 结构权威（draft 2020-12，66 个 `$defs`） |

`examples/demo-project.json` 覆盖 8 类节点、`sequence` / `conditional` 两类连线、两条时间轴与全部四类素材，可直接打开对照字段，此处不复制大 JSON。

### 15.2 最小可变项目骨架

下面这份 JSON 是**通过 schema 校验**的最小项目骨架（注意：只有蓝图结构，导出前还需补连线与素材；导出校验会要求出口覆盖与起始节点可达）：

```json
{
  "$schema": "../schema/schema.json",
  "schemaVersion": 1,
  "meta": { "id": "demo-minimal-01", "title": "最小项目骨架", "createdAt": "2026-10-21T00:00:00Z", "updatedAt": "2026-10-21T00:00:00Z" },
  "settings": { "startNodeId": "n_open", "resolution": { "width": 1280, "height": 720 }, "backgroundColor": "#101418", "textSpeedCps": 30 },
  "assets": { "images": [], "audio": [], "videos": [], "minigames": [] },
  "variables": { "has_key": { "type": "boolean", "value": false } },
  "nodes": [{ "id": "n_open", "type": "dialogue", "name": "开场", "position": { "x": 0, "y": 0 }, "exits": [{ "id": "next", "name": "next" }], "text": "雨还在下。", "speaker": "旁白" }],
  "edges": [],
  "timelines": {}
}
```
扩容顺序建议：加素材 → 加节点与出口 → 加连线 → 加场景变量/时间轴 → 补 `settings.startNodeId`。
