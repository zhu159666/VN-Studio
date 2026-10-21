'use strict';

// smoke 模式：在 editor/.smoke/ 下生成一个带真实素材文件的项目，用于自动截图验收。
// 不参与正常启动路径。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const paths = require('./paths.cjs');
const projectStore = require('./project.cjs');
const schema = require('./schema.cjs');
const media = require('./media.cjs');

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return undefined;
  }
}

async function tryFfmpeg(args) {
  try {
    await media.runFfmpeg(args, { timeoutMs: 60000 });
    return true;
  } catch (error) {
    console.warn('[smoke] ffmpeg 失败：', error.message);
    return false;
  }
}

async function createSmokeProject() {
  // 本环境 ffmpeg 不能写系统临时目录，统一放工作区 editor/.smoke/ 下。
  const base = path.join(paths.repoRoot(), 'editor', '.smoke', `smoke-project-${Date.now()}`);
  await fsp.rm(base, { recursive: true, force: true });
  await fsp.mkdir(base, { recursive: true });
  const dirs = paths.ensureProjectDirs(base);
  const created = await projectStore.createProjectInDir(base, {
    title: 'Smoke 测试项目',
    resolution: { width: 1280, height: 720 },
  });
  const project = created.project;

  const ffmpegOk = media.isFfmpegAvailable();
  const warnings = [];

  const bgFinal = path.join(dirs.images, 'img_smoke_bg.png');
  const spriteFinal = path.join(dirs.images, 'img_smoke_sprite.png');
  const bgSource = path.join(dirs.sourceImages, 'img_smoke_bg.png');
  const spriteSource = path.join(dirs.sourceImages, 'img_smoke_sprite.png');
  const audioFinal = path.join(dirs.audio, 'aud_smoke_bgm.ogg');
  const audioSource = path.join(dirs.sourceAudio, 'aud_smoke_bgm.ogg');
  const videoFinal = path.join(dirs.videos, 'vid_smoke_clip.mp4');
  const minigameFinal = path.join(dirs.minigames, 'mg_smoke_demo.html');

  if (ffmpegOk) {
    const bgOk = await tryFfmpeg([
      '-y', '-f', 'lavfi', '-i', 'color=c=0x22384f:s=1280x720', '-frames:v', '1', bgFinal,
    ]);
    const spriteOk = await tryFfmpeg([
      '-y', '-f', 'lavfi', '-i', 'color=c=0xe0a070:s=600x900', '-frames:v', '1', spriteFinal,
    ]);
    const audioOk = await tryFfmpeg([
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:a', 'libvorbis', '-q:a', '5', audioFinal,
    ]);
    if (!bgOk || !spriteOk) warnings.push('smoke 背景/立绘生成失败');
    if (!audioOk) warnings.push('smoke 音频生成失败');
    if (bgOk) fs.copyFileSync(bgFinal, bgSource);
    if (spriteOk) fs.copyFileSync(spriteFinal, spriteSource);
    if (audioOk) fs.copyFileSync(audioFinal, audioSource);

    await tryFfmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0x334a66:s=640x360:d=2:r=24',
      '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      videoFinal,
    ]);
  } else {
    warnings.push('未检测到 ffmpeg，smoke 素材仅包含小游戏');
  }

  const minigameHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Smoke 小游戏</title>
