// 阶段一最小单元测试：对示例项目做 schema 之外无法表达的引用完整性 / 语义校验。
// 这些规则后续会成为编辑器保存校验与导出校验的共同实现（阶段 2+ 抽成共享模块）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/demo-project.json'), 'utf8'));
const saveSample = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/save-sample.json'), 'utf8'));

const nodesById = new Map(demo.nodes.map((node) => [node.id, node]));
const assetById = new Map(
  [...demo.assets.images, ...demo.assets.audio, ...demo.assets.videos, ...demo.assets.minigames].map(
    (asset) => [asset.id, asset],
  ),
);
const nodeType = (node) => node.type;
const outgoing = (nodeId) => demo.edges.filter((edge) => edge.from === nodeId);

function duplicateIds(items) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates];
}

function duplicateExitIds(project) {
  const problems = [];
  for (const node of project.nodes) {
    const seen = new Set();
    for (const exit of node.exits) {
      if (seen.has(exit.id)) problems.push(`${node.id}:${exit.id}`);
      seen.add(exit.id);
    }
  }
  return problems;
}

test('示例覆盖全部 8 种节点类型', () => {
  const types = new Set(demo.nodes.map(nodeType));
  assert.deepEqual(
    [...types].sort(),
    ['choice', 'condition', 'dialogue', 'jump', 'minigame', 'scene', 'variable', 'video'],
  );
});

test('节点 id / 连线 id / 素材 id 在各自命名空间内唯一', () => {
  assert.deepEqual(duplicateIds(demo.nodes), [], '节点 id 重复');
  assert.deepEqual(duplicateIds(demo.edges), [], '连线 id 重复');
  assert.deepEqual(
    duplicateIds([
      ...demo.assets.images,
      ...demo.assets.audio,
      ...demo.assets.videos,
      ...demo.assets.minigames,
    ]),
    [],
    '素材 id 重复',
  );
});

test('出口 id 在节点内唯一（JSON Schema 无法表达，必须由校验层拦截）', () => {
  assert.deepEqual(duplicateExitIds(demo), [], '示例项目存在重复出口 id');

  const mutated = structuredClone(demo);
  const minigame = mutated.nodes.find((node) => node.type === 'minigame');
  const duplicatedId = minigame.exits[0].id;
  minigame.exits.push({ ...minigame.exits[0], name: '另一个名字' });
  assert.deepEqual(
    duplicateExitIds(mutated),
    [`${minigame.id}:${duplicatedId}`],
    '校验层未能识别重复的出口 id',
  );
});

test('每条连线的 from / to 节点存在，port 是源节点真实出口', () => {
  for (const edge of demo.edges) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    assert.ok(from, `连线 ${edge.id} 的 from 节点不存在：${edge.from}`);
    assert.ok(to, `连线 ${edge.id} 的 to 节点不存在：${edge.to}`);
    assert.ok(
      from.exits.some((exit) => exit.id === edge.port),
      `连线 ${edge.id} 的 port ${edge.port} 不是 ${edge.from} 的出口`,
    );
  }
});

test('连线 kind 与源节点类型一致，且第一版示例不含 data 连线', () => {
  for (const edge of demo.edges) {
    const from = nodesById.get(edge.from);
    const expected = from.type === 'condition' ? 'conditional' : 'sequence';
    assert.equal(edge.kind, expected, `连线 ${edge.id}（${from.type}）的 kind 应为 ${expected}`);
  }
  assert.equal(
    demo.edges.filter((edge) => edge.kind === 'data').length,
    0,
    '第一版不实现 data 连线 UI，示例不应包含 data 连线',
  );
});

test('每个出口最多一条出边，且所有非 jump 出口都被连线覆盖', () => {
  for (const node of demo.nodes) {
    const edges = outgoing(node.id);
    const ports = edges.map((edge) => edge.port);
    assert.equal(new Set(ports).size, ports.length, `节点 ${node.id} 存在重复出口连线`);

    if (node.type === 'jump') {
      assert.equal(node.exits.length, 0, 'jump 节点不应有出口');
      assert.equal(edges.length, 0, 'jump 节点不应有出边');
      continue;
    }

    for (const exit of node.exits) {
      assert.equal(
        edges.filter((edge) => edge.port === exit.id).length,
        1,
        `节点 ${node.id} 的出口 ${exit.id} 必须恰好有一条出边`,
      );
    }
    assert.equal(edges.length, node.exits.length, `节点 ${node.id} 存在指向未知出口的连线`);
  }
});

