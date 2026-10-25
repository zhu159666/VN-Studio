# VN Studio· 桌面视觉小说创作套件

Electron + React + React Flow 的桌面端视觉小说创作套件，配一个零依赖的纯浏览器运行时。项目文件为 JSON，编辑器与运行时共用同一 schema。

> 当前进度：**阶段 1–7 已完成**：schema、项目与素材、蓝图编辑器、场景时间轴、纯浏览器运行时、Web 打包导出、electron-builder 桌面打包（Windows 免安装目录 / zip / 单文件 portable），以及内置 ffmpeg 的完整 NSIS 安装包（已静默安装 + 卸载验证）。
>
> **1.2.0 更新**：普通节点内置对话序列、内嵌式 Unity 风格场景编辑、全局/单场景双演示、素材文件夹、组件启用时长、时间轴分割/吸附/快捷关键帧、自动说话轨，以及台词文字抖动/波浪/脉冲模板。新增用户请直接看下方 [教学文档：从零完成一个视觉小说](#教学文档从零完成一个视觉小说)；阶段 1–8 的章节保留为历史实现说明。

## 下载 VN Studio

**最终用户请到本仓库的 [Releases](../../releases) 下载 Windows 安装包**：

- `VN-Studio-Setup-<version>-x64.exe`：完整环境安装包（内置 ffmpeg，推荐；支持 `/S` 静默安装与 `/D=<目录>` 指定安装位置）。
- `VN-Studio-Setup-<version>.exe`：electron-builder 标准 NSIS 安装包。

> 源码仓库**不包含** `node_modules`、打包产物和 `exe`，所以「下载源码」不等于能直接运行；需要自己构建时见下方「本地运行与验证」。仓库已配置 GitHub Actions：推送 `v*` 标签会自动构建并上传两个安装包到 Releases，手动运行 `Build Windows installer` 可在 Actions Artifacts 中下载。

## 阶段路线

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | `schema.json` 草案 + 字段说明文档 | ✅ 已完成 |
| 2 | 项目文件读写 + 素材导入 + 素材管理界面 | ✅ 已完成 |
| 3 | 蓝图编辑器（节点渲染、拖拽、连线、属性面板） | ✅ 已完成 |
| 4 | 场景内时间轴与关键帧 | ✅ 已完成 |
| 5 | 浏览器运行时（解析项目文件并播放） | ✅ 已完成 |
| 6 | Web 打包导出 | ✅ 已完成 |
| 7 | electron-builder 桌面打包（Windows zip / portable / 解包目录 + NSIS 完整安装包） | ✅ 已完成 |

## 目录结构

```
editor/                       Electron + React 编辑器
  electron/                   主进程：窗口 / IPC / 项目读写 / 素材服务 / 存档 / 导出 / smoke
  src/
    screens/                  开始界面、项目工作区
    components/               素材面板、左下三面板、InspectorPanel、inspectors/
    features/blueprint/       React Flow 蓝图
    features/timeline/        时间轴编辑器与纯逻辑
    features/preview/         编辑器内嵌运行时预览（演示 Tab）
    features/assets/          素材编辑器
    state/                    项目状态、蓝图/时间轴纯函数变更
runtime/                      纯浏览器运行时（原生 ESM + Canvas/DOM）
  engine.js / expression.js / timeline.js   纯逻辑引擎
  runtime.js / storage.js / runtime.css / index.html
  CONTRACT-PHASE5.md
schema/                       schema.json（66 个 $defs）+ FIELDS.md
assets/、saves/、examples/、tests/（316 项）
scripts/                      schema/文档校验、UI/运行时/导出/桌面冒烟
```

## 已实现能力

**阶段一 schema**：8 类节点、命名出口、统一 `edges` 表（sequence/conditional/data 预留）、typed variables、场景时间轴、存档、布局持久化；字段与行为约定见 [schema/FIELDS.md](schema/FIELDS.md)。

**阶段二 项目与素材**：项目 CRUD + Ajv 校验；图片/音频/视频/小游戏导入与编辑（ffmpeg）；`assets/.source/` 原始文件；`vnasset://` 协议；开始界面四入口、三栏工作区、素材编辑器、自动保存、最近项目。

**阶段三 蓝图编辑器**：React Flow 画布、8 类节点、右侧命名出口（宽度随出口数扩展）、贝塞尔连线、端口拖线/拖到空白建节点、素材拖拽生成、场景/节点/连线属性面板、Delete/F/框选等快捷键。

**阶段四 场景时间轴**：四类轨道（立绘/背景/音频/文本框）、关键帧、linear/easeIn/easeOut/easeInOut + 强度滑块换算贝塞尔控制点、播放/缩放/K/←→/Delete、时间轴覆盖蓝图静态值。工具栏「+ 轨道」菜单用浮层渲染，不再被轨道裁剪/遮挡（底部空间不足时自动向上弹出）。

**场景预览小窗**：在蓝图选中场景节点后，画布左下角出现可拖动、可收起的「场景预览」画中画。它以该场景为起点静音运行：时间轴动画按关键帧播放，对白自动推进、选项自动选择，走到结尾自动回到该场景循环重播；项目编辑后（防抖）重建，演示的始终是编辑后的效果。

**界面材质**：作者可用图片替换界面内置外观（填充方式 stretch/cover/contain + 图片透明度 + 边框色/宽度 + 圆角）。作用范围：对话框按场景设置（场景属性「对话框材质」）、选项按钮按 choice 节点设置（节点属性「选项材质」）、标题背景与卡片 / 结束卡片 / 存档菜单面板在右侧项目设置的「界面材质」中设置。运行时、编辑器预览与导出的 Web 包行为一致；不设置时沿用内置样式。

**编辑器体验（主题 / 音频工坊 / 抠图 / 自动保存）**：
- **明 / 暗模式**：开始界面与编辑器顶栏右上角一键切换，localStorage 记忆；画布与运行时舞台保持深色，避免影响画面判断。
- **音频工坊**：素材库「导入 → 制作音频…」或开始界面「音乐管理」进入；内置 7 种合成预设（提示音 / 按钮音 / 胜利 / 失败 / 氛围铺底 / 旋律 / 鼓点），可调 BPM 与时长，生成 WAV 后自动转成 ogg 入库。
- **自动抠图**：图片编辑「去背景」新增「自动抠图」，按画面四角与边缘取平均色作为键色，再配合容差/羽化微调。
- **自动保存**：存在未保存改动时每 15 分钟静默落盘一次；`Ctrl+S` 与「保存」按钮仍即时保存。

**阶段五 纯浏览器运行时**：8 类节点推进、白名单表达式、场景 Canvas 渲染 + 时间轴 cubic-bezier、逐字对话、选项、小游戏 iframe（仅 `allow-scripts` + postMessage 校验/超时）、视频（暂停恢复 BGM）、BGM/voice/sfx、标题/结束界面、存档（手动 1–9 + 自动/快速、缩略图）；编辑器演示 Tab 内嵌预览；桌面存档写 `saves/*.json`，独立 Web 运行时用 IndexedDB。

**阶段六 Web 打包导出**：
- 导出前校验器（[validate-project.cjs](editor/electron/lib/validate-project.cjs)）覆盖 E03–E28/E30 与 W01–W10：引用完整性、出口覆盖、小游戏声明/HTML 合规、素材 role、路径/文件、时间轴、视频编码矩阵、纯逻辑环等；错误阻止导出，警告放行。
- 导出器（[export-web.cjs](editor/electron/lib/export-web.cjs)）生成可部署静态包：
  ```
  <项目名>-web/
  ├─ index.html            # runtime 入口
  ├─ runtime.js engine.js expression.js timeline.js storage.js runtime.css
  ├─ game.json             # 去掉 $schema / layout / editor
  └─ assets/{images,audio,videos,minigames}/   # 不含 .source/
  ```
- 编辑器顶部「导出」按钮（进行中禁用、成功后显示「打开目录」）；开始界面「打包」入口会先打开项目再导出；失败 toast 列出 E 编号与前几条原因。
- 校验失败不创建输出目录；同名导出自动避免覆盖。

**阶段七 electron-builder 桌面打包**：
- `editor/package.json` 配置：`appId` / `productName: VN Studio` / asar / `dist + electron + package.json` 入包；`extraResources` 携带 `runtime/`（导出模板）与 `schema/schema.json`；`release/` 输出。
- 打包态路径解析已适配（[paths.cjs](editor/electron/lib/paths.cjs)）：`schemaPath()/runtimeDir()` 指向 `resources/`，`editorDistIndex()/preloadPath()` 指向 `app.asar` 内；导出器改用 `runtimeDir()`，打包后 Web 导出仍可用。
- 产物：
  - `editor/release/win-unpacked/`：可直接运行的免安装目录（`VN Studio.exe`）。
  - `editor/release/VN-Studio-<version>-x64.zip`：可分发 zip。
  - `editor/release/VN-Studio-<version>-portable.exe`：单文件免安装 portable。
  - `editor/release/VN-Studio-Setup-<version>-x64.exe`：**完整 NSIS 安装包**（约 117 MB，内置 ffmpeg）：欢迎 / 选择目录 / 安装 / 完成页（中文 + English），创建桌面与开始菜单快捷方式、写入 HKCU 卸载项与 `EstimatedSize`，自带卸载程序；`INSTALLER-INFO.json` 记录大小、SHA-256、payload 文件数。
  - `editor/release/VN-Studio-Setup-<version>.exe`：electron-builder 标准 NSIS 安装包（`pnpm editor:dist:win`，约 115 MB，同样内置 ffmpeg；已静默安装 + 卸载验证）。
- 完整安装包用 `pnpm editor:installer`（[build-installer.mjs](scripts/build-installer.mjs)）生成：`vite build` → `electron-builder --dir` → 把 `win-unpacked` 复制到 `.installer-stage` → 用 electron-builder 缓存里的 `makensis` 直接编译。脚本会校验 payload 文件数/字节、makensis 退出码与 `Total size`、PE 头，并修正产物的完整性级别。
- 自定义 NSIS 脚本写到 `editor/.nsis/installer.nsi`，**不要**放回 `editor/build/`：electron-builder 会把 `build/installer.nsi` 当作自定义脚本、经 stdin 交给 makensis，UTF-8 BOM 会变成 `Invalid command: "?Unicode"`，导致 `dist:win` 失败。
- 已验证：两个安装包用 `/S /D=<目录>` 静默安装后，payload 与 `win-unpacked` 逐文件 SHA-256 一致；注册表卸载项与快捷方式正确；卸载程序能完整清理目录、快捷方式和注册表；安装后的 `app.asar` 内 paths/schema/runtime 解析正常。
- 校验脚本 `pnpm smoke:desktop`：重新构建 → `electron-builder --dir` → 检查 app.asar 大小、`resources/runtime`/`schema` → 用打包 exe 的 `ELECTRON_RUN_AS_NODE` 模式加载 `app.asar` 内 paths/schema/export-web，验证打包态路径与生产依赖。

**阶段八 Command bus + MCP（MCP-ready）**：
- `editor/src/commands/` 是纯逻辑命令总线（不依赖 React / DOM / Electron），为把编辑器操作暴露给 MCP / AI 做准备。
- 共 **21 个 command**：蓝图节点创建 / 连线 / 出口配置（增/改/删/默认出口）、节点删除 / 连线删除 / 开始节点 / 对话内容、时间轴关键帧（增/改/删）、轨道删除、时间轴时长与循环、场景背景 / 立绘 / BGM 配置。
- 每个 command 都有 JSON Schema `inputSchema` 与描述；`listCommands()` / `commandsToMcpTools()` 可直接映射成 MCP tools。参数只接受 JSON 可序列化类型，执行返回统一结构：`ok`、`command`、`affectedNodeIds`、`affectedTrackIds`、`warnings`、`data`、`project`（成功时）或 `error.code/message`（失败时，不抛异常）。
- **MCP 已接入**：`editor/electron/lib/mcp-server.cjs` 提供 stdio / HTTP 两种传输。默认只暴露 **14 个面向 AI 的语义工具**（`get_blueprint_summary`、`create_scene_node`、`create_dialogue_chain`、`create_branch_node`、`create_choice_node`、`configure_scene_stage`、`add_scene_keyframes`、`update_project_settings`、`connect_blueprint_nodes`、`create_project`、`import_image_asset`、`import_audio_asset` 等），所有修改操作返回**受影响区域结构化快照**（节点坐标/出口/连线/悬空端口）；底层 21 个 command 通过 `execute_command` 逃生口调用（`VN_MCP_TOOLSET=all` 可恢复旧工具列表）。
- 编辑器通过 `actions.executeCommand(name, params)` 调用。测试见 `tests/phase8/commands.test.mjs`、`tests/phase8/mcp.test.mjs`。

**外部 AI 助手（内部生图）**：
- 设置（开始界面 / 编辑器顶部）→「外部 AI 服务」：OpenAI 兼容的 Base URL、API Key、模型、生图尺寸、超时；API Key 用 Electron safeStorage 加密保存在 userData，不写入项目。
- 编辑器顶部「AI 助手」：输入提示词选择立绘/背景，生成后自动调用与 MCP 相同的 `saveImportedImage` 管道（去背景、512×1024 / 1920×1080 裁剪），再导入素材库。
- 外部 Agent 通过 MCP 时不需要这里的 API 配置：Agent 自己生图后调用 `import_image_asset(base64_data, asset_type, auto_remove_bg)`。

**立绘动画模板**：场景属性面板的每个立绘实例新增「动画模板」下拉（淡入 / 左右滑入 / 弹出 / 浮动 / 呼吸），选择后自动在当前场景时间轴生成可继续编辑的关键帧。

**打开项目 / 桌面版游玩**：
- 开始界面右上角新增「打开项目」，可直接选择已有 `project.json`（此前只有创建项目与最近项目）。
- 编辑器顶部新增「桌面版」导出：在导出 Web 包的同时生成 `启动游戏.cmd`，双击后用 `VN Studio.exe --play <目录>` 进入独立播放窗口（`vnplay://` 协议，存档 origin 稳定），不进入编辑器、不需要浏览器或本地服务器。
- 也可以命令行播放：`VN Studio.exe --play "D:\\path\\game-web"`。

## 教学文档：从零完成一个视觉小说

> 本节对应 **VN Studio 1.2.0** 的普通节点模型。旧版「对话 / 选项 / 跳转」节点只用于兼容旧工程，新建项目请按本节操作。

### 0. 安装与启动

1. 从 [Releases](../../releases) 下载 `VN-Studio-Setup-<version>-x64.exe`。
2. 安装后桌面会出现 **VN Studio**。
3. 打开后进入开始界面：
   - **新建项目**：从零开始。
   - **打开项目**：选择已有 `project.json`。
   - **最近项目**：继续之前的工程。
   - **音乐管理 / 打包**等入口也在开始界面。

项目本质上是一个文件夹，核心文件是 `project.json`，素材放在 `assets/` 下。

### 1. 新建项目

新建项目时填写：

- 项目标题
- 作者
- 分辨率（默认 1920×1080 或 1280×720）
- 起始节点

创建后会进入三栏工作区：

- 左侧：素材库 / 变量表 / 项目结构
- 中间：蓝图 / 素材编辑 / 演示
- 右侧：节点属性
- 底部：场景时间轴

### 2. 认识 1.0 的蓝图

「+ 创建节点」现在只有五类：

| 节点 | 用途 |
| --- | --- |
| **普通节点** | 一个场景，内部包含背景、图层、对话序列、分支；双击进入场景编辑 |
| **动画/视频** | 播放视频 CG，完成后继续 |
| **小游戏** | QTE、点击等自包含小游戏 |
| **条件** | 高级流程：按表达式走 true/false |
| **变量操作** | 高级流程：修改变量后继续 |

不再新建：

- **对话节点**：对话已经放进普通节点内部。
- **选项节点**：普通节点内部的分支对话即可完成。
- **跳转节点**：直接拉线到目标节点即可，不需要单独跳转节点。

> 条件节点用于「系统判断」而不是玩家选择。例如 `route == "good"`、`affection >= 3`。  
> 跳转是「无条件去另一个节点」，现在用普通连线表达。

### 3. 普通节点 = 场景 + 对话

双击普通节点，或选中后点属性栏「场景编辑」，进入场景编辑。

一个普通节点包含：

- **场景图层**：背景、立绘、UI、前景、粒子
- **对话序列**：普通对话 + 分支对话
- **自动存档点**：可选
- **出口**：通常一条 `next` 连线

普通节点之间的连线决定场景顺序。

### 4. 场景编辑

场景编辑直接嵌在蓝图工作区中间，不弹全屏，底部时间轴保持显示：

- 双击普通节点进入场景编辑
- 顶部「返回蓝图」回到节点图
- 中间是 16:9 舞台
- 左侧是图层列表
- 右侧仍是完整属性面板
- 底部时间轴不隐藏，可边看舞台边改关键帧
- 立绘 / UI 图片可以直接在舞台上**拖动位置**
- 左栏可直接改 x / y / 缩放 / 透明度

图层从上到下通常按：

```
粒子 / 前景
UI
立绘
背景
```

添加立绘：

1. 先在左侧素材库导入图片，role 选「立绘」。
2. 选中普通节点。
3. 右侧属性栏 →「B · 场景常驻立绘」→「+ 添加立绘」。
4. 选素材，填 x/y/缩放/层级。
5. 需要动画时选「动画模板」，会在时间轴生成关键帧。

> **B 与 C0 的区别**：B 是场景常驻图层，适合一直站在场景里的角色/物件；C0 每条台词里的「台词立绘」是说话时覆盖上来的立绘。两者选同一素材时，运行时会在该台词期间自动隐藏常驻层，避免立绘重影。

### 5. 对话序列

选中普通节点，右侧「C0 · 对话序列」。

#### 普通对话

点「添加普通对话」，每行可以设置：

- 说话人 `speaker`
- 台词 `text`
- 台词立绘、位置、缩放
- 动画：无 / 淡入 / 左滑 / 右滑 / 弹出
- 文字表现模板：正常 / 抖动 / 波浪 / 脉冲 / 彩色
- 自动前进时间 `autoAdvanceMs`（0 表示手动点击）
- 上下移动 / 删除

对话按列表从前往后播放。

#### 分支对话

点「添加分支对话」：

- 填分支提示 `prompt`
- 每个选项填选项文字
- 每个选项必须选「下一个节点 `targetNodeId`」
- 选项选中后会离开当前普通节点，进入指定的下一个普通节点 / 视频 / 小游戏 / 条件节点

#### 自动存档点

勾选「自动存档点 autoSave」，进入该普通节点时自动写自动存档。

### 6. 组件启用与启用时长

背景、立绘、UI、前景、粒子都可以设置：

- **启用**：关闭后运行时不绘制该组件
- **开始时间**：从场景第几毫秒开始显示
- **结束时间**：到第几毫秒停止显示

例如让雨停：

1. 选中普通节点。
2. B4 粒子层 → 启用粒子 → 选 `rain`。
3. 设置结束时间 `12000`。
4. 场景播放到 12 秒后雨就不再绘制。

### 7. 场景时间轴

底部时间轴只作用于当前场景，选中普通节点时自动出现：

- 自动按当前对话序列估算场景时长
- 自动生成「说话轨」：每条台词按顺序排成块，点击块跳到对应时间
- 之后可以继续在说话轨上方添加立绘 / 背景 / 音频 / 镜头等属性轨道

#### 添加轨道

点「+ 轨道」，可选：

- 立绘（x / y / 缩放 / 透明度 / 层级）
- 背景（x / y / 缩放 / 透明度）
- 音频（音量等）
- 文本框（位置 / 透明度等）
- 镜头（x / y / zoom / 旋转 / 抖动）
- 粒子 / 前景等由场景属性控制

#### 编辑关键帧

- 说话轨是只读预览；属性轨道可自由加关键帧
- 「+ 关键帧」：选择任意属性，在播放头一键插入关键帧（没有轨道会自动建）
- 双击轨道：在鼠标位置加关键帧
- 拖动关键帧：改时间
- 选中关键帧：在右侧改数值 / 缓动
- `K`：在播放头位置加关键帧
- `S` 或工具栏「分割」：在播放头分割当前轨道
- 「吸附」：拖动关键帧时吸附到 0.1 秒网格和已有帧
- `Delete`：删除选中关键帧
- `Space`：播放 / 暂停
- `← / →`：跳到上一个 / 下一个关键帧

关键帧会覆盖蓝图里的静态值；没有关键帧的属性沿用蓝图值。

#### 镜头 / 前景 / 粒子

- **镜头**：只作用于背景、立绘、前景、粒子，不影响文本框和选项按钮。
- **前景层**：属性栏「B3 · 前景层」；可设图片、透明度、fit、缩放、视差偏移。
- **粒子层**：属性栏「B4 · 粒子层」；预设雨、雪、尘、火星、光点。

### 8. 全局流程时间轴

顶部「全局流程」按钮打开。

它把整条路线铺成三条轨道：

- 普通节点
- 视频 CG
- 小游戏

顶部显示：

- 当前路线节点数
- 总时长估算
- 排除小游戏后的时长
- 分支点数量

底部「分支 / 路线切换」：

- 列出当前路线上的每个分支
- 点击不同选项会重新计算整条路线
- 点击任意时间轴块会回到蓝图并选中对应节点

> 当前是按「当前选择路线」铺轴，不是把所有分支同时铺开。切换分支即可比较不同路线时长。

### 9. 素材文件夹

分组现在直接在左侧素材栏里，像文件夹一样使用：

1. 左侧「素材文件夹」→「+ 新建文件夹」
2. 输入名称，回车或点「确定」
3. 点击文件夹即可只显示该文件夹的素材
4. 选中一个素材，点工具栏「加入文件夹」
5. 点「全部素材」返回完整素材库

文件夹数据保存在 `project.editor.groups`，导出游戏时不会打包进去。

### 10. 预览、导出与游玩

#### 编辑器内预览

顶部「演示」有两个模式：

- **全局演示**：从起始节点开始，完整运行整个游戏。
- **单场景演示**：只运行当前选中的普通节点，适合反复调一场戏；不会写自动存档。
- 选中场景节点后，蓝图左下角还有一个「场景预览」小窗，循环演示当前场景，可拖动、可收起。

#### 导出 Web 包

顶部「导出」：

- 生成 `index.html + game.json + runtime + assets`
- 可部署到静态服务器
- 本地游玩：解压后双击 `启动游戏.cmd`（需要 Python 3）
- 不要直接双击 `index.html`

#### 导出桌面版

顶部「桌面版」：

- 生成 Web 资源和 `启动游戏.cmd`
- 双击后用 VN Studio 的独立播放窗口运行
- 不需要浏览器或本地服务器

### 11. 常用快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl/Cmd + S` | 保存 |
| `Delete / Backspace` | 删除选中节点 / 连线 / 关键帧 |
| `F` | 蓝图适应全部 |
| `Space` | 时间轴播放 / 暂停 |
| `K` | 在播放头添加关键帧 |
| `S` | 在播放头分割当前轨道 |
| `← / →` | 跳到上 / 下一个关键帧 |
| 双击普通节点 | 打开场景编辑 |
| 双击蓝图空白 | 打开创建节点菜单 |

### 12. 常见问题

**Q：为什么创建节点菜单里没有「对话」「选项」？**  
A：1.0 起对话和选项都收进普通节点的「C0 · 对话序列」。旧工程里的独立对话/选项节点仍可显示和兼容。

**Q：分支选项为什么必须连下一个节点？**  
A：分支是「离开当前场景」的流程分叉，不是同一场景内的临时台词。需要同一场景内继续说话，请把台词加在当前普通节点的对话序列里。

**Q：条件节点和分支对话有什么区别？**  
A：分支对话由玩家点击选项；条件节点由系统计算表达式，走 true/false。

**Q：为什么全局时间轴时长和实际游玩不一样？**  
A：时长是估算值，按文本速度、视频时长、小游戏超时计算；实际阅读速度、是否跳过会影响真实时长。小游戏默认不计入「排除小游戏」的数值。

**Q：导入素材后场景里看不到？**  
A：确认素材 role 是否正确（背景 / 立绘 / UI），并在场景属性或场景编辑里选择该素材；同时检查组件是否被停用或设置了错误的启用时间。

## 本地运行与验证

```bash
pnpm install

# 编辑器开发（两个终端）
pnpm editor:dev
pnpm editor:dev:electron

# 构建后启动编辑器
pnpm editor:build
pnpm editor:start

# 桌面打包（electron-builder）
pnpm editor:dist           # Windows zip → editor/release/
pnpm editor:dist:dir       # 免安装目录 → editor/release/win-unpacked/
pnpm editor:dist:portable  # 单文件 portable exe
pnpm editor:dist:win       # NSIS 安装器（electron-builder 内置目标）
pnpm editor:installer      # 完整 NSIS 安装包（内置 ffmpeg，推荐；产物 VN-Studio-Setup-<version>-x64.exe）

# 测试与校验
pnpm test                  # 316 项
pnpm check:schema
pnpm check:docs

# 冒烟（本机 Edge；截图输出 editor/.smoke/）
pnpm smoke:ui              # 编辑器全流程（素材/蓝图/时间轴/演示）
pnpm smoke:runtime         # 独立运行时全流程（标题/对话/场景/小游戏/视频/存档/结局）
pnpm smoke:export          # 真实项目 → 导出 Web 包 → 静态服务 → Edge 验证
pnpm smoke:desktop         # 重新打 dir 包 + 打包态路径/依赖自检
```

**独立运行时/导出包使用**：把包或 runtime 目录部署到静态服务器，打开 `index.html`（或 `index.html?game=./game.json`）即可播放；不依赖 Electron/Node/远程资源。

**MCP 接入（AI 编辑项目）**：安装版提供 **HTTP + stdio** 两种传输。

- **HTTP（推荐，免配置命令）**：打开 VN Studio 后，支持 `url` 的客户端直接连 `http://127.0.0.1:38123/mcp`（端口可用 `VN_STUDIO_MCP_HTTP_PORT` 改；`GET /health` 自检）：

```json
{
  "mcpServers": {
    "vn-studio": { "url": "http://127.0.0.1:38123/mcp" }
  }
}
```

- **stdio（Claude Desktop 等）**：用安装目录下的启动器，通过 `ELECTRON_RUN_AS_NODE=1` 运行、不打开 GUI：

```json
{
  "mcpServers": {
    "vn-studio": {
      "command": "C:\\Users\\<你>\\AppData\\Local\\Programs\\VN Studio\\VN Studio.exe",
      "args": [
        "C:\\Users\\<你>\\AppData\\Local\\Programs\\VN Studio\\resources\\mcp\\mcp-stdio.cjs",
        "--project",
        "D:\\my-vn-project\\project.json"
      ],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

- 提供 13 个语义工具（含 `get_blueprint_summary` / `create_branch_node` / `create_dialogue_chain` / `import_image_asset`）；AI 先读 summary 拿节点 id 与悬空端口，再调用语义工具，每个修改工具都会返回受影响区域快照。
- MCP 直接读写磁盘上的 `project.json`；如果编辑器正打开同一项目，先保存/关闭，避免编辑器内存中的旧版本覆盖 MCP 的修改。
- 开发态先跑 `pnpm editor:build`（会生成 `editor/electron/generated/command-bus.cjs` 与 `editor/electron/resources/mcp/mcp-stdio.cjs`）。详细协议与工具说明见 [editor/src/commands/README.md](editor/src/commands/README.md)。

> 桌面版已内置 ffmpeg（打包后在 `resources/bin/ffmpeg.exe`，[media.cjs](editor/electron/lib/media.cjs) 优先使用它），用户无需预装。免安装运行用 `editor/release/win-unpacked/VN Studio.exe`，正式分发用 `editor/release/VN-Studio-Setup-<version>-x64.exe`（支持 `/S` 静默安装、`/D=<目录>` 指定安装位置）。
>
> 注意：如果项目位于“低完整性级别（Low IL）”目录（某些沙箱/受限目录），其中生成的 exe 会继承 Low，双击安装时会报 `NSIS Error: Error writing temporary file`。`scripts/build-installer.mjs` 会自动把安装包提升为 Medium；其他手动产物可用 `icacls <exe> /setintegritylevel Medium` 处理。

## 发布新版本（GitHub Releases）

1. 修改版本号：根 `package.json` 与 `editor/package.json` 的 `version`（安装包文件名/版本资源取后者）。
2. 提交并打标签：`git tag v0.1.3 && git push origin v0.1.3`。
3. GitHub Actions（[build-windows.yml](.github/workflows/build-windows.yml)）会在 `windows-latest` 上安装依赖与 ffmpeg、跑测试、构建两个 NSIS 安装包，并自动创建 Release 上传 `VN-Studio-Setup-*.exe` 与 `INSTALLER-INFO.json`。
4. 不发布 Release 时，也可以在 Actions 页面手动运行 `Build Windows installer`，从 Artifacts 下载安装包。

## 验收结果

- 全仓 **316 项** Node 测试通过（schema/引用完整性/项目/素材/媒体/IPC/蓝图/时间轴/表达式/引擎/存档/导出校验与导出器/桌面打包路径/Command bus/语义 MCP/图片导入/外部 AI）。
- `pnpm editor:build` 成功；`check:schema` / `check:docs` 通过。
- 四套 headless 冒烟均通过：编辑器、运行时、导出包；桌面打包冒烟验证 `win-unpacked` 结构、`resources/runtime`/`schema` 与打包态模块加载（零 GUI 启动，因无桌面会话）。
- 桌面产物：`editor/release/win-unpacked/`、`editor/release/VN-Studio-<version>-x64.zip`、`editor/release/VN-Studio-<version>-portable.exe`、`editor/release/VN-Studio-Setup-<version>.exe`（electron-builder NSIS）、`editor/release/VN-Studio-Setup-<version>-x64.exe`（完整环境 NSIS）；两个安装包均已静默安装 + 卸载验证。

## 关键约定

- 不使用任何现有视觉小说引擎；不采用 Web 应用或云端依赖。
- 连线统一存一张 `edges` 表；`data` 仅 schema 预留。
- 所有节点从第一版起就是多出口「命名出口」模型。
- 表达式白名单递归下降，无 `eval` / `Function`、无原型链访问。
- 舞台位置 0–1 中心点；时间轴毫秒；缓动只存贝塞尔控制点。
- 时间轴关键帧覆盖蓝图静态值，未覆盖沿用蓝图；dialogue/scene 无出边=正常结束。
- 保存允许 WIP，导出严格校验；小游戏 iframe 仅 `allow-scripts`，结果精确匹配出口。
- 素材最终格式：图片 png/webp、音频 ogg/mp3；原始文件留在 `assets/.source/` 且不导出。

## 后续建议

- 在桌面 Windows/带交互会话的 CI 上生成并验证 NSIS 安装器；补充自定义应用图标与代码签名。
- 将 ffmpeg 作为 `extraResources` 一起分发，避免要求用户预装。
- 大型项目性能优化、蓝图自动布局、导出进度窗口。
- 小游戏结果 payload 扩展、更多条件函数与时间轴属性。
