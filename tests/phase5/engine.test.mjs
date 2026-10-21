// 阶段五：运行时引擎测试（含时间轴求值的运行时视角）。
// 用一份手写 project（8 类节点 / edges / scene 全套字段 / timeline 四类轨道）覆盖：
// 自动链、可交互节点推进、变量操作、小游戏、视频、tick 与时间轴、渲染状态、存档序列化与恢复。
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { createEngine, ENGINE_STATUS } from '../../runtime/engine.js';
import {
  DEFAULT_TEXTBOX,
  cubicBezierY,
  evaluateTrack,
  getTimeline,
  resolveSceneValues,
  sampleTimeline,
} from '../../runtime/timeline.js';

/* 测试期间静音 console.warn，但保留调用记录用于断言「warning 同时 console.warn」。 */
const originalWarn = console.warn;
const warnLog = [];
console.warn = (...args) => {
  warnLog.push(args.map((item) => String(item)).join(' '));
};
beforeEach(() => {
  warnLog.length = 0;
});
after(() => {
  console.warn = originalWarn;
});

/* 用项目自带 schema 的 $defs.saveState 校验存档形状（与编辑器/Web 共用同一份权威结构）。 */
const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020');
const projectSchema = require('../../schema/schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
ajv.compile(projectSchema);
const validateSaveState = ajv.compile({ $ref: `${projectSchema.$id}#/$defs/saveState` });

/* ------------------------------------------------------------------ */
/* 测试项目 fixture                                                    */
/* ------------------------------------------------------------------ */

const LINEAR = { type: 'bezier', p1: [0, 0], p2: [1, 1] };
const EASE_IN_OUT = { type: 'bezier', p1: [0.42, 0], p2: [0.58, 1] };

function makeProject() {
  return {
    schemaVersion: 1,
    meta: { id: 'proj_phase5', title: '阶段五测试项目', author: '测试' },
    settings: {
      startNodeId: 'n_jump',
      resolution: { width: 1280, height: 720 },
      backgroundColor: '#101418',
      textSpeedCps: 45,
      runtime: { defaultMinigameTimeoutMs: 30000 },
    },
    assets: {
      images: [
        { id: 'img_bg', kind: 'image', name: '雨夜背景', role: 'background', path: 'assets/images/img_bg.png', width: 1280, height: 720, format: 'png' },
        { id: 'img_sp', kind: 'image', name: '立绘', role: 'sprite', path: 'assets/images/img_sp.png', width: 600, height: 900, format: 'png' },
        { id: 'img_ui', kind: 'image', name: 'UI', role: 'ui', path: 'assets/images/img_ui.png', width: 200, height: 80, format: 'png' },
      ],
      audio: [
        { id: 'aud_bgm', kind: 'audio', name: '雨声', role: 'bgm', path: 'assets/audio/aud_bgm.ogg', format: 'ogg', durationMs: 60000 },
      ],
      videos: [
        { id: 'vid_1', kind: 'video', name: '片头', path: 'assets/videos/vid_1.mp4', format: 'mp4', durationMs: 5000 },
      ],
      minigames: [
        { id: 'mg_1', kind: 'minigame', name: '接伞小游戏', path: 'assets/minigames/mg_1.html', declaredExits: ['win', 'lose'] },
      ],
    },
    variables: {
      money: { type: 'number', value: 120 },
      score: { type: 'number', value: 0 },
      flag: { type: 'boolean', value: false },
      inventory: { type: 'array', value: ['umbrella'] },
      run_stats: { type: 'object', value: { loop: 2 } },
      last_minigame_result: { type: 'string', value: 'idle' },
    },
    nodes: [
      {
        id: 'n_jump', type: 'jump', name: '入口跳转', position: { x: 0, y: 0 },
        exits: [], targetNodeId: 'n_cond',
      },
      {
        id: 'n_cond', type: 'condition', name: '钱够吗', position: { x: 100, y: 0 },
        expression: 'money >= 100',
        exits: [
          { id: 'true', name: 'true' },
          { id: 'false', name: 'false' },
        ],
      },
      {
        id: 'n_var', type: 'variable', name: '结算', position: { x: 200, y: 0 },
        exits: [{ id: 'next', name: 'next' }],
        assignments: [
          { key: 'money', op: 'subtract', value: { type: 'number', value: 20 } },
          { key: 'score', op: 'add', value: { type: 'number', value: 5 } },
          { key: 'flag', op: 'toggle' },
          { key: 'inventory', op: 'push', value: { type: 'string', value: 'ticket' } },
          { key: 'tag', op: 'set', value: { type: 'string', value: 'veteran' } },
        ],
      },
      {
        id: 'n_scene', type: 'scene', name: '雨夜街道', position: { x: 300, y: 0 },
        exits: [{ id: 'next', name: 'next' }],
        background: { assetId: 'img_bg', fit: 'cover', x: 0.5, y: 0.5, scale: 1, opacity: 1 },
        sprites: [{ id: 'sp_me', assetId: 'img_sp', x: 0.3, y: 0.6, scale: 1, zIndex: 10, opacity: 1 }],
        uiImages: [{ id: 'ui_hp', assetId: 'img_ui', x: 0.12, y: 0.1, scale: 1, zIndex: 5, opacity: 0.9 }],
        textbox: {
          x: 0.5, y: 0.84, width: 0.92, height: 0.22, fontSizePx: 28,
          color: '#ffffff', background: '#000000', backgroundOpacity: 0.55, opacity: 1,
        },
        audio: { bgmAssetId: 'aud_bgm', volume: 0.8, loop: true },
        variables: [
          { key: 'met_clerk', value: { type: 'boolean', value: true } },
          { key: 'money', value: { type: 'number', value: 42 } },
        ],
      },
      {
        id: 'n_dlg', type: 'dialogue', name: '店员台词', position: { x: 400, y: 0 },
        exits: [{ id: 'next', name: 'next' }],
        text: '雨下大了，要伞吗？',
        speaker: '林',
        portrait: { assetId: 'img_sp', x: 0.82, y: 0.92, scale: 1 },
        voice: null,
        speedCps: null,
        autoAdvanceMs: null,
      },
      {
        id: 'n_choice', type: 'choice', name: '去哪边', position: { x: 500, y: 0 },
        prompt: '走哪边？',
        exits: [
          { id: 'rain', name: '雨中' },
          { id: 'shop', name: '商店' },
        ],
      },
      {
        id: 'n_mg', type: 'minigame', name: '接伞', position: { x: 600, y: 0 },
        minigameAssetId: 'mg_1',
        exits: [
          { id: 'ex_win', name: 'win' },
          { id: 'ex_lose', name: 'lose' },
        ],
        defaultExitId: 'ex_lose',
        timeoutMs: null,
        instructions: '按方向键接住雨伞',
      },
      {
        id: 'n_cond_mg', type: 'condition', name: '小游戏结果判断', position: { x: 700, y: 0 },
        expression: 'last_minigame_result == "win"',
        exits: [
          { id: 'true', name: 'true' },
          { id: 'false', name: 'false' },
        ],
      },
      {
        id: 'n_video', type: 'video', name: '片头视频', position: { x: 600, y: 100 },
        videoAssetId: 'vid_1',
        exits: [
          { id: 'completed', name: 'completed' },
          { id: 'skipped', name: 'skipped' },
        ],
        volume: 0.8,
        loop: false,
        showSkipButton: true,
        skipAfterMs: 1000,
      },
      {
        id: 'n_end_dlg', type: 'dialogue', name: '结束语', position: { x: 800, y: 0 },
        exits: [{ id: 'next', name: 'next' }], text: '完。',
      },
      {
        id: 'n_scene2', type: 'scene', name: '第二个场景', position: { x: 300, y: 100 },
        exits: [{ id: 'next', name: 'next' }],
        background: { assetId: 'img_bg', fit: 'contain', x: 0.5, y: 0.5, scale: 1, opacity: 1 },
        sprites: [{ id: 'sp_me', assetId: 'img_sp', x: 0.7, y: 0.6, scale: 1, zIndex: 10, opacity: 1 }],
        textbox: {
          x: 0.5, y: 0.84, width: 0.92, height: 0.22, fontSizePx: 28,
          color: '#ffffff', background: '#000000', backgroundOpacity: 0.55, opacity: 1,
        },
        audio: { bgmAssetId: 'aud_bgm', volume: 0.5, loop: false },
        variables: [],
      },
      {
        id: 'n_scene_loop', type: 'scene', name: '循环场景', position: { x: 300, y: 200 },
        exits: [{ id: 'next', name: 'next' }],
        background: null,
        sprites: [{ id: 'sp_me', assetId: 'img_sp', x: 0.3, y: 0.6, scale: 1, zIndex: 10, opacity: 1 }],
        textbox: {
          x: 0.5, y: 0.84, width: 0.92, height: 0.22, fontSizePx: 28,
          color: '#ffffff', background: '#000000', backgroundOpacity: 0.55, opacity: 1,
        },
        audio: { bgmAssetId: 'aud_bgm', volume: 0.6, loop: true },
        variables: [],
      },
      {
        id: 'n_end_scene', type: 'scene', name: '最后场景', position: { x: 800, y: 200 },
        exits: [{ id: 'next', name: 'next' }],
        background: null, sprites: [], uiImages: [],
        textbox: {
          x: 0.5, y: 0.84, width: 0.92, height: 0.22, fontSizePx: 28,
          color: '#ffffff', background: '#000000', backgroundOpacity: 0.55, opacity: 1,
        },
        audio: { bgmAssetId: null, volume: 0.8, loop: false },
        variables: [],
      },
      {
        id: 'n_scene_plain', type: 'scene', name: '无时间轴场景', position: { x: 900, y: 300 },
        exits: [{ id: 'next', name: 'next' }],
        background: null, sprites: [],
        textbox: {
          x: 0.5, y: 0.84, width: 0.92, height: 0.22, fontSizePx: 28,
          color: '#ffffff', background: '#000000', backgroundOpacity: 0.55, opacity: 1,
        },
        audio: { bgmAssetId: null, volume: 0.8, loop: false },
        variables: [],
      },
      {
        id: 'n_jump_a', type: 'jump', name: '环A', position: { x: 0, y: 300 },
        exits: [], targetNodeId: 'n_jump_b',
      },
      {
        id: 'n_jump_b', type: 'jump', name: '环B', position: { x: 0, y: 400 },
        exits: [], targetNodeId: 'n_jump_a',
      },
      {
        id: 'n_cond_bad', type: 'condition', name: '坏表达式', position: { x: 100, y: 400 },
        expression: 'missing_value > 1',
        exits: [
          { id: 'true', name: 'true' },
          { id: 'false', name: 'false' },
        ],
      },
      {
        id: 'n_var_back', type: 'variable', name: '回场景', position: { x: 200, y: 400 },
        exits: [{ id: 'next', name: 'next' }],
        assignments: [{ key: 'money', op: 'set', value: { type: 'number', value: 5 } }],
      },
    ],
    edges: [
      { id: 'e_cond_true', from: 'n_cond', port: 'true', to: 'n_var', kind: 'conditional' },
      { id: 'e_cond_false', from: 'n_cond', port: 'false', to: 'n_dlg', kind: 'conditional' },
      { id: 'e_var_next', from: 'n_var', port: 'next', to: 'n_scene', kind: 'sequence' },
      { id: 'e_scene_next', from: 'n_scene', port: 'next', to: 'n_dlg', kind: 'sequence' },
      { id: 'e_dlg_next', from: 'n_dlg', port: 'next', to: 'n_choice', kind: 'sequence' },
      { id: 'e_choice_rain', from: 'n_choice', port: 'rain', to: 'n_mg', kind: 'sequence' },
      { id: 'e_choice_shop', from: 'n_choice', port: 'shop', to: 'n_video', kind: 'sequence' },
      { id: 'e_mg_win', from: 'n_mg', port: 'ex_win', to: 'n_cond_mg', kind: 'sequence' },
      { id: 'e_mg_lose', from: 'n_mg', port: 'ex_lose', to: 'n_cond_mg', kind: 'sequence' },
      { id: 'e_condmg_true', from: 'n_cond_mg', port: 'true', to: 'n_dlg', kind: 'conditional' },
      { id: 'e_condmg_false', from: 'n_cond_mg', port: 'false', to: 'n_choice', kind: 'conditional' },
      { id: 'e_video_completed', from: 'n_video', port: 'completed', to: 'n_dlg', kind: 'sequence' },
      { id: 'e_video_skipped', from: 'n_video', port: 'skipped', to: 'n_dlg', kind: 'sequence' },
      { id: 'e_scene2_next', from: 'n_scene2', port: 'next', to: 'n_dlg', kind: 'sequence' },
      { id: 'e_loop_next', from: 'n_scene_loop', port: 'next', to: 'n_dlg', kind: 'sequence' },
      { id: 'e_condbad_true', from: 'n_cond_bad', port: 'true', to: 'n_choice', kind: 'conditional' },
      { id: 'e_condbad_false', from: 'n_cond_bad', port: 'false', to: 'n_dlg', kind: 'conditional' },
      { id: 'e_varback_next', from: 'n_var_back', port: 'next', to: 'n_scene', kind: 'sequence' },
      // data 连线必须被推进逻辑忽略（即使 from / port 命中）。
      { id: 'e_scene_data', from: 'n_scene', port: 'next', to: 'n_choice', kind: 'data', data: { fromProperty: 'x', toProperty: 'y' } },
    ],
    timelines: {
      n_scene: {
        durationMs: 2000,
        loop: false,
        tracks: [
          {
            id: 'tr_sprite_x', kind: 'sprite', target: 'sp_me', property: 'x',
            keys: [
              { time: 0, value: 0.3, easing: LINEAR },
              { time: 1000, value: 0.7, easing: LINEAR },
            ],
          },
          {
            id: 'tr_bg_opacity', kind: 'background', property: 'opacity',
            keys: [
              { time: 0, value: 0.5, easing: LINEAR },
              { time: 2000, value: 1, easing: EASE_IN_OUT },
            ],
          },
          {
            id: 'tr_audio_volume', kind: 'audio', property: 'volume',
            keys: [
              { time: 0, value: 0.2, easing: LINEAR },
              { time: 2000, value: 0.9, easing: LINEAR },
            ],
          },
          {
            id: 'tr_textbox_font', kind: 'textbox', property: 'fontSizePx',
            keys: [
              { time: 0, value: 28, easing: LINEAR },
              { time: 1000, value: 40, easing: LINEAR },
            ],
          },
        ],
      },
      n_scene2: {
        durationMs: 1000,
        loop: false,
        tracks: [
          {
            id: 'tr2_sprite_x', kind: 'sprite', target: 'sp_me', property: 'x',
            keys: [
              { time: 0, value: 0.7, easing: LINEAR },
              { time: 1000, value: 0.2, easing: LINEAR },
            ],
          },
        ],
      },
      n_scene_loop: {
        durationMs: 1000,
        loop: true,
        tracks: [
          {
            id: 'tr_loop_x', kind: 'sprite', target: 'sp_me', property: 'x',
            keys: [
              { time: 0, value: 0, easing: LINEAR },
              { time: 1000, value: 1, easing: LINEAR },
            ],
          },
        ],
      },
    },
  };
}

function nodeById(project, nodeId) {
  return project.nodes.find((node) => node.id === nodeId);
}

function edgeById(project, edgeId) {
  return project.edges.find((edge) => edge.id === edgeId);
}

function makeEngine({ project = makeProject(), ...options } = {}) {
  return createEngine({ project, ...options });
}

/* ------------------------------------------------------------------ */
/* 1. 构造 / 启动                                                      */
/* ------------------------------------------------------------------ */

test('autoStart=false 构造不启动；start() 自动链 jump→condition→variable→scene', () => {
  const project = makeProject();
  const engine = createEngine({ project });
  assert.equal(engine.project, project);
  assert.equal(engine.status, ENGINE_STATUS.RUNNING);
  assert.equal(engine.error, null);
  assert.deepEqual(engine.warnings, []);
  assert.equal(engine.nodeId, null);
  assert.equal(engine.pending, null);
  assert.equal(engine.playtimeMs, 0);
  assert.equal(engine.stage, null);

  const result = engine.start();
  assert.deepEqual(result, { ok: true });
  assert.equal(engine.nodeId, 'n_scene');
  assert.deepEqual(engine.pending, { type: 'scene' });
  assert.equal(engine.getRenderState().nodeType, 'scene');
  // variable 节点五类操作全部生效。
  assert.deepEqual(engine.variables.money, { type: 'number', value: 100 });
  assert.deepEqual(engine.variables.score, { type: 'number', value: 5 });
  assert.deepEqual(engine.variables.flag, { type: 'boolean', value: true });
  assert.deepEqual(engine.variables.inventory, { type: 'array', value: ['umbrella', 'ticket'] });
  assert.deepEqual(engine.variables.tag, { type: 'string', value: 'veteran' });
  // scene 声明变量：缺失才初始化；money 已存在（100），不被声明的 42 覆盖。
  assert.deepEqual(engine.variables.met_clerk, { type: 'boolean', value: true });
  assert.deepEqual(engine.variables.money, { type: 'number', value: 100 });
  assert.deepEqual(engine.warnings, []);
  // 舞台初始时间轴时间为 0。
  assert.equal(engine.stage.sceneNodeId, 'n_scene');
  assert.equal(engine.stage.timeMs, 0);
});

test('autoStart=true 构造阶段直接 start()', () => {
  const engine = createEngine({ project: makeProject(), autoStart: true });
  assert.equal(engine.nodeId, 'n_scene');
  assert.deepEqual(engine.pending, { type: 'scene' });
});

test('condition 为 false 时走 false 出口', () => {
  const project = makeProject();
  project.variables.money = { type: 'number', value: 5 };
  const engine = createEngine({ project, autoStart: true });
  assert.equal(engine.nodeId, 'n_dlg');
  assert.deepEqual(engine.pending, { type: 'dialogue' });
  assert.equal(engine.stage, null);
  assert.deepEqual(engine.variables.money, { type: 'number', value: 5 });
});

test('condition 表达式求值错误：走 false + warnings + console.warn（含表达式文本）', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_cond_bad', autoStart: true });
  assert.equal(engine.nodeId, 'n_dlg');
  assert.deepEqual(engine.pending, { type: 'dialogue' });
  assert.equal(engine.warnings.length, 1);
  assert.match(engine.warnings[0], /未知标识符/);
  assert.match(engine.warnings[0], /missing_value > 1/);
  assert.ok(warnLog.some((message) => message.includes('missing_value > 1')));
});

