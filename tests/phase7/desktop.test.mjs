// 阶段七：桌面打包配置与打包态路径解析（不依赖真实构建产物）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const paths = require('../../editor/electron/lib/paths.cjs');
const rootPkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const editorPkg = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'editor', 'package.json'), 'utf8'),
);

const TMP = path.join(process.cwd(), 'editor', '.tmp-phase7-desktop');
const RUNTIME_FILES = [
  'index.html',
  'runtime.js',
  'engine.js',
  'expression.js',
  'timeline.js',
  'storage.js',
  'runtime.css',
];

test('开发态路径与运行时分发文件齐全', () => {
  assert.ok(fs.existsSync(paths.preloadPath()));
  assert.ok(fs.existsSync(paths.editorDistIndex()) || process.env.VN_SKIP_DIST_CHECK === '1');
  assert.ok(fs.existsSync(paths.runtimeDir()));
  for (const file of RUNTIME_FILES) {
    assert.ok(fs.existsSync(path.join(paths.runtimeDir(), file)), `runtime 缺少 ${file}`);
  }
  assert.ok(fs.existsSync(paths.schemaPath()));
});

test('electron-builder 配置包含主入口、渲染层、runtime 与 schema 资源', () => {
  assert.equal(editorPkg.main, 'electron/main.cjs');
  assert.ok(fs.existsSync(path.join(process.cwd(), 'editor', editorPkg.main)));
  assert.ok(editorPkg.devDependencies['electron-builder']);
  assert.ok(editorPkg.scripts['dist:zip']);
  assert.ok(editorPkg.scripts['dist:dir']);
  assert.ok(editorPkg.scripts['dist:win']);

  const build = editorPkg.build;
  assert.equal(build.appId, 'com.vnstudio.desktop');
  assert.equal(build.productName, 'VN Studio');
  assert.equal(build.asar, true);
  assert.deepEqual(build.files, ['dist/**/*', 'electron/**/*', 'package.json']);
  const resources = build.extraResources.map((entry) => entry.to);
  assert.ok(resources.includes('runtime'));
  assert.ok(resources.includes('schema'));
  const runtimeResource = build.extraResources.find((entry) => entry.to === 'runtime');
  assert.ok(runtimeResource.from.includes('runtime'));
  assert.ok(rootPkg.scripts['smoke:desktop']);
  assert.ok(rootPkg.scripts['editor:dist']);
});

test('打包态 app.asar 布局下 paths 解析到 resources 的 schema/runtime 与 asar 内 dist/preload', () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  try {
    // 模拟 resources/app.asar/electron/lib/paths.cjs（asar 对 path 来说就是普通目录层级）。
    const appRoot = path.join(TMP, 'resources', 'app');
    const libDir = path.join(appRoot, 'electron', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), 'editor', 'electron', 'lib', 'paths.cjs'),
      path.join(libDir, 'paths.cjs'),
    );
    fs.copyFileSync(
      path.join(process.cwd(), 'editor', 'electron', 'preload.cjs'),
      path.join(appRoot, 'electron', 'preload.cjs'),
    );
    fs.mkdirSync(path.join(appRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'dist', 'index.html'), '<!doctype html>');

    const resourcesRoot = path.join(TMP, 'resources');
    fs.mkdirSync(path.join(resourcesRoot, 'schema'), { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), 'schema', 'schema.json'),
      path.join(resourcesRoot, 'schema', 'schema.json'),
    );
    fs.mkdirSync(path.join(resourcesRoot, 'runtime'), { recursive: true });
    for (const file of RUNTIME_FILES) {
      fs.copyFileSync(
        path.join(process.cwd(), 'runtime', file),
        path.join(resourcesRoot, 'runtime', file),
      );
    }

    const packagedPaths = require(path.join(libDir, 'paths.cjs'));
    assert.equal(
      path.resolve(packagedPaths.schemaPath()),
      path.resolve(path.join(resourcesRoot, 'schema', 'schema.json')),
    );
    assert.equal(
      path.resolve(packagedPaths.runtimeDir()),
      path.resolve(path.join(resourcesRoot, 'runtime')),
    );
    assert.equal(
      path.resolve(packagedPaths.editorDistIndex()),
      path.resolve(path.join(appRoot, 'dist', 'index.html')),
    );
    assert.equal(
      path.resolve(packagedPaths.preloadPath()),
      path.resolve(path.join(appRoot, 'electron', 'preload.cjs')),
    );
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('导出器在 runtimeDir() 下能找到全部运行时模板文件', async () => {
  const { RUNTIME_FILES: exported } = require('../../editor/electron/lib/export-web.cjs');
  assert.deepEqual(exported, RUNTIME_FILES);
  for (const file of exported) {
    assert.ok(fs.existsSync(path.join(paths.runtimeDir(), file)), `导出模板缺失 ${file}`);
  }
});