test('小游戏节点出口覆盖素材声明的 MINIGAME_EXITS，且 defaultExitId 合法', () => {
  for (const node of demo.nodes.filter((item) => item.type === 'minigame')) {
    const asset = assetById.get(node.minigameAssetId);
    assert.ok(asset, `小游戏素材不存在：${node.minigameAssetId}`);
    assert.equal(asset.kind, 'minigame');
    for (const declared of asset.declaredExits) {
      assert.ok(
        node.exits.some((exit) => exit.name === declared),
        `小游戏节点 ${node.id} 缺少声明出口 ${declared}`,
      );
    }
    const names = node.exits.map((exit) => exit.name);
    assert.equal(new Set(names).size, names.length, `小游戏节点 ${node.id} 出口 name 重复`);
    if (node.defaultExitId !== null) {
      assert.ok(
        node.exits.some((exit) => exit.id === node.defaultExitId),
        `节点 ${node.id} 的 defaultExitId 不是本节点出口`,
      );
    }
  }
});

test('视频节点两个出口都有出边', () => {
  for (const node of demo.nodes.filter((item) => item.type === 'video')) {
    for (const id of ['completed', 'skipped']) {
      assert.ok(
        demo.edges.some((edge) => edge.from === node.id && edge.port === id),
        `视频节点 ${node.id} 缺少 ${id} 出口连线`,
      );
    }
  }
});

test('起始节点与跳转目标存在', () => {
  assert.ok(demo.settings.startNodeId, '示例必须设置 startNodeId');
  assert.ok(nodesById.has(demo.settings.startNodeId), 'startNodeId 指向不存在的节点');
  for (const node of demo.nodes.filter((item) => item.type === 'jump')) {
    assert.ok(nodesById.has(node.targetNodeId), `跳转节点 ${node.id} 指向不存在的节点`);
  }
});

test('场景 / 对话 / 视频 / 小游戏引用的素材存在且角色匹配', () => {
  for (const node of demo.nodes) {
    if (node.type === 'scene') {
      if (node.background) {
        const image = assetById.get(node.background.assetId);
        assert.ok(image && image.kind === 'image', `场景 ${node.id} 背景素材不存在`);
        assert.equal(image.role, 'background', `场景 ${node.id} 背景素材 role 应为 background`);
      }
      for (const sprite of node.sprites) {
        const image = assetById.get(sprite.assetId);
        assert.ok(image && image.kind === 'image', `场景 ${node.id} 立绘素材不存在：${sprite.assetId}`);
        assert.equal(image.role, 'sprite', `场景 ${node.id} 立绘素材 role 应为 sprite`);
      }
      if (node.audio.bgmAssetId !== null) {
        const audio = assetById.get(node.audio.bgmAssetId);
        assert.ok(audio && audio.kind === 'audio', `场景 ${node.id} BGM 素材不存在`);
        assert.equal(audio.role, 'bgm', `场景 ${node.id} BGM 素材 role 应为 bgm`);
      }
    }
    if (node.type === 'dialogue' && node.portrait) {
      const image = assetById.get(node.portrait.assetId);
      assert.ok(image && image.kind === 'image', `对话 ${node.id} 立绘素材不存在`);
      assert.equal(image.role, 'sprite', `对话 ${node.id} 立绘素材 role 应为 sprite`);
    }
    if (node.type === 'video') {
      const video = assetById.get(node.videoAssetId);
      assert.ok(video && video.kind === 'video', `视频节点 ${node.id} 素材不存在`);
      assert.equal(video.format, 'mp4', '示例视频应为 mp4（浏览器兼容性演示）');
    }
    if (node.type === 'minigame') {
      const minigame = assetById.get(node.minigameAssetId);
      assert.ok(minigame && minigame.kind === 'minigame', `小游戏节点 ${node.id} 素材不存在`);
    }
  }
});

