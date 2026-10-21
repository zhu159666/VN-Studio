// 阶段一最小单元测试：schema 本身可编译、合法示例通过、常见非法结构被拒绝。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Ajv2020 = require('ajv/dist/2020');

const ROOT = process.cwd();
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/schema.json'), 'utf8'));
const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/demo-project.json'), 'utf8'));
const saveSample = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/save-sample.json'), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
const validateProject = ajv.compile(schema);
const validateSave = ajv.compile({ $ref: `${schema.$id}#/$defs/saveState` });

const clone = (value) => JSON.parse(JSON.stringify(value));
const nodeOfType = (project, type) => project.nodes.find((node) => node.type === type);

function assertInvalid(data, label, pathFragment) {
  const ok = validateProject(data);
  const errors = clone(validateProject.errors ?? []);
  assert.equal(ok, false, `${label}：期望被 schema 拒绝，实际通过`);
  if (pathFragment) {
    const needle = pathFragment.replace(/^\//, '');
    const hit = errors.some(
      (e) =>
        e.instancePath.includes(pathFragment) ||
        JSON.stringify(e).includes(needle),
    );
    assert.ok(
      hit,
      `${label}：没有在期望位置（${pathFragment}）报错，实际错误：${JSON.stringify(errors, null, 2)}`,
    );
  }
}

function assertValid(data, label) {
  const ok = validateProject(data);
  assert.equal(ok, true, `${label}：期望通过，实际错误：${JSON.stringify(validateProject.errors, null, 2)}`);
}

test('schema 能在 ajv 2020-12 下编译，且节点类型覆盖 8 种', () => {
  assert.ok(validateProject, 'schema 编译失败');
  const variants = schema.$defs.node.oneOf.map((ref) => schema.$defs[ref.$ref.split('/').pop()]);
  const types = variants.map((variant) => variant.properties.type.const).sort();
  assert.deepEqual(types, [
    'choice',
    'condition',
    'dialogue',
    'jump',
    'minigame',
    'scene',
    'variable',
    'video',
  ]);
});

test('examples/demo-project.json 通过项目 schema', () => {
  assertValid(demo, '示例项目');
});

test('examples/save-sample.json 通过 saveState 子 schema', () => {
  const ok = validateSave(saveSample);
  assert.equal(ok, true, `示例存档校验失败：${JSON.stringify(validateSave.errors, null, 2)}`);
});

test('示例存档：manual 槽位必须 >=1，auto/quick 必须是槽位 0', () => {
  const manualZero = clone(saveSample);
  manualZero.slot = 0;
  assert.equal(validateSave(manualZero), false, 'manual + slot=0 应被拒绝');

  const auto = clone(saveSample);
  auto.kind = 'auto';
  auto.slot = 0;
  assert.equal(validateSave(auto), true, `auto + slot=0 应通过：${JSON.stringify(validateSave.errors)}`);

  const quick = clone(saveSample);
  quick.kind = 'quick';
  quick.slot = 0;
  assert.equal(validateSave(quick), true, `quick + slot=0 应通过：${JSON.stringify(validateSave.errors)}`);

  const autoWithSlot = clone(saveSample);
  autoWithSlot.kind = 'auto';
  autoWithSlot.slot = 3;
  assert.equal(validateSave(autoWithSlot), false, 'auto + slot=3 应被拒绝');
});

test('拒绝未知顶层字段（防止 schema 漂移）', () => {
  const project = clone(demo);
  project.unexpectedField = true;
  assertInvalid(project, '未知顶层字段', '/unexpectedField');
});

test('拒绝未知节点类型', () => {
  const project = clone(demo);
  project.nodes[0].type = 'narrator';
  assertInvalid(project, '未知节点类型');
});

test('拒绝非法连线 kind', () => {
  const project = clone(demo);
  project.edges[0].kind = 'jump';
  assertInvalid(project, '非法 edge.kind');
});

test('拒绝缺少节点 exits 字段', () => {
  const project = clone(demo);
  const dialogue = nodeOfType(project, 'dialogue');
  delete dialogue.exits;
  assertInvalid(project, '缺少 exits', '/exits');
});

test('拒绝变量使用未登记的类型标签', () => {
  const project = clone(demo);
  project.variables.affection = { type: 'int', value: 1 };
  assertInvalid(project, '非法变量类型标签', '/variables/affection/type');
});

test('拒绝带额外字段的类型标签值', () => {
  const project = clone(demo);
  project.variables.affection = { type: 'number', value: 1, unit: 'point' };
  assertInvalid(project, '类型标签值带额外字段');
});

test('拒绝非贝塞尔的 easing（运行时不认预设名）', () => {
  const project = clone(demo);
  const timeline = Object.values(project.timelines)[0];
  timeline.tracks[0].keys[0].easing = { type: 'easeInOut' };
  assertInvalid(project, '预设名 easing', '/easing/type');
});

test('拒绝三点控制点的贝塞尔 easing', () => {
  const project = clone(demo);
  const timeline = Object.values(project.timelines)[0];
  timeline.tracks[0].keys[0].easing.p1 = [0, 0.5, 1];
  assertInvalid(project, '三点贝塞尔控制点', '/p1');
});

test('拒绝改写固定出口显示名（dialogue 的 next 固定）', () => {
  const project = clone(demo);
  const dialogue = nodeOfType(project, 'dialogue');
  dialogue.exits[0].name = '继续';
  assertInvalid(project, '固定出口被改名');
});

test('选项节点至少需要 2 个出口', () => {
  const project = clone(demo);
  const choice = nodeOfType(project, 'choice');
  choice.exits = choice.exits.slice(0, 1);
  assertInvalid(project, '选项少于 2 个', '/exits');
});

test('跳转节点不允许有出口', () => {
  const project = clone(demo);
  const jump = nodeOfType(project, 'jump');
  jump.exits = [{ id: 'next', name: 'next' }];
  assertInvalid(project, '跳转节点带出口', '/exits');
});

test('视频 / 条件节点出口顺序不敏感，但两个固定出口必须各出现一次', () => {
  const swappedVideo = clone(demo);
  const video = nodeOfType(swappedVideo, 'video');
  video.exits = [video.exits[1], video.exits[0]];
  assertValid(swappedVideo, '视频出口交换顺序');

  const missingSkipped = clone(demo);
  const videoMissing = nodeOfType(missingSkipped, 'video');
  videoMissing.exits = videoMissing.exits.filter((exit) => exit.id !== 'skipped');
  assertInvalid(missingSkipped, '视频缺少 skipped 出口');

  const swappedCondition = clone(demo);
  const condition = nodeOfType(swappedCondition, 'condition');
  condition.exits = [condition.exits[1], condition.exits[0]];
  assertValid(swappedCondition, '条件出口交换顺序');

  const duplicatedTrue = clone(demo);
  const conditionDup = nodeOfType(duplicatedTrue, 'condition');
  conditionDup.exits = [conditionDup.exits[0], { ...conditionDup.exits[0], name: 'true' }];
  assertInvalid(duplicatedTrue, '条件节点 true 出口出现两次');
});

test('素材 path 扩展名必须与 format 一致，视频编码必须可播放', () => {
  const project = clone(demo);
  const image = project.assets.images[0];
  image.format = 'png';
  assertInvalid(project, '图片扩展名不一致', '/assets/images/0');

  const project2 = clone(demo);
  project2.assets.audio[0].format = 'mp3';
  assertInvalid(project2, '音频扩展名不一致', '/assets/audio/0');

  const project3 = clone(demo);
  project3.assets.videos[0].codec = 'av1';
  assertInvalid(project3, '不支持的视频编码', '/assets/videos/0');
});

test('文本框轨道 property 与蓝图字段同名（fontSizePx，而非 fontSize）', () => {
  const project = clone(demo);
  const timeline = Object.values(project.timelines).find((item) =>
    item.tracks.some((track) => track.kind === 'textbox'),
  );
  assert.ok(timeline, '示例应包含 textbox 轨道');
  const textboxTrack = timeline.tracks.find((track) => track.kind === 'textbox');
  textboxTrack.property = 'fontSize';
  assertInvalid(project, '旧字段名 fontSize');
});

test('保留变量 last_minigame_result 类型锁定为 string', () => {
  const project = clone(demo);
  project.variables.last_minigame_result = { type: 'number', value: 1 };
  assertInvalid(project, '保留变量写成 number', '/variables/last_minigame_result/type');
});

test('图片 / 音频最终格式收紧为 png/webp、ogg/mp3（导入格式不落盘）', () => {
  const project = clone(demo);
  project.assets.images[0].format = 'jpg';
  project.assets.images[0].path = 'assets/images/legacy.jpg';
  assertInvalid(project, 'jpg 不是合法最终图片格式', '/assets/images/0/format');

  const project2 = clone(demo);
  project2.assets.audio[0].format = 'wav';
  project2.assets.audio[0].path = 'assets/audio/legacy.wav';
  assertInvalid(project2, 'wav 不是合法最终音频格式', '/assets/audio/0/format');
});

test('出口 id 重复无法用 JSON Schema 表达（已知限制，由引用完整性校验拦截）', () => {
  const project = clone(demo);
  const minigame = nodeOfType(project, 'minigame');
  minigame.exits.push({ ...minigame.exits[0], name: '另一个名字' });
  // schema 的 uniqueItems 只能比较整个对象，无法约束子字段 id 唯一；
  // 该限制由 FIELDS.md 校验规则与 tests/integrity.test.mjs 的 duplicateExitIds 覆盖。
  assert.equal(
    validateProject(project),
    true,
    '若此断言失败，说明 schema 已能约束出口 id 唯一性，请同步更新文档与完整性测试',
  );
});

test('变量操作节点：set 必须带 value，toggle 不得带 value', () => {
  const project = clone(demo);
  const variable = nodeOfType(project, 'variable');
  variable.assignments = [{ key: 'affection', op: 'set' }];
  assertInvalid(project, 'set 缺少 value', '/assignments/0');

  const project2 = clone(demo);
  const variable2 = nodeOfType(project2, 'variable');
  variable2.assignments = [
    { key: 'hasKey', op: 'toggle', value: { type: 'boolean', value: true } },
  ];
  assertInvalid(project2, 'toggle 携带 value', '/assignments/0');
});

test('data 语义连线允许存在并保留扩展字段（第一版不实现 UI）', () => {
  const project = clone(demo);
  const scene = nodeOfType(project, 'scene');
  const other = project.nodes.find((node) => node.id !== scene.id && node.type !== 'jump');
  project.edges.push({
    id: 'e_data_reserved',
    from: scene.id,
    port: 'next',
    to: other.id,
    kind: 'data',
    data: { fromProperty: 'textbox.opacity', toProperty: 'sprite.opacity', valueType: 'number' },
  });
  assertValid(project, '预留 data 连线');
});

test('拒绝缺少 startNodeId 的 settings（可以为 null，但字段必须存在）', () => {
  const project = clone(demo);
  delete project.settings.startNodeId;
  assertInvalid(project, '缺少 startNodeId', '/settings');
});
