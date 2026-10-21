# 阶段二共享契约（编辑器 ↔ 主进程 ↔ 子任务）

> 本文件是阶段二并行开发的唯一接口约定。**不要偏离本文件自行改接口**；发现契约问题先在最终汇报里提出，由 Lead 统一修改。
> 阶段二范围：项目文件读写 + 素材导入/管理（图片 / 音频 / 视频 / 小游戏）+ 素材管理界面。蓝图、时间轴、运行时、打包分别属于阶段 3/4/5/6，本阶段只放占位入口。

## 0. 文件归属（写入范围，互相不要越界）

| 角色 | 文件 |
|---|---|
| Lead | `editor/electron/main.cjs`、`editor/electron/preload.cjs`、`editor/electron/lib/{paths,schema,project,ipc}.cjs`、`editor/index.html`、`editor/vite.config.js`、`editor/src/main.jsx`、`editor/src/App.jsx`、`editor/src/api.js`、`editor/src/state/**`、`editor/src/screens/ProjectWorkspace.jsx`、`editor/src/components/InspectorPanel.jsx`、`editor/src/styles/base.css`、`editor/src/styles/workspace.css`、`editor/CONTRACT.md`、`tests/phase2/project.test.mjs` |
| media-service | `editor/electron/lib/{media,minigame,assets,asset-utils}.cjs`、`tests/phase2/{media,minigame,assets}.test.mjs` |
| ui-shell | `editor/src/screens/StartScreen.jsx`、`editor/src/components/AssetPanel.jsx`、`editor/src/components/LeftBottomPanels.jsx`、`editor/src/styles/start.css`、`editor/src/styles/assets.css` |
| ui-editors | `editor/src/features/assets/{ImageEditor,AudioEditor,VideoPreview,MinigamePreview}.jsx`、`editor/src/features/assets/lib/{imageEdits,audioUtils}.js`、`editor/src/styles/asset-editor.css`、`tests/phase2/image-edits.test.mjs` |

不要新增 npm 依赖（当前已有：react、react-dom、ajv、image-size、electron、vite、@vitejs/plugin-react；主进程可用 Node 内置模块与本机 `ffmpeg`）。不要修改 `schema/`、根 `package.json`、`tests/schema.test.mjs`、`tests/integrity.test.mjs`、`examples/`。

## 1. 运行环境与编码约定

- 主进程：CommonJS（`.cjs`），Electron `main` 字段 = `electron/main.cjs`；渲染层：React 19 + Vite（ESM）。
- 项目根 = `D:\deeepseek 工作区`；编辑器独立包在 `editor/`；schema 在仓库根 `schema/schema.json`。
- 主进程用 `require('electron')`；渲染层通过 `window.vnStudio` 访问主进程，**严禁 import electron**。
- 渲染层不直接读文件系统；所有文件操作走 IPC。渲染层不 assume Node 环境。
- 所有 IPC 方法返回统一结果：成功 `{ ok: true, ... }`，失败 `{ ok: false, error: string }`；对话框取消返回 `{ ok: true, canceled: true }`。渲染层 `src/api.js` 的 `unwrap()` 会把 `{ok:false}` 转成 `Error`。
- 时间统一毫秒整数；路径统一仓库相对路径（`assets/...`，用 `/`）；禁止 `..`。
- 素材 id 规则：`img_` / `aud_` / `vid_` / `mg_` + 8 位小写 base36 随机串（如 `img_k3f9a2c1`），全库唯一；创建后不变。
- 素材原始文件放 `assets/.source/images/`、`assets/.source/audio/`；最终烘焙文件放 `assets/images|audio|videos|minigames/`。schema 资产字段 `source`（见 `schema/schema.json` 的 `assetSource`）记录原始文件，二次编辑始终基于 `source`。
- 媒体处理使用本机 `ffmpeg`（PATH 中已有，2018 版，含 libwebp/libvorbis/libmp3lame）。ffprobe 不可用：用 `ffmpeg -i` 的 stderr 解析元数据。所有 ffmpeg 调用封装在 `media.cjs`，加超时（30s）与错误信息截断。
- 中文文案；不要用 Ren'Py / WebGAL 等既有引擎名词。

