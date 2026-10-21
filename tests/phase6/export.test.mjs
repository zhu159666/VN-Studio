// 阶段六：Web 包导出器测试（结构、文件复制、game.json、校验阻断）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { createNodeDraft } from '../../editor/src/features/blueprint/blueprintUtils.js';
import { createTimeline, createTrackDraft, addKeyframeToTrack } from '../../editor/src/features/timeline/timelineUtils.js';

const require = createRequire(import.meta.url);
const projectStore = require('../../editor/electron/lib/project.cjs');
const schema = require('../../editor/electron/lib/schema.cjs');
const { exportProjectWeb, buildGameJson, RUNTIME_FILES } = require('../../editor/electron/lib/export-web.cjs');

const TMP = path.join(process.cwd(), 'editor', '.tmp-phase6-export');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function makeProject() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const projectDir = path.join(TMP, 'project');
  const created = await projectStore.createProjectInDir(projectDir, { title: '导出测试' });
  const project = created.project;

  for (const dir of ['images', 'audio', 'videos', 'minigames', '.source/images']) {
    fs.mkdirSync(path.join(projectDir, 'assets', dir), { recursive: true });
  }
  fs.writeFileSync(path.join(projectDir, 'assets', 'images', 'bg.png'), TINY_PNG);
  fs.writeFileSync(path.join(projectDir, 'assets', 'images', 'sprite.png'), TINY_PNG);
  fs.writeFileSync(path.join(projectDir, 'assets', 'audio', 'bgm.ogg'), Buffer.from('OggS'));
  fs.writeFileSync(path.join(projectDir, 'assets', 'videos', 'clip.mp4'), Buffer.from('mp4'));
  fs.writeFileSync(
    path.join(projectDir, 'assets', 'minigames', 'mini.html'),
    '<!doctype html><script>window.MINIGAME_EXITS=["win","lose"];parent.postMessage({type:"minigame-result",result:"win"},"*");</script>',
    'utf8',
  );
  fs.writeFileSync(path.join(projectDir, 'assets', '.source', 'images', 'raw.png'), TINY_PNG);

  project.assets.images.push(
    { id: 'img_bg', kind: 'image', name: '背景', role: 'background', path: 'assets/images/bg.png', width: 1, height: 1, format: 'png' },
    { id: 'img_sprite', kind: 'image', name: '立绘', role: 'sprite', path: 'assets/images/sprite.png', width: 1, height: 1, format: 'png' },
  );
  project.assets.audio.push({ id: 'aud_bgm', kind: 'audio', name: 'BGM', role: 'bgm', path: 'assets/audio/bgm.ogg', format: 'ogg', durationMs: 1000 });
  project.assets.videos.push({
    id: 'vid_clip', kind: 'video', name: '视频', path: 'assets/videos/clip.mp4',
    format: 'mp4', durationMs: 1000, width: 640, height: 360, codec: 'h264',
  });
  project.assets.minigames.push({
    id: 'mg_mini', kind: 'minigame', name: '小游戏',
    path: 'assets/minigames/mini.html', declaredExits: ['win', 'lose'], mode: 'blocking',
  });

  const scene = createNodeDraft(project, 'scene', { position: { x: 300, y: 0 } }).node;
  scene.name = '场景';
  scene.background = { assetId: 'img_bg', fit: 'cover', x: 0.5, y: 0.5, scale: 1, opacity: 1 };
  scene.sprites = [{ id: 'sp_1', assetId: 'img_sprite', x: 0.5, y: 0.6, scale: 1, zIndex: 10, opacity: 1 }];
  scene.audio.bgmAssetId = 'aud_bgm';
  const choice = createNodeDraft(project, 'choice', { position: { x: 600, y: 0 } }).node;
  choice.name = '选择';
  const end1 = createNodeDraft(project, 'dialogue', { position: { x: 900, y: 0 } }).node;
  end1.name = '结束 1';
  end1.text = '结束一。';
  const end2 = createNodeDraft(project, 'dialogue', { position: { x: 900, y: 200 } }).node;
  end2.name = '结束 2';
  end2.text = '结束二。';
  const jump = createNodeDraft(project, 'jump', { position: { x: 1200, y: 100 } }).node;
  jump.name = '循环';
  jump.targetNodeId = scene.id;

  project.nodes.push(scene, choice, end1, end2, jump);
  project.edges = [
    { id: 'e1', from: 'n_opening', port: 'next', to: scene.id, kind: 'sequence' },
    { id: 'e2', from: scene.id, port: 'next', to: choice.id, kind: 'sequence' },
    { id: 'e3', from: choice.id, port: 'opt_1', to: end1.id, kind: 'sequence' },
    { id: 'e4', from: choice.id, port: 'opt_2', to: end2.id, kind: 'sequence' },
    { id: 'e5', from: end1.id, port: 'next', to: jump.id, kind: 'sequence' },
    { id: 'e6', from: end2.id, port: 'next', to: jump.id, kind: 'sequence' },
  ];
  project.settings.startNodeId = 'n_opening';
  const timeline = createTimeline(scene.id, 3000);
  const track = createTrackDraft({ sceneNode: scene, timeline, kind: 'background', property: 'opacity' }).track;
  timeline.tracks.push(addKeyframeToTrack(track, 1000, 0.8));
  project.timelines[scene.id] = timeline;
  schema.assertValidProject(project);
  await projectStore.saveProject(created.projectPath, project);
  return { project, projectDir };
}