test('时间轴只挂在 scene 节点上，轨道 target 存在，关键帧有序且在时长内', () => {
  const sceneIds = new Set(demo.nodes.filter((node) => node.type === 'scene').map((node) => node.id));
  assert.ok(Object.keys(demo.timelines).length >= 2, '示例至少应有 2 个场景时间轴');

  for (const [nodeId, timeline] of Object.entries(demo.timelines)) {
    const scene = nodesById.get(nodeId);
    assert.ok(scene, `时间轴键 ${nodeId} 不是节点`);
    assert.ok(sceneIds.has(nodeId), `时间轴只能挂在 scene 节点上：${nodeId}`);

    const trackIds = new Set();
    for (const track of timeline.tracks) {
      assert.ok(!trackIds.has(track.id), `场景 ${nodeId} 轨道 id 重复：${track.id}`);
      trackIds.add(track.id);

      if (track.kind === 'sprite') {
        assert.ok(
          scene.sprites.some((sprite) => sprite.id === track.target),
          `场景 ${nodeId} 的立绘轨道 target ${track.target} 不存在`,
        );
      }

      const times = track.keys.map((key) => key.time);
      for (let i = 1; i < times.length; i += 1) {
        assert.ok(times[i] > times[i - 1], `场景 ${nodeId} 轨道 ${track.id} 关键帧未严格升序`);
      }
      assert.ok(
        times[times.length - 1] <= timeline.durationMs,
        `场景 ${nodeId} 轨道 ${track.id} 关键帧超出时间轴时长`,
      );

      for (const key of track.keys) {
        const [x1, y1] = key.easing.p1;
        const [x2, y2] = key.easing.p2;
        assert.ok(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1, '贝塞尔控制点 x 必须在 0–1');
        assert.ok(Number.isFinite(y1) && Number.isFinite(y2), '贝塞尔控制点 y 必须是有限数');
        if (track.property === 'opacity' || track.property === 'volume') {
          assert.ok(
            key.value >= 0 && key.value <= 1,
            `场景 ${nodeId} 轨道 ${track.id} 的 ${track.property} 关键帧值必须在 0–1`,
          );
        }
      }
    }
  }
});

test('场景变量声明不重复，变量名不重复', () => {
  const seen = new Set();
  for (const node of demo.nodes.filter((item) => item.type === 'scene')) {
    const keys = node.variables.map((variable) => variable.key);
    assert.equal(new Set(keys).size, keys.length, `场景 ${node.id} 变量名重复`);
    for (const key of keys) {
      // 同一变量允许在多个场景声明（缺失才初始化），这里只检查场景内重复。
      seen.add(key);
    }
  }
  assert.ok(seen.size > 0, '示例应包含场景变量声明');
});

test('存档样例引用同一项目且节点 / 时间轴位置合法', () => {
  assert.equal(saveSample.projectId, demo.meta.id, '存档 projectId 必须与项目 meta.id 一致');
  assert.equal(saveSample.schemaVersion, demo.schemaVersion, '存档与项目 schemaVersion 必须一致');
  assert.ok(nodesById.has(saveSample.nodeId), '存档 nodeId 不存在');

  if (saveSample.timeline !== null) {
    const { nodeId, timeMs } = saveSample.timeline;
    assert.ok(nodesById.has(nodeId), '存档时间轴 nodeId 不存在');
    assert.equal(nodesById.get(nodeId).type, 'scene', '存档时间轴必须指向 scene 节点');
    assert.ok(
      timeMs >= 0 && timeMs <= demo.timelines[nodeId].durationMs,
      '存档时间轴进度超出时长',
    );
  }

  for (const [key, typed] of Object.entries(saveSample.variables)) {
    assert.ok(key.length > 0, '变量名不能为空');
    assert.ok(
      ['number', 'string', 'boolean', 'array', 'object', 'null'].includes(typed.type),
      `存档变量 ${key} 类型标签非法`,
    );
  }
});
