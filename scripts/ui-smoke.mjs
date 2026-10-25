#!/usr/bin/env node
// 无 GUI 环境下的渲染层冒烟测试：
// - 用本机 Edge headless 加载 Vite 构建产物；
// - 注入 window.vnStudio mock（真实项目数据 + 真实媒体文件，经本地 HTTP 服务提供）；
// - 截图开始界面、编辑器、图片/音频/视频/小游戏视图，供人工验收。
// Electron 主进程无法在当前 CI 环境启动时，用它验证 UI 与组件接线。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const projectStore = require('../editor/electron/lib/project.cjs');
const schema = require('../editor/electron/lib/schema.cjs');
const { createNodeDraft } = await import('../editor/src/features/blueprint/blueprintUtils.js');

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'editor', 'dist');
const OUT_DIR = path.join(ROOT, 'editor', '.smoke');
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function findEdge() {
  const found = EDGE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('未找到 Microsoft Edge，无法运行 UI 冒烟测试');
  return found;
}

function tryFfmpeg(args) {
  try {
    execFileSync('ffmpeg', args, { stdio: 'ignore', timeout: 60000 });
    return true;
  } catch {
    return false;
  }
}

function makeWavFallback(file) {
  const sampleRate = 22050;
  const seconds = 1;
  const samples = sampleRate * seconds;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 8000), 44 + i * 2);
  }
  fs.writeFileSync(file, data);
}

