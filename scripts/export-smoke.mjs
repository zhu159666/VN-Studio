#!/usr/bin/env node
// 阶段六导出冒烟：生成含真实素材的项目 → 导出 Web 包 → 静态服务导出包 → Edge headless 验证。
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
const { exportProjectWeb } = require('../editor/electron/lib/export-web.cjs');
const { createNodeDraft } = await import('../editor/src/features/blueprint/blueprintUtils.js');
const { createTimeline, createTrackDraft, addKeyframeToTrack } = await import(
  '../editor/src/features/timeline/timelineUtils.js'
);

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'editor', '.smoke');
const WORK_DIR = path.join(OUT_DIR, 'export-smoke');
const PROJECT_DIR = path.join(WORK_DIR, 'project');
const OUTPUT_PARENT = path.join(WORK_DIR, 'output');

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
    console.warn('[export-smoke] ffmpeg 失败：', error.message);
    return false;
  }
}

function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
}

async function prepareProject() {
  await fsp.rm(WORK_DIR, { recursive: true, force: true });
  await fsp.mkdir(path.join(PROJECT_DIR, 'assets', 'images'), { recursive: true });
  await fsp.mkdir(path.join(PROJECT_DIR, 'assets', 'audio'), { recursive: true });
  await fsp.mkdir(path.join(PROJECT_DIR, 'assets', 'videos'), { recursive: true });
  await fsp.mkdir(path.join(PROJECT_DIR, 'assets', 'minigames'), { recursive: true });
  await fsp.mkdir(path.join(PROJECT_DIR, 'assets', '.source', 'images'), { recursive: true });
  await fsp.mkdir(OUTPUT_PARENT, { recursive: true });

  const created = await projectStore.createProjectInDir(PROJECT_DIR, {
    title: '导出冒烟项目',
    resolution: { width: 1280, height: 720 },
  });
  const project = created.project;
  project.meta.author = 'Smoke';

  const bgFile = path.join(PROJECT_DIR, 'assets', 'images', 'bg.png');
  const spriteFile = path.join(PROJECT_DIR, 'assets', 'images', 'sprite.png');
  const audioFile = path.join(PROJECT_DIR, 'assets', 'audio', 'bgm.ogg');
  const videoFile = path.join(PROJECT_DIR, 'assets', 'videos', 'clip.mp4');
  const minigameFile = path.join(PROJECT_DIR, 'assets', 'minigames', 'mini.html');

  const bgOk = tryFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x27405a:s=1280x720', '-frames:v', '1', bgFile]);
  const spriteOk = tryFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0xe0a070:s=420x620', '-frames:v', '1', spriteFile]);
  const audioOk = tryFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libvorbis', '-q:a', '5', audioFile,
  ]);
  const videoOk = tryFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'color=c=0x664422:s=640x360:d=2:r=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoFile,
  ]);
  if (!bgOk) fs.writeFileSync(bgFile, tinyPng());
  if (!spriteOk) fs.writeFileSync(spriteFile, tinyPng());
  if (!audioOk) fs.writeFileSync(audioFile, Buffer.from('OggS-smoke', 'utf8'));
  if (!videoOk) fs.writeFileSync(videoFile, Buffer.from('smoke-mp4', 'utf8'));
  fs.writeFileSync(
    minigameFile,
    '<!doctype html><script>window.MINIGAME_EXITS=["win","lose"];parent.postMessage({type:"minigame-result",result:"win"},"*");</script>',
    'utf8',
  );
  fs.writeFileSync(path.join(PROJECT_DIR, 'assets', '.source', 'images', 'raw.png'), tinyPng());

  project.assets.images.push(
    {
      id: 'img_bg', kind: 'image', name: '背景', role: 'background',
      path: 'assets/images/bg.png', width: 1280, height: 720, format: 'png',
    },
    {
      id: 'img_sprite', kind: 'image', name: '立绘', role: 'sprite',
      path: 'assets/images/sprite.png', width: 420, height: 620, format: 'png',
    },
  );
  project.assets.audio.push({
    id: 'aud_bgm', kind: 'audio', name: 'BGM', role: 'bgm',
    path: 'assets/audio/bgm.ogg', format: 'ogg', durationMs: 2000,
  });
  project.assets.videos.push({
    id: 'vid_clip', kind: 'video', name: '视频',
    path: 'assets/videos/clip.mp4', format: 'mp4', durationMs: 2000,
    width: 640, height: 360, codec: 'h264',
  });
  project.assets.minigames.push({
    id: 'mg_mini', kind: 'minigame', name: '小游戏',
    path: 'assets/minigames/mini.html', declaredExits: ['win', 'lose'], mode: 'blocking',
  });

  const scene = createNodeDraft(project, 'scene', { position: { x: 320, y: 0 } }).node;
  scene.name = '雨夜街道';
  scene.background = { assetId: 'img_bg', fit: 'cover', x: 0.5, y: 0.5, scale: 1, opacity: 1 };
  scene.sprites = [{ id: 'sp_1', assetId: 'img_sprite', x: 0.5, y: 0.62, scale: 1, zIndex: 10, opacity: 1 }];
  scene.audio.bgmAssetId = 'aud_bgm';
  scene.audio.volume = 0.6;
  scene.textbox = {
    x: 0.5, y: 0.84, width: 0.92, height: 0.22, fontSizePx: 30,
    color: '#ffffff', background: '#000000', backgroundOpacity: 0.55, opacity: 1,
  };

  const choice = createNodeDraft(project, 'choice', { position: { x: 620, y: 0 } }).node;
  choice.name = '要买伞吗';
  choice.prompt = '雨越下越大。';
  choice.exits = [{ id: 'buy', name: '买一把伞' }, { id: 'wait', name: '等雨停' }];

  const end1 = createNodeDraft(project, 'dialogue', { position: { x: 900, y: 0 } }).node;
  end1.name = '买伞';
  end1.text = '你买了一把伞。';
  const end2 = createNodeDraft(project, 'dialogue', { position: { x: 900, y: 200 } }).node;
  end2.name = '等雨';
  end2.text = '雨渐渐停了。';
  const jump = createNodeDraft(project, 'jump', { position: { x: 1180, y: 100 } }).node;
  jump.name = '回到街道';
  jump.targetNodeId = scene.id;

  project.nodes.push(scene, choice, end1, end2, jump);
  project.edges = [
    { id: 'e1', from: 'n_opening', port: 'next', to: scene.id, kind: 'sequence' },
    { id: 'e2', from: scene.id, port: 'next', to: choice.id, kind: 'sequence' },
    { id: 'e3', from: choice.id, port: 'buy', to: end1.id, kind: 'sequence' },
    { id: 'e4', from: choice.id, port: 'wait', to: end2.id, kind: 'sequence' },
    { id: 'e5', from: end1.id, port: 'next', to: jump.id, kind: 'sequence' },
    { id: 'e6', from: end2.id, port: 'next', to: jump.id, kind: 'sequence' },
  ];
  project.settings.startNodeId = 'n_opening';
  project.nodes[0].text = '雨还在下。';

  const timeline = createTimeline(scene.id, 4000);
  const bgTrack = createTrackDraft({ sceneNode: scene, timeline, kind: 'background', property: 'opacity' }).track;
  timeline.tracks.push(addKeyframeToTrack(bgTrack, 1500, 0.8));
  project.timelines[scene.id] = timeline;

  schema.assertValidProject(project);
  await projectStore.saveProject(created.projectPath, project);
  return { project: JSON.parse(fs.readFileSync(created.projectPath, 'utf8')), projectDir: PROJECT_DIR };
}

