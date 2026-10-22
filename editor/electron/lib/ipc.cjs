'use strict';

// 主进程 IPC 注册。所有处理器统一返回 { ok: true, ... } 或 { ok: false, error }。

const path = require('node:path');
const fs = require('node:fs');
const { ipcMain, dialog, BrowserWindow, app, shell } = require('electron');

const projectStore = require('./project.cjs');
const recentStore = require('./recent.cjs');
const schema = require('./schema.cjs');
const assets = require('./assets.cjs');
const media = require('./media.cjs');
const saveStore = require('./saves.cjs');
const { validateProjectForExport } = require('./validate-project.cjs');
const { exportProjectWeb } = require('./export-web.cjs');

let current = { projectDir: null, projectPath: null };
let smokeStartup = null;
let getWindow = () => BrowserWindow.getAllWindows()[0] ?? null;

function setCurrent(payload) {
  current = {
    projectDir: payload?.projectDir ?? null,
    projectPath: payload?.projectPath ?? null,
  };
  return current;
}

function getCurrentProjectDir() {
  return current.projectDir;
}

function assertCurrentProjectDir(projectDir) {
  if (!current.projectDir) {
    throw new Error('当前没有打开的项目');
  }
  const expected = path.resolve(current.projectDir);
  const given = path.resolve(String(projectDir ?? ''));
  if (expected !== given) {
    throw new Error('项目目录与当前打开的项目不一致');
  }
  return expected;
}

async function wrap(fn) {
  try {
    const data = await fn();
    return { ok: true, ...(data ?? {}) };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
      code: error?.code,
      errors: error?.errors,
    };
  }
}