## 2. 项目文件（schema/schema.json，schemaVersion=1）

项目对象就是 schema 根对象。阶段二新建项目默认值：
- `meta`: `{ id: 'proj_' + 随机串, title, author: '', description: '', createdAt, updatedAt }`（ISO `new Date().toISOString()`）
- `settings`: `{ startNodeId: 'n_opening', resolution: {width:1280,height:720}, backgroundColor: '#101418', textSpeedCps: 30, autoSave: {enabled:true, onSceneEnter:true} }`
- `assets`: `{ images: [], audio: [], videos: [], minigames: [] }`
- `variables`: `{}`
- `nodes`: 必须至少 1 个（schema `minItems:1`）：默认一个 `dialogue` 节点
  `{ id:'n_opening', type:'dialogue', name:'开场', position:{x:0,y:0}, exits:[{id:'next',name:'next'}], text:'新项目：双击空白处开始编写剧情。', speaker:null, portrait:null, voice:null, speedCps:null, autoAdvanceMs:null }`
- `edges`: `[]`，`timelines`: `{}`
- `layout`: `{ leftWidth:280, rightWidth:320, timelineHeight:200, rightCollapsed:false, leftBottomPanel:'variables', assetView:'grid', assetTypeFilter:'all' }`
- `editor`: `{ viewport:{x:0,y:0,zoom:1}, selectedNodeIds:['n_opening'], selectedEdgeId:null, selectedAssetId:null, activeTab:'blueprint', timelinePlayheadMs:0 }`

磁盘结构：`<项目目录>/project.json`、`assets/{images,audio,videos,minigames}/`、`assets/.source/{images,audio}/`、`saves/`。项目目录由主进程创建；`projectDir` 是绝对路径，渲染层只透传。

素材记录形状（严格按 schema）：
- image：`{ id, kind:'image', name, role:'background'|'sprite'|'ui'|'other', path, width, height, format:'png'|'webp', sizeBytes?, importedAt?, edit?:{crop,removeBackground,adjustments}, source?:{path,format,width,height,sizeBytes} }`
- audio：`{ id, kind:'audio', name, role:'bgm'|'sfx'|'voice', path, format:'ogg'|'mp3', durationMs, sizeBytes?, importedAt?, trim?:{startMs,endMs}, gainDb?, loop?, source?:{path,format,durationMs,sizeBytes} }`
- video：`{ id, kind:'video', name, path, format:'mp4'|'webm', durationMs?, width?, height?, codec?:'h264'|'vp8'|'vp9', hasAudio?, sizeBytes?, importedAt? }`
- minigame：`{ id, kind:'minigame', name, path (assets/.../*.html), declaredExits:string[], mode:'blocking', description?, sizeBytes?, importedAt? }`

## 3. 主进程 IPC（preload 暴露为 `window.vnStudio`）

渲染层统一从 `editor/src/api.js` 导入，不直接用 `window.vnStudio`。

### app
- `getInfo(): Promise<{ ok:true, version, electron, chrome, node, platform, ffmpegAvailable, projectSchemaVersion }>`
- `getStartupProject(): Promise<{ ok:true, project, projectPath, projectDir } | { ok:true, project:null }>`（仅 smoke 模式返回，普通启动为 null）
- `onSmokeLoadProject(cb(projectPayload)): () => void`（仅 smoke 模式触发，返回取消订阅函数）
- `setTitle(title): Promise<{ok:true}>`

### projects
- `create({ title, resolution:{width,height} }): Promise<{ok:true,canceled?:true, project?, projectPath?, projectDir?}>`
  主进程弹目录选择框，在所选目录下新建 `<slug(title)>`（重名加 `-2`），写 project.json，建目录。
- `open(): Promise<{ok:true,canceled?, project?, projectPath?, projectDir?}>`
- `openPath(projectPath): Promise<{ok:true, project, projectPath, projectDir}>`（用于最近项目）
- `save({ project, projectPath }): Promise<{ok:true, projectPath}>`：先 schema 校验；不合法返回 `{ok:false,error, errors:[{path,message}]}`；成功写盘并更新 `meta.updatedAt`（返回的 project 由主进程写回？渲染层自己更新即可，主进程只写收到的对象）。
- `recent(): Promise<{ok:true, items:[{projectPath,title,updatedAt,missing}]}>`
- `removeRecent(projectPath): Promise<{ok:true}>`

