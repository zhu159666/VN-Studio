// 阶段三：蓝图纯逻辑测试（节点草稿 / 拖拽生成 / 连线 / 项目变更）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  applyAssetDrop,
  createNodeDraft,
  edgeKindForNode,
  makeEdgeFromConnection,
  nodeWidth,
  validateConnection,
} from '../../editor/src/features/blueprint/blueprintUtils.js';
import {
  addEdgeToProject,
  removeEdgeFromProject,
  removeNodeExitFromProject,
  removeNodeFromProject,
  setNodePositionsInProject,
  updateNodeExitInProject,
  updateNodeInProject,
} from '../../editor/src/state/projectMutations.js';

const require = createRequire(import.meta.url);
const projectStore = require('../../editor/electron/lib/project.cjs');
const schema = require('../../editor/electron/lib/schema.cjs');

function fixtureProject() {
  const project = projectStore.defaultProject({ title: '蓝图测试项目' });
  project.assets.images.push(
    {
      id: 'img_bg', kind: 'image', name: '背景', role: 'background',
      path: 'assets/images/img_bg.png', width: 1280, height: 720, format: 'png',
    },
    {
      id: 'img_sp', kind: 'image', name: '立绘', role: 'sprite',
      path: 'assets/images/img_sp.png', width: 600, height: 900, format: 'png',
    },
    {
      id: 'img_ui', kind: 'image', name: 'UI', role: 'ui',
      path: 'assets/images/img_ui.png', width: 64, height: 64, format: 'png',
    },
  );
  project.assets.audio.push({
    id: 'aud_bgm', kind: 'audio', name: 'BGM', role: 'bgm',
    path: 'assets/audio/aud_bgm.ogg', format: 'ogg', durationMs: 5000,
  });
  project.assets.videos.push({
    id: 'vid_clip', kind: 'video', name: '视频',
    path: 'assets/videos/vid_clip.mp4', format: 'mp4', codec: 'h264',
  });
  project.assets.minigames.push({
    id: 'mg_demo', kind: 'minigame', name: '小游戏',
    path: 'assets/minigames/mg_demo.html', declaredExits: ['win', 'lose'],
    mode: 'blocking',
  });
  return project;
}