function registerIpc(options = {}) {
  if (options.getWindow) getWindow = options.getWindow;
  if (options.smokeStartup) smokeStartup = options.smokeStartup;

  ipcMain.handle('app:info', async () =>
    wrap(async () => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      ffmpegAvailable: media.isFfmpegAvailable(),
      projectSchemaVersion: schema.SCHEMA_VERSION,
    })),
  );

  ipcMain.handle('app:startup-project', async () =>
    wrap(async () => {
      if (!smokeStartup) return { project: null };
      return {
        project: smokeStartup.project,
        projectPath: smokeStartup.projectPath,
        projectDir: smokeStartup.projectDir,
        assetIds: smokeStartup.assetIds ?? null,
      };
    }),
  );

  ipcMain.handle('app:set-title', async (event, title) =>
    wrap(async () => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow();
      const text = String(title ?? '').trim();
      if (win && text) win.setTitle(text);
      return {};
    }),
  );

  ipcMain.handle('project:create', async (_event, payload) =>
    wrap(async () => {
      const title = payload?.title;
      const resolution = payload?.resolution;
      const win = getWindow();
      const picked = await dialog.showOpenDialog(win, {
        title: '选择项目存放位置（将新建项目文件夹）',
        buttonLabel: '在此创建项目',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || picked.filePaths.length === 0) return { canceled: true };
      const created = await projectStore.createProjectUnder(picked.filePaths[0], {
        title,
        resolution,
      });
      setCurrent(created);
      await recentStore.addRecent(created.projectPath, created.project);
      return created;
    }),
  );

  ipcMain.handle('project:open', async () =>
    wrap(async () => {
      const win = getWindow();
      const picked = await dialog.showOpenDialog(win, {
        title: '打开视觉小说项目',
        buttonLabel: '打开项目',
        properties: ['openFile'],
        filters: [
          { name: 'VN Studio 项目', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (picked.canceled || picked.filePaths.length === 0) return { canceled: true };
      const opened = await projectStore.openProject(picked.filePaths[0]);
      setCurrent(opened);
      await recentStore.addRecent(opened.projectPath, opened.project);
      return opened;
    }),
  );

  ipcMain.handle('project:open-path', async (_event, projectPath) =>
    wrap(async () => {
      if (typeof projectPath !== 'string' || !projectPath.trim()) {
        throw new Error('缺少项目路径');
      }
      const opened = await projectStore.openProject(projectPath);
      setCurrent(opened);
      await recentStore.addRecent(opened.projectPath, opened.project);
      return opened;
    }),
  );

  ipcMain.handle('project:save', async (_event, payload) =>
    wrap(async () => {
      const project = payload?.project;
      if (!project) throw new Error('缺少项目数据');
      const targetPath = payload?.projectPath || current.projectPath;
      if (!targetPath) throw new Error('当前没有打开的项目');
      const saved = await projectStore.saveProject(targetPath, project);
      setCurrent(saved);
      await recentStore.addRecent(saved.projectPath, saved.project);
      return saved;
    }),
  );

  ipcMain.handle('project:recent', async () =>
    wrap(async () => ({ items: await recentStore.listRecent() })),
  );

  ipcMain.handle('project:remove-recent', async (_event, projectPath) =>
    wrap(async () => {
      if (typeof projectPath !== 'string') throw new Error('缺少项目路径');
      await recentStore.removeRecent(projectPath);
      return {};
    }),
  );

  // ---------- 素材 ----------

  ipcMain.handle('asset:import-images', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      const result = await assets.importImages({ projectDir, role: payload?.role });
      return result?.canceled ? { canceled: true } : result;
    }),
  );

  ipcMain.handle('asset:import-audio', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      const result = await assets.importAudio({ projectDir, role: payload?.role });
      return result?.canceled ? { canceled: true } : result;
    }),
  );

  ipcMain.handle('asset:import-videos', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      const result = await assets.importVideos({ projectDir });
      return result?.canceled ? { canceled: true } : result;
    }),
  );

  ipcMain.handle('asset:save-generated-audio', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      const asset = await assets.saveGeneratedAudio({ ...payload, projectDir });
      return { asset };
    }),
  );

  ipcMain.handle('asset:import-minigames', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      const result = await assets.importMinigames({ projectDir });
      return result?.canceled ? { canceled: true } : result;
    }),
  );

  ipcMain.handle('asset:read-data-url', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      return assets.readDataUrl({ projectDir, relativePath: payload?.relativePath });
    }),
  );

  ipcMain.handle('asset:read-text', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      return assets.readText({ projectDir, relativePath: payload?.relativePath });
    }),
  );

  ipcMain.handle('asset:url', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      return assets.assetUrl({ projectDir, relativePath: payload?.relativePath });
    }),
  );

  ipcMain.handle('asset:export-image', async (_event, payload) =>
    wrap(async () => {
      assertCurrentProjectDir(payload?.projectDir);
      const result = await assets.exportImage(payload);
      return { asset: result };
    }),
  );

  ipcMain.handle('asset:export-audio', async (_event, payload) =>
    wrap(async () => {
      assertCurrentProjectDir(payload?.projectDir);
      const result = await assets.exportAudio(payload);
      return { asset: result };
    }),
  );

  ipcMain.handle('asset:remove', async (_event, payload) =>
    wrap(async () => {
      assertCurrentProjectDir(payload?.projectDir);
      return assets.remove(payload);
    }),
  );

  // ---------- 存档（Electron 写项目 saves/ 目录） ----------

  ipcMain.handle('saves:list', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      return { saves: await saveStore.listSaves(projectDir) };
    }),
  );

  ipcMain.handle('saves:get', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      const save = await saveStore.readSave(projectDir, payload?.kind, payload?.slot);
      return { save: save ?? null };
    }),
  );

  ipcMain.handle('saves:put', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      const save = await saveStore.writeSave(projectDir, payload?.save);
      return { save };
    }),
  );

  ipcMain.handle('saves:delete', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      return saveStore.deleteSave(projectDir, payload?.kind, payload?.slot);
    }),
  );

  // ---------- 导出 Web 包 ----------

  ipcMain.handle('export:validate', async (_event, payload) =>
    wrap(async () => {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      const validation = await validateProjectForExport(payload?.project, {
        projectDir,
        checkFiles: true,
      });
      return {
        valid: validation.ok,
        errors: validation.errors,
        warnings: validation.warnings,
      };
    }),
  );

  ipcMain.handle('export:web', async (_event, payload) => {
    try {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      const win = getWindow();
      const picked = await dialog.showOpenDialog(win, {
        title: '选择 Web 包导出位置（将在其中新建 <项目名>-web 文件夹）',
        buttonLabel: '导出到此目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || picked.filePaths.length === 0) return { ok: true, canceled: true };
      const result = await exportProjectWeb({
        project: payload?.project,
        projectDir,
        outputParentDir: picked.filePaths[0],
      });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          errors: result.errors ?? [],
          warnings: result.warnings ?? [],
        };
      }
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), errors: error?.errors ?? [] };
    }
  });

  ipcMain.handle('export:desktop', async (_event, payload) => {
    try {
      const projectDir = assertCurrentProjectDir(payload?.projectDir);
      const win = getWindow();
      const picked = await dialog.showOpenDialog(win, {
        title: '选择桌面版导出位置（将生成游戏文件夹 + 启动游戏.cmd）',
        buttonLabel: '导出到此目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || picked.filePaths.length === 0) return { ok: true, canceled: true };
      const result = await exportProjectWeb({
        project: payload?.project,
        projectDir,
        outputParentDir: picked.filePaths[0],
      });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          errors: result.errors ?? [],
          warnings: result.warnings ?? [],
        };
      }
      // 桌面播放模式：双击启动器 → VN Studio.exe --play <本目录>（不打开编辑器、不需要浏览器/服务器）
      const launcher = path.join(result.outputDir, '启动游戏.cmd');
      const exe = process.execPath;
      const playArgs = app.isPackaged
        ? '--play "%~dp0"'
        : `"${app.getAppPath()}" --play "%~dp0"`;
      fs.writeFileSync(
        launcher,
        `@echo off\r\nchcp 65001 >nul\r\nstart "" "${exe}" ${playArgs}\r\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(result.outputDir, '如何游玩.txt'),
        '双击「启动游戏.cmd」即可用 VN Studio 桌面播放模式打开本游戏，无需浏览器或本地服务器。\r\n',
        'utf8',
      );
      return { ok: true, ...result, launcher };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), errors: error?.errors ?? [] };
    }
  });

  ipcMain.handle('shell:open-path', async (_event, payload) =>
    wrap(async () => {
      const target = String(payload?.path ?? '').trim();
      if (!target) throw new Error('缺少要打开的路径');
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      return { opened: true };
    }),
  );

  return { setCurrent, getCurrentProjectDir };
}

module.exports = { registerIpc, setCurrent, getCurrentProjectDir };