test('纯逻辑死循环（jump 互指）→ error 状态，不抛异常', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_jump_a', autoStart: true });
  assert.equal(engine.status, ENGINE_STATUS.ERROR);
  assert.match(engine.error, /过长|死循环/);
  assert.equal(engine.pending, null);
});

test('无效起始节点 / 缺少 startNodeId → error 状态', () => {
  const missingNode = createEngine({ project: makeProject(), startNodeId: 'n_missing', autoStart: true });
  assert.equal(missingNode.status, ENGINE_STATUS.ERROR);
  assert.match(missingNode.error, /起始节点不存在/);

  const project = makeProject();
  project.settings.startNodeId = null;
  const noStart = createEngine({ project });
  noStart.start();
  assert.equal(noStart.status, ENGINE_STATUS.ERROR);
  assert.match(noStart.error, /没有可用的起始节点/);
});

test('createEngine() 缺 project 不抛异常，返回 error 状态的可检查引擎', () => {
  const engine = createEngine({});
  assert.equal(engine.status, ENGINE_STATUS.ERROR);
  assert.match(engine.error, /项目数据无效/);
  assert.equal(engine.getCurrentNode(), null);
  assert.equal(engine.getNodeById('x'), null);
});

/* ------------------------------------------------------------------ */
/* 2. dialogue / scene 推进与舞台冻结                                  */
/* ------------------------------------------------------------------ */