async function startServer(rootDir) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.json': 'application/json; charset=utf-8',
  };
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.join(rootDir, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(await fsp.readFile(file));
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

async function capture(page, name) {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file });
  console.log(`[export-smoke] 截图：${file}`);
}

async function main() {
  const { project, projectDir } = await prepareProject();
  const result = await exportProjectWeb({
    project,
    projectDir,
    outputParentDir: OUTPUT_PARENT,
  });
  if (!result.ok) {
    console.error('[export-smoke] 导出失败：', result.errors);
    process.exit(1);
  }
  console.log(`[export-smoke] 导出完成：${result.outputDir}（${result.files.length} 文件，${result.bytes} 字节，${result.warnings.length} 警告）`);

  const required = [
    'index.html',
    'game.json',
    'runtime.js',
    'engine.js',
    'expression.js',
    'timeline.js',
    'storage.js',
    'runtime.css',
    'assets/images/bg.png',
    'assets/images/sprite.png',
    'assets/audio/bgm.ogg',
    'assets/videos/clip.mp4',
    'assets/minigames/mini.html',
  ];
  for (const relative of required) {
    if (!fs.existsSync(path.join(result.outputDir, relative))) {
      console.error(`[export-smoke] 缺少导出文件：${relative}`);
      process.exit(1);
    }
  }
  if (fs.existsSync(path.join(result.outputDir, 'assets', '.source'))) {
    console.error('[export-smoke] 导出包不应包含 assets/.source/');
    process.exit(1);
  }
  const game = JSON.parse(await fsp.readFile(path.join(result.outputDir, 'game.json'), 'utf8'));
  if (game.editor || game.layout || game.$schema) {
    console.error('[export-smoke] game.json 应去掉 editor/layout/$schema');
    process.exit(1);
  }
  const validation = schema.validateProject(game);
  if (!validation.ok) {
    console.error('[export-smoke] 导出 game.json 不符合 schema', validation.errors);
    process.exit(1);
  }

  const { server, port } = await startServer(result.outputDir);
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
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await capture(page, 'export-title.png');
    const start = page.getByRole('button', { name: /开始游戏/ }).first();
    if (await start.count()) await start.click();
    await page.waitForTimeout(900);
    await capture(page, 'export-dialogue.png');
    const stage = page.locator('.vnrt-stage, canvas').first();
    const box = await stage.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1400);
      await capture(page, 'export-scene.png');
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (errors.length > 0) {
    console.error('[export-smoke] 控制台错误：');
    for (const error of errors) console.error('  -', error);
    process.exitCode = 1;
  } else {
    console.log('[export-smoke] 完成，未捕获控制台错误');
  }
}

main().catch((error) => {
  console.error('[export-smoke] 失败：', error);
  process.exit(1);
});
