// 立绘动画模板 → 时间轴关键帧纯逻辑测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  SPRITE_ANIMATIONS,
  applySpriteAnimationToTimeline,
  buildSpriteAnimationTracks,
} from '../../editor/src/features/timeline/spriteAnimations.js';

const require = createRequire(import.meta.url);
const projectStore = require('../../editor/electron/lib/project.cjs');
const schema = require('../../editor/electron/lib/schema.cjs');

const ITEM = { id: 'sp_1', x: 0.5, y: 0.7, scale: 1.1 };

test('6 个立绘动画模板都能生成合法的关键帧轨道', () => {
  assert.equal(SPRITE_ANIMATIONS.length, 6);
  for (const preset of SPRITE_ANIMATIONS) {
    const tracks = buildSpriteAnimationTracks(preset.key, ITEM);
    assert.ok(tracks.length > 0, preset.key);
    for (const track of tracks) {
      assert.ok(['x', 'y', 'scale', 'opacity'].includes(track.property));
      assert.ok(track.keys.length >= 2);
      for (const key of track.keys) {
        assert.equal(Number.isInteger(key.time), true);
        assert.ok(key.time >= 0);
        assert.ok(key.easing && key.easing.type === 'bezier');
      }
      assert.deepEqual(
        track.keys.map((key) => key.time),
        [...track.keys.map((key) => key.time)].sort((a, b) => a - b),
      );
    }
  }
});

test('应用模板会创建/扩展时间轴，重复应用只替换对应轨道', () => {
  const project = projectStore.defaultProject({ title: 'anim' });
  const scene = project.nodes[0];
  scene.type = 'scene';
  scene.background = null;
  scene.sprites = [{ ...ITEM, assetId: 'img_x', zIndex: 10, opacity: 1 }];
  project.settings.resolution = { width: 1280, height: 720 };
  // 以合法场景节点为基础验证时间轴
  const sceneNode = {
    id: 's_anim',
    type: 'scene',
    name: '动画场景',
    position: { x: 0, y: 0 },
    exits: [{ id: 'next', name: 'next' }],
    background: null,
    sprites: [{ ...ITEM, assetId: 'img_x', zIndex: 10, opacity: 1 }],
    uiImages: [],
    textbox: { x: 0.5, y: 0.84, width: 0.86, height: 0.2, fontSizePx: 28, color: '#fff', background: '#000', backgroundOpacity: 0.6, opacity: 1 },
    audio: { bgmAssetId: null, volume: 1, loop: true, sfx: [] },
    variables: [],
  };
  project.nodes = [sceneNode];
  project.edges = [];
  project.settings.startNodeId = sceneNode.id;

  let timeline = applySpriteAnimationToTimeline(null, sceneNode.sprites[0], 'fadeIn');
  assert.ok(timeline.tracks.length >= 1);
  const opacityTrack = timeline.tracks.find((track) => track.property === 'opacity');
  assert.equal(opacityTrack.target, 'sp_1');
  assert.equal(opacityTrack.keys[0].value, 0);
  assert.equal(opacityTrack.keys.at(-1).value, 1);

  const fadeTrackId = opacityTrack.id;
  timeline = applySpriteAnimationToTimeline(timeline, sceneNode.sprites[0], 'slideInLeft');
  assert.equal(timeline.tracks.filter((track) => track.property === 'opacity').length, 1);
  assert.equal(timeline.tracks.find((track) => track.property === 'opacity').id, fadeTrackId);
  assert.ok(timeline.tracks.some((track) => track.property === 'x'));
  assert.ok(timeline.durationMs >= 900);

  const full = { ...project, timelines: { [sceneNode.id]: timeline } };
  assert.equal(schema.validateProject(full).ok, true, JSON.stringify(schema.validateProject(full).errors?.slice(0, 4)));
});

test('未知模板不修改时间轴', () => {
  const timeline = { durationMs: 5000, loop: false, tracks: [] };
  assert.equal(applySpriteAnimationToTimeline(timeline, ITEM, 'nope'), timeline);
});