test('导出 Web 包：runtime 文件 + 四类素材 + game.json，排除 .source，剥离 editor/layout', async () => {
  try {
    const { project, projectDir } = await makeProject();
    const parent = path.join(TMP, 'out');
    fs.mkdirSync(parent, { recursive: true });
    const result = await exportProjectWeb({ project, projectDir, outputParentDir: parent });
    assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
    assert.ok(result.outputDir.startsWith(parent));

    for (const runtimeFile of RUNTIME_FILES) {
      assert.ok(fs.existsSync(path.join(result.outputDir, runtimeFile)), `缺少 ${runtimeFile}`);
    }
    for (const relative of [
      'game.json',
      'assets/images/bg.png',
      'assets/images/sprite.png',
      'assets/audio/bgm.ogg',
      'assets/videos/clip.mp4',
      'assets/minigames/mini.html',
    ]) {
      assert.ok(fs.existsSync(path.join(result.outputDir, relative)), `缺少 ${relative}`);
    }
    assert.equal(fs.existsSync(path.join(result.outputDir, 'assets', '.source')), false, '.source 不应被导出');
    const game = JSON.parse(fs.readFileSync(path.join(result.outputDir, 'game.json'), 'utf8'));
    assert.equal(game.editor, undefined);
    assert.equal(game.layout, undefined);
    assert.equal(game.$schema, undefined);
    assert.equal(schema.validateProject(game).ok, true);
    assert.ok(result.files.length >= RUNTIME_FILES.length + 6);
    assert.ok(result.bytes > 0);

    // 同名导出第二次自动避免覆盖
    const second = await exportProjectWeb({ project, projectDir, outputParentDir: parent });
    assert.equal(second.ok, true);
    assert.notEqual(second.outputDir, result.outputDir);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('导出校验失败时不生成输出目录', async () => {
  try {
    const { project, projectDir } = await makeProject();
    const parent = path.join(TMP, 'out-invalid');
    fs.mkdirSync(parent, { recursive: true });
    const broken = JSON.parse(JSON.stringify(project));
    broken.settings.startNodeId = 'n_missing';
    const result = await exportProjectWeb({ project: broken, projectDir, outputParentDir: parent });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === 'E08' || /起始节点/.test(error.message)));
    assert.equal(fs.readdirSync(parent).length, 0, '校验失败不应留下输出目录');
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('dialogue 无出边视为正常结束，导出不被 E12 阻断', async () => {
  try {
    const { project, projectDir } = await makeProject();
    const terminal = JSON.parse(JSON.stringify(project));
    terminal.edges = terminal.edges.filter((edge) => edge.id !== 'e5' && edge.id !== 'e6');
    const parent = path.join(TMP, 'out-terminal');
    fs.mkdirSync(parent, { recursive: true });
    const result = await exportProjectWeb({ project: terminal, projectDir, outputParentDir: parent });
    assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
    assert.ok(fs.existsSync(path.join(result.outputDir, 'game.json')));
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('buildGameJson 剥离编辑器字段后仍符合 schema，且不修改原对象', () => {
  const project = projectStore.defaultProject({ title: 'game.json' });
  project.layout = { leftWidth: 280 };
  project.editor = { viewport: { x: 0, y: 0, zoom: 1 } };
  const game = buildGameJson(project);
  assert.equal(game.layout, undefined);
  assert.equal(game.editor, undefined);
  assert.equal(game.$schema, undefined);
  assert.equal(schema.validateProject(game).ok, true);
  assert.equal(project.layout.leftWidth, 280, '不应修改入参');
});
