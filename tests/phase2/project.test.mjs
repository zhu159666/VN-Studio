// 阶段二最小单元测试：项目创建 / 保存 / 打开 / schema 校验 / 路径安全。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectStore = require('../../editor/electron/lib/project.cjs');
const schema = require('../../editor/electron/lib/schema.cjs');
const paths = require('../../editor/electron/lib/paths.cjs');

function makeTempDir(prefix = 'vn-project-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

test('defaultProject 通过 schema 校验，并包含默认节点/布局', () => {
  const project = projectStore.defaultProject({ title: '测试项目', resolution: { width: 1280, height: 720 } });
  const result = schema.validateProject(project);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.nodes.length, 1);
  assert.equal(project.nodes[0].type, 'dialogue');
  assert.equal(project.nodes[0].id, project.settings.startNodeId);
  assert.equal(project.layout.leftWidth, 280);
  assert.equal(project.layout.rightWidth, 320);
});

test('defaultProject 拒绝空标题与越界分辨率', () => {
  assert.throws(() => projectStore.defaultProject({ title: '   ' }), /标题不能为空/);
  assert.throws(
    () => projectStore.defaultProject({ title: 'x', resolution: { width: 100, height: 100 } }),
    /分辨率超出范围/,
  );
});

test('createProjectInDir 建目录、写合法 project.json，且能重新打开', async () => {
  const parent = makeTempDir();
  try {
    const projectDir = path.join(parent, 'my-vn');
    const created = await projectStore.createProjectInDir(projectDir, {
      title: '单元测试项目',
      resolution: { width: 1920, height: 1080 },
    });
    assert.equal(created.projectDir, projectDir);
    assert.ok(fs.existsSync(path.join(projectDir, 'project.json')));
    for (const sub of ['assets/images', 'assets/audio', 'assets/videos', 'assets/minigames', 'assets/.source/images', 'saves']) {
      assert.ok(fs.existsSync(path.join(projectDir, sub)), `缺少目录：${sub}`);
    }

    const raw = JSON.parse(fs.readFileSync(created.projectPath, 'utf8'));
    assert.equal(schema.validateProject(raw).ok, true);
    assert.equal(raw.meta.title, '单元测试项目');
    assert.deepEqual(raw.settings.resolution, { width: 1920, height: 1080 });

    const reopened = await projectStore.openProject(created.projectPath);
    assert.equal(reopened.project.meta.id, created.project.meta.id);
    assert.equal(reopened.projectDir, projectDir);
  } finally {
    cleanup(parent);
  }
});

test('createProjectInDir 拒绝覆盖已有项目；createProjectUnder 自动重名避让', async () => {
  const parent = makeTempDir();
  try {
    const first = await projectStore.createProjectUnder(parent, { title: '同名项目' });
    assert.ok(fs.existsSync(first.projectPath));
    const second = await projectStore.createProjectUnder(parent, { title: '同名项目' });
    assert.notEqual(first.projectDir, second.projectDir, '重名项目应创建不同目录');
    await assert.rejects(
      () => projectStore.createProjectInDir(first.projectDir, { title: 'x' }),
      /已存在 project\.json/,
    );
  } finally {
    cleanup(parent);
  }
});

test('saveProject 写回 updatedAt 并持久化修改；非法项目被拒绝', async () => {
  const parent = makeTempDir();
  try {
    const created = await projectStore.createProjectInDir(path.join(parent, 'save-test'), {
      title: '保存测试',
    });
    const project = structuredClone(created.project);
    project.meta.title = '保存测试（改名）';
    project.variables.money = { type: 'number', value: 50 };

    const saved = await projectStore.saveProject(created.projectPath, project);
    assert.equal(saved.project.meta.title, '保存测试（改名）');
    assert.ok(Date.parse(saved.project.meta.updatedAt) >= Date.parse(created.project.meta.updatedAt));

    const reopened = await projectStore.openProject(created.projectPath);
    assert.equal(reopened.project.meta.title, '保存测试（改名）');
    assert.equal(reopened.project.variables.money.value, 50);

    const invalid = structuredClone(saved.project);
    invalid.nodes = [];
    await assert.rejects(() => projectStore.saveProject(created.projectPath, invalid), /不符合 schema/);
    // 磁盘上的旧文件不应被破坏
    const stillValid = await projectStore.openProject(created.projectPath);
    assert.equal(stillValid.project.meta.title, '保存测试（改名）');
  } finally {
    cleanup(parent);
  }
});

test('openProject 拒绝不存在的路径 / 非法 JSON / schemaVersion 不匹配', async () => {
  const parent = makeTempDir();
  try {
    await assert.rejects(() => projectStore.openProject(path.join(parent, 'nope')), /不存在/);

    const badJsonDir = path.join(parent, 'bad-json');
    fs.mkdirSync(badJsonDir, { recursive: true });
    fs.writeFileSync(path.join(badJsonDir, 'project.json'), '{ not json', 'utf8');
    await assert.rejects(() => projectStore.openProject(badJsonDir), /不是合法 JSON/);

    const created = await projectStore.createProjectInDir(path.join(parent, 'version-test'), {
      title: '版本测试',
    });
    const raw = JSON.parse(fs.readFileSync(created.projectPath, 'utf8'));
    raw.schemaVersion = 2;
    fs.writeFileSync(created.projectPath, JSON.stringify(raw), 'utf8');
    await assert.rejects(() => projectStore.openProject(created.projectPath), /schemaVersion/);
  } finally {
    cleanup(parent);
  }
});

test('路径工具：拒绝 .. 逃逸与绝对路径', () => {
  const base = path.resolve('assets-root');
  assert.throws(() => paths.resolveInside(base, '../secret.txt'), /越界/);
  assert.throws(() => paths.resolveInside(base, 'a/../../secret.txt'), /越界/);
  assert.throws(() => paths.resolveInside(base, path.resolve(base, 'x.txt')), /绝对路径/);
  assert.equal(paths.safeDirName('雨夜 便利店'), '雨夜 便利店');
  assert.equal(paths.safeDirName('a/b:c*'), 'a-b-c-');
  assert.equal(paths.safeDirName(''), 'vn-project');
});

test('素材 source 字段被 schema 接受（阶段二新增可选字段）', () => {
  const project = projectStore.defaultProject({ title: 'source 字段测试' });
  project.assets.images.push({
    id: 'img_test_source',
    kind: 'image',
    name: '测试图',
    role: 'background',
    path: 'assets/images/img_test_source.png',
    width: 1280,
    height: 720,
    format: 'png',
    sizeBytes: 100,
    importedAt: new Date().toISOString(),
    edit: { crop: null, removeBackground: null, adjustments: { brightness: 0, contrast: 0 } },
    source: {
      path: 'assets/.source/images/img_test_source.png',
      format: 'png',
      width: 1280,
      height: 720,
      sizeBytes: 100,
    },
  });
  const result = schema.validateProject(project);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
});