test('dialogue advance → 下一个节点；getRenderState().dialogue 字段完整', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_dlg' });
  engine.start();
  const state = engine.getRenderState();
  assert.equal(state.status, ENGINE_STATUS.RUNNING);
  assert.equal(state.nodeId, 'n_dlg');
  assert.equal(state.nodeType, 'dialogue');
  assert.deepEqual(state.dialogue, {
    speaker: '林',
    text: '雨下大了，要伞吗？',
    portrait: { assetId: 'img_sp', x: 0.82, y: 0.92, scale: 1 },
    voice: null,
    speedCps: 45, // dialogue.speedCps 为 null 时回落到 settings.textSpeedCps
    autoAdvanceMs: null,
  });
  assert.equal(state.choice, null);
  assert.equal(state.ended, false);

  const result = engine.advance();
  assert.deepEqual(result, { ok: true });
  assert.equal(engine.nodeId, 'n_choice');
  assert.deepEqual(engine.pending, { type: 'choice' });
});

test('scene advance：离开 scene 后 stage 保留且时间冻结，直到进入下一个 scene', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_scene' });
  engine.start();
  engine.tick(400);
  assert.equal(engine.getRenderState().stage.timeMs, 400);
  assert.equal(engine.getRenderState().playtimeMs, 400);

  engine.advance();
  assert.equal(engine.nodeId, 'n_dlg');
  assert.deepEqual(engine.stage, { sceneNodeId: 'n_scene', timeMs: 400 });
  assert.equal(engine.getRenderState().stage.sceneNodeId, 'n_scene');

  // 停在 dialogue 时继续 tick：playtime 增加，舞台时间不再前进。
  engine.tick(600);
  assert.equal(engine.getRenderState().playtimeMs, 1000);
  assert.deepEqual(engine.stage, { sceneNodeId: 'n_scene', timeMs: 400 });
  assert.ok(Math.abs(engine.getRenderState().stage.sprites[0].x - 0.46) < 1e-6); // 0.3 + 0.4 × 0.4
});

