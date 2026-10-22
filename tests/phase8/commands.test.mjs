// 阶段八：Command bus（为未来 MCP 暴露准备的 AI 可调用操作）。
// 覆盖四类优先 command：节点创建 / 连线 / 出口配置 / 时间轴关键帧。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  COMMAND_NAMES,
  commandsToMcpTools,
  executeCommand,
  listCommands,
  validateCommandParams,
} from '../../editor/src/commands/index.js';

const require = createRequire(import.meta.url);
const projectStore = require('../../editor/electron/lib/project.cjs');
const schema = require('../../editor/electron/lib/schema.cjs');

function fixtureProject() {
  const project = projectStore.defaultProject({ title: 'Command Bus 测试项目' });
  project.assets.images.push(
    {
      id: 'img_bg',
      kind: 'image',
      name: '背景',
      role: 'background',
      path: 'assets/images/img_bg.png',
      width: 1280,
      height: 720,
      format: 'png',
    },
    {
      id: 'img_sp',
      kind: 'image',
      name: '立绘',
      role: 'sprite',
      path: 'assets/images/img_sp.png',
      width: 600,
      height: 900,
      format: 'png',
    },
  );
  project.assets.audio.push({
    id: 'aud_bgm',
    kind: 'audio',
    name: 'BGM',
    role: 'bgm',
    path: 'assets/audio/aud_bgm.ogg',
    format: 'ogg',
    durationMs: 5000,
  });
  project.assets.videos.push({
    id: 'vid_clip',
    kind: 'video',
    name: '视频',
    path: 'assets/videos/vid_clip.mp4',
    format: 'mp4',
    codec: 'h264',
  });
  project.assets.minigames.push({
    id: 'mg_demo',
    kind: 'minigame',
    name: '小游戏',
    path: 'assets/minigames/mg_demo.html',
    declaredExits: ['win', 'lose'],
    mode: 'blocking',
  });
  return project;
}

function expectOk(result, label) {
  assert.equal(result.ok, true, `${label} 失败：${JSON.stringify(result.error)}`);
  const validated = schema.validateProject(result.project);
  assert.equal(validated.ok, true, `${label} 结果 schema 不合法：${JSON.stringify(validated.errors)}`);
  return result;
}

function createNode(project, type, extra = {}) {
  return expectOk(executeCommand(project, 'blueprint.createNode', { type, ...extra }), `创建 ${type}`);
}

function getNode(project, nodeId) {
  return project.nodes.find((node) => node.id === nodeId);
}

test('command 描述可 JSON 序列化，并可直接映射为 MCP tools', () => {
  const commands = listCommands();
  assert.equal(commands.length, COMMAND_NAMES.length);
  assert.equal(commands.length, 10);
  assert.deepEqual(new Set(COMMAND_NAMES), new Set(commands.map((item) => item.name)));
  for (const command of commands) {
    assert.ok(command.name.includes('.'), `command 名应带分类前缀：${command.name}`);
    assert.match(command.mcpName, /^[A-Za-z0-9_-]+$/, `MCP 工具名不合法：${command.mcpName}`);
    assert.equal(command.inputSchema.type, 'object');
    assert.equal(command.inputSchema.additionalProperties, false);
    assert.ok(command.description.length > 10);
    assert.ok(command.category === 'blueprint' || command.category === 'timeline');
  }
  const tools = commandsToMcpTools();
  assert.deepEqual(tools.map((tool) => tool.name), commands.map((item) => item.mcpName));
  for (const tool of tools) {
    assert.ok(tool.name.length <= 64);
    assert.equal(tool.inputSchema.type, 'object');
  }
  assert.doesNotThrow(() => JSON.stringify(commands));
});