### assets
- `importImages({ projectDir, role }): Promise<{ok:true,canceled?:true, assets:[imageAsset], warnings:string[]}>`
  多选；支持 png/webp/jpg/jpeg；复制原始文件到 `.source/images`；用 ffmpeg 转 webp（q≈90）到 `assets/images/<id>.webp`；`edit` 初始 `{crop:null,removeBackground:null,adjustments:{brightness:0,contrast:0}}`；`source` 记录原始路径/格式/宽高。
- `importAudio({ projectDir, role }): Promise<{ok:true,canceled?,assets:[audioAsset],warnings}>`
  支持 wav/mp3/ogg（其他格式尝试 ffmpeg）；复制原始到 `.source/audio`；探测时长；默认转 ogg（libvorbis q5）到 `assets/audio/<id>.ogg`；`trim:null, gainDb:0, loop:false`。
- `importVideos({ projectDir }): Promise<{ok:true,canceled?,assets:[videoAsset],warnings}>`
  支持 mp4/webm；ffmpeg 探测编码：mp4→h264、webm→vp8/vp9，否则**拒绝该文件**并给 warning（不中断其他文件）；复制到 `assets/videos/<id>.<ext>`。
- `importMinigames({ projectDir }): Promise<{ok:true,canceled?,assets:[minigameAsset],warnings}>`
  只选 `.html`；读取并解析 `window.MINIGAME_EXITS`（必须是字符串数组、非空、唯一）；检测远程资源（`http://`、`https://`、`//` 开头的 src/href/url/import）；失败拒绝该文件；复制到 `assets/minigames/<id>.html`。
- `readDataUrl({ projectDir, relativePath }): Promise<{ok:true,dataUrl:string,mime:string}>` — 小文件用（图片缩略图/预览、音频源文件<40MB）；超过 40MB 返回 `{ok:false,error}`。
- `assetUrl({ projectDir, relativePath }): Promise<{ok:true,url:string}>` — 返回 `vnasset://` 地址，大文件（音频波形解码、视频播放、小游戏 iframe）用。
- `readText({ projectDir, relativePath }): Promise<{ok:true,text:string}>`
- `exportImage({ projectDir, asset, edit, format, width, height, dataBase64 }): Promise<{ok:true,asset:imageAsset}>`
  渲染层 canvas 输出 base64（不带 `data:` 前缀）；主进程写 `assets/images/<id>.<format>`，更新 asset 的 path/format/width/height/edit/sizeBytes；如果扩展名变化删除旧最终文件。`dataBase64` 由渲染层生成，主进程只落盘。
- `exportAudio({ projectDir, asset, trim, gainDb, format }): Promise<{ok:true,asset:audioAsset}>`
  基于 `asset.source`（缺失则用当前 `path`）用 ffmpeg：`-ss start -to end -af volume=<gain>dB` + 编码 ogg(vorbis q5)/mp3(192k)；更新 path/format/durationMs/trim/gainDb/sizeBytes；删除旧最终文件（路径变化时）。
- `remove({ projectDir, asset }): Promise<{ok:true}>` — 删除最终文件与 source 文件（存在时）；找不到文件不算失败。

## 4. 渲染层文件与公开接口

### `editor/src/api.js`（Lead 提供，其他人只 import）
```js
export function unwrap(response) // {ok:false} -> throw Error; 原样返回 {ok:true,...}
export const appApi = { getInfo, getStartupProject, onSmokeLoadProject, setTitle }
export const projectsApi = { create, open, openPath, save, recent, removeRecent }
export const assetsApi = { importImages, importAudio, importVideos, importMinigames,
  readDataUrl, assetUrl, readText, exportImage, exportAudio, remove }
export function assetDataUrl(projectDir, asset, which='final') // 供缩略图；内部 readDataUrl
```
所有方法内部已做 unwrap / 错误抛出；组件里用 try/catch + notify。

