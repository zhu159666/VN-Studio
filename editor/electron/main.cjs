'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, dialog, net, protocol } = require('electron');

const paths = require('./lib/paths.cjs');
const ipc = require('./lib/ipc.cjs');
const smoke = require('./lib/smoke.cjs');

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vnasset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
  {
    // 桌面播放模式：VN Studio.exe --play <web 包目录>
    scheme: 'vnplay',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const isDev = process.argv.includes('--dev');
const isSmoke = process.argv.includes('--smoke-test');
const isMcp = process.argv.includes('--mcp');
const isPlay = process.argv.includes('--play');
let mainWindow = null;
let smokeProject = null;
let smokeFailed = false;

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

if (isMcp) {
  // MCP 模式无窗口：关闭 GPU/沙箱，避免无桌面会话或受限环境下的启动失败。
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
  // MCP 模式下 stdout 是协议通道，所有普通日志改走 stderr。
  console.log = (...args) => console.error(...args);
}

function registerAssetProtocol() {
  protocol.handle('vnasset', async (request) => {
    try {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const projectDir = ipc.getCurrentProjectDir();
      if (!projectDir) return new Response('no project opened', { status: 404 });
      const abs = paths.resolveInside(projectDir, relative);
      if (!fs.existsSync(abs)) return new Response('asset not found', { status: 404 });
      const upstream = await net.fetch(pathToFileURL(abs).toString(), {
        headers: request.headers,
      });
      const headers = new Headers(upstream.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cache-Control', 'no-store');
      if (!headers.get('Content-Type')) {
        headers.set('Content-Type', MIME_BY_EXT[path.extname(abs).toLowerCase()] || 'application/octet-stream');
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (error) {
      console.warn('[vnasset]', error.message);
      return new Response('asset error', { status: 400 });
    }
  });
}

const gameRoots = new Map();

/** 桌面播放模式：把导出的 Web 包通过 vnplay://<gameId>/ 提供，存档 origin 稳定。 */
function registerGameProtocol() {
  protocol.handle('vnplay', async (request) => {
    try {
      const url = new URL(request.url);
      const root = gameRoots.get(url.host);
      if (!root) return new Response('game not found', { status: 404 });
      const relative = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'index.html';
      const abs = paths.resolveInside(root, relative);
      if (!fs.existsSync(abs)) return new Response('not found', { status: 404 });
      const upstream = await net.fetch(pathToFileURL(abs).toString(), { headers: request.headers });
      const headers = new Headers(upstream.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cache-Control', 'no-store');
      if (!headers.get('Content-Type')) {
        headers.set(
          'Content-Type',
          MIME_BY_EXT[path.extname(abs).toLowerCase()] || 'application/octet-stream',
        );
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (error) {
      console.warn('[vnplay]', error.message);
      return new Response('game error', { status: 400 });
    }
  });
}

async function startPlayMode(gameDir) {
  const root = gameDir ? path.resolve(gameDir) : null;
  if (!root || !fs.existsSync(path.join(root, 'index.html')) || !fs.existsSync(path.join(root, 'game.json'))) {
    dialog.showErrorBox(
      '无法启动游戏',
      '请选择 VN Studio 导出的 Web 包目录（目录内应包含 index.html 与 game.json）。',
    );
    app.quit();
    return;
  }
  let title = 'VN Studio';
  try {
    const gameJson = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));
    title = gameJson.meta?.title || title;
  } catch {
    /* 标题读取失败时用默认值 */
  }
  const gameId = `g${crypto.createHash('sha256').update(root).digest('hex').slice(0, 16)}`;
  gameRoots.set(gameId, root);
  registerGameProtocol();

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    show: false,
    backgroundColor: '#070b10',
    title,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => app.quit());
  try {
    await win.loadURL(`vnplay://${gameId}/index.html?game=./game.json`);
  } catch (error) {
    console.error('[play] 加载游戏失败：', error);
    dialog.showErrorBox('无法启动游戏', `加载失败：${error.message}`);
    app.quit();
  }
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0f1216',
    title: 'VN Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: paths.preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.on('console-message', (_event, level, message) => {
    if (isDev || isSmoke) console.log(`[renderer:${level}] ${message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] gone:', details);
    smokeFailed = true;
  });
  win.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('[renderer] did-fail-load', code, description);
    smokeFailed = true;
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const index = paths.editorDistIndex();
    if (!fs.existsSync(index)) {
      win.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          '<body style="background:#101418;color:#e7edf3;font-family:sans-serif;padding:40px"><h2>尚未构建渲染层</h2><p>请先在 editor/ 目录运行 <code>pnpm build</code>，或使用 <code>pnpm dev:electron --dev</code> 配合 Vite。</p></body>',
        )}`,
      );
    } else {
      win.loadFile(index);
    }
  }
  return win;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function capture(win, name) {
  const dir = path.join(paths.repoRoot(), 'editor', '.smoke');
  await fsp.mkdir(dir, { recursive: true });
  const image = await win.webContents.capturePage();
  const file = path.join(dir, name);
  await fsp.writeFile(file, image.toPNG());
  console.log(`[smoke] 截图：${file}`);
}

async function runSmokeFlow(win, data) {
  try {
    await wait(1800);
    await capture(win, 'start.png');

    win.webContents.send('smoke:load-project', {
      project: data.project,
      projectPath: data.projectPath,
      projectDir: data.projectDir,
    });
    await wait(2200);
    await capture(win, 'workspace.png');

    const order = [
      ['image', 'asset-image.png'],
      ['audio', 'asset-audio.png'],
      ['video', 'asset-video.png'],
      ['minigame', 'asset-minigame.png'],
    ];
    for (const [kind, fileName] of order) {
      const assetId = data.assetIds?.[kind];
      if (!assetId) continue;
      win.webContents.send('smoke:select-asset', assetId);
      await wait(1800);
      await capture(win, fileName);
    }

    if (smokeFailed) {
      console.error('[smoke] 渲染进程出现错误，截图可能不完整');
    }
    console.log('[smoke] 完成');
    await wait(300);
    if (data.tempRoot) {
      await fsp.rm(data.tempRoot, { recursive: true, force: true }).catch(() => {});
    }
    app.exit(smokeFailed ? 1 : 0);
  } catch (error) {
    console.error('[smoke] 失败：', error);
    app.exit(1);
  }
}

async function start() {
  await app.whenReady();

  // MCP stdio server：不创建窗口，外部 MCP 客户端通过 stdin/stdout 调用 command bus。
  if (isMcp) {
    const { startMcpServer } = require('./lib/mcp-server.cjs');
    startMcpServer({
      defaultProjectPath: getArgValue('--project'),
      version: app.getVersion(),
      onClose: () => app.quit(),
    });
    return;
  }

  // 桌面播放模式：VN Studio.exe --play <导出的 Web 包目录>
  if (isPlay) {
    await startPlayMode(getArgValue('--play'));
    return;
  }

  Menu.setApplicationMenu(null);

  if (isSmoke) {
    try {
      smokeProject = await smoke.createSmokeProject();
      if (smokeProject.warnings?.length) {
        console.warn('[smoke] 警告：', smokeProject.warnings.join('；'));
      }
    } catch (error) {
      console.error('[smoke] 生成临时项目失败：', error);
      app.exit(1);
      return;
    }
  }

  registerAssetProtocol();
  ipc.registerIpc({
    getWindow: () => mainWindow,
    smokeStartup: smokeProject
      ? {
          project: smokeProject.project,
          projectPath: smokeProject.projectPath,
          projectDir: smokeProject.projectDir,
          assetIds: smokeProject.assetIds,
        }
      : null,
  });

  mainWindow = createMainWindow();

  // HTTP MCP：支持 url 的客户端可直接连接（应用需保持运行）。
  const { startHttpMcpServer } = require('./lib/mcp-server.cjs');
  const mcpHttpPort = Number(process.env.VN_STUDIO_MCP_HTTP_PORT || 38123);
  startHttpMcpServer({
    port: mcpHttpPort,
    version: app.getVersion(),
    getDefaultProjectPath: () => {
      const projectDir = ipc.getCurrentProjectDir();
      return projectDir ? path.join(projectDir, 'project.json') : null;
    },
    log: (line) => console.error(line),
  })
    .then((server) => console.error(`[mcp-http] ready: ${server.url}`))
    .catch((error) => console.error('[mcp-http] 启动失败：', error && error.message ? error.message : error));

  if (isSmoke) {
    mainWindow.webContents.once('did-finish-load', () => {
      runSmokeFlow(mainWindow, smokeProject);
    });
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});

start().catch((error) => {
  console.error('[main] 启动失败：', error);
  app.exit(1);
});