test('进入新 scene 时 stage 切换到新场景并重置时间', () => {
  const project = makeProject();
  edgeById(project, 'e_scene_next').to = 'n_scene2';
  const engine = createEngine({ project, startNodeId: 'n_scene' });
  engine.start();
  engine.tick(500);
  assert.equal(engine.getRenderState().stage.timeMs, 500);

  engine.advance();
  assert.equal(engine.nodeId, 'n_scene2');
  assert.deepEqual(engine.stage, { sceneNodeId: 'n_scene2', timeMs: 0 });
  engine.tick(300);
  assert.equal(engine.getRenderState().stage.timeMs, 300);
});

test('最后一幕 dialogue 没有 next 出边 → 正常结束（ended），不是 error', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_end_dlg' });
  engine.start();
  const result = engine.advance();
  assert.deepEqual(result, { ok: true, ended: true });
  assert.equal(engine.status, ENGINE_STATUS.ENDED);
  assert.equal(engine.error, null);
  assert.equal(engine.pending, null);
  assert.equal(engine.getRenderState().ended, true);
  assert.equal(engine.getRenderState().status, ENGINE_STATUS.ENDED);
  // 已结束后再 advance 不改变状态。
  assert.equal(engine.advance().ok, false);
  assert.equal(engine.status, ENGINE_STATUS.ENDED);
});

test('最后一幕 scene 没有 next 出边 → ended；同一出口多条边 → error', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_end_scene' });
  engine.start();
  engine.advance();
  assert.equal(engine.status, ENGINE_STATUS.ENDED);

  const project = makeProject();
  project.edges.push({ id: 'e_dup', from: 'n_scene', port: 'next', to: 'n_choice', kind: 'sequence' });
  const broken = createEngine({ project, startNodeId: 'n_scene' });
  broken.start();
  broken.advance();
  assert.equal(broken.status, ENGINE_STATUS.ERROR);
  assert.match(broken.error, /多条连线/);
});

test('data 连线不参与推进（只有 sequence / conditional 被使用）', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_scene' });
  engine.start();
  engine.advance();
  assert.equal(engine.nodeId, 'n_dlg'); // 走的是 e_scene_next 而不是同 from/port 的 data 边
  assert.equal(engine.status, ENGINE_STATUS.RUNNING);
});

/* ------------------------------------------------------------------ */
/* 3. choice                                                          */
/* ------------------------------------------------------------------ */

test('choice：getRenderState 选项、合法 choose、非法出口 → error', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_choice' });
  engine.start();
  const state = engine.getRenderState();
  assert.equal(state.choice.prompt, '走哪边？');
  assert.deepEqual(state.choice.options.map((option) => option.id), ['rain', 'shop']);
  assert.deepEqual(state.choice.options[0], { id: 'rain', name: '雨中', label: null });

  const result = engine.choose('rain');
  assert.deepEqual(result, { ok: true });
  assert.equal(engine.nodeId, 'n_mg');
  assert.deepEqual(engine.pending, { type: 'minigame' });
});

test('choice：出口 id 不存在 → error 状态 + warning', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_choice' });
  engine.start();
  const result = engine.choose('not_an_exit');
  assert.equal(result.ok, false);
  assert.match(result.error, /不存在出口/);
  assert.equal(engine.status, ENGINE_STATUS.ERROR);
  assert.equal(engine.error, result.error);
  assert.ok(warnLog.some((message) => message.includes('不存在出口')));
});

test('choice：出口存在但没有连线 → error 状态', () => {
  const project = makeProject();
  project.edges = project.edges.filter((edge) => edge.id !== 'e_choice_rain');
  const engine = createEngine({ project, startNodeId: 'n_choice' });
  engine.start();
  const result = engine.choose('rain');
  assert.equal(result.ok, false);
  assert.match(result.error, /没有连线/);
  assert.equal(engine.status, ENGINE_STATUS.ERROR);
});

test('非当前可交互节点调用 advance / choose / completeVideo 返回 ok:false 且不改变状态', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_dlg' });
  engine.start();
  assert.equal(engine.choose('rain').ok, false);
  assert.equal(engine.completeVideo('completed').ok, false);
  assert.equal(engine.status, ENGINE_STATUS.RUNNING);
  assert.equal(engine.nodeId, 'n_dlg');
});

/* ------------------------------------------------------------------ */
/* 4. variable 操作语义                                               */
/* ------------------------------------------------------------------ */

test('变量操作 set/add/subtract/toggle/push 与 set 改变类型', () => {
  const project = makeProject();
  nodeById(project, 'n_var').assignments = [
    { key: 'money', op: 'set', value: { type: 'string', value: '很多' } },
    { key: 'score', op: 'add', value: { type: 'number', value: 2.5 } },
    { key: 'score', op: 'subtract', value: { type: 'number', value: 0.5 } },
    { key: 'flag', op: 'toggle' },
    { key: 'inventory', op: 'push', value: { type: 'object', value: { id: 'ticket' } } },
  ];
  const engine = createEngine({ project, startNodeId: 'n_var' });
  engine.start();
  assert.deepEqual(engine.variables.money, { type: 'string', value: '很多' });
  assert.deepEqual(engine.variables.score, { type: 'number', value: 2 });
  assert.deepEqual(engine.variables.flag, { type: 'boolean', value: true });
  assert.deepEqual(engine.variables.inventory, { type: 'array', value: ['umbrella', { id: 'ticket' }] });
  assert.deepEqual(engine.warnings, []);
});