function assertProjectValid(project, label) {
  const result = schema.validateProject(project);
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.errors, null, 2)}`);
}

test('nodeWidth 随出口数量单调增长，edgeKind 由源节点派生', () => {
  assert.ok(nodeWidth(4) > nodeWidth(1));
  assert.ok(nodeWidth(10) >= nodeWidth(6));
  assert.equal(nodeWidth(0), 236);
  assert.equal(edgeKindForNode({ type: 'condition' }), 'conditional');
  assert.equal(edgeKindForNode({ type: 'scene' }), 'sequence');
  assert.equal(edgeKindForNode({ type: 'choice' }), 'sequence');
});

test('8 类节点草稿均能通过 schema 校验', () => {
  for (const type of ['dialogue', 'scene', 'choice', 'minigame', 'video', 'jump', 'condition', 'variable']) {
    const project = fixtureProject();
    const draft = createNodeDraft(project, type, { position: { x: 400, y: 200 } });
    assert.ok(draft.node, `${type} 草稿失败：${draft.error}`);
    assert.equal(draft.node.type, type);
    project.nodes.push(draft.node);
    assertProjectValid(project, `${type} 草稿`);
  }
});

test('缺少素材时视频/小游戏草稿返回可读错误', () => {
  const project = projectStore.defaultProject({ title: '空项目' });
  assert.match(createNodeDraft(project, 'video').error, /视频/);
  assert.match(createNodeDraft(project, 'minigame').error, /小游戏/);
});

test('图片背景拖到空白处：创建场景节点并设置背景', () => {
  let project = fixtureProject();
  const result = applyAssetDrop(project, {
    asset: project.assets.images[0],
    flowPosition: { x: 120, y: 80 },
  });
  assert.equal(result.error, undefined);
  const created = result.project.nodes.find((node) => node.id === result.selectedNodeId);
  assert.ok(created);
  assert.equal(created.type, 'scene');
  assert.equal(created.background.assetId, 'img_bg');
  assert.deepEqual(created.position, { x: 120, y: 80 });
  assertProjectValid(result.project, '背景拖拽');
});

test('图片背景拖到场景节点：替换背景；音频 BGM 拖到场景：设置 BGM', () => {
  let project = fixtureProject();
  const sceneDraft = createNodeDraft(project, 'scene', { position: { x: 300, y: 0 } }).node;
  project.nodes.push(sceneDraft);
  project = applyAssetDrop(project, {
    asset: project.assets.images[0],
    targetNodeId: sceneDraft.id,
  }).project;
  assert.equal(project.nodes.find((n) => n.id === sceneDraft.id).background.assetId, 'img_bg');
  project = applyAssetDrop(project, {
    asset: project.assets.audio[0],
    targetNodeId: sceneDraft.id,
  }).project;
  assert.equal(project.nodes.find((n) => n.id === sceneDraft.id).audio.bgmAssetId, 'aud_bgm');
  assertProjectValid(project, '背景/BGM 替换');
});

test('音频拖到空白处 / 对话节点会被拒绝', () => {
  const project = fixtureProject();
  const result = applyAssetDrop(project, { asset: project.assets.audio[0], flowPosition: { x: 0, y: 0 } });
  assert.match(result.error, /场景节点/);
  const result2 = applyAssetDrop(project, {
    asset: project.assets.audio[0],
    targetNodeId: project.nodes[0].id,
  });
  assert.match(result2.error, /场景节点/);
});

test('立绘拖拽：先要位置参数，确认后加入场景 sprites', () => {
  const project = fixtureProject();
  const first = applyAssetDrop(project, { asset: project.assets.images[1], flowPosition: { x: 0, y: 0 } });
  assert.equal(first.needsSpriteOptions, true);

  const result = applyAssetDrop(project, {
    asset: project.assets.images[1],
    flowPosition: { x: 200, y: 100 },
    spriteOptions: { assetId: 'img_sp', x: 0.3, y: 0.6, scale: 1.1, zIndex: 12, opacity: 0.95 },
  });
  const scene = result.project.nodes.find((node) => node.id === result.selectedNodeId);
  assert.equal(scene.sprites.length, 1);
  assert.equal(scene.sprites[0].assetId, 'img_sp');
  assert.equal(scene.sprites[0].x, 0.3);
  assertProjectValid(result.project, '立绘拖拽');

  const project2 = fixtureProject();
  const sceneDraft = createNodeDraft(project2, 'scene', { position: { x: 0, y: 0 } }).node;
  project2.nodes.push(sceneDraft);
  const result2 = applyAssetDrop(project2, {
    asset: project2.assets.images[1],
    targetNodeId: sceneDraft.id,
    spriteOptions: { assetId: 'img_sp', x: 0.5, y: 0.6, scale: 1, zIndex: 10, opacity: 1 },
  });
  assert.equal(result2.project.nodes.find((n) => n.id === sceneDraft.id).sprites.length, 1);
});

test('视频 / 小游戏拖到空白处创建对应节点', () => {
  const project = fixtureProject();
  const v = applyAssetDrop(project, {
    asset: project.assets.videos[0],
    flowPosition: { x: 50, y: 50 },
  });
  assert.equal(v.project.nodes.find((node) => node.id === v.selectedNodeId).type, 'video');
  assertProjectValid(v.project, '视频拖拽');

  const m = applyAssetDrop(project, {
    asset: project.assets.minigames[0],
    flowPosition: { x: 60, y: 60 },
  });
  const minigame = m.project.nodes.find((node) => node.id === m.selectedNodeId);
  assert.equal(minigame.type, 'minigame');
  assert.deepEqual(minigame.exits.map((exit) => exit.name), ['win', 'lose']);
  assertProjectValid(m.project, '小游戏拖拽');
});

test('连线校验：出口必须存在，condition 生成 conditional 边', () => {
  const project = fixtureProject();
  const scene = createNodeDraft(project, 'scene', { position: { x: 0, y: 0 } }).node;
  const condition = createNodeDraft(project, 'condition', { position: { x: 300, y: 0 } }).node;
  project.nodes.push(scene, condition);

  assert.equal(validateConnection(project, { source: scene.id, sourceHandle: 'next', target: condition.id }).ok, true);
  assert.match(
    validateConnection(project, { source: scene.id, sourceHandle: 'nope', target: condition.id }).error,
    /出口/,
  );

  const edge = makeEdgeFromConnection(project, {
    source: condition.id,
    sourceHandle: 'true',
    target: scene.id,
  });
  assert.equal(edge.error, undefined);
  assert.equal(edge.edge.kind, 'conditional');
  assert.equal(edge.edge.port, 'true');

  const sequence = makeEdgeFromConnection(project, {
    source: scene.id,
    sourceHandle: 'next',
    target: condition.id,
  });
  assert.equal(sequence.edge.kind, 'sequence');
});

test('项目变更：删除节点清理连线/起始节点；删除出口清理连线与 defaultExitId', () => {
  const project = fixtureProject();
  const scene = createNodeDraft(project, 'scene', { position: { x: 0, y: 0 } }).node;
  project.nodes.push(scene);
  project.edges.push({
    id: 'e1', from: scene.id, port: 'next', to: project.nodes[0].id, kind: 'sequence',
  });
  project.edges.push({
    id: 'e2', from: project.nodes[0].id, port: 'next', to: scene.id, kind: 'sequence',
  });
  project.settings.startNodeId = scene.id;

  const removed = removeNodeFromProject(project, scene.id);
  assert.equal(removed.nodes.some((node) => node.id === scene.id), false);
  assert.equal(removed.edges.length, 0);
  assert.equal(removed.settings.startNodeId, null);

  const minigame = createNodeDraft(project, 'minigame', { position: { x: 0, y: 300 } }).node;
  minigame.defaultExitId = minigame.exits[0].id;
  project.nodes.push(minigame);
  project.edges.push({
    id: 'e3', from: minigame.id, port: minigame.exits[0].id, to: project.nodes[0].id, kind: 'sequence',
  });
  const noExit = removeNodeExitFromProject(project, minigame.id, minigame.exits[0].id);
  const nextMini = noExit.nodes.find((node) => node.id === minigame.id);
  assert.equal(nextMini.exits.some((exit) => exit.id === minigame.exits[0].id), false);
  assert.equal(nextMini.defaultExitId, null);
  assert.equal(noExit.edges.some((edge) => edge.from === minigame.id), false);
});

test('addEdge 替换同一出口旧边；setNodePositions 更新坐标；updateNodeExit 改显示名', () => {
  const project = fixtureProject();
  const scene = createNodeDraft(project, 'scene', { position: { x: 0, y: 0 } }).node;
  project.nodes.push(scene);
  let next = addEdgeToProject(project, {
    id: 'e_old', from: scene.id, port: 'next', to: project.nodes[0].id, kind: 'sequence',
  });
  next = addEdgeToProject(next, {
    id: 'e_new', from: scene.id, port: 'next', to: project.nodes[0].id, kind: 'sequence',
  });
  assert.equal(next.edges.filter((edge) => edge.from === scene.id).length, 1);
  assert.equal(next.edges[0].id, 'e_new');

  const moved = setNodePositionsInProject(next, [{ id: scene.id, x: 420, y: 240 }]);
  assert.deepEqual(moved.nodes.find((node) => node.id === scene.id).position, { x: 420, y: 240 });

  const renamed = updateNodeExitInProject(next, scene.id, 'next', { label: '继续' });
  assert.equal(renamed.nodes.find((node) => node.id === scene.id).exits[0].label, '继续');

  const patched = updateNodeInProject(next, scene.id, { notes: '测试备注' });
  assert.equal(patched.nodes.find((node) => node.id === scene.id).notes, '测试备注');
  assert.equal(removeEdgeFromProject(next, 'e_new').edges.length, 0);
});
