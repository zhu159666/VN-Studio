#!/usr/bin/env node
// 桌面打包冒烟：构建渲染层 → electron-builder --dir → 校验解包产物与打包后路径解析。
// 说明：本自动化环境没有桌面会话，无法启动 Electron 窗口；用打包后的 exe + ELECTRON_RUN_AS_NODE
// 在 Node 模式里加载 app.asar 中的主进程模块，验证 schema/runtime/渲染层/preload 路径与依赖。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const EDITOR = path.join(ROOT, 'editor');
const RELEASE = path.join(EDITOR, 'release');
const UNPACKED = path.join(RELEASE, 'win-unpacked');
const EXE = path.join(UNPACKED, 'VN Studio.exe');
const RESOURCES = path.join(UNPACKED, 'resources');

const RUNTIME_FILES = [
  'index.html',
  'runtime.js',
  'engine.js',
  'expression.js',
  'timeline.js',
  'storage.js',
  'runtime.css',
];

function run(command, args, options = {}) {
  console.log(`[desktop-smoke] $ ${command} ${args.join(' ')}`);
  return execFileSync(command, args, {
    cwd: EDITOR,
    stdio: 'inherit',
    timeout: 600000,
    ...options,
  });
}

function fail(message) {
  console.error(`[desktop-smoke] 失败：${message}`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(path.join(EDITOR, 'node_modules', 'electron-builder', 'cli.js'))) {
    fail('未安装 electron-builder，请先 pnpm install');
  }
  const viteCli = path.join(EDITOR, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteCli)) fail('未安装 vite，请先 pnpm install');
  run(process.execPath, [viteCli, 'build']);

  const builderCli = path.join(EDITOR, 'node_modules', 'electron-builder', 'cli.js');
  run(process.execPath, [builderCli, '--dir', '--win']);

  if (!fs.existsSync(EXE)) fail(`未生成可执行文件：${EXE}`);
  if (!fs.existsSync(path.join(RESOURCES, 'app.asar'))) fail('缺少 resources/app.asar');

  const asarSize = fs.statSync(path.join(RESOURCES, 'app.asar')).size;
  if (asarSize < 1024 * 1024) fail(`app.asar 过小（${asarSize} bytes），可能缺少依赖/渲染层`);

  for (const file of RUNTIME_FILES) {
    const target = path.join(RESOURCES, 'runtime', file);
    if (!fs.existsSync(target)) fail(`resources/runtime 缺少 ${file}`);
  }
  const schemaFile = path.join(RESOURCES, 'schema', 'schema.json');
  if (!fs.existsSync(schemaFile)) fail('resources/schema/schema.json 缺失');
  JSON.parse(fs.readFileSync(schemaFile, 'utf8'));

  const checkScript = `
    const fs = require('fs');
    const p = require('./resources/app.asar/electron/lib/paths.cjs');
    const s = require('./resources/app.asar/electron/lib/schema.cjs');
    const e = require('./resources/app.asar/electron/lib/export-web.cjs');
    const result = {
      schema: p.schemaPath(),
      runtime: p.runtimeDir(),
      dist: p.editorDistIndex(),
      preload: p.preloadPath(),
      schemaOk: fs.existsSync(p.schemaPath()) && typeof s.validateProject === 'function',
      runtimeOk: fs.existsSync(p.runtimeDir()),
      distOk: fs.existsSync(p.editorDistIndex()),
      preloadOk: fs.existsSync(p.preloadPath()),
      exportOk: typeof e.exportProjectWeb === 'function',
    };
    console.log('PACKAGED_CHECK:' + JSON.stringify(result));
  `;
  let output;
  try {
    output = execFileSync(EXE, ['-e', checkScript], {
      cwd: UNPACKED,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
  } catch (error) {
    fail(`打包应用 Node 模式自检失败：${error.stderr || error.message}`);
  }
  const line = String(output)
    .split(/\r?\n/)
    .find((item) => item.startsWith('PACKAGED_CHECK:'));
  if (!line) fail(`未拿到打包自检输出：${output}`);
  const check = JSON.parse(line.slice('PACKAGED_CHECK:'.length));
  console.log('[desktop-smoke] 打包自检：', check);
  for (const key of ['schemaOk', 'runtimeOk', 'distOk', 'preloadOk', 'exportOk']) {
    if (!check[key]) fail(`打包自检项失败：${key}`);
  }
  if (!check.schema.endsWith(path.join('resources', 'schema', 'schema.json'))) {
    fail(`schema 路径不在 resources：${check.schema}`);
  }
  if (!check.runtime.endsWith(path.join('resources', 'runtime'))) {
    fail(`runtime 路径不在 resources：${check.runtime}`);
  }

  const zip = fs
    .readdirSync(RELEASE)
    .filter((name) => name.endsWith('.zip'))
    .map((name) => path.join(RELEASE, name))
    .sort()
    .at(-1);
  console.log('[desktop-smoke] 解包产物：', UNPACKED);
  console.log('[desktop-smoke] app.asar 大小：', asarSize);
  if (zip) console.log('[desktop-smoke] 可分发 zip：', zip);
  console.log('[desktop-smoke] 通过（无桌面会话，未启动 GUI 窗口）');
}

try {
  main();
} catch (error) {
  fail(error.stack || error.message);
}