test('变量操作类型不符 / 变量不存在：跳过该条 + warning，后续赋值继续执行', () => {
  const project = makeProject();
  nodeById(project, 'n_var').assignments = [
    { key: 'tag', op: 'add', value: { type: 'number', value: 1 } }, // 不存在
    { key: 'money', op: 'toggle' }, // number 不能 toggle
    { key: 'flag', op: 'push', value: { type: 'string', value: 'x' } }, // boolean 不能 push
    { key: 'missing_var', op: 'subtract', value: { type: 'number', value: 1 } }, // 不存在
    { key: 'score', op: 'add', value: { type: 'string', value: 'x' } }, // 值不是 number
    { key: 'tag', op: 'set', value: { type: 'string', value: 'ok' } }, // 合法，必须仍执行
  ];
  const engine = createEngine({ project, startNodeId: 'n_var' });
  engine.start();
  assert.equal(engine.warnings.length, 5);
  for (const message of engine.warnings) assert.match(message, /跳过/);
  assert.equal(warnLog.length >= 5, true);
  assert.deepEqual(engine.variables.tag, { type: 'string', value: 'ok' });
  assert.deepEqual(engine.variables.score, { type: 'number', value: 0 }); // add 值类型不符，被跳过
  assert.equal(engine.nodeId, 'n_scene');
  assert.equal(engine.status, ENGINE_STATUS.RUNNING);
});

test('last_minigame_result 只允许 string typedValue（变量节点写入被拒）', () => {
  const project = makeProject();
  nodeById(project, 'n_var').assignments = [
    { key: 'last_minigame_result', op: 'set', value: { type: 'number', value: 1 } },
    { key: 'last_minigame_result', op: 'set', value: { type: 'string', value: 'manual' } },
    { key: 'last_minigame_result', op: 'add', value: { type: 'number', value: 1 } },
  ];
  const engine = createEngine({ project, startNodeId: 'n_var' });
  engine.start();
  assert.deepEqual(engine.variables.last_minigame_result, { type: 'string', value: 'manual' });
  assert.equal(engine.warnings.length, 2);
});

test('场景 variables：仅缺失时初始化，再次进入不覆盖已有值', () => {
  const project = makeProject();
  edgeById(project, 'e_scene_next').to = 'n_var_back';
  const engine = createEngine({ project, startNodeId: 'n_scene' });
  engine.start();
  assert.equal(engine.variables.money.value, 120, '项目变量已有 money，不被场景声明的 42 覆盖');
  assert.equal(engine.variables.met_clerk.value, true);

  engine.advance(); // scene → 变量节点（money=5）→ 再次进入 n_scene
  assert.equal(engine.nodeId, 'n_scene');
  assert.equal(engine.variables.money.value, 5, '再次进入场景不覆盖已有值');
  assert.equal(engine.variables.met_clerk.value, true);
  assert.equal(engine.stage.timeMs, 0);
});

/* ------------------------------------------------------------------ */
/* 5. minigame                                                        */
/* ------------------------------------------------------------------ */

test('minigame：精确匹配 exit.name，先写 last_minigame_result，下游 condition 能读到', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_mg' });
  engine.start();
  const state = engine.getRenderState();
  assert.equal(state.nodeType, 'minigame');
  assert.equal(state.minigame.nodeId, 'n_mg');
  assert.equal(state.minigame.path, 'assets/minigames/mg_1.html');
  assert.deepEqual(state.minigame.exits, [
    { id: 'ex_win', name: 'win' },
    { id: 'ex_lose', name: 'lose' },
  ]);
  assert.equal(state.minigame.defaultExitId, 'ex_lose');
  assert.equal(state.minigame.timeoutMs, 30000);
  assert.equal(state.minigame.instructions, '按方向键接住雨伞');
  assert.equal(state.minigame.mode, 'blocking');

  const result = engine.submitMinigameResult('win');
  assert.deepEqual(result, { ok: true, matched: true, exitId: 'ex_win' });
  // 下游 condition（last_minigame_result == "win"）走 true 分支。
  assert.equal(engine.nodeId, 'n_dlg');
  assert.deepEqual(engine.variables.last_minigame_result, { type: 'string', value: 'win' });
  assert.deepEqual(engine.pending, { type: 'dialogue' });
});

test('minigame：无匹配走 defaultExitId（区分大小写），下游 condition 读到最新值', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_mg' });
  engine.start();
  const result = engine.submitMinigameResult('Win'); // 大小写不匹配 → 默认出口
  assert.deepEqual(result, { ok: true, matched: false, exitId: 'ex_lose' });
  assert.equal(engine.nodeId, 'n_choice'); // condition 读到 "Win" ≠ "win" → false 分支
  assert.deepEqual(engine.variables.last_minigame_result, { type: 'string', value: 'Win' });
});

test('minigame：格式非 string → 拒绝，不写变量、不推进', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_mg' });
  engine.start();
  for (const invalid of [123, null, undefined, {}, ['win'], true]) {
    const result = engine.submitMinigameResult(invalid);
    assert.equal(result.ok, false);
    assert.match(result.error, /必须是字符串/);
    assert.equal(engine.status, ENGINE_STATUS.RUNNING);
    assert.deepEqual(engine.pending, { type: 'minigame' });
    assert.deepEqual(engine.variables.last_minigame_result, { type: 'string', value: 'idle' });
  }
});

test('minigame：无匹配且没有 defaultExitId → error 状态（结果仍先写入）', () => {
  const project = makeProject();
  nodeById(project, 'n_mg').defaultExitId = null;
  const engine = createEngine({ project, startNodeId: 'n_mg' });
  engine.start();
  const result = engine.submitMinigameResult('draw');
  assert.equal(result.ok, false);
  assert.match(result.error, /没有默认出口/);
  assert.equal(engine.status, ENGINE_STATUS.ERROR);
  assert.deepEqual(engine.variables.last_minigame_result, { type: 'string', value: 'draw' });
});

test('minigame：匹配出口没有连线 → error', () => {
  const project = makeProject();
  project.edges = project.edges.filter((edge) => edge.id !== 'e_mg_win');
  const engine = createEngine({ project, startNodeId: 'n_mg' });
  engine.start();
  const result = engine.submitMinigameResult('win');
  assert.equal(result.ok, false);
  assert.equal(result.matched, true);
  assert.equal(result.exitId, 'ex_win');
  assert.match(result.error, /没有连线/);
  assert.equal(engine.status, ENGINE_STATUS.ERROR);
});

test('timeoutMinigame：不写 last_minigame_result，按无匹配走默认出口', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_mg' });
  engine.start();
  const result = engine.timeoutMinigame();
  assert.deepEqual(result, { ok: true, matched: false, exitId: 'ex_lose' });
  assert.deepEqual(engine.variables.last_minigame_result, { type: 'string', value: 'idle' });
  assert.equal(engine.nodeId, 'n_choice'); // condition 读到 idle ≠ win → false
});

