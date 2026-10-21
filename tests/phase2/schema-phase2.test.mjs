// 阶段二 schema 增量测试：source / label / uiImages / audio.sfx。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectStore = require('../../editor/electron/lib/project.cjs');
const schema = require('../../editor/electron/lib/schema.cjs');

function baseProject() {
  return projectStore.defaultProject({ title: '阶段二 schema 测试' });
}

function sceneNode() {
  return {
    id: 'n_scene',
    type: 'scene',
    name: '场景',
    position: { x: 200, y: 100 },
    exits: [{ id: 'next', name: 'next' }],
    background: null,
    sprites: [],
    uiImages: [
      { id: 'ui_hud', assetId: 'img_ui_hud', x: 0.5, y: 0.5, scale: 1, zIndex: 100, opacity: 0.9 },
    ],
    textbox: {
      x: 0.5,
      y: 0.84,
      width: 0.92,
      height: 0.22,
      fontSizePx: 28,
      color: '#ffffff',
      background: '#000000',
      backgroundOpacity: 0.55,
      opacity: 1,
    },
    audio: {
      bgmAssetId: null,
      volume: 0.6,
      loop: true,
      sfx: [{ assetId: 'aud_sfx_click', volume: 0.8, loop: false }],
    },
    variables: [],
  };
}

test('scene.uiImages 与 audio.sfx 结构被接受', () => {
  const project = baseProject();
  project.nodes.push(sceneNode());
  project.assets.images.push({
    id: 'img_ui_hud', kind: 'image', name: 'HUD', role: 'ui',
    path: 'assets/images/img_ui_hud.png', width: 64, height: 64, format: 'png',
  });
  project.assets.audio.push({
    id: 'aud_sfx_click', kind: 'audio', name: '点击', role: 'sfx',
    path: 'assets/audio/aud_sfx_click.ogg', format: 'ogg', durationMs: 300,
  });
  const result = schema.validateProject(project);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
});

test('uiImages / sfx 结构非法时被拒绝', () => {
  const project = baseProject();
  const scene = sceneNode();
  delete scene.uiImages[0].opacity;
  project.nodes.push(scene);
  assert.equal(schema.validateProject(project).ok, false, 'uiImages 缺 opacity 应被拒绝');

  const project2 = baseProject();
  const scene2 = sceneNode();
  scene2.audio.sfx = [{ assetId: '../evil' }];
  project2.nodes.push(scene2);
  assert.equal(schema.validateProject(project2).ok, false, 'sfx.assetId 非法应被拒绝');

  const project3 = baseProject();
  const scene3 = sceneNode();
  scene3.audio.sfx = { assetId: 'aud_sfx_click' };
  project3.nodes.push(scene3);
  assert.equal(schema.validateProject(project3).ok, false, 'sfx 必须是数组');

  const project4 = baseProject();
  project4.nodes.push(scene3);
  project4.nodes[project4.nodes.length - 1] = sceneNode();
  assert.equal(schema.validateProject(project4).ok, true, '未改动的场景应合法');
});

test('固定出口 / 通用出口允许可选 label，类型错误被拒绝', () => {
  const project = baseProject();
  project.nodes[0].exits[0].label = '继续';
  assert.equal(schema.validateProject(project).ok, true, 'label 字符串应被接受');

  const project2 = baseProject();
  project2.nodes[0].exits[0].label = 42;
  assert.equal(schema.validateProject(project2).ok, false, 'label 必须是字符串');

  const project3 = baseProject();
  project3.nodes.push({
    id: 'n_choice',
    type: 'choice',
    name: '选项',
    position: { x: 300, y: 0 },
    exits: [
      { id: 'a', name: '选项 A', label: '去左边' },
      { id: 'b', name: '选项 B' },
    ],
  });
  assert.equal(schema.validateProject(project3).ok, true, 'choice 出口 label 应被接受');
});
