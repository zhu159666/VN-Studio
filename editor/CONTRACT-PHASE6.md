# 阶段六共享契约（Web 打包导出）

阶段六范围：把编辑器项目一键导出为可部署静态 Web 包：`index.html + assets/ + game.json` + runtime 文件。桌面打包（electron-builder）为第二阶段，不在本轮。

## 文件归属

| 角色 | 文件 |
|---|---|
| Lead | `editor/electron/lib/export-web.cjs`、`editor/electron/lib/ipc.cjs`（导出通道）、`editor/electron/preload.cjs`、`editor/src/api.js`、`editor/src/state/useProjectController.js`、`editor/src/screens/ProjectWorkspace.jsx`、`editor/src/App.jsx`、`scripts/export-smoke.mjs`、`tests/phase6/export.test.mjs` |
| validator 子任务 | `editor/electron/lib/validate-project.cjs`、`tests/phase6/validate.test.mjs` |

不要修改 schema、runtime、阶段 1–5 测试；不要新增依赖。

## 校验器 API（validator 子任务必须提供）

```js
// editor/electron/lib/validate-project.cjs
async function validateProjectForExport(project, options = {}) -> {
  ok: boolean,
  errors: [{ code: 'E08', message: string, path?: string }],
  warnings: [{ code: 'W01', message: string, path?: string }]
}
// options: { projectDir: string|null, checkFiles: boolean = Boolean(projectDir), readFile: Function }
```
- 结构类错误按 `schema/FIELDS.md` §12 的 E 编号实现：E03–E30（与导出相关的全部 E；E01/E02/E29 由 schema/存档另行处理）。**E12 按最新 D31：dialogue / scene 的 next 允许留空 = 剧情正常结束；choice/minigame/video/condition/variable 出口缺边仍为错误。**
- 文件检查（`checkFiles=true`）额外做 E19/E20/E26/E27/E28：素材 path 存在、扩展名/format 一致、小游戏 html 读取后用 `./minigame.cjs` 的 `validateMinigameHtml` 重新校验（MINIGAME_EXITS 存在且与 `declaredExits` 一致、无远程资源、含 postMessage）；视频编码矩阵（mp4→h264，webm→vp8/vp9）。
- 警告按 W01–W10 实现（可达性、含交互节点环、data 边、未使用素材、重复名称、choice 重复文案、minigame 多余出口、last_minigame_result 初值、场景变量类型不一致）；警告不阻止导出。
- 环检测：图 = sequence/conditional 边；纯逻辑节点（condition/variable/jump）构成的环 → E30 错误；包含可交互节点的环 → W02 警告。
- 不抛异常到调用方；内部错误转 `errors`。纯 Node，不 require electron。
- 同一项目二次校验结果稳定；不修改项目对象。

## 导出器（Lead 实现）

`exportProjectWeb({ project, projectDir, outputParentDir }) -> { ok, outputDir?, files?, bytes?, errors?, warnings? }`：
1. 调 `validateProjectForExport(project,{projectDir,checkFiles:true})`；有 errors 直接返回，不创建目录。
2. 在 `outputParentDir` 下创建 `<safeDirName(meta.title)>-web`（已存在则加 `-2`），建 `assets/{images,audio,videos,minigames}`。
3. 复制 `runtime/` 的 `index.html`、`runtime.js`、`engine.js`、`expression.js`、`timeline.js`、`storage.js`、`runtime.css` 到包根目录。
4. 复制项目 `assets/` 下四类最终文件（**排除 `assets/.source/`**）；保留相对路径 `assets/...`。素材文件缺失由校验器 E20 拦截。
5. 写 `game.json`：项目对象去掉 `$schema`、`layout`、`editor` 字段（运行时不需要），保持 schema 根对象其余字段；`JSON.stringify(...,2)`；用 ajv 验证去掉字段后的对象仍通过 schema。
6. 返回 `{ outputDir, files:[相对路径...], bytes:总字节, errors:[], warnings }`。
7. 复制/写入使用 fs/promises；失败时尽量清理已生成的临时目录并返回 `{ok:false,errors:[...]}`。

## IPC / 渲染层

- 主进程：
  - `export:web`：`{ project }` → 弹目录选择（选择导出父目录）→ exportProjectWeb；返回 `{ok:true,summary}` 或 `{ok:false,error,errors,warnings}`。
  - `export:validate`：`{ project }` → 仅校验（不弹框），返回 `{ok:true,errors,warnings}`。
  - `shell:open-path`：打开导出目录（`shell.openPath`）。
- preload 增加 `exports.{validate,web,openPath}`（方法名避免 JS 保留字冲突用 `exportWeb`/`validate`）。
- 渲染层 `api.js` 增加 `exportApi`。
- controller actions 增加 `exportWeb()`（返回 summary 或抛错；设置 `exporting` busy）与 `validateExport()`。
- 顶部「导出」按钮启用：点击导出；进行中禁用；成功后 toast 输出路径并提示可「打开目录」。开始界面「打包」入口：若未打开项目则先打开项目，成功后自动导出。
- 导出失败时把 errors 前几条拼进 toast（`E12 节点 xxx 出口 ...`），完整错误 console.warn。

## 验收

- `node --test "tests/phase6/*.test.mjs"` 全绿。
- `pnpm editor:build` 成功。
- `node scripts/export-smoke.mjs`：生成含真实素材的项目 → 导出到临时目录 → 静态服务导出包 → Edge headless 打开 `index.html` → 标题/开始/场景截图，无控制台错误；断言包内含 runtime 文件、game.json、四类素材、无 `.source/`。
- 编辑器 UI 冒烟可验证「导出」按钮存在（不实际弹系统对话框）。