test('blueprint.createNode：8 类节点都能创建，原项目不被原地修改', () => {
  let project = fixtureProject();
  const types = ['dialogue', 'scene', 'choice', 'minigame', 'video', 'jump', 'condition', 'variable'];
  for (const type of types) {
    const before = JSON.stringify(project);
    const result = createNode(project, type);
    assert.equal(result.affectedNodeIds.length, 1);
    const node = getNode(result.project, result.affectedNodeIds[0]);
    assert.equal(node.type, type);
    assert.match(node.id, /^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
    assert.equal(JSON.stringify(project), before, `${type} 命令修改了原项目`);
    assert.doesNotThrow(() => JSON.stringify(result));
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    project = result.project;
  }
  assert.equal(project.nodes.length, types.length + 1);
  expectOk({ project, ok: true }, '8 类节点');
});

test('blueprint.createNode：参数错误返回结构化错误', () => {
  const project = fixtureProject();
  let result = executeCommand(project, 'blueprint.createNode', { type: 'not-a-type' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'E_INVALID_PARAMS');
  assert.deepEqual(result.affectedNodeIds, []);

  result = executeCommand(project, 'blueprint.createNode', { type: 'scene', assetId: 'img_bg' });
  assert.equal(result.error.code, 'E_INVALID_PARAMS');

  const scene = createNode(project, 'scene');
  result = executeCommand(scene.project, 'blueprint.createNode', {
    type: 'dialogue',
    nodeId: scene.affectedNodeIds[0],
  });
  assert.equal(result.error.code, 'E_DUPLICATE_NODE_ID');

  result = executeCommand(project, 'blueprint.nope', {});
  assert.equal(result.error.code, 'E_UNKNOWN_COMMAND');
  assert.equal(executeCommand(null, 'blueprint.createNode', {}).error.code, 'E_INVALID_PROJECT');
  assert.equal(validateCommandParams('blueprint.connect', {}).ok, false);
});

test('blueprint.connect：连接出口、替换同出口旧连线、校验非法出口', () => {
  const sceneResult = createNode(fixtureProject(), 'scene');
  const sceneId = sceneResult.affectedNodeIds[0];
  const dialogueResult = createNode(sceneResult.project, 'dialogue');
  const dialogueId = dialogueResult.affectedNodeIds[0];
  const project = dialogueResult.project;

  const connected = expectOk(
    executeCommand(project, 'blueprint.connect', {
      fromNodeId: sceneId,
      fromExitId: 'next',
      toNodeId: dialogueId,
    }),
    '连线',
  );
  assert.equal(connected.project.edges.length, 1);
  assert.equal(connected.project.edges[0].from, sceneId);
  assert.equal(connected.project.edges[0].port, 'next');
  assert.equal(connected.project.edges[0].to, dialogueId);
  assert.equal(connected.project.edges[0].kind, 'sequence');
  assert.deepEqual(connected.affectedNodeIds.sort(), [sceneId, dialogueId].sort());
  assert.equal(connected.data.replacedEdgeId, null);

  // 同一出口重新连接 → 替换旧边，不新增
  const replaced = expectOk(
    executeCommand(connected.project, 'blueprint.connect', {
      fromNodeId: sceneId,
      fromExitId: 'next',
      toNodeId: dialogueId,
    }),
    '替换连线',
  );
  assert.equal(replaced.project.edges.length, 1);
  assert.equal(replaced.data.replacedEdgeId, connected.project.edges[0].id);
  assert.ok(replaced.warnings.some((item) => item.includes('替换')));

  const badExit = executeCommand(replaced.project, 'blueprint.connect', {
    fromNodeId: sceneId,
    fromExitId: 'nope',
    toNodeId: dialogueId,
  });
  assert.equal(badExit.error.code, 'E_CONNECTION_INVALID');

  const badTarget = executeCommand(replaced.project, 'blueprint.connect', {
    fromNodeId: sceneId,
    fromExitId: 'next',
    toNodeId: 'n_missing',
  });
  assert.equal(badTarget.error.code, 'E_CONNECTION_INVALID');

  // condition 节点自动使用 conditional 边，即使调用方传了 sequence
  let withCondition = createNode(replaced.project, 'condition').project;
  const condition = withCondition.nodes[withCondition.nodes.length - 1];
  const conditional = expectOk(
    executeCommand(withCondition, 'blueprint.connect', {
      fromNodeId: condition.id,
      fromExitId: 'true',
      toNodeId: dialogueId,
      kind: 'sequence',
    }),
    '条件连线',
  );
  assert.equal(conditional.project.edges.at(-1).kind, 'conditional');
  assert.ok(conditional.warnings.some((item) => item.includes('conditional')));
});

test('blueprint 出口配置：choice 增删改 + 固定出口保护 + 级联删边', () => {
  const choiceResult = createNode(fixtureProject(), 'choice');
  const choiceId = choiceResult.affectedNodeIds[0];
  const dialogueResult = createNode(choiceResult.project, 'dialogue');
  const dialogueId = dialogueResult.affectedNodeIds[0];
  let project = dialogueResult.project;
  const choice = getNode(project, choiceId);

  const added = expectOk(
    executeCommand(project, 'blueprint.addExit', { nodeId: choice.id, name: '新选项' }),
    '新增出口',
  );
  assert.equal(added.data.exit.name, '新选项');
  assert.match(added.data.exit.id, /^opt_\d+$/);
  assert.deepEqual(added.affectedNodeIds, [choice.id]);
  project = added.project;

  const exitId = added.data.exit.id;
  const updated = expectOk(
    executeCommand(project, 'blueprint.updateExit', { nodeId: choice.id, exitId, name: '改名选项', label: '按钮' }),
    '修改出口',
  );
  assert.equal(updated.data.exit.name, '改名选项');
  assert.equal(updated.data.exit.label, '按钮');
  project = updated.project;

  // 为待删除出口建一条边，删除出口时应级联删除
  const connected = expectOk(
    executeCommand(project, 'blueprint.connect', {
      fromNodeId: choice.id,
      fromExitId: exitId,
      toNodeId: dialogueId,
    }),
    '出口连线',
  );
  project = connected.project;
  const removed = expectOk(
    executeCommand(project, 'blueprint.removeExit', { nodeId: choice.id, exitId }),
    '删除出口',
  );
  assert.deepEqual(removed.data.removedEdgeIds, [connected.data.edge.id]);
  assert.equal(removed.project.edges.length, 0);
  assert.ok(removed.affectedNodeIds.includes(dialogueId));
  project = removed.project;

  // choice 最少保留 2 个出口
  let current = getNode(project, choice.id);
  assert.equal(current.exits.length, 2);
  const blocked = executeCommand(project, 'blueprint.removeExit', {
    nodeId: choice.id,
    exitId: current.exits[0].id,
  });
  assert.equal(blocked.error.code, 'E_EXIT_MIN');

  // 固定出口节点：不能增删/改名，但可以改 label
  const fixedResult = createNode(fixtureProject(), 'dialogue');
  const fixedDialogueId = fixedResult.affectedNodeIds[0];
  let fixedProject = fixedResult.project;
  const dialogue = getNode(fixedProject, fixedDialogueId);
  assert.equal(
    executeCommand(fixedProject, 'blueprint.addExit', { nodeId: dialogue.id, name: 'x' }).error.code,
    'E_FIXED_EXITS',
  );
  assert.equal(
    executeCommand(fixedProject, 'blueprint.updateExit', { nodeId: dialogue.id, exitId: 'next', name: 'next2' })
      .error.code,
    'E_FIXED_EXITS',
  );
  fixedProject = expectOk(
    executeCommand(fixedProject, 'blueprint.updateExit', { nodeId: dialogue.id, exitId: 'next', label: '继续' }),
    '固定出口改 label',
  ).project;
  assert.equal(getNode(fixedProject, dialogue.id).exits[0].label, '继续');
  assert.equal(
    executeCommand(fixedProject, 'blueprint.removeExit', { nodeId: dialogue.id, exitId: 'next' }).error.code,
    'E_FIXED_EXITS',
  );

  // minigame：默认出口可设置/清空，出口可删
  const mgResult = createNode(fixtureProject(), 'minigame');
  const minigameId = mgResult.affectedNodeIds[0];
  let mgProject = mgResult.project;
  const minigame = getNode(mgProject, minigameId);
  mgProject = expectOk(
    executeCommand(mgProject, 'blueprint.setDefaultExit', { nodeId: minigame.id, exitId: minigame.exits[0].id }),
    '设置默认出口',
  ).project;
  assert.equal(getNode(mgProject, minigame.id).defaultExitId, minigame.exits[0].id);
  assert.equal(
    executeCommand(mgProject, 'blueprint.setDefaultExit', { nodeId: minigame.id, exitId: 'nope' }).error.code,
    'E_EXIT_NOT_FOUND',
  );
  mgProject = expectOk(
    executeCommand(mgProject, 'blueprint.setDefaultExit', { nodeId: minigame.id, exitId: null }),
    '清空默认出口',
  ).project;
  assert.equal(getNode(mgProject, minigame.id).defaultExitId, null);
  mgProject = expectOk(
    executeCommand(mgProject, 'blueprint.removeExit', { nodeId: minigame.id, exitId: minigame.exits[0].id }),
    '删除小游戏出口',
  ).project;
  assert.equal(getNode(mgProject, minigame.id).exits.length, 1);
});

test('timeline：自动建时间轴/轨道，增改删关键帧与轨道', () => {
  const sceneResult = createNode(fixtureProject(), 'scene');
  const sceneId = sceneResult.affectedNodeIds[0];
  let project = sceneResult.project;

  const added = expectOk(
    executeCommand(project, 'timeline.addKeyframe', {
      sceneNodeId: sceneId,
      kind: 'background',
      property: 'opacity',
      time: 1000,
      value: 0.5,
      preset: 'easeIn',
      intensity: 0.6,
    }),
    '添加关键帧',
  );
  assert.equal(added.data.createdAt, true);
  assert.equal(added.data.track.kind, 'background');
  assert.equal(added.data.track.keys.length, 2);
  assert.equal(added.data.track.keys.find((key) => key.time === 1000).value, 0.5);
  assert.equal(added.affectedNodeIds[0], sceneId);
  assert.equal(added.affectedTrackIds[0], added.data.track.id);
  project = added.project;

  const trackId = added.data.track.id;
  const replaced = expectOk(
    executeCommand(project, 'timeline.addKeyframe', {
      sceneNodeId: sceneId,
      trackId,
      time: 1000,
      value: 0.25,
    }),
    '覆盖关键帧',
  );
  assert.equal(replaced.data.track.keys.length, 2);
  assert.equal(replaced.data.track.keys.find((key) => key.time === 1000).value, 0.25);
  project = replaced.project;

  const moved = expectOk(
    executeCommand(project, 'timeline.updateKeyframe', {
      sceneNodeId: sceneId,
      trackId,
      time: 1000,
      newTime: 2000,
      value: 2,
      preset: 'linear',
    }),
    '修改关键帧',
  );
  assert.ok(moved.warnings.some((item) => item.includes('收敛')));
  const key = moved.data.track.keys.find((item) => item.time === 2000);
  assert.equal(key.value, 1);
  project = moved.project;

  // 目标时间已有其它关键帧 → 拒绝
  project = expectOk(
    executeCommand(project, 'timeline.addKeyframe', {
      sceneNodeId: sceneId,
      trackId,
      time: 3000,
      value: 0.5,
    }),
    '添加第二个关键帧',
  ).project;
  const duplicate = executeCommand(project, 'timeline.updateKeyframe', {
    sceneNodeId: sceneId,
    trackId,
    time: 3000,
    newTime: 2000,
  });
  assert.equal(duplicate.error.code, 'E_DUPLICATE_TIME');

  // 时间超出时间轴时长
  const outOfRange = executeCommand(project, 'timeline.addKeyframe', {
    sceneNodeId: sceneId,
    kind: 'audio',
    property: 'volume',
    time: 6000,
    value: 0.5,
  });
  assert.equal(outOfRange.error.code, 'E_TIME_OUT_OF_RANGE');

  // 轨道不存在 / 非法属性
  assert.equal(
    executeCommand(project, 'timeline.addKeyframe', {
      sceneNodeId: sceneId,
      trackId: 'trk_missing',
      time: 0,
      value: 1,
    }).error.code,
    'E_TRACK_NOT_FOUND',
  );
  assert.equal(
    executeCommand(project, 'timeline.addKeyframe', {
      sceneNodeId: sceneId,
      kind: 'audio',
      property: 'x',
      time: 0,
      value: 1,
    }).error.code,
    'E_INVALID_TRACK',
  );

  // sprite 轨道需要合法 target
  const sceneNode = getNode(project, sceneId);
  sceneNode.sprites = [{ id: 'sp_1', assetId: 'img_sp', x: 0.5, y: 1, scale: 1, zIndex: 0, opacity: 1 }];
  const spriteAdded = expectOk(
    executeCommand(project, 'timeline.addKeyframe', {
      sceneNodeId: sceneId,
      kind: 'sprite',
      target: 'sp_1',
      property: 'x',
      time: 500,
      value: 0.8,
    }),
    '立绘关键帧',
  );
  project = spriteAdded.project;
  assert.equal(
    executeCommand(project, 'timeline.addKeyframe', {
      sceneNodeId: sceneId,
      kind: 'sprite',
      target: 'sp_missing',
      property: 'x',
      time: 0,
      value: 0.5,
    }).error.code,
    'E_INVALID_TRACK',
  );

  // 轨道至少保留一个关键帧；删除轨道则允许
  const lastTrack = executeCommand(project, 'timeline.addKeyframe', {
    sceneNodeId: sceneId,
    kind: 'textbox',
    property: 'fontSizePx',
    time: 0,
    value: 18,
  });
  assert.equal(lastTrack.ok, true);
  assert.equal(
    executeCommand(lastTrack.project, 'timeline.removeKeyframe', {
      sceneNodeId: sceneId,
      trackId: lastTrack.data.track.id,
      time: 0,
    }).error.code,
    'E_LAST_KEYFRAME',
  );
  const removedTrack = expectOk(
    executeCommand(lastTrack.project, 'timeline.removeTrack', {
      sceneNodeId: sceneId,
      trackId: lastTrack.data.track.id,
    }),
    '删除轨道',
  );
  assert.equal(
    (removedTrack.project.timelines[sceneId]?.tracks ?? []).some(
      (track) => track.id === lastTrack.data.track.id,
    ),
    false,
  );
});

test('command 结果结构固定，可直接被 MCP 客户端消费', () => {
  const sceneResult = createNode(fixtureProject(), 'scene');
  const project = sceneResult.project;
  const sceneId = sceneResult.affectedNodeIds[0];
  const created = executeCommand(project, 'blueprint.createNode', { type: 'dialogue' });
  assert.deepEqual(Object.keys(created).sort(), [
    'affectedNodeIds',
    'affectedTrackIds',
    'command',
    'data',
    'ok',
    'project',
    'warnings',
  ]);
  const failure = executeCommand(project, 'blueprint.connect', { fromNodeId: sceneId });
  assert.deepEqual(Object.keys(failure).sort(), [
    'affectedNodeIds',
    'affectedTrackIds',
    'command',
    'error',
    'ok',
    'warnings',
  ]);
  assert.equal(typeof failure.error.code, 'string');
  assert.equal(typeof failure.error.message, 'string');
  assert.doesNotThrow(() => JSON.stringify(failure));
  // MCP 下划线别名可直接调用
  const alias = executeCommand(project, 'blueprint_createNode', { type: 'dialogue' });
  assert.equal(alias.ok, true);
  assert.equal(alias.command, 'blueprint.createNode');
});