### `editor/src/state/ProjectContext.jsx`（Lead 提供）
`useProjectController()` 返回（通过 `ProjectContext` 注入）：
```js
{
  project, projectPath, projectDir, dirty, saving, lastSavedAt, busy,
  recentProjects, notify(message, kind='info'),
  actions: {
    createProject({title,resolution}), openProject(), openProjectPath(path), closeProject(), saveNow(),
    updateMeta(patch), updateSettings(patch), setVariables(nextVariables),
    updateLayout(patch), updateEditor(patch),
    addAssets(assetsArray), updateAsset(assetId, patch), replaceAsset(asset),
    removeAsset(asset), // 调 IPC 删除文件 + 从 project 移除
  }
}
```
`projectDir` 为 null 表示未打开项目。`allocateAssetId` 等在主进程。

### 组件契约

**StartScreen**（ui-shell 写；Lead 在 App 中渲染）
```jsx
<StartScreen
  appInfo={appInfo}                 // {version, ffmpegAvailable, ...}
  recentProjects={recentProjects}   // [{projectPath,title,updatedAt,missing}]
  busy={busy}
  onCreateProject={({title,resolution}) => Promise<void>}
  onOpenProject={() => Promise<void>}
  onOpenRecent={(projectPath) => Promise<void>}
  onOpenAssetManager={(type) => Promise<void>}  // type: 'audio' | 'image'
  onOpenPackaging={() => void}      // 阶段二只提示占位
/>
```
创建项目：内嵌 modal，标题必填、分辨率选择（1280×720 / 1920×1080 / 720×1280 / 800×600 / 自定义宽高），确认后走 `onCreateProject`，主进程弹目录选择。开始界面四入口顺序：创建项目、音乐管理、立绘/背景管理、打包；最近项目列表；缺 ffmpeg 时显示警示条。

**AssetPanel**（ui-shell 写；含左侧素材列表 + 下方三选一面板，Lead 在 Workspace 渲染）
```jsx
<AssetPanel
  project={project}
  projectDir={projectDir}
  selectedAssetId={string|null}
  onSelectAsset={(asset|null)=>void}
  filter={layout.assetTypeFilter}        // all|image|audio|video|minigame
  onFilterChange={(type)=>void}
  view={layout.assetView}                // list|grid
  onViewChange={(view)=>void}
  query={searchQuery}
  onQueryChange={(q)=>void}
  onImportImages={(role)=>Promise}       // role 由按钮菜单选择
  onImportAudio={(role)=>Promise}
  onImportVideos={()=>Promise}
  onImportMinigames={()=>Promise}
  onRemoveAsset={(asset)=>Promise}       // 二次确认在 Workspace 做，面板只调用
  notify={(msg,kind)=>void}
  lowerPanel={layout.leftBottomPanel}    // variables|structure|minigameExits
  onLowerPanelChange={(panel)=>void}
  onVariablesChange={(next)=>void}
  onSelectAssetById={(id)=>void}         // 小游戏出口面板跳到素材
/>
```
要求：280px 宽左栏；上部素材列表带搜索（按 name/id）+ 类型筛选 + 列表/网格切换 + 导入按钮；图片显示缩略图（懒加载 dataUrl）、音频/视频/小游戏用类型图标和时长/出口数；空状态文案。下部三 tab 见下。所有交互只用 props，不直接调 IPC（缩略图除外：可 import `assetDataUrl`）。

**LeftBottomPanels**（可由 ui-shell 合并进 AssetPanel，也可单独文件；Lead 只依赖 AssetPanel 上述 props）
- variables：变量表增删改，六种类型（number/string/boolean 数组/对象用 JSON 文本域），重名/非法 JSON 内联报错；改动调用 `onVariablesChange(整个 variables 对象)`；`last_minigame_result` 只允许 string 并标注保留变量。
- structure：只读项目结构树（按类型分组列节点：名称/id/出口数），phase 2 不提供编辑，提示“节点编辑在阶段 3”。
- minigameExits：列出 assets.minigames 的 declaredExits，以及使用该素材的 minigame 节点的配置出口（没有节点时提示）；点击素材跳 ID。

