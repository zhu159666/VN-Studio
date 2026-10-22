# VN Studio· 桌面视觉小说创作套件

Electron + React + React Flow 的桌面端视觉小说创作套件，配一个零依赖的纯浏览器运行时。项目文件为 JSON，编辑器与运行时共用同一 schema。

> 当前进度：**阶段 1–7 已完成**：schema、项目与素材、蓝图编辑器、场景时间轴、纯浏览器运行时、Web 打包导出、electron-builder 桌面打包（Windows 免安装目录 / zip / 单文件 portable），以及内置 ffmpeg 的完整 NSIS 安装包（已静默安装 + 卸载验证）。

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
assets/、saves/、examples/、tests/（289 项）
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
  - `editor/release/VN-Studio-0.1.0-x64.zip`：可分发 zip。
  - `editor/release/VN-Studio-0.1.0-portable.exe`：单文件免安装 portable。
  - `editor/release/VN-Studio-Setup-0.1.0-x64.exe`：**完整 NSIS 安装包**（约 117 MB，内置 ffmpeg）：欢迎 / 选择目录 / 安装 / 完成页（中文 + English），创建桌面与开始菜单快捷方式、写入 HKCU 卸载项与 `EstimatedSize`，自带卸载程序；`INSTALLER-INFO.json` 记录大小、SHA-256、payload 文件数。
  - `editor/release/VN-Studio-Setup-0.1.0.exe`：electron-builder 标准 NSIS 安装包（`pnpm editor:dist:win`，约 115 MB，同样内置 ffmpeg；已静默安装 + 卸载验证）。
- 完整安装包用 `pnpm editor:installer`（[build-installer.mjs](scripts/build-installer.mjs)）生成：`vite build` → `electron-builder --dir` → 把 `win-unpacked` 复制到 `.installer-stage` → 用 electron-builder 缓存里的 `makensis` 直接编译。脚本会校验 payload 文件数/字节、makensis 退出码与 `Total size`、PE 头，并修正产物的完整性级别。
- 自定义 NSIS 脚本写到 `editor/.nsis/installer.nsi`，**不要**放回 `editor/build/`：electron-builder 会把 `build/installer.nsi` 当作自定义脚本、经 stdin 交给 makensis，UTF-8 BOM 会变成 `Invalid command: "?Unicode"`，导致 `dist:win` 失败。
- 已验证：两个安装包用 `/S /D=<目录>` 静默安装后，payload 与 `win-unpacked` 逐文件 SHA-256 一致；注册表卸载项与快捷方式正确；卸载程序能完整清理目录、快捷方式和注册表；安装后的 `app.asar` 内 paths/schema/runtime 解析正常。
- 校验脚本 `pnpm smoke:desktop`：重新构建 → `electron-builder --dir` → 检查 app.asar 大小、`resources/runtime`/`schema` → 用打包 exe 的 `ELECTRON_RUN_AS_NODE` 模式加载 `app.asar` 内 paths/schema/export-web，验证打包态路径与生产依赖。

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
pnpm test                  # 289 项
pnpm check:schema
pnpm check:docs

# 冒烟（本机 Edge；截图输出 editor/.smoke/）
pnpm smoke:ui              # 编辑器全流程（素材/蓝图/时间轴/演示）
pnpm smoke:runtime         # 独立运行时全流程（标题/对话/场景/小游戏/视频/存档/结局）
pnpm smoke:export          # 真实项目 → 导出 Web 包 → 静态服务 → Edge 验证
pnpm smoke:desktop         # 重新打 dir 包 + 打包态路径/依赖自检
```

**独立运行时/导出包使用**：把包或 runtime 目录部署到静态服务器，打开 `index.html`（或 `index.html?game=./game.json`）即可播放；不依赖 Electron/Node/远程资源。

> 桌面版已内置 ffmpeg（打包后在 `resources/bin/ffmpeg.exe`，[media.cjs](editor/electron/lib/media.cjs) 优先使用它），用户无需预装。免安装运行用 `editor/release/win-unpacked/VN Studio.exe`，正式分发用 `editor/release/VN-Studio-Setup-0.1.0-x64.exe`（支持 `/S` 静默安装、`/D=<目录>` 指定安装位置）。
>
> 注意：如果项目位于“低完整性级别（Low IL）”目录（某些沙箱/受限目录），其中生成的 exe 会继承 Low，双击安装时会报 `NSIS Error: Error writing temporary file`。`scripts/build-installer.mjs` 会自动把安装包提升为 Medium；其他手动产物可用 `icacls <exe> /setintegritylevel Medium` 处理。

## 发布新版本（GitHub Releases）

1. 修改版本号：根 `package.json` 与 `editor/package.json` 的 `version`（安装包文件名/版本资源取后者）。
2. 提交并打标签：`git tag v0.1.0 && git push origin v0.1.0`。
3. GitHub Actions（[build-windows.yml](.github/workflows/build-windows.yml)）会在 `windows-latest` 上安装依赖与 ffmpeg、跑测试、构建两个 NSIS 安装包，并自动创建 Release 上传 `VN-Studio-Setup-*.exe` 与 `INSTALLER-INFO.json`。
4. 不发布 Release 时，也可以在 Actions 页面手动运行 `Build Windows installer`，从 Artifacts 下载安装包。

## 验收结果

- 全仓 **289 项** Node 测试通过（schema/引用完整性/项目/素材/媒体/IPC/蓝图/时间轴/表达式/引擎/存档/导出校验与导出器/桌面打包路径）。
- `pnpm editor:build` 成功；`check:schema` / `check:docs` 通过。
- 四套 headless 冒烟均通过：编辑器、运行时、导出包；桌面打包冒烟验证 `win-unpacked` 结构、`resources/runtime`/`schema` 与打包态模块加载（零 GUI 启动，因无桌面会话）。
- 桌面产物：`editor/release/win-unpacked/`、`editor/release/VN-Studio-0.1.0-x64.zip`、`editor/release/VN-Studio-0.1.0-portable.exe`、`editor/release/VN-Studio-Setup-0.1.0.exe`（electron-builder NSIS）、`editor/release/VN-Studio-Setup-0.1.0-x64.exe`（完整环境 NSIS）；两个安装包均已静默安装 + 卸载验证。

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
