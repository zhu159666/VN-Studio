// 阶段四：时间轴纯逻辑测试（缓动 / 轨道 / 关键帧 / 覆盖求值 / schema）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  addKeyframeToTrack,
  clampTrackValue,
  createTimeline,
  createTrackDraft,
  cubicBezierY,
  easingToPreset,
  evaluateTrack,
  formatTime,
  intensityToBezier,
  listTrackCandidates,
  nextKeyframeTime,
  prevKeyframeTime,
  removeTrackFromTimeline,
  resolveSceneValues,
  updateKeyframeInTrack,
  removeKeyframeFromTrack,
} from '../../editor/src/features/timeline/timelineUtils.js';
import {
  removeTimelineFromProject,
  setTimelineInProject,
  updateTimelineDurationInProject,
} from '../../editor/src/state/timelineMutations.js';
import { createNodeDraft } from '../../editor/src/features/blueprint/blueprintUtils.js';

const require = createRequire(import.meta.url);
const projectStore = require('../../editor/electron/lib/project.cjs');
const schema = require('../../editor/electron/lib/schema.cjs');

function sceneFixture() {
  const project = projectStore.defaultProject({ title: '时间轴测试' });
  const scene = createNodeDraft(project, 'scene', { position: { x: 100, y: 100 } }).node;
  scene.name = '雨夜街道';
  scene.background = { assetId: 'img_bg', fit: 'cover', x: 0.5, y: 0.5, scale: 1, opacity: 1 };
  scene.sprites = [
    { id: 'sp_1', assetId: 'img_sp', x: 0.3, y: 0.6, scale: 1, zIndex: 10, opacity: 0.9 },
  ];
  scene.audio.bgmAssetId = 'aud_bgm';
  scene.audio.volume = 0.8;
  scene.textbox.fontSizePx = 28;
  project.assets.images.push(
    {
      id: 'img_bg', kind: 'image', name: '背景', role: 'background',
      path: 'assets/images/img_bg.png', width: 1280, height: 720, format: 'png',
    },
    {
      id: 'img_sp', kind: 'image', name: '立绘', role: 'sprite',
      path: 'assets/images/img_sp.png', width: 600, height: 900, format: 'png',
    },
  );
  project.assets.audio.push({
    id: 'aud_bgm', kind: 'audio', name: 'BGM', role: 'bgm',
    path: 'assets/audio/aud_bgm.ogg', format: 'ogg', durationMs: 5000,
  });
  project.nodes.push(scene);
  return { project, scene };
}

function timelineWithAllTracks() {
  const { project, scene } = sceneFixture();
  const timeline = createTimeline(scene.id, 5000);
  const drafts = [
    { kind: 'sprite', target: 'sp_1', property: 'x' },
    { kind: 'background', property: 'opacity' },
    { kind: 'audio', property: 'volume' },
    { kind: 'textbox', property: 'fontSizePx' },
  ];
  for (const candidate of drafts) {
    const draft = createTrackDraft({ sceneNode: scene, timeline, ...candidate });
    assert.ok(draft.track, draft.error);
    timeline.tracks.push(draft.track);
  }
  return { project, scene, timeline };
}

test('缓动：预设 / 强度换算 / 立方贝塞尔求值', () => {
  const easeInOutHalf = intensityToBezier('easeInOut', 0.5);
  assert.deepEqual(easeInOutHalf.p1, [0.21, 0]);
  assert.deepEqual(easeInOutHalf.p2, [0.79, 1]);

  const linear = intensityToBezier('linear', 1);
  assert.deepEqual(linear.p1, [0, 0]);
  assert.deepEqual(linear.p2, [1, 1]);

  assert.ok(Math.abs(cubicBezierY([0, 0], [1, 1], 0.5) - 0.5) < 1e-6);
  assert.ok(Math.abs(cubicBezierY([0, 0], [1, 1], 0)) < 1e-9);
  assert.ok(Math.abs(cubicBezierY([0, 0], [1, 1], 1) - 1) < 1e-9);

  const back = easingToPreset(intensityToBezier('easeIn', 0.5));
  assert.equal(back.presetKey, 'easeIn');
  assert.ok(Math.abs(back.intensity - 0.5) < 0.06);
});

test('格式化与数值范围', () => {
  assert.equal(formatTime(0), '00:00.000');
  assert.equal(formatTime(1234), '00:01.234');
  assert.equal(clampTrackValue('opacity', 1.4), 1);
  assert.equal(clampTrackValue('opacity', -0.2), 0);
  assert.equal(clampTrackValue('fontSizePx', 28.6), 29);
  assert.equal(clampTrackValue('x', 0.12345), 0.123);
});

test('轨道草稿使用蓝图静态值作为首个关键帧', () => {
  const { scene } = sceneFixture();
  const timeline = createTimeline(scene.id, 5000);

  const bg = createTrackDraft({ sceneNode: scene, timeline, kind: 'background', property: 'opacity' });
  assert.equal(bg.track.keys[0].value, 1);
  assert.equal(bg.track.keys[0].time, 0);
  assert.equal(bg.track.keys[0].easing.type, 'bezier');

  const sprite = createTrackDraft({ sceneNode: scene, timeline, kind: 'sprite', target: 'sp_1', property: 'opacity' });
  assert.equal(sprite.track.keys[0].value, 0.9);
  assert.equal(sprite.track.target, 'sp_1');

  const audio = createTrackDraft({ sceneNode: scene, timeline, kind: 'audio', property: 'volume' });
  assert.equal(audio.track.keys[0].value, 0.8);

  const textbox = createTrackDraft({ sceneNode: scene, timeline, kind: 'textbox', property: 'fontSizePx' });
  assert.equal(textbox.track.keys[0].value, 28);

  timeline.tracks.push(bg.track);
  assert.match(
    createTrackDraft({ sceneNode: scene, timeline, kind: 'background', property: 'opacity' }).error,
    /已经有轨道/,
  );
  assert.match(
    createTrackDraft({ sceneNode: scene, timeline, kind: 'sprite', target: 'missing', property: 'x' }).error,
    /立绘/,
  );
  assert.match(
    createTrackDraft({ sceneNode: scene, timeline, kind: 'audio', property: 'x' }).error,
    /不能用于/,
  );
});

