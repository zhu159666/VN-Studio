#!/usr/bin/env node
// 阶段五运行时冒烟：生成临时 game.json + 媒体文件，静态服务 runtime/，Edge headless 截图。
// 不依赖 Electron，验证独立浏览器运行时（标题 / 舞台 / 对话 / 选项 / 存档菜单）。
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
const { createTimeline, createTrackDraft, addKeyframeToTrack } = await import(
  '../editor/src/features/timeline/timelineUtils.js'
);

const ROOT = process.cwd();
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const OUT_DIR = path.join(ROOT, 'editor', '.smoke');
const ASSET_DIR = path.join(OUT_DIR, 'runtime-assets');

function findEdge() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('未找到 Microsoft Edge');
  return found;
}

function tryFfmpeg(args) {
  try {
    execFileSync('ffmpeg', args, { stdio: 'ignore', timeout: 60000 });
    return true;
  } catch (error) {
    console.warn('[runtime-smoke] ffmpeg 失败：', error.message);
    return false;
  }
}

async function prepareAssets() {
  await fsp.rm(ASSET_DIR, { recursive: true, force: true });
  await fsp.mkdir(path.join(ASSET_DIR, 'images'), { recursive: true });
  await fsp.mkdir(path.join(ASSET_DIR, 'audio'), { recursive: true });
  await fsp.mkdir(path.join(ASSET_DIR, 'videos'), { recursive: true });
  await fsp.mkdir(path.join(ASSET_DIR, 'minigames'), { recursive: true });

  const bg = path.join(ASSET_DIR, 'images', 'bg.png');
  const sprite = path.join(ASSET_DIR, 'images', 'sprite.png');
  const bgm = path.join(ASSET_DIR, 'audio', 'bgm.ogg');
  const video = path.join(ASSET_DIR, 'videos', 'clip.mp4');
  const minigame = path.join(ASSET_DIR, 'minigames', 'minigame.html');

  tryFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x22384f:s=1280x720', '-frames:v', '1', bg]);
  tryFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0xe0a070:s=420x620', '-frames:v', '1', sprite]);
  tryFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:a', 'libvorbis', '-q:a', '5', bgm,
  ]);
  tryFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'color=c=0x664422:s=640x360:d=2:r=24',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video,
  ]);
  fs.writeFileSync(
    minigame,
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>冒烟小游戏</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#15202b;color:#e7edf3;font-family:system-ui}button{margin:8px;padding:10px 22px;border-radius:8px;border:1px solid #5aa9ff;background:#1f3140;color:#e7edf3;font-size:16px}</style></head>
<body><main><h1>冒烟小游戏</h1><button id="win">Win</button><button id="lose">Lose</button></main>
<script>window.MINIGAME_EXITS=["win","lose"];
function report(result){parent.postMessage({type:"minigame-result",result:result},"*");}
document.getElementById("win").onclick=function(){report("win");};
document.getElementById("lose").onclick=function(){report("lose");};
setTimeout(function(){report("win");},2500);
</script></body></html>`,
    'utf8',
  );

  if (!fs.existsSync(bg)) {
    fs.writeFileSync(bg, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  }
  if (!fs.existsSync(sprite)) fs.copyFileSync(bg, sprite);
  return {
    bg: fs.existsSync(bg),
    sprite: fs.existsSync(sprite),
    bgm: fs.existsSync(bgm),
    video: fs.existsSync(video),
    minigame: fs.existsSync(minigame),
  };
}

function buildGame(assets) {
  const project = projectStore.defaultProject({ title: '运行时冒烟', resolution: { width: 1280, height: 720 } });
  project.meta.author = 'Smoke';
  project.meta.description = '纯浏览器运行时冒烟测试项目。';
  project.variables = {
    money: { type: 'number', value: 120 },
    player_name: { type: 'string', value: '林' },
    last_minigame_result: { type: 'string', value: '' },
  };
  if (assets.bg) {
    project.assets.images.push({
      id: 'img_bg', kind: 'image', name: '雨夜街道', role: 'background',
      path: 'assets/images/bg.png', width: 1280, height: 720, format: 'png',
    });
  }
  if (assets.sprite) {
    project.assets.images.push({
      id: 'img_sprite', kind: 'image', name: '店员', role: 'sprite',
      path: 'assets/images/sprite.png', width: 420, height: 620, format: 'png',
    });
  }
  if (assets.bgm) {
    project.assets.audio.push({
      id: 'aud_bgm', kind: 'audio', name: '雨声', role: 'bgm',
      path: 'assets/audio/bgm.ogg', format: 'ogg', durationMs: 2000,
    });
  }
  if (assets.minigame) {
    project.assets.minigames.push({
      id: 'mg_test', kind: 'minigame', name: '撑伞',
      path: 'assets/minigames/minigame.html',
      declaredExits: ['win', 'lose'], mode: 'blocking',
    });
  }
  if (assets.video) {
    project.assets.videos.push({
      id: 'vid_test', kind: 'video', name: '过场',
      path: 'assets/videos/clip.mp4', format: 'mp4', durationMs: 2000,
      width: 640, height: 360, codec: 'h264', hasAudio: false,
    });
  }

  const scene = createNodeDraft(project, 'scene', { position: { x: 320, y: 0 } }).node;
  scene.name = '雨夜街道';
  scene.background = assets.bg
    ? { assetId: 'img_bg', fit: 'cover', x: 0.5, y: 0.5, scale: 1, opacity: 1 }
    : null;
  scene.sprites = assets.sprite
    ? [{ id: 'sp_1', assetId: 'img_sprite', x: 0.5, y: 0.62, scale: 1, zIndex: 10, opacity: 1 }]
    : [];
  scene.textbox = {
    x: 0.5, y: 0.84, width: 0.92, height: 0.22, fontSizePx: 30,
    color: '#ffffff', background: '#000000', backgroundOpacity: 0.55, opacity: 1,
  };
  scene.audio.bgmAssetId = assets.bgm ? 'aud_bgm' : null;
  scene.audio.volume = 0.6;

  const minigameNode = createNodeDraft(project, 'minigame', { position: { x: 620, y: 0 } }).node;
  minigameNode.name = '撑伞小游戏';
  minigameNode.exits = [
    { id: 'win', name: 'win' },
    { id: 'lose', name: 'lose' },
  ];
  minigameNode.defaultExitId = 'lose';
  minigameNode.timeoutMs = 8000;
  minigameNode.instructions = '点击按钮上报结果（冒烟会自动上报 win）。';

  const choice = createNodeDraft(project, 'choice', { position: { x: 900, y: 0 } }).node;
  choice.name = '要买伞吗';
  choice.prompt = '雨越下越大。';
  choice.exits = [
    { id: 'buy', name: '买一把伞' },
    { id: 'wait', name: '在店里等雨停' },
  ];

  const videoNode = createNodeDraft(project, 'video', { position: { x: 1180, y: 0 } }).node;
  videoNode.name = '雨景过场';
  videoNode.showSkipButton = true;
  videoNode.skipAfterMs = 0;
  videoNode.volume = 0.8;

  const end = createNodeDraft(project, 'dialogue', { position: { x: 1460, y: 0 } }).node;
  end.name = '结束';
  end.text = '雨停了。（演示结束）';
  const fail = createNodeDraft(project, 'dialogue', { position: { x: 900, y: 240 } }).node;
  fail.name = '失败';
  fail.text = '伞没有撑开。';

  project.nodes.push(scene, minigameNode, choice, videoNode, end, fail);
  project.edges = [
    { id: 'e1', from: 'n_opening', port: 'next', to: scene.id, kind: 'sequence' },
    { id: 'e2', from: scene.id, port: 'next', to: minigameNode.id, kind: 'sequence' },
    { id: 'e3', from: minigameNode.id, port: 'win', to: choice.id, kind: 'sequence' },
    { id: 'e4', from: minigameNode.id, port: 'lose', to: fail.id, kind: 'sequence' },
    { id: 'e5', from: choice.id, port: 'buy', to: videoNode.id, kind: 'sequence' },
    { id: 'e6', from: choice.id, port: 'wait', to: videoNode.id, kind: 'sequence' },
    { id: 'e7', from: videoNode.id, port: 'completed', to: end.id, kind: 'sequence' },
    { id: 'e8', from: videoNode.id, port: 'skipped', to: end.id, kind: 'sequence' },
  ];
  project.settings.startNodeId = 'n_opening';
  project.nodes[0].text = '雨还在下。';

  // 时间轴：背景透明度 + 立绘 X 位置
  const timeline = createTimeline(scene.id, 4000);
  if (assets.bg) {
    const bgTrack = createTrackDraft({ sceneNode: scene, timeline, kind: 'background', property: 'opacity' }).track;
    timeline.tracks.push(addKeyframeToTrack(bgTrack, 2000, 0.75));
  }
  if (assets.sprite) {
    const spriteTrack = createTrackDraft({ sceneNode: scene, timeline, kind: 'sprite', target: 'sp_1', property: 'y' }).track;
    timeline.tracks.push(addKeyframeToTrack(spriteTrack, 2000, 0.55));
  }
  if (timeline.tracks.length > 0) project.timelines[scene.id] = timeline;

  schema.assertValidProject(project);
  return project;
}

async function startServer(project) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.json': 'application/json; charset=utf-8',
  };
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/game.json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(project));
        return;
      }
      if (pathname.startsWith('/assets/')) {
        const file = path.join(ASSET_DIR, pathname.slice('/assets/'.length));
        if (fs.existsSync(file)) {
          res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
          res.end(await fsp.readFile(file));
          return;
        }
      }
      let runtimePath = pathname;
      if (runtimePath === '/runtime/' || runtimePath === '/runtime') runtimePath = '/runtime/index.html';
      if (runtimePath.startsWith('/runtime/')) {
        const file = path.join(RUNTIME_DIR, runtimePath.slice('/runtime/'.length));
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
          res.end(await fsp.readFile(file));
          return;
        }
      }
      res.writeHead(404);
      res.end('not found');
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

async function capture(page, name) {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file });
  console.log(`[runtime-smoke] 截图：${file}`);
}

async function main() {
  if (!fs.existsSync(path.join(RUNTIME_DIR, 'index.html'))) {
    throw new Error('runtime/index.html 未就绪');
  }
  const assets = await prepareAssets();
  if (!assets.bg) throw new Error('无法生成背景图');
  const project = buildGame(assets);
  const { server, port } = await startServer(project);
  const browser = await chromium.launch({
    executablePath: findEdge(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/runtime/index.html?game=/game.json`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(1200);
    await capture(page, 'runtime-title.png');

    const startButton = page.getByRole('button', { name: /开始游戏/ }).first();
    if (await startButton.count()) {
      await startButton.click();
      await page.waitForTimeout(800);
    }
    await capture(page, 'runtime-dialogue.png');

    const stage = page.locator('.vnrt-stage, .vnrt-canvas, canvas').first();
    const box = await stage.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1400);
      await capture(page, 'runtime-scene.png');

      // 场景 → 小游戏（iframe 自动上报 win）
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector('.vnrt-minigame');
      await page.waitForTimeout(600);
      await capture(page, 'runtime-minigame.png');
      await page.waitForSelector('.vnrt-choice', { timeout: 15000 });
      await page.waitForTimeout(500);
      await capture(page, 'runtime-choice.png');

      // 存档菜单
      const menuButton = page.getByRole('button', { name: /菜单/ }).first();
      if (await menuButton.count()) {
        await menuButton.click();
        await page.waitForSelector('.vnrt-menu');
        await page.waitForTimeout(700);
        await capture(page, 'runtime-save-menu.png');
        await page.locator('.vnrt-menu__close').click();
        await page.waitForTimeout(400);
      }

      // 选择 → 视频 → 跳过 → 结局
      await page.locator('.vnrt-choice__btn').first().click();
      await page.waitForSelector('.vnrt-video');
      await page.waitForTimeout(800);
      await capture(page, 'runtime-video.png');
      await page.locator('.vnrt-video__skip').click();
      await page.waitForTimeout(700);
      await capture(page, 'runtime-ending-dialogue.png');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector('.vnrt-ended');
      await page.waitForTimeout(500);
      await capture(page, 'runtime-ended.png');
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (errors.length > 0) {
    console.error('[runtime-smoke] 控制台错误：');
    for (const error of errors) console.error('  -', error);
    process.exitCode = 1;
  } else {
    console.log('[runtime-smoke] 完成，未捕获控制台错误');
  }
}

main().catch((error) => {
  console.error('[runtime-smoke] 失败：', error);
  process.exit(1);
});