<style>body{font-family:sans-serif;background:#15202b;color:#e7edf3;display:grid;place-items:center;height:100vh;margin:0}button{margin:8px;padding:10px 22px;font-size:16px;border-radius:8px;border:1px solid #5aa9ff;background:#1f3140;color:#e7edf3;cursor:pointer}</style></head>
<body><main><h1>Smoke 小游戏</h1><p>点击按钮上报结果</p>
<button id="win">Win</button><button id="lose">Lose</button></main>
<script>window.MINIGAME_EXITS = ["win", "lose"];
function report(result){ parent.postMessage({ type: "minigame-result", result: result }, "*"); }
document.getElementById("win").addEventListener("click", function(){ report("win"); });
document.getElementById("lose").addEventListener("click", function(){ report("lose"); });
</script></body></html>`;
  await fsp.writeFile(minigameFinal, minigameHtml, 'utf8');

  const now = new Date().toISOString();
  const images = [];
  if (fs.existsSync(bgFinal)) {
    images.push({
      id: 'img_smoke_bg', kind: 'image', name: 'smoke 背景', role: 'background',
      path: 'assets/images/img_smoke_bg.png', width: 1280, height: 720, format: 'png',
      sizeBytes: sizeOf(bgFinal), importedAt: now,
      edit: { crop: null, removeBackground: null, adjustments: { brightness: 0, contrast: 0 } },
      source: { path: 'assets/.source/images/img_smoke_bg.png', format: 'png', width: 1280, height: 720, sizeBytes: sizeOf(bgSource) },
    });
  }
  if (fs.existsSync(spriteFinal)) {
    images.push({
      id: 'img_smoke_sprite', kind: 'image', name: 'smoke 立绘', role: 'sprite',
      path: 'assets/images/img_smoke_sprite.png', width: 600, height: 900, format: 'png',
      sizeBytes: sizeOf(spriteFinal), importedAt: now,
      edit: { crop: null, removeBackground: null, adjustments: { brightness: 0, contrast: 0 } },
      source: { path: 'assets/.source/images/img_smoke_sprite.png', format: 'png', width: 600, height: 900, sizeBytes: sizeOf(spriteSource) },
    });
  }

  const audio = [];
  if (fs.existsSync(audioFinal)) {
    audio.push({
      id: 'aud_smoke_bgm', kind: 'audio', name: 'smoke BGM', role: 'bgm',
      path: 'assets/audio/aud_smoke_bgm.ogg', format: 'ogg', durationMs: 2000,
      sizeBytes: sizeOf(audioFinal), importedAt: now, trim: null, gainDb: 0, loop: true,
      source: { path: 'assets/.source/audio/aud_smoke_bgm.ogg', format: 'ogg', durationMs: 2000, sizeBytes: sizeOf(audioSource) },
    });
  }

  const videos = [];
  if (fs.existsSync(videoFinal)) {
    videos.push({
      id: 'vid_smoke_clip', kind: 'video', name: 'smoke 视频',
      path: 'assets/videos/vid_smoke_clip.mp4', format: 'mp4', durationMs: 2000,
      width: 640, height: 360, codec: 'h264', hasAudio: true,
      sizeBytes: sizeOf(videoFinal), importedAt: now,
    });
  }

  const minigames = [
    {
      id: 'mg_smoke_demo', kind: 'minigame', name: 'smoke 小游戏',
      path: 'assets/minigames/mg_smoke_demo.html',
      declaredExits: ['win', 'lose'], mode: 'blocking',
      sizeBytes: sizeOf(minigameFinal), importedAt: now,
    },
  ];

  project.assets = { images, audio, videos, minigames };
  project.variables = {
    money: { type: 'number', value: 120 },
    player_name: { type: 'string', value: '林' },
    has_umbrella: { type: 'boolean', value: false },
    inventory: { type: 'array', value: ['ticket'] },
    flags: { type: 'object', value: { chapter: 1 } },
    last_seen_ending: { type: 'null', value: null },
    last_minigame_result: { type: 'string', value: '' },
  };
  project.meta.description = '自动生成：用于阶段二截图验收。';
  project.layout = {
    ...project.layout,
    assetView: 'grid',
    assetTypeFilter: 'all',
    leftBottomPanel: 'variables',
  };
  project.editor = {
    ...project.editor,
    selectedAssetId: images[0]?.id ?? null,
  };

  schema.assertValidProject(project);
  const saved = await projectStore.saveProject(created.projectPath, project);

  return {
    project: saved.project,
    projectPath: saved.projectPath,
    projectDir: saved.projectDir,
    tempRoot: base,
    assetIds: {
      image: images[0]?.id ?? null,
      audio: audio[0]?.id ?? null,
      video: videos[0]?.id ?? null,
      minigame: minigames[0]?.id ?? null,
    },
    warnings,
  };
}

module.exports = { createSmokeProject };