test('timeoutMinigame：没有默认出口 → error，且不写变量', () => {
  const project = makeProject();
  nodeById(project, 'n_mg').defaultExitId = null;
  const engine = createEngine({ project, startNodeId: 'n_mg' });
  engine.start();
  const result = engine.timeoutMinigame();
  assert.equal(result.ok, false);
  assert.match(result.error, /没有默认出口/);
  assert.equal(engine.status, ENGINE_STATUS.ERROR);
  assert.deepEqual(engine.variables.last_minigame_result, { type: 'string', value: 'idle' });
});

/* ------------------------------------------------------------------ */
/* 6. video                                                           */
/* ------------------------------------------------------------------ */

test('video：completed / skipped 沿固定出口推进；renderState 字段完整', () => {
  const project = makeProject();
  const engine = createEngine({ project, startNodeId: 'n_video' });
  engine.start();
  const state = engine.getRenderState();
  assert.equal(state.nodeType, 'video');
  assert.deepEqual(state.video, {
    nodeId: 'n_video',
    videoAssetId: 'vid_1',
    path: 'assets/videos/vid_1.mp4',
    volume: 0.8,
    loop: false,
    showSkipButton: true,
    skipAfterMs: 1000,
  });
  assert.deepEqual(engine.completeVideo('completed'), { ok: true });
  assert.equal(engine.nodeId, 'n_dlg');

  const skippedEngine = createEngine({ project, startNodeId: 'n_video' });
  skippedEngine.start();
  assert.deepEqual(skippedEngine.completeVideo('skipped'), { ok: true });
  assert.equal(skippedEngine.nodeId, 'n_dlg');
});

test('video：非法 outcome → ok:false 且不推进；出口无连线 → error', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_video' });
  engine.start();
  const invalid = engine.completeVideo('paused');
  assert.equal(invalid.ok, false);
  assert.equal(engine.status, ENGINE_STATUS.RUNNING);
  assert.equal(engine.nodeId, 'n_video');

  const project = makeProject();
  project.edges = project.edges.filter((edge) => edge.id !== 'e_video_completed');
  const broken = createEngine({ project, startNodeId: 'n_video' });
  broken.start();
  const result = broken.completeVideo('completed');
  assert.equal(result.ok, false);
  assert.match(result.error, /没有连线/);
  assert.equal(broken.status, ENGINE_STATUS.ERROR);
});

/* ------------------------------------------------------------------ */
/* 7. tick 与时间轴                                                    */
/* ------------------------------------------------------------------ */

test('tick：playtime 累加；非 loop 时间轴 clamp 到 durationMs', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_scene' });
  engine.start();
  engine.tick(500);
  assert.equal(engine.stage.timeMs, 500);
  assert.equal(engine.getRenderState().playtimeMs, 500);

  engine.tick(10000);
  assert.equal(engine.stage.timeMs, 2000, '非 loop 停在末帧');
  assert.equal(engine.getRenderState().playtimeMs, 10500);
});

test('tick：loop 时间轴对 durationMs 取模', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_scene_loop' });
  engine.start();
  engine.tick(2500);
  assert.equal(engine.stage.timeMs, 500);
  engine.tick(1200);
  assert.equal(engine.stage.timeMs, 700);
  engine.tick(300);
  assert.equal(engine.stage.timeMs, 0);
});

test('tick：非法 delta 被忽略；非 scene 状态不推进舞台时间', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_dlg' });
  engine.start();
  engine.tick(Number.NaN);
  engine.tick(-100);
  assert.equal(engine.getRenderState().playtimeMs, 0);

  const sceneEngine = createEngine({ project: makeProject(), startNodeId: 'n_scene' });
  sceneEngine.start();
  sceneEngine.tick(250);
  sceneEngine.advance();
  sceneEngine.tick(1000);
  assert.equal(sceneEngine.getRenderState().playtimeMs, 1250);
  assert.equal(sceneEngine.stage.timeMs, 250);
});

/* ------------------------------------------------------------------ */
/* 8. getRenderState                                                  */
/* ------------------------------------------------------------------ */

test('getRenderState：scene 舞台值含时间轴覆盖（背景/立绘/UI 图/文本框/音频）', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_scene' });
  engine.start();
  engine.tick(500);
  const state = engine.getRenderState();
  assert.equal(state.stage.sceneNodeId, 'n_scene');
  assert.equal(state.stage.timeMs, 500);
  // 时间轴插值走 cubic-bezier，返回浮点近似值，数值字段用容差比较。
  const background = state.stage.background;
  assert.equal(background.assetId, 'img_bg');
  assert.equal(background.fit, 'cover');
  assert.equal(background.x, 0.5);
  assert.equal(background.y, 0.5);
  assert.equal(background.scale, 1);
  // 背景透明度轨道用 easeInOut（目标帧 easing），期望值按 cubic-bezier 计算。
  const expectedBgOpacity = 0.5 + 0.5 * cubicBezierY([0.42, 0], [0.58, 1], 0.25);
  assert.ok(Math.abs(background.opacity - expectedBgOpacity) < 1e-6);
  const sprite = state.stage.sprites[0];
  assert.equal(sprite.id, 'sp_me');
  assert.equal(sprite.assetId, 'img_sp');
  assert.ok(Math.abs(sprite.x - 0.5) < 1e-6);
  assert.equal(sprite.y, 0.6);
  assert.equal(sprite.scale, 1);
  assert.equal(sprite.zIndex, 10);
  assert.equal(sprite.opacity, 1);
  assert.deepEqual(state.stage.uiImages[0], {
    id: 'ui_hp', assetId: 'img_ui', x: 0.12, y: 0.1, scale: 1, zIndex: 5, opacity: 0.9,
  });
  assert.ok(Math.abs(state.stage.textbox.fontSizePx - 34) < 1e-6);
  assert.equal(state.stage.textbox.color, '#ffffff');
  assert.equal(state.stage.audio.bgmAssetId, 'aud_bgm');
  assert.ok(Math.abs(state.stage.audio.volume - 0.375) < 1e-6);
  assert.equal(state.stage.audio.loop, true);
  assert.deepEqual(state.stage.audio.sfx, []);
});

test('getRenderState：没有 scene 时用默认 textbox + 空舞台', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_dlg' });
  engine.start();
  const state = engine.getRenderState();
  assert.equal(state.stage.sceneNodeId, null);
  assert.equal(state.stage.timeMs, 0);
  assert.equal(state.stage.background, null);
  assert.deepEqual(state.stage.sprites, []);
  assert.deepEqual(state.stage.uiImages, []);
  assert.deepEqual(state.stage.textbox, { ...DEFAULT_TEXTBOX });
  assert.deepEqual(state.stage.audio, { bgmAssetId: null, volume: 0.8, loop: false, sfx: [] });
});