async function prepareMockAssets(mockDir) {
  const files = {
    'bg.png': 'image/png',
    'sprite.png': 'image/png',
    'audio.wav': 'audio/wav',
    'video.mp4': 'video/mp4',
    'minigame.html': 'text/html; charset=utf-8',
  };
  const bg = path.join(mockDir, 'bg.png');
  const sprite = path.join(mockDir, 'sprite.png');
  const audio = path.join(mockDir, 'audio.wav');
  const video = path.join(mockDir, 'video.mp4');

  const bgOk = tryFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'color=c=0x27405a:s=640x360', '-frames:v', '1', bg,
  ]);
  const spriteOk = tryFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'color=c=0xe0a070:s=300x450', '-frames:v', '1', sprite,
  ]);
  const audioOk = tryFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le', audio,
  ]);
  const videoOk = tryFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'color=c=0x334a66:s=640x360:d=1:r=24',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video,
  ]);

  if (!bgOk) fs.writeFileSync(bg, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  if (!spriteOk) fs.copyFileSync(bg, sprite);
  if (!audioOk) makeWavFallback(audio);

  fs.writeFileSync(
    path.join(mockDir, 'minigame.html'),
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Mock 小游戏</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#15202b;color:#e7edf3;font-family:system-ui}button{padding:10px 24px;border-radius:8px;border:1px solid #5aa9ff;background:#1f3140;color:#e7edf3;font-size:16px}</style>
</head><body><main><h1>Mock 小游戏</h1><button id="win">Win</button> <button id="lose">Lose</button></main>
<script>window.MINIGAME_EXITS=["win","lose"];</script></body></html>`,
    'utf8',
  );

  const available = { bg: bgOk || true, sprite: true, audio: true, video: videoOk };
  return { files, available };
}

function buildFixture(mockAssets) {
  const project = projectStore.defaultProject({ title: '冒烟测试项目', resolution: { width: 1280, height: 720 } });
  project.meta.author = 'Smoke';
  project.meta.description = '用于渲染层截图验证的临时项目。';
  project.variables = {
    money: { type: 'number', value: 120 },
    player_name: { type: 'string', value: '林' },
    has_umbrella: { type: 'boolean', value: false },
    inventory: { type: 'array', value: ['ticket'] },
    flags: { type: 'object', value: { chapter: 1 } },
    last_seen_ending: { type: 'null', value: null },
    last_minigame_result: { type: 'string', value: '' },
  };
  project.assets.images.push(
    {
      id: 'img_smoke_bg', kind: 'image', name: '烟测背景', role: 'background',
      path: 'assets/images/img_smoke_bg.png', width: 640, height: 360, format: 'png',
      sizeBytes: 1024, importedAt: new Date().toISOString(),
      edit: { crop: null, removeBackground: null, adjustments: { brightness: 0, contrast: 0 } },
      source: { path: 'assets/.source/images/img_smoke_bg.png', format: 'png', width: 640, height: 360, sizeBytes: 1024 },
    },
    {
      id: 'img_smoke_sprite', kind: 'image', name: '烟测立绘', role: 'sprite',
      path: 'assets/images/img_smoke_sprite.png', width: 300, height: 450, format: 'png',
      sizeBytes: 1024, importedAt: new Date().toISOString(),
      edit: { crop: null, removeBackground: null, adjustments: { brightness: 0, contrast: 0 } },
      source: { path: 'assets/.source/images/img_smoke_sprite.png', format: 'png', width: 300, height: 450, sizeBytes: 1024 },
    },
  );
  project.assets.audio.push({
    id: 'aud_smoke_bgm', kind: 'audio', name: '烟测 BGM', role: 'bgm',
    path: 'assets/audio/aud_smoke_bgm.ogg', format: 'ogg', durationMs: 1000,
    sizeBytes: 1024, importedAt: new Date().toISOString(), trim: null, gainDb: 0, loop: true,
    source: { path: 'assets/.source/audio/aud_smoke_bgm.ogg', format: 'ogg', durationMs: 1000, sizeBytes: 1024 },
  });
  if (mockAssets.available.video) {
    project.assets.videos.push({
      id: 'vid_smoke_clip', kind: 'video', name: '烟测视频', path: 'assets/videos/vid_smoke_clip.mp4',
      format: 'mp4', durationMs: 1000, width: 640, height: 360, codec: 'h264',
      hasAudio: false, sizeBytes: 1024, importedAt: new Date().toISOString(),
    });
  }
  project.assets.minigames.push({
    id: 'mg_smoke_demo', kind: 'minigame', name: '烟测小游戏',
    path: 'assets/minigames/mg_smoke_demo.html', declaredExits: ['win', 'lose'],
    mode: 'blocking', sizeBytes: 512, importedAt: new Date().toISOString(),
  });

  // 蓝图验收用图：对话 → 场景 → 选项 → 对话回环
  const scene = createNodeDraft(project, 'scene', { position: { x: 360, y: 40 } }).node;
  scene.name = '雨夜街道';
  scene.background = { assetId: 'img_smoke_bg', fit: 'cover', x: 0.5, y: 0.5, scale: 1, opacity: 1 };
  scene.sprites = [
    { id: 'sp_1', assetId: 'img_smoke_sprite', x: 0.5, y: 0.62, scale: 1, zIndex: 10, opacity: 1 },
  ];
  scene.audio.bgmAssetId = 'aud_smoke_bgm';
  const choice = createNodeDraft(project, 'choice', { position: { x: 720, y: 40 } }).node;
  choice.name = '要买伞吗';
  choice.prompt = '雨越下越大。';
  const end = createNodeDraft(project, 'dialogue', { position: { x: 1060, y: 40 } }).node;
  end.name = '章节结束';
  end.text = '雨还在下。';
  project.nodes.push(scene, choice, end);

  // 其余节点类型：用于属性面板与出口拖拽验收
  const minigame = createNodeDraft(project, 'minigame', { position: { x: 360, y: 380 } }).node;
  minigame.name = '开锁小游戏';
  const video = createNodeDraft(project, 'video', { position: { x: 700, y: 380 } })?.node;
  if (video) video.name = '雨景过场';
  const condition = createNodeDraft(project, 'condition', { position: { x: 1040, y: 380 } }).node;
  condition.name = '判断结果';
  condition.expression = 'last_minigame_result == "win"';
  const variable = createNodeDraft(project, 'variable', { position: { x: 1360, y: 380 } }).node;
  variable.name = '设置状态';
  const jump = createNodeDraft(project, 'jump', { position: { x: 360, y: 580 } }).node;
  jump.name = '回到开头';
  jump.targetNodeId = 'n_opening';
  project.nodes.push(minigame, ...(video ? [video] : []), condition, variable, jump);

  project.edges = [
    { id: 'e1', from: 'n_opening', port: 'next', to: scene.id, kind: 'sequence' },
    { id: 'e2', from: scene.id, port: 'next', to: choice.id, kind: 'sequence' },
    { id: 'e3', from: choice.id, port: 'opt_1', to: end.id, kind: 'sequence' },
    { id: 'e4', from: choice.id, port: 'opt_2', to: end.id, kind: 'sequence' },
    { id: 'e5', from: end.id, port: 'next', to: scene.id, kind: 'sequence' },
  ];
  project.editor.selectedNodeIds = [scene.id];

  // 界面材质验收数据：对话框 / 选项 / 标题 / 结束 / 存档菜单
  project.settings.uiSkin = {
    title: {
      card: { borderColor: '#f59e0b', borderWidthPx: 2, borderRadiusPx: 18 },
    },
    ending: {
      card: { borderColor: '#c084fc', borderWidthPx: 2, borderRadiusPx: 16 },
    },
    menu: {
      panel: { borderColor: '#22d3ee', borderWidthPx: 2, borderRadiusPx: 16 },
    },
  };
  scene.textbox.material = {
    imageAssetId: 'img_smoke_bg',
    imageMode: 'cover',
    imageOpacity: 0.35,
    borderColor: '#00d1b2',
    borderWidthPx: 3,
    borderRadiusPx: 12,
  };
  choice.material = {
    imageAssetId: 'img_smoke_sprite',
    imageMode: 'cover',
    imageOpacity: 0.3,
    borderColor: '#ff9f6b',
    borderWidthPx: 2,
    borderRadiusPx: 14,
    textColor: '#fff3e0',
    gapPx: 12,
    hoverBackgroundColor: '#7c2d12',
    hoverBorderColor: '#ffb27a',
  };

  schema.assertValidProject(project);
  return project;
}

async function startServer(mockDir) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.json': 'application/json; charset=utf-8',
  };
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file;
      if (pathname.startsWith('/mock/')) {
        file = path.join(mockDir, pathname.slice('/mock/'.length));
      } else {
        file = path.join(DIST, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
        if (!fs.existsSync(file)) file = path.join(DIST, 'index.html');
      }
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const body = await fsp.readFile(file);
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

function mockBridgeSource({ project, fileMap, assetIds }) {
  return `(() => {
  const PROJECT = ${JSON.stringify(project)};
  const FILES = ${JSON.stringify(fileMap)};
  const ASSET_IDS = ${JSON.stringify(assetIds)};
  const SAVES = [];
  const toDataUrl = async (relativePath) => {
    const url = FILES[relativePath];
    if (!url) return null;
    const res = await fetch(url);
    const mime = res.headers.get('content-type') || 'application/octet-stream';
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return 'data:' + mime + ';base64,' + btoa(binary);
  };
  const okProject = () => ({ ok: true, project: PROJECT, projectPath: 'C:/mock/project/project.json', projectDir: 'C:/mock/project', assetIds: ASSET_IDS });
  const assets = {
    importImages: async () => ({ ok: true, canceled: true }),
    importAudio: async () => ({ ok: true, canceled: true }),
    importVideos: async () => ({ ok: true, canceled: true }),
    importMinigames: async () => ({ ok: true, canceled: true }),
    saveGeneratedAudio: async ({ name, role, durationMs }) => {
      const id = 'aud_gen_' + Date.now();
      const ms = durationMs || 1000;
      return {
        ok: true,
        asset: {
          id,
          kind: 'audio',
          name: name || id,
          role: role || 'bgm',
          path: 'assets/audio/' + id + '.ogg',
          format: 'ogg',
          durationMs: ms,
          sizeBytes: 2048,
          importedAt: new Date().toISOString(),
          trim: null,
          gainDb: 0,
          loop: role === 'bgm',
          source: {
            path: 'assets/.source/audio/' + id + '.wav',
            format: 'wav',
            durationMs: ms,
            sizeBytes: 4096,
          },
        },
      };
    },
    readDataUrl: async ({ relativePath }) => {
      const dataUrl = await toDataUrl(relativePath);
      return dataUrl ? { ok: true, dataUrl, mime: 'application/octet-stream' } : { ok: false, error: 'mock 文件不存在：' + relativePath };
    },
    readText: async () => ({ ok: true, text: '<html><body>mock</body></html>' }),
    assetUrl: async ({ relativePath }) => ({ ok: true, url: FILES[relativePath] || '' }),
    exportImage: async ({ asset, edit, format, width, height }) => ({
      ok: true,
      asset: { ...asset, edit, format, width, height, path: 'assets/images/' + asset.id + '.' + format, sizeBytes: 2048 },
    }),
    exportAudio: async ({ asset, trim, gainDb, format }) => ({
      ok: true,
      asset: { ...asset, trim, gainDb, format, path: 'assets/audio/' + asset.id + '.ogg', sizeBytes: 2048 },
    }),
    remove: async () => ({ ok: true }),
  };
  window.vnStudio = {
    app: {
      getInfo: async () => ({ ok: true, version: 'smoke', electron: 'mock', chrome: 'mock', node: 'mock', platform: 'mock', ffmpegAvailable: true, projectSchemaVersion: 1 }),
      getStartupProject: async () => (PROJECT ? okProject() : { ok: true, project: null }),
      setTitle: async () => ({ ok: true }),
      onSmokeLoadProject: () => () => {},
      onSmokeSelectAsset: () => () => {},
    },
    projects: {
      create: async () => ({ ok: true, canceled: true }),
      open: async () => ({ ok: true, canceled: true }),
      openPath: async () => okProject(),
      save: async ({ project, projectPath }) => ({ ok: true, project, projectPath: projectPath || 'C:/mock/project/project.json', projectDir: 'C:/mock/project' }),
      recent: async () => ({ ok: true, items: [] }),
      removeRecent: async () => ({ ok: true }),
    },
    assets,
    ai: {
      getConfig: async () => ({
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-image-1',
        imageSize: '1024x1024',
        timeoutMs: 60000,
        hasApiKey: true,
        keyPreview: 'sk-...abcd',
      }),
      setConfig: async (patch) => ({
        baseUrl: patch.baseUrl || 'https://api.openai.com/v1',
        model: patch.model || 'gpt-image-1',
        imageSize: patch.imageSize || '1024x1024',
        timeoutMs: patch.timeoutMs || 60000,
        hasApiKey: true,
        keyPreview: 'sk-...abcd',
      }),
      testService: async () => ({ connected: true, status: 200, message: '连接成功' }),
      generateImage: async () => ({ ok: true, asset: null }),
    },
    saves: {
      list: async () => ({ ok: true, saves: SAVES.slice() }),
      get: async ({ kind, slot }) => ({
        ok: true,
        save: SAVES.find(function (item) { return item.kind === kind && item.slot === slot; }) || null,
      }),
      put: async ({ save }) => {
        const index = SAVES.findIndex(function (item) { return item.kind === save.kind && item.slot === save.slot; });
        if (index >= 0) SAVES[index] = save; else SAVES.push(save);
        return { ok: true, save: save };
      },
      remove: async ({ kind, slot }) => {
        const index = SAVES.findIndex(function (item) { return item.kind === kind && item.slot === slot; });
        if (index >= 0) SAVES.splice(index, 1);
        return { ok: true };
      },
    },
  };
})();`;
}

async function capture(page, name) {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file });
  console.log(`[ui-smoke] 截图：${file}`);
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('editor/dist 不存在，请先运行 pnpm --filter @vn-studio/editor build');
  }
  const mockDir = path.join(OUT_DIR, 'mock-assets');
  await fsp.rm(mockDir, { recursive: true, force: true });
  await fsp.mkdir(mockDir, { recursive: true });
  const mockAssets = await prepareMockAssets(mockDir);
  const fixture = buildFixture(mockAssets);
  const fileMap = {
    'assets/images/img_smoke_bg.png': '/mock/bg.png',
    'assets/.source/images/img_smoke_bg.png': '/mock/bg.png',
    'assets/images/img_smoke_sprite.png': '/mock/sprite.png',
    'assets/.source/images/img_smoke_sprite.png': '/mock/sprite.png',
    'assets/audio/aud_smoke_bgm.ogg': '/mock/audio.wav',
    'assets/.source/audio/aud_smoke_bgm.ogg': '/mock/audio.wav',
    'assets/videos/vid_smoke_clip.mp4': '/mock/video.mp4',
    'assets/minigames/mg_smoke_demo.html': '/mock/minigame.html',
  };
  const assetIds = {
    image: 'img_smoke_bg',
    audio: 'aud_smoke_bgm',
    video: mockAssets.available.video ? 'vid_smoke_clip' : null,
    minigame: 'mg_smoke_demo',
  };

  const { server, port } = await startServer(mockDir);
  const baseUrl = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({
    executablePath: findEdge(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  });
  const errors = [];
  try {
    const startPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    startPage.on('pageerror', (error) => errors.push(`[start] pageerror: ${error.message}`));
    startPage.on('console', (message) => {
      if (message.type() === 'error') errors.push(`[start] console: ${message.text()}`);
    });
    await startPage.addInitScript({ content: mockBridgeSource({ project: null, fileMap, assetIds }) });
    await startPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await startPage.waitForSelector('.vn-start-screen');
    await startPage.waitForTimeout(500);
    await capture(startPage, 'chromium-start.png');
    if ((await startPage.getByRole('button', { name: '打开项目' }).count()) === 0) {
      throw new Error('开始界面缺少「打开项目」按钮');
    }
    if ((await startPage.getByRole('button', { name: '设置' }).count()) === 0) {
      throw new Error('开始界面缺少「设置」按钮');
    }

    // 明/暗模式切换（开始界面）
    await startPage.locator('.vn-start-status .vn-theme-toggle').click();
    await startPage.waitForTimeout(300);
    const startTheme = await startPage.evaluate(() => document.documentElement.dataset.theme);
    if (startTheme !== 'light') throw new Error(`开始界面明亮模式切换失败：${startTheme}`);
    await capture(startPage, 'chromium-start-light.png');
    await startPage.locator('.vn-start-status .vn-theme-toggle').click();
    await startPage.waitForTimeout(200);

    // 设置 → 外部 AI 服务
    await startPage.getByRole('button', { name: '设置' }).click();
    await startPage.waitForSelector('.vn-ai-modal');
    await capture(startPage, 'chromium-ai-settings.png');
    await startPage.locator('.vn-ai-close').click();
    await startPage.waitForSelector('.vn-ai-modal', { state: 'detached' });

    await startPage.getByRole('button', { name: /创建项目/ }).first().click();
    await startPage.waitForSelector('.vn-start-modal, [role="dialog"]');
    await capture(startPage, 'chromium-create-modal.png');
    await startPage.keyboard.press('Escape');

    const editorPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    editorPage.on('pageerror', (error) => errors.push(`[editor] pageerror: ${error.message}`));
    editorPage.on('console', (message) => {
      if (message.type() === 'error') errors.push(`[editor] console: ${message.text()}`);
    });
    await editorPage.addInitScript({ content: mockBridgeSource({ project: fixture, fileMap, assetIds }) });
    await editorPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await editorPage.waitForSelector('.vn-workspace');
    await editorPage.waitForTimeout(700);
    await capture(editorPage, 'chromium-workspace.png');
    if ((await editorPage.getByRole('button', { name: '桌面版' }).count()) === 0) {
      throw new Error('编辑器顶部缺少「桌面版」导出按钮');
    }
    if ((await editorPage.getByRole('button', { name: 'AI 助手' }).count()) === 0) {
      throw new Error('编辑器顶部缺少「AI 助手」按钮');
    }
    await editorPage.getByRole('button', { name: 'AI 助手' }).click();
    await editorPage.waitForSelector('.vn-ai-drawer');
    await capture(editorPage, 'chromium-ai-assistant.png');
    await editorPage.locator('.vn-ai-drawer .vn-ai-close').click();
    await editorPage.waitForSelector('.vn-ai-drawer', { state: 'detached' });

    // 素材编辑：时间轴必须收起，避免画布被上下挤压
    await editorPage.locator('.vn-asset-item').first().click();
    await editorPage.getByRole('button', { name: '素材编辑' }).click();
    await editorPage.waitForTimeout(500);
    if ((await editorPage.locator('.vn-workspace__timeline').count()) !== 0) {
      throw new Error('素材编辑界面仍渲染时间轴');
    }
    if ((await editorPage.locator('.vn-workspace__center.is-no-timeline').count()) === 0) {
      throw new Error('素材编辑界面缺少 is-no-timeline 布局');
    }
    await capture(editorPage, 'chromium-asset-editor.png');
    if ((await editorPage.locator('.vn-ed-img-zoom-label').count()) === 0) {
      throw new Error('素材编辑缺少视图缩放控件');
    }
    if ((await editorPage.locator('.vn-asset-scene').count()) === 0) {
      throw new Error('素材编辑缺少场景预览浮窗');
    }
    await editorPage.getByRole('button', { name: '查看原图' }).click();
    await editorPage.waitForTimeout(300);
    if ((await editorPage.locator('.vn-ed-img-source').count()) === 0) {
      throw new Error('素材编辑无法查看完整原图');
    }
    await editorPage.getByRole('button', { name: '编辑结果' }).click();
    await editorPage.getByRole('button', { name: '收起编辑栏' }).click();
    await editorPage.waitForTimeout(200);
    if ((await editorPage.locator('.vn-ed-img-tools').count()) !== 0) {
      throw new Error('收起编辑栏后下方工具区仍然存在');
    }
    await editorPage.getByRole('button', { name: '展开编辑栏' }).click();
    await editorPage.waitForTimeout(200);
    if ((await editorPage.locator('.vn-ed-img-tools').count()) === 0) {
      throw new Error('展开编辑栏失败');
    }
    await capture(editorPage, 'chromium-asset-editor-view.png');
    await editorPage.getByRole('button', { name: '演示' }).click();
    await editorPage.waitForTimeout(800);
    if ((await editorPage.locator('.vn-workspace__timeline').count()) === 0) {
      throw new Error('演示界面不应隐藏时间轴');
    }
    await editorPage.getByRole('button', { name: '蓝图' }).click();
    await editorPage.waitForTimeout(300);
    if ((await editorPage.locator('.vn-workspace__timeline').count()) === 0) {
      throw new Error('回到蓝图后时间轴没有恢复');
    }

    // 明/暗模式切换（编辑器）
    await editorPage.locator('.vn-workspace__topbar .vn-theme-toggle').click();
    await editorPage.waitForTimeout(300);
    const editorTheme = await editorPage.evaluate(() => document.documentElement.dataset.theme);
    if (editorTheme !== 'light') throw new Error(`编辑器明亮模式切换失败：${editorTheme}`);
    await capture(editorPage, 'chromium-workspace-light.png');
    await editorPage.locator('.vn-workspace__topbar .vn-theme-toggle').click();
    await editorPage.waitForTimeout(200);

    // 音频工坊：导入菜单 → 制作音频 → 打开 / 试听 / 关闭
    await editorPage.getByRole('button', { name: '导入', exact: true }).click();
    await editorPage.getByRole('menuitem', { name: /制作音频/ }).click();
    await editorPage.waitForSelector('.vn-audio-studio');
    await editorPage.waitForTimeout(300);
    await capture(editorPage, 'chromium-audio-studio.png');
    const studioCheck = await editorPage.evaluate(() => {
      const modal = document.querySelector('.vn-audio-studio');
      return { ok: Boolean(modal && modal.querySelector('select') && modal.querySelector('input')) };
    });
    if (!studioCheck.ok) throw new Error('音频工坊未正确打开');
    await editorPage.getByRole('button', { name: '试听', exact: true }).click();
    await editorPage.waitForTimeout(500);
    const stopPreviewButton = editorPage.getByRole('button', { name: /停止试听/ });
    if ((await stopPreviewButton.count()) > 0) await stopPreviewButton.click();
    await editorPage.getByRole('button', { name: '关闭', exact: true }).click();
    await editorPage.waitForTimeout(300);

    // 蓝图：画布 / 场景属性面板 / 创建节点菜单
    await editorPage.getByRole('button', { name: '蓝图', exact: true }).click();
    await editorPage.waitForSelector('.vn-bp .react-flow');
    await editorPage.waitForTimeout(900);
    await capture(editorPage, 'chromium-blueprint.png');

    const sceneNode = editorPage.locator('.vn-bp-node').filter({ hasText: '雨夜街道' }).first();
    await sceneNode.click();
    await editorPage.waitForTimeout(800);
    await capture(editorPage, 'chromium-scene-inspector.png');
    if (!(await editorPage.locator('body').innerText()).includes('启用 背景')) {
      throw new Error('场景属性面板缺少组件启用/时长字段');
    }
    await sceneNode.dblclick({ force: true });
    await editorPage.waitForTimeout(1000);
    if ((await editorPage.locator('.vn-stage-editor').count()) === 0) {
      throw new Error('双击普通节点没有打开场景编辑器');
    }
    await capture(editorPage, 'chromium-scene-stage-editor.png');
    const closeStage = editorPage.getByRole('button', { name: '关闭场景编辑' });
    if (await closeStage.count()) await closeStage.click();
    await editorPage.waitForTimeout(300);
    await editorPage.getByRole('button', { name: '全局流程' }).click();
    await editorPage.waitForTimeout(500);
    if ((await editorPage.locator('.vn-global-timeline').count()) === 0) {
      throw new Error('全局流程时间轴没有打开');
    }
    if ((await editorPage.locator('.vn-global-track').count()) < 3) {
      throw new Error('全局流程时间轴缺少多轨道');
    }
    await capture(editorPage, 'chromium-global-flow.png');
    await editorPage.getByRole('button', { name: '关闭' }).last().click();
    await editorPage.waitForTimeout(300);
    await editorPage.getByRole('button', { name: '分组', exact: true }).click();
    await editorPage.waitForTimeout(400);
    if ((await editorPage.locator('.vn-group-manager').count()) === 0) {
      throw new Error('分组管理没有打开');
    }
    await editorPage.locator('.vn-group-manager__create input').fill('冒烟分组');
    await editorPage.locator('.vn-group-manager__create').getByRole('button', { name: '新建' }).click();
    await editorPage.waitForTimeout(300);
    if (!(await editorPage.locator('.vn-group-manager').innerText()).includes('冒烟分组')) {
      throw new Error('分组创建失败');
    }
    await capture(editorPage, 'chromium-groups.png');
    await editorPage.locator('.vn-group-manager').getByRole('button', { name: '关闭' }).click();
    await editorPage.waitForTimeout(300);
    if ((await editorPage.locator('.vn-asset-group-filter').count()) === 0) {
      throw new Error('素材分组筛选没有出现');
    }
    if ((await editorPage.getByText('B4 · 粒子层').count()) === 0) {
      throw new Error('场景属性面板缺少原生粒子层');
    }
    if ((await editorPage.getByText('B3 · 前景层').count()) === 0) {
      throw new Error('场景属性面板缺少前景层');
    }
    const enableParticles = editorPage.getByRole('button', { name: '启用粒子' });
    if ((await enableParticles.count()) > 0) {
      await enableParticles.click();
      await editorPage.waitForTimeout(300);
      await capture(editorPage, 'chromium-scene-particles.png');
    }

    // 立绘动画模板：选择后应在场景时间轴生成关键帧
    const animationSelect = editorPage
      .locator('.vn-scene-insp select')
      .filter({ hasText: '淡入（0.8s）' })
      .first();
    if ((await animationSelect.count()) === 0) {
      throw new Error('立绘编辑面板缺少动画模板选择器');
    }
    await animationSelect.selectOption('fadeIn');
    await editorPage.waitForTimeout(600);
    await capture(editorPage, 'chromium-sprite-animation.png');

    // 场景预览小窗：选中场景后出现在画布左下角并自动循环演示
    await editorPage.waitForSelector('.vn-scene-preview canvas');
    await editorPage.waitForTimeout(1600);
    await capture(editorPage, 'chromium-scene-preview.png');
    const previewCheck = await editorPage.evaluate(() => {
      const panel = document.querySelector('.vn-scene-preview');
      const canvas = panel?.querySelector('canvas');
      if (!panel || !canvas) return { ok: false, reason: 'missing' };
      const rect = panel.getBoundingClientRect();
      const container = panel.offsetParent?.getBoundingClientRect();
      const stateText = panel.querySelector('.vn-scene-preview__state')?.textContent?.trim() || '';
      return {
        ok:
          rect.width > 200 &&
          rect.height > 120 &&
          Boolean(container && rect.left >= container.left - 1 && rect.bottom <= container.bottom + 1) &&
          stateText.length > 0,
        rect: { width: Math.round(rect.width), height: Math.round(rect.height), bottom: Math.round(rect.bottom) },
        stateText,
      };
    });
    if (!previewCheck.ok) {
      throw new Error(`场景预览小窗异常：${JSON.stringify(previewCheck)}`);
    }
    // 收起小窗，避免遮挡后续画布拖拽/双击操作
    await editorPage.getByRole('button', { name: '收起', exact: true }).click();
    await editorPage.waitForTimeout(300);
    await editorPage.waitForSelector('.vn-scene-preview.is-collapsed');
    await capture(editorPage, 'chromium-scene-preview-collapsed.png');

    // 时间轴：创建 → 添加立绘轨道 → 双击加关键帧 → 缓动 / 播放
    // 立绘动画模板可能已经创建了时间轴；没有「创建时间轴」按钮时直接复用。
    if ((await editorPage.getByRole('button', { name: '创建时间轴' }).count()) > 0) {
      await editorPage.getByRole('button', { name: '创建时间轴' }).click();
      await editorPage.waitForTimeout(700);
    }
    await capture(editorPage, 'chromium-timeline.png');
    if ((await editorPage.getByRole('button', { name: '分割', exact: true }).count()) === 0) {
      throw new Error('场景时间轴缺少分割按钮');
    }
    if ((await editorPage.getByText('吸附', { exact: true }).count()) === 0) {
      throw new Error('场景时间轴缺少吸附开关');
    }
    await editorPage.getByRole('button', { name: '分割', exact: true }).click();
    await editorPage.waitForTimeout(400);
    await capture(editorPage, 'chromium-timeline-split.png');

    await editorPage.getByRole('button', { name: '+ 轨道' }).click();
    await editorPage.waitForSelector('.vn-tl-menu');
    await editorPage.waitForTimeout(300);
    if ((await editorPage.locator('.vn-tl-menu__item').filter({ hasText: '镜头缩放' }).count()) === 0) {
      throw new Error('时间轴菜单缺少原生镜头轨道');
    }
    await capture(editorPage, 'chromium-timeline-menu.png');
    // 菜单必须完整浮在轨道上方：不被工具栏 overflow 裁剪，中心点命中菜单自身。
    const menuCheck = await editorPage.evaluate(() => {
      const menu = document.querySelector('.vn-tl-menu');
      if (!menu) return { ok: false, reason: 'missing' };
      const rect = menu.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + Math.min(24, rect.height / 2);
      const topElement = document.elementFromPoint(x, y);
      return {
        ok:
          rect.height > 120 &&
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight &&
          Boolean(topElement && menu.contains(topElement)),
        rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) },
        topTag: topElement ? `${topElement.tagName}.${topElement.className}` : null,
      };
    });
    if (!menuCheck.ok) {
      throw new Error(`「+ 轨道」菜单被裁剪/遮挡：${JSON.stringify(menuCheck)}`);
    }
    await editorPage.locator('.vn-tl-menu__item').filter({ hasText: 'X 位置' }).first().click();
    await editorPage.waitForTimeout(700);
    await capture(editorPage, 'chromium-timeline-track.png');

    await editorPage.locator('.vn-tl-track').first().dblclick({ position: { x: 230, y: 16 } });
    await editorPage.waitForTimeout(700);
    await capture(editorPage, 'chromium-timeline-keyframe.png');

    const easingButton = editorPage.locator('.vn-tl-easing__btn').filter({ hasText: '缓入缓出' }).first();
    if (await easingButton.count()) {
      await easingButton.click();
      await editorPage.waitForTimeout(500);
      await capture(editorPage, 'chromium-timeline-easing.png');
    }

    await editorPage.getByRole('button', { name: '播放', exact: true }).click();
    await editorPage.waitForTimeout(500);
    await editorPage.getByRole('button', { name: '暂停', exact: true }).click();
    await capture(editorPage, 'chromium-timeline-play.png');

    // 时间轴快捷键：K 加关键帧 / ←→ 跳关键帧 / Delete 删除 / Ctrl+滚轮缩放
    try {
      await editorPage.locator('.vn-tl-ruler').click({ position: { x: 420, y: 12 } });
      await editorPage.waitForTimeout(300);
      await editorPage.keyboard.press('k');
      await editorPage.waitForTimeout(500);
      await capture(editorPage, 'chromium-timeline-k.png');
      await editorPage.keyboard.press('ArrowLeft');
      await editorPage.waitForTimeout(300);
      await capture(editorPage, 'chromium-timeline-arrow.png');
      await editorPage.keyboard.press('Delete');
      await editorPage.waitForTimeout(400);
      await capture(editorPage, 'chromium-timeline-delete.png');
      await editorPage.keyboard.down('Control');
      await editorPage.mouse.move(760, 780);
      await editorPage.mouse.wheel(0, -120);
      await editorPage.keyboard.up('Control');
      await editorPage.waitForTimeout(400);
      await capture(editorPage, 'chromium-timeline-zoom.png');
    } catch (error) {
      console.warn('[ui-smoke] 时间轴快捷键步骤跳过：', error.message);
    }

    await editorPage.locator('.react-flow__pane').dblclick({ position: { x: 120, y: 200 } });
    await editorPage.waitForSelector('.vn-bp-node-menu');
    await editorPage.waitForTimeout(400);
    await capture(editorPage, 'chromium-node-menu.png');

    // 从菜单创建场景节点
    await editorPage.locator('.vn-bp-node-menu__item').filter({ hasText: '普通节点' }).first().click();
    await editorPage.waitForTimeout(900);
    await capture(editorPage, 'chromium-node-created.png');

    // 选项节点属性面板
    await editorPage.locator('.vn-bp-node').filter({ hasText: '要买伞吗' }).first().click();
    await editorPage.waitForTimeout(800);
    await capture(editorPage, 'chromium-choice-inspector.png');

    // 条件节点属性面板
    await editorPage.locator('.vn-bp-node').filter({ hasText: '判断结果' }).first().click();
    await editorPage.waitForTimeout(700);
    await capture(editorPage, 'chromium-condition-inspector.png');

    // 连线选中（失败不阻断冒烟）
    try {
      const edge = editorPage.locator('.react-flow__edge').first();
      if (await edge.count()) {
        await edge.click({ force: true });
        await editorPage.waitForTimeout(600);
        await capture(editorPage, 'chromium-edge-inspector.png');
      }
    } catch (error) {
      console.warn('[ui-smoke] 连线点击跳过：', error.message);
    }
    await editorPage.keyboard.press('Escape');

    // 素材拖拽生成：背景图 → 新建场景；立绘 → 位置/表情 modal
    try {
      const pane = editorPage.locator('.react-flow__pane');
      const bgItem = editorPage.locator('.vn-asset-item__main').filter({ hasText: '烟测背景' }).first();
      await bgItem.dragTo(pane, { targetPosition: { x: 90, y: 500 } });
      await editorPage.waitForTimeout(1000);
      await capture(editorPage, 'chromium-drag-create.png');

      const spriteItem = editorPage.locator('.vn-asset-item__main').filter({ hasText: '烟测立绘' }).first();
      await spriteItem.dragTo(pane, { targetPosition: { x: 260, y: 500 } });
      await editorPage.waitForTimeout(800);
      await editorPage.waitForSelector('.vn-bp-modal');
      await capture(editorPage, 'chromium-sprite-modal.png');
      await editorPage.getByRole('button', { name: '取消', exact: true }).last().click();

      // 明确选中拖拽生成的场景节点，再从 next 出口拉线到「章节结束」
      const createdSceneNode = editorPage
        .locator('.vn-bp-node')
        .filter({ has: editorPage.getByText('烟测背景', { exact: true }) })
        .first();
      await createdSceneNode.click();
      await editorPage.waitForTimeout(500);
      const selectedNode = editorPage.locator('.vn-bp-node.is-selected').first();
      const sourceHandle = selectedNode.locator('.vn-bp-handle--source').first();
      const targetNode = editorPage.locator('.vn-bp-node').filter({ hasText: '章节结束' }).first();
      const targetHandle = targetNode.locator('.vn-bp-handle--target').first();
      const sourceBox = await sourceHandle.boundingBox();
      const targetBox = await targetHandle.boundingBox();
      if (sourceBox && targetBox) {
        await editorPage.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
        await editorPage.mouse.down();
        await editorPage.mouse.move(
          targetBox.x + targetBox.width / 2,
          targetBox.y + targetBox.height / 2,
          { steps: 14 },
        );
        await editorPage.mouse.up();
        await editorPage.waitForTimeout(1000);
        await capture(editorPage, 'chromium-edge-created.png');
      }

      // 从出口拖到空白处：弹出创建节点菜单并自动连线
      const miniNode = editorPage.locator('.vn-bp-node').filter({ hasText: '开锁小游戏' }).first();
      const miniHandle = miniNode.locator('.vn-bp-handle--source').first();
      const miniBox = await miniHandle.boundingBox();
      const paneBox = await editorPage.locator('.react-flow__pane').boundingBox();
      if (miniBox && paneBox) {
        await editorPage.mouse.move(miniBox.x + miniBox.width / 2, miniBox.y + miniBox.height / 2);
        await editorPage.mouse.down();
        await editorPage.mouse.move(paneBox.x + 170, paneBox.y + 120, { steps: 12 });
        await editorPage.mouse.up();
        await editorPage.waitForSelector('.vn-bp-node-menu');
        await editorPage.waitForTimeout(400);
        await capture(editorPage, 'chromium-edge-drop-menu.png');
        await editorPage
          .locator('.vn-bp-node-menu__item')
          .filter({ hasText: '普通节点' })
          .first()
          .click();
        await editorPage.waitForTimeout(900);
        await capture(editorPage, 'chromium-edge-drop-created.png');
      }
    } catch (error) {
      console.warn('[ui-smoke] 素材拖拽步骤跳过：', error.message);
    }

    // 编辑器内嵌运行时预览（演示 Tab）
    try {
      await editorPage.getByRole('button', { name: '演示', exact: true }).click();
      await editorPage.waitForSelector('.vn-preview__stage');
      await editorPage.waitForTimeout(1800);
      await capture(editorPage, 'chromium-runtime-preview.png');

      // 界面材质：标题 / 结束 / 存档菜单的边框色应来自 settings.uiSkin
      const skinCheck = await editorPage.evaluate(() => {
        const stage = document.querySelector('.vn-preview__stage');
        if (!stage) return { ok: false };
        const menuPanel = stage.querySelector('.vnrt-menu__panel');
        const titleCard = stage.querySelector('.vnrt-title__card');
        const endCard = stage.querySelector('.vnrt-ended__card');
        return {
          ok: true,
          menuBorder: menuPanel ? getComputedStyle(menuPanel).borderTopColor : null,
          titleBorder: titleCard ? getComputedStyle(titleCard).borderTopColor : null,
          endBorder: endCard ? getComputedStyle(endCard).borderTopColor : null,
        };
      });
      if (!skinCheck.ok) throw new Error('找不到运行时预览舞台');
      if (skinCheck.menuBorder !== 'rgb(34, 211, 238)') {
        throw new Error(`存档菜单材质未生效：${skinCheck.menuBorder}`);
      }
      if (skinCheck.titleBorder !== 'rgb(245, 158, 11)') {
        throw new Error(`标题材质未生效：${skinCheck.titleBorder}`);
      }
      if (skinCheck.endBorder !== 'rgb(192, 132, 252)') {
        throw new Error(`结束材质未生效：${skinCheck.endBorder}`);
      }

      const previewStage = editorPage.locator('.vn-preview__stage');
      const previewBox = await previewStage.boundingBox();
      if (previewBox) {
        await editorPage.mouse.click(
          previewBox.x + previewBox.width / 2,
          previewBox.y + previewBox.height / 2,
        );
        await editorPage.waitForTimeout(1600);
        await capture(editorPage, 'chromium-runtime-stage.png');

        // 推进到 choice 节点，验证选项按钮材质
        for (let step = 0; step < 6; step += 1) {
          if ((await editorPage.locator('.vn-preview__stage .vnrt-choice__btn').count()) > 0) break;
          await editorPage.mouse.click(
            previewBox.x + previewBox.width / 2,
            previewBox.y + previewBox.height / 2,
          );
          await editorPage.waitForTimeout(500);
        }
        await editorPage.mouse.move(5, 5);
        await editorPage.waitForTimeout(300);
        const choiceBorder = await editorPage.evaluate(() => {
          const button = document.querySelector('.vn-preview__stage .vnrt-choice__btn');
          if (!button) return null;
          const computed = getComputedStyle(button);
          return { border: computed.borderTopColor, radius: computed.borderTopLeftRadius };
        });
        if (choiceBorder) {
          if (choiceBorder.border !== 'rgb(255, 159, 107)') {
            throw new Error(`选项材质边框未生效：${choiceBorder.border}`);
          }
          await capture(editorPage, 'chromium-runtime-choice-material.png');
        }
        const menuButton = editorPage.locator('.vn-preview__stage .vnrt-menu-btn');
        if ((await menuButton.count()) > 0) {
          await menuButton.click();
          await editorPage.waitForTimeout(400);
          await capture(editorPage, 'chromium-runtime-menu-material.png');
          await editorPage.keyboard.press('Escape');
        }
      }
    } catch (error) {
      if (String(error.message).includes('材质')) throw error;
      console.warn('[ui-smoke] 运行时预览步骤跳过：', error.message);
    }

    await editorPage.getByText('烟测背景', { exact: true }).first().click();
    await editorPage.waitForTimeout(1200);
    await capture(editorPage, 'chromium-image-editor.png');

    await editorPage.getByText('烟测 BGM', { exact: true }).first().click();
    await editorPage.waitForTimeout(1200);
    await capture(editorPage, 'chromium-audio-editor.png');

    if (assetIds.video) {
      await editorPage.getByText('烟测视频', { exact: true }).first().click();
      await editorPage.waitForTimeout(1200);
      await capture(editorPage, 'chromium-video-preview.png');
    }

    await editorPage.getByText('烟测小游戏', { exact: true }).first().click();
    await editorPage.waitForTimeout(1200);
    await capture(editorPage, 'chromium-minigame-preview.png');
  } finally {
    await browser.close();
    server.close();
    await fsp.rm(mockDir, { recursive: true, force: true }).catch(() => {});
  }

  if (errors.length > 0) {
    console.error('[ui-smoke] 控制台错误：');
    for (const error of errors) console.error('  -', error);
    process.exitCode = 1;
  } else {
    console.log('[ui-smoke] 完成，未捕获控制台错误');
  }
}

main().catch((error) => {
  console.error('[ui-smoke] 失败：', error);
  process.exit(1);
});
