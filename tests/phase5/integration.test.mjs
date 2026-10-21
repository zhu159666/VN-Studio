// 阶段五集成测试：引擎 + 时间轴 + 表达式 + 存档 schema 贯通。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { createEngine } from '../../runtime/engine.js';
import { evaluateExpression } from '../../runtime/expression.js';
import { resolveSceneValues } from '../../runtime/timeline.js';

const require = createRequire(import.meta.url);
const projectStore = require('../../editor/electron/lib/project.cjs');
const schema = require('../../editor/electron/lib/schema.cjs');

function buildProject() {
  const project = projectStore.defaultProject({ title: '运行时集成测试' });
  project.variables = {
    last_minigame_result: { type: 'string', value: '' },
  };

  const scene = {
    id: 'n_scene',
    type: 'scene',
    name: '雨夜街道',
    position: { x: 0, y: 0 },
    exits: [{ id: 'next', name: 'next' }],
    background: { assetId: 'img_bg', fit: 'cover', x: 0.5, y: 0.5, scale: 1, opacity: 1 },
    sprites: [{ id: 'sp_1', assetId: 'img_sp', x: 0.4, y: 0.6, scale: 1, zIndex: 10, opacity: 1 }],
    uiImages: [],
    textbox: {
      x: 0.5, y: 0.84, width: 0.92, height: 0.22, fontSizePx: 28,
      color: '#ffffff', background: '#000000', backgroundOpacity: 0.55, opacity: 1,
    },
    audio: { bgmAssetId: null, volume: 0.8, loop: true, sfx: [] },
    variables: [{ key: 'affection', value: { type: 'number', value: 5 } }],
  };
  const minigame = {
    id: 'n_mini', type: 'minigame', name: '撑伞', position: { x: 320, y: 0 },
    minigameAssetId: 'mg_umbrella',
    exits: [{ id: 'win', name: 'win' }, { id: 'lose', name: 'lose' }],
    defaultExitId: 'lose', timeoutMs: null, instructions: '',
  };
  const condition = {
    id: 'n_condition', type: 'condition', name: '判断', position: { x: 640, y: 0 },
    expression: 'last_minigame_result == "win" && affection >= 5',
    exits: [{ id: 'true', name: 'true' }, { id: 'false', name: 'false' }],
  };
  const success = {
    id: 'n_success', type: 'dialogue', name: '成功', position: { x: 960, y: 0 },
    exits: [{ id: 'next', name: 'next' }], text: '你成功了。', speaker: null,
    portrait: null, voice: null, speedCps: null, autoAdvanceMs: null,
  };
  const fail = {
    id: 'n_fail', type: 'dialogue', name: '失败', position: { x: 960, y: 240 },
    exits: [{ id: 'next', name: 'next' }], text: '再试一次。', speaker: null,
    portrait: null, voice: null, speedCps: null, autoAdvanceMs: null,
  };

  project.nodes.push(scene, minigame, condition, success, fail);
  project.edges = [
    { id: 'e1', from: 'n_opening', port: 'next', to: 'n_scene', kind: 'sequence' },
    { id: 'e2', from: 'n_scene', port: 'next', to: 'n_mini', kind: 'sequence' },
    { id: 'e3', from: 'n_mini', port: 'win', to: 'n_condition', kind: 'sequence' },
    { id: 'e4', from: 'n_mini', port: 'lose', to: 'n_fail', kind: 'sequence' },
    { id: 'e5', from: 'n_condition', port: 'true', to: 'n_success', kind: 'conditional' },
    { id: 'e6', from: 'n_condition', port: 'false', to: 'n_fail', kind: 'conditional' },
  ];
  project.timelines.n_scene = {
    durationMs: 1000,
    loop: false,
    tracks: [
      {
        id: 'trk_bg', kind: 'background', property: 'opacity',
        keys: [
          { time: 0, value: 1, easing: { type: 'bezier', p1: [0, 0], p2: [1, 1] } },
          { time: 1000, value: 0.5, easing: { type: 'bezier', p1: [0.42, 0], p2: [0.58, 1] } },
        ],
      },
    ],
  };
  project.settings.startNodeId = 'n_opening';
  schema.assertValidProject(project);
  return project;
}

test('引擎 + 时间轴 + 条件 + 小游戏 + 存档 schema 贯通', () => {
  const project = buildProject();
  const engine = createEngine({ project, autoStart: true });
  assert.equal(engine.status, 'running');
  assert.equal(engine.getRenderState().nodeType, 'dialogue');

  engine.advance();
  assert.equal(engine.getRenderState().nodeType, 'scene');
  engine.tick(500);
  const values = resolveSceneValues(project, engine.getCurrentNode(), engine.stage.timeMs);
  assert.ok(Math.abs(values.background.opacity - 0.75) < 0.01);

  engine.advance();
  assert.equal(engine.getRenderState().nodeType, 'minigame');
  const submitted = engine.submitMinigameResult('win');
  assert.equal(submitted.ok, true);
  assert.equal(submitted.matched, true);
  // 条件节点会自动求值并继续推进
  const state = engine.getRenderState();
  assert.equal(state.nodeType, 'dialogue');
  assert.equal(state.dialogue.text, '你成功了。');
  assert.equal(engine.variables.affection.value, 5, '场景变量只在缺失时初始化');

  const save = engine.serialize({
    kind: 'manual',
    slot: 1,
    projectTitle: project.meta.title,
    thumbnailDataUrl: null,
  });
  const validation = schema.validateSaveState(save);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
  assert.equal(save.variables.last_minigame_result.value, 'win');

  // 读档恢复到同一节点/变量/舞台时间
  const restored = createEngine({ project, autoStart: false });
  const loaded = restored.loadSave(save);
  assert.equal(loaded.ok, true, loaded.error);
  assert.equal(restored.nodeId, save.nodeId);
  assert.equal(restored.variables.last_minigame_result.value, 'win');
  assert.equal(restored.stage.sceneNodeId, 'n_scene');
  assert.equal(Math.round(restored.stage.timeMs), Math.round(save.timeline.timeMs));

  // 最后一幕无出边 → 正常结束
  restored.advance();
  assert.equal(restored.status, 'ended');
});

test('表达式与变量类型系统的运行时集成', () => {
  assert.deepEqual(evaluateExpression('affection >= 5 && last_minigame_result == "win"', {
    affection: 5,
    last_minigame_result: 'win',
  }), { ok: true, value: true });

  const bad = evaluateExpression('unknown_var == 1', {});
  assert.equal(bad.ok, false);
  assert.match(bad.error, /未知标识符/);

  assert.deepEqual(evaluateExpression('"buy" in ["buy", "wait"]', {}), { ok: true, value: true });
});