test('getRenderState：choice / dialogue / error / ended 标志', () => {
  const choiceEngine = createEngine({ project: makeProject(), startNodeId: 'n_choice' });
  choiceEngine.start();
  const choiceState = choiceEngine.getRenderState();
  assert.equal(choiceState.choice.prompt, '走哪边？');
  assert.equal(choiceState.dialogue, null);
  assert.equal(choiceState.ended, false);

  const endedEngine = createEngine({ project: makeProject(), startNodeId: 'n_end_dlg' });
  endedEngine.start();
  endedEngine.advance();
  assert.equal(endedEngine.getRenderState().ended, true);
  assert.equal(endedEngine.getRenderState().dialogue, null);
});

test('getCurrentNode / getNodeById', () => {
  const engine = createEngine({ project: makeProject(), startNodeId: 'n_choice' });
  engine.start();
  assert.equal(engine.getCurrentNode().id, 'n_choice');
  assert.equal(engine.getNodeById('n_scene').type, 'scene');
  assert.equal(engine.getNodeById('n_missing'), null);
});

/* ------------------------------------------------------------------ */
/* 9. serialize / loadSave                                            */
/* ------------------------------------------------------------------ */

test('serialize：输出 schema saveState 形状，槽位规则符合 schema', () => {
  const engine = createEngine({ project: makeProject() });
  engine.start(); // 走完整自动链 jump→condition→variable→scene，变量已结算
  engine.tick(500);
  const save = engine.serialize({ kind: 'manual', slot: 3, label: '雨夜', thumbnailDataUrl: null });
  assert.deepEqual(Object.keys(save).sort(), [
    'kind', 'label', 'nodeId', 'playtimeMs', 'projectId', 'projectTitle',
    'savedAt', 'schemaVersion', 'slot', 'thumbnailDataUrl', 'timeline', 'variables', 'version',
  ]);
  assert.equal(save.version, 1);
  assert.equal(save.kind, 'manual');
  assert.equal(save.slot, 3);
  assert.match(save.savedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(save.projectId, 'proj_phase5');
  assert.equal(save.schemaVersion, 1);
  assert.equal(save.nodeId, 'n_scene');
  assert.deepEqual(save.timeline, { nodeId: 'n_scene', timeMs: 500 });
  assert.equal(save.thumbnailDataUrl, null);
  assert.equal(save.playtimeMs, 500);
  assert.equal(save.label, '雨夜');
  assert.equal(save.projectTitle, '阶段五测试项目');
  assert.deepEqual(save.variables.money, { type: 'number', value: 100 });
  // 默认手动槽 1；auto / quick 固定 slot 0。
  assert.equal(engine.serialize().slot, 1);
  assert.equal(engine.serialize({ kind: 'manual', slot: 0 }).slot, 1);
  assert.equal(engine.serialize({ kind: 'auto' }).slot, 0);
  assert.equal(engine.serialize({ kind: 'quick', slot: 9 }).slot, 0);
});

test('serialize：变量与时间轴是深拷贝快照', () => {
  const engine = createEngine({ project: makeProject() });
  engine.start();
  engine.tick(300);
  const save = engine.serialize({ kind: 'quick' });
  engine.variables.inventory.value.push('after_save');
  engine.tick(100);
  assert.deepEqual(save.variables.inventory, { type: 'array', value: ['umbrella', 'ticket'] });
  assert.deepEqual(save.timeline, { nodeId: 'n_scene', timeMs: 300 });
});

test('loadSave：恢复变量 / 节点 / 舞台时间 / 累计游玩时间', () => {
  const project = makeProject();
  const engine = createEngine({ project });
  engine.start(); // 完整自动链进入 n_scene
  engine.tick(700);
  engine.advance(); // n_dlg，stage 冻结
  const save = engine.serialize({ kind: 'manual', slot: 2 });
  engine.tick(5000); // 篡改当前进度，确认读档覆盖

  const restored = createEngine({ project, save });
  assert.equal(restored.status, ENGINE_STATUS.RUNNING);
  assert.equal(restored.nodeId, 'n_dlg');
  assert.deepEqual(restored.pending, { type: 'dialogue' });
  assert.equal(restored.playtimeMs, 700);
  assert.deepEqual(restored.stage, { sceneNodeId: 'n_scene', timeMs: 700 });
  assert.deepEqual(restored.variables.money, { type: 'number', value: 100 });
  assert.deepEqual(restored.getRenderState().stage.timeMs, 700);

  // 普通 loadSave() 调用同样 ok。
  const target = createEngine({ project });
  assert.deepEqual(target.loadSave(save), { ok: true });
  assert.equal(target.nodeId, 'n_dlg');
});

test('loadSave：处在 scene 时恢复该场景的播放头', () => {
  const project = makeProject();
  const engine = createEngine({ project, startNodeId: 'n_scene' });
  engine.start();
  engine.tick(900);
  const save = engine.serialize({ kind: 'auto' });
  const restored = createEngine({ project, save, autoStart: true });
  assert.equal(restored.nodeId, 'n_scene');
  assert.deepEqual(restored.pending, { type: 'scene' });
  assert.deepEqual(restored.stage, { sceneNodeId: 'n_scene', timeMs: 900 });
});

test('loadSave 校验：projectId / schemaVersion / nodeId / 非对象存档', () => {
  const project = makeProject();
  const engine = createEngine({ project, startNodeId: 'n_dlg' });
  engine.start();
  const save = engine.serialize({ kind: 'manual', slot: 1 });

  const otherProject = { ...save, projectId: 'proj_other' };
  const wrongProject = createEngine({ project });
  wrongProject.start('n_dlg');
  const result1 = wrongProject.loadSave(otherProject);
  assert.equal(result1.ok, false);
  assert.match(result1.error, /其他项目/);
  assert.equal(wrongProject.nodeId, 'n_dlg', '校验失败不改变当前节点');

  const result2 = wrongProject.loadSave({ ...save, schemaVersion: 2 });
  assert.equal(result2.ok, false);
  assert.match(result2.error, /版本不兼容/);

  const result3 = wrongProject.loadSave({ ...save, nodeId: 'n_deleted' });
  assert.equal(result3.ok, false);
  assert.match(result3.error, /节点不存在/);

  const result4 = wrongProject.loadSave(null);
  assert.equal(result4.ok, false);
  assert.match(result4.error, /存档数据无效/);
});

test('loadSave：自动节点按存档变量重新推进，但不覆盖已有变量', () => {
  const project = makeProject();
  const save = {
    version: 1,
    kind: 'manual',
    slot: 1,
    savedAt: new Date().toISOString(),
    projectId: 'proj_phase5',
    schemaVersion: 1,
    nodeId: 'n_cond',
    variables: { money: { type: 'number', value: 5 } },
    timeline: null,
    thumbnailDataUrl: null,
    playtimeMs: 1000,
  };
  const engine = createEngine({ project, save });
  assert.equal(engine.nodeId, 'n_dlg'); // money=5 → false 分支
  assert.deepEqual(engine.variables.money, { type: 'number', value: 5 });
  assert.equal(engine.variables.score, undefined, '不会被项目初始变量表覆盖补全');
  assert.equal(engine.playtimeMs, 1000);
  assert.equal(engine.stage, null);
});

test('loadSave：存档变量非法条目被忽略并 warning', () => {
  const project = makeProject();
  // 用 JSON.parse 构造真实的 own property "__proto__"（对象字面量里的 __proto__ 会改原型）。
  const variables = JSON.parse(
    '{"money":{"type":"number","value":7},"broken":{"type":"wat","value":1},"__proto__":{"type":"string","value":"x"}}',
  );
  const save = {
    version: 1,
    kind: 'manual',
    slot: 1,
    savedAt: new Date().toISOString(),
    projectId: 'proj_phase5',
    schemaVersion: 1,
    nodeId: 'n_dlg',
    variables,
    timeline: null,
    thumbnailDataUrl: null,
    playtimeMs: 0,
  };
  const engine = createEngine({ project, save });
  assert.equal(engine.status, ENGINE_STATUS.RUNNING);
  assert.deepEqual(engine.variables.money, { type: 'number', value: 7 });
  assert.equal(engine.variables.broken, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(engine.variables, '__proto__'), false);
  assert.equal(engine.warnings.length, 2);
  assert.ok(engine.warnings.some((message) => message.includes('broken')));
  assert.ok(engine.warnings.some((message) => message.includes('__proto__')));
});

test('serialize 输出通过 schema $defs.saveState 校验（Ajv，含 manual/auto/quick 槽位约束）', () => {
  const engine = createEngine({ project: makeProject() });
  engine.start();
  engine.tick(1234);
  const manual = engine.serialize({ kind: 'manual', slot: 5, label: '存档', thumbnailDataUrl: null });
  assert.equal(validateSaveState(manual), true, JSON.stringify(validateSaveState.errors));
  // 合法缩略图 data URL 也应通过。
  const withThumbnail = engine.serialize({
    kind: 'auto',
    thumbnailDataUrl: 'data:image/webp;base64,AAAA',
  });
  assert.equal(validateSaveState(withThumbnail), true, JSON.stringify(validateSaveState.errors));
  assert.equal(withThumbnail.slot, 0);
  assert.equal(validateSaveState(engine.serialize({ kind: 'quick' })), true);
});

/* ------------------------------------------------------------------ */
/* 10. 时间轴模块（runtime/timeline.js）                              */
/* ------------------------------------------------------------------ */

test('cubicBezierY：linear 控制点退化为恒等，端点固定，easeIn 起步慢', () => {
  assert.equal(cubicBezierY([0, 0], [1, 1], 0), 0);
  assert.equal(cubicBezierY([0, 0], [1, 1], 1), 1);
  assert.ok(Math.abs(cubicBezierY([0, 0], [1, 1], 0.25) - 0.25) < 1e-3);
  assert.ok(Math.abs(cubicBezierY([0.42, 0], [0.58, 1], 0.5) - 0.5) < 1e-2);
  assert.ok(cubicBezierY([0.42, 0], [1, 1], 0.3) < 0.3);
  assert.ok(cubicBezierY([0, 0], [0.58, 1], 0.7) > 0.7);
});

test('evaluateTrack：首末帧保持，段内按目标帧 easing 插值', () => {
  const track = {
    id: 'tr',
    kind: 'sprite',
    target: 'sp_me',
    property: 'x',
    keys: [
      { time: 0, value: 0.3, easing: LINEAR },
      { time: 1000, value: 0.7, easing: LINEAR },
    ],
  };
  assert.equal(evaluateTrack(track, -100), 0.3);
  assert.equal(evaluateTrack(track, 0), 0.3);
  assert.ok(Math.abs(evaluateTrack(track, 500) - 0.5) < 1e-6);
  assert.equal(evaluateTrack(track, 1000), 0.7);
  assert.equal(evaluateTrack(track, 999999), 0.7);
  assert.equal(evaluateTrack({ id: 'empty', keys: [] }, 100), 0);
});

test('resolveSceneValues：时间轴覆盖蓝图、未覆盖沿用；overridden 列出被覆盖属性', () => {
  const project = makeProject();
  const scene = nodeById(project, 'n_scene');

  const at0 = resolveSceneValues(project, scene, 0);
  assert.equal(at0.background.fit, 'cover');
  assert.equal(at0.sprites[0].x, 0.3);
  assert.equal(at0.audio.volume, 0.2);
  assert.equal(at0.textbox.fontSizePx, 28);
  assert.equal(at0.uiImages.length, 1);
  assert.equal(at0.overridden.length, 4);
  assert.deepEqual(at0.overridden.map((item) => item.property).sort(), ['fontSizePx', 'opacity', 'volume', 'x']);
  assert.deepEqual(at0.overridden[0], {
    trackId: 'tr_sprite_x', kind: 'sprite', target: 'sp_me', property: 'x', value: 0.3,
  });

  const at500 = resolveSceneValues(project, scene, 500);
  assert.ok(Math.abs(at500.sprites[0].x - 0.5) < 1e-6);
  assert.ok(Math.abs(at500.audio.volume - 0.375) < 1e-6);
  // 背景透明度轨道目标是 easeInOut，段内按目标帧 easing 插值。
  const expectedBgOpacity = 0.5 + 0.5 * cubicBezierY([0.42, 0], [0.58, 1], 0.25);
  assert.ok(Math.abs(at500.background.opacity - expectedBgOpacity) < 1e-6);
  assert.ok(Math.abs(at500.textbox.fontSizePx - 34) < 1e-6);
  // 未覆盖属性沿用蓝图。
  assert.equal(at500.background.assetId, 'img_bg');
  assert.equal(at500.sprites[0].assetId, 'img_sp');
  assert.equal(at500.sprites[0].y, 0.6);
  assert.equal(at500.textbox.color, '#ffffff');
});

test('resolveSceneValues：无时间轴场景返回纯蓝图值；缺省字段回落默认', () => {
  const project = makeProject();
  const scene = nodeById(project, 'n_scene_plain');
  assert.equal(getTimeline(project, 'n_scene_plain'), null);
  const values = resolveSceneValues(project, scene, 1234);
  assert.equal(values.background, null);
  assert.deepEqual(values.sprites, []);
  assert.deepEqual(values.overridden, []);
  assert.deepEqual(values.textbox, { ...DEFAULT_TEXTBOX });
  assert.deepEqual(values.audio, { bgmAssetId: null, volume: 0.8, loop: false, fadeInMs: 0, sfx: [] });
});

test('getTimeline / sampleTimeline', () => {
  const project = makeProject();
  assert.equal(getTimeline(project, 'n_dlg'), null);
  assert.equal(getTimeline(project, 'n_missing'), null);
  assert.equal(getTimeline(project, 'n_scene').durationMs, 2000);

  const sample = sampleTimeline(project, 'n_scene', 500);
  assert.ok(Math.abs(sample.sprites[0].x - 0.5) < 1e-6);
  assert.equal(sampleTimeline(project, 'n_dlg', 0), null);
  assert.equal(sampleTimeline(project, 'n_missing', 0), null);
});