test('关键帧：排序 / 替换 / 更新 / 删除 / 前后跳转', () => {
  const { scene } = sceneFixture();
  let track = createTrackDraft({ sceneNode: scene, timeline: createTimeline(scene.id), kind: 'textbox', property: 'opacity' }).track;

  track = addKeyframeToTrack(track, 2000, 0.2);
  track = addKeyframeToTrack(track, 800, 0.9);
  assert.deepEqual(track.keys.map((key) => key.time), [0, 800, 2000]);

  track = addKeyframeToTrack(track, 800, 0.1);
  assert.equal(track.keys.find((key) => key.time === 800).value, 0.1);
  assert.equal(track.keys.length, 3);

  track = updateKeyframeInTrack(track, 800, { time: 2400, value: 1.5 });
  assert.deepEqual(track.keys.map((key) => key.time), [0, 2000, 2400]);
  assert.equal(track.keys.find((key) => key.time === 2400).value, 1);

  const eased = intensityToBezier('easeOut', 0.6);
  track = updateKeyframeInTrack(track, 2400, { easing: eased });
  assert.deepEqual(track.keys.find((key) => key.time === 2400).easing, eased);

  assert.equal(prevKeyframeTime(track, 2200), 2000);
  assert.equal(prevKeyframeTime(track, 2000), 0);
  assert.equal(nextKeyframeTime(track, 2000), 2400);
  assert.equal(nextKeyframeTime(track, 2400), null);

  const removed = removeKeyframeFromTrack(track, 2000);
  assert.deepEqual(removed.keys.map((key) => key.time), [0, 2400]);
});

test('轨道求值：首末帧保持、线性插值、缓动插值', () => {
  const linearTrack = {
    kind: 'background', property: 'x', id: 't1',
    keys: [
      { time: 0, value: 0.2, easing: intensityToBezier('linear', 0) },
      { time: 1000, value: 0.8, easing: intensityToBezier('linear', 0) },
    ],
  };
  assert.equal(evaluateTrack(linearTrack, -100), 0.2);
  assert.equal(evaluateTrack(linearTrack, 0), 0.2);
  assert.ok(Math.abs(evaluateTrack(linearTrack, 500) - 0.5) < 1e-6);
  assert.equal(evaluateTrack(linearTrack, 2000), 0.8);

  const curved = {
    ...linearTrack,
    keys: [
      { time: 0, value: 0, easing: intensityToBezier('linear', 0) },
      { time: 1000, value: 1, easing: intensityToBezier('easeIn', 1) },
    ],
  };
  const atQuarter = evaluateTrack(curved, 250);
  assert.ok(atQuarter < 0.25, `easeIn 应在 25% 处慢于线性，实际 ${atQuarter}`);
  assert.ok(atQuarter > 0);
});

test('resolveSceneValues：时间轴覆盖蓝图、未覆盖沿用静态值', () => {
  const { project, scene } = sceneFixture();
  const timeline = createTimeline(scene.id, 4000);
  let xTrack = createTrackDraft({ sceneNode: scene, timeline, kind: 'background', property: 'x' }).track;
  xTrack = addKeyframeToTrack(xTrack, 1000, 0.8);
  timeline.tracks.push(xTrack);
  const withTimeline = setTimelineInProject(project, scene.id, timeline);

  const at0 = resolveSceneValues(withTimeline, scene, 0);
  assert.equal(at0.background.x, 0.5);
  assert.equal(at0.background.opacity, 1);
  assert.deepEqual(at0.overridden.map((item) => item.property), ['x']);

  const at500 = resolveSceneValues(withTimeline, scene, 500);
  assert.ok(Math.abs(at500.background.x - 0.65) < 1e-6);
  assert.equal(at500.background.opacity, 1);

  const withoutTimeline = resolveSceneValues(project, scene, 500);
  assert.equal(withoutTimeline.background.x, 0.5);
});

test('项目级时间轴写入 / 删除 / 时长更新；非 scene 节点被拒绝', () => {
  const { project, scene } = sceneFixture();
  const timeline = createTimeline(scene.id, 3000);
  const next = setTimelineInProject(project, scene.id, timeline);
  assert.equal(next.timelines[scene.id].durationMs, 3000);
  assert.equal(project.timelines[scene.id], undefined, '不应修改原对象');

  const updated = updateTimelineDurationInProject(next, scene.id, 8200);
  assert.equal(updated.timelines[scene.id].durationMs, 8200);

  const removed = removeTimelineFromProject(updated, scene.id);
  assert.equal(removed.timelines[scene.id], undefined);

  const dialogueId = project.nodes[0].id;
  assert.equal(setTimelineInProject(project, dialogueId, timeline), project, '非 scene 节点应拒绝');
});

test('完整时间轴对象通过 schema 校验', () => {
  const { project, scene, timeline } = timelineWithAllTracks();
  const withTimeline = setTimelineInProject(project, scene.id, timeline);
  const result = schema.validateProject(withTimeline);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));

  assert.equal(listTrackCandidates(scene).length, 21); // 1 立绘 ×4 + 背景 4 + 音频 1 + 文本框 7 + 镜头 5
  assert.equal(removeTrackFromTimeline(timeline, timeline.tracks[0].id).tracks.length, 3);
});
