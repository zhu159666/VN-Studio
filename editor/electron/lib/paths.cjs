'use strict';

// 路径与目录工具。注意：这里除了 userDataFile() 之外不得 require('electron')，
// 这样 tests/phase2/project.test.mjs 可以在纯 Node 下复用项目读写逻辑。

const path = require('node:path');
const fs = require('node:fs');

// 开发态：editor/electron/lib -> 仓库根；打包态：app.asar/electron/lib -> resources。
const ELECTRON_ROOT = path.resolve(__dirname, '..');
const EDITOR_ROOT = path.resolve(ELECTRON_ROOT, '..');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function repoRoot() {
  return REPO_ROOT;
}

function resourceCandidates(name) {
  const candidates = [path.join(REPO_ROOT, name)];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, name));
  return candidates;
}

function firstExisting(candidates, fallback) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return fallback;
}

function schemaPath() {
  return firstExisting(
    resourceCandidates(path.join('schema', 'schema.json')),
    path.join(REPO_ROOT, 'schema', 'schema.json'),
  );
}

// 渲染层入口：开发态 editor/dist；打包态 app.asar/dist。
function editorDistIndex() {
  return path.join(EDITOR_ROOT, 'dist', 'index.html');
}

function preloadPath() {
  return path.join(ELECTRON_ROOT, 'preload.cjs');
}

// 运行时源码 / 导出模板：开发态仓库 runtime/；打包态 resources/runtime/。
function runtimeDir() {
  return firstExisting(resourceCandidates('runtime'), path.join(REPO_ROOT, 'runtime'));
}

function userDataFile(name) {
  // 延迟 require，避免纯 Node 测试环境加载 electron。
  const { app } = require('electron');
  return path.join(app.getPath('userData'), name);
}

function projectFilePath(projectDir) {
  return path.join(projectDir, 'project.json');
}

function projectDirs(projectDir) {
  const base = path.resolve(projectDir);
  return {
    root: base,
    projectFile: projectFilePath(base),
    assets: path.join(base, 'assets'),
    images: path.join(base, 'assets', 'images'),
    audio: path.join(base, 'assets', 'audio'),
    videos: path.join(base, 'assets', 'videos'),
    minigames: path.join(base, 'assets', 'minigames'),
    source: path.join(base, 'assets', '.source'),
    sourceImages: path.join(base, 'assets', '.source', 'images'),
    sourceAudio: path.join(base, 'assets', '.source', 'audio'),
    saves: path.join(base, 'saves'),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureProjectDirs(projectDir) {
  const dirs = projectDirs(projectDir);
  ensureDir(dirs.assets);
  ensureDir(dirs.images);
  ensureDir(dirs.audio);
  ensureDir(dirs.videos);
  ensureDir(dirs.minigames);
  ensureDir(dirs.source);
  ensureDir(dirs.sourceImages);
  ensureDir(dirs.sourceAudio);
  ensureDir(dirs.saves);
  return dirs;
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function resolveInside(baseDir, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new Error('路径不能为空');
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error('不允许使用绝对路径');
  }
  const base = path.resolve(baseDir);
  const abs = path.resolve(base, relativePath);
  const rel = path.relative(base, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越界：${relativePath}`);
  }
  return abs;
}

// 项目目录名：保留中文，去掉 Windows 非法字符。
function safeDirName(title, fallback = 'vn-project') {
  const cleaned = String(title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\\s+/g, ' ')
    .trim()
    .replace(/^[.\\s]+|[.\\s]+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

module.exports = {
  repoRoot,
  schemaPath,
  editorDistIndex,
  preloadPath,
  runtimeDir,
  userDataFile,
  projectFilePath,
  projectDirs,
  ensureDir,
  ensureProjectDirs,
  toPosix,
  resolveInside,
  safeDirName,
};