**ImageEditor / AudioEditor / VideoPreview / MinigamePreview**（ui-editors 写；Lead 在 AssetWorkspace 中按 asset.kind 渲染）
```jsx
<ImageEditor asset={imageAsset} projectDir={string} onAssetUpdated={(asset)=>void} notify={fn} />
<AudioEditor asset={audioAsset} projectDir={string} onAssetUpdated={(asset)=>void} notify={fn} />
<VideoPreview asset={videoAsset} projectDir={string} />
<MinigamePreview asset={minigameAsset} projectDir={string} />
```
- ImageEditor：从 `source`（缺失回退 `path`）加载原图；canvas 预览；编辑状态从 `asset.edit` 初始化（缺省 crop:null、removeBackground:null、adjustments {brightness:0,contrast:0}）；右侧/底部控件包含：裁剪预设（16:9 1920×1080、16:9 1280×720、4:3 1024×768、1:1 1024×1024、9:16 1080×1920、原尺寸；可选 png/webp 输出）、裁剪缩放/偏移滑块、去背景（吸管取色 + 容差 + 羽化，点击预览取色）、亮度/对比度滑块、重置、保存。保存时 canvas 生成 base64 调 `assetsApi.exportImage`，成功后 `onAssetUpdated(updatedAsset)`；保证预览与导出渲染逻辑一致。
- AudioEditor：从 `source`（缺失回退 `path`）加载音频，Web Audio 解码画波形（降采样 peaks ≤2000 点）；拖拽/数字输入设置 trim.startMs/endMs（要求 end>start 且 ≤duration）；增益 -60..24 dB；试听（trim 区间 + 增益）；格式 ogg/mp3；导出调 `assetsApi.exportAudio`；成功后更新 asset。
- VideoPreview：`vnasset://` URL 播放，显示容器/编码/分辨率/时长/是否有音轨。
- MinigamePreview：`vnasset://` URL 的 iframe（`sandbox="allow-scripts"` 且**只加 allow-scripts**），显示 declaredExits 标签与路径，说明“运行时结果经 postMessage 上报”。

**ProjectWorkspace**（Lead 写）：顶部工具栏（返回开始、项目标题、保存状态、保存按钮、打开、导出占位）、三栏 + 可拖拽分隔条、Ctrl+S 保存、左栏下方面板、中栏素材编辑器、右栏 InspectorPanel（素材元数据 name/role/path/宽高/来源、删除；无选中时显示项目设置：标题/作者/简介/分辨率只读展示 + 数据统计；阶段 3/4 占位提示）。左栏宽度/右栏宽度/折叠/下方面板/筛选/视图写入 `layout` 并自动保存。

## 5. 样式

- 深色主题，CSS 变量定义在 Lead 的 `styles/base.css`：
  `--bg-0:#0f1216; --bg-1:#161b21; --bg-2:#1d242c; --bg-3:#252e38; --border:#2c3640; --text-0:#e7edf3; --text-1:#9aa8b5; --text-2:#6f7d8a; --accent:#5aa9ff; --accent-2:#7be0c0; --danger:#ff6b6b; --warn:#ffc857; --radius:8px; --font-ui: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; --font-mono: "Cascadia Code", Consolas, monospace;`
- 各子任务 CSS 只加自己的文件并由组件 `import`；不要覆盖全局 * 规则；用 `box-sizing:border-box`。
- 固定布局：左栏 280px、右栏 320px、时间轴 200px 是默认值（来自 `project.layout`）；分隔条拖拽范围 200–480 / 240–560。

## 6. 验收（阶段二）

- `pnpm --filter @vn-studio/editor build` 成功（Vite 产物 `editor/dist/`）。
- `pnpm test` 全绿（阶段一 37 项 + 阶段二新增）。
- `pnpm --filter @vn-studio/editor smoke` 生成开始界面与编辑器两张截图（主进程 smoke 模式会临时造项目与素材），肉眼可见无布局错乱。
- 手动/自动验证：创建项目 → assets 目录与合法 project.json；导入图片/音频/视频/小游戏（smoke 用临时素材模拟）→ 记录合法且文件存在；图片编辑导出 png/webp；音频截取+增益导出 ogg/mp3；删除素材清理文件；重启后打开项目数据一致。
