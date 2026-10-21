'use strict';

// 项目文件读写。纯 Node 模块（不 require electron），可被单元测试直接使用。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const paths = require('./paths.cjs');
const schema = require('./schema.cjs');

const DEFAULT_RESOLUTION = { width: 1280, height: 720 };
const RESOLUTION_LIMITS = { minWidth: 320, maxWidth: 7680, minHeight: 240, maxHeight: 4320 };

function nowIso() {
  return new Date().toISOString();
}

function randomProjectId() {
  return `proj_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeResolution(resolution) {
  const width = Math.round(Number(resolution?.width ?? DEFAULT_RESOLUTION.width));
  const height = Math.round(Number(resolution?.height ?? DEFAULT_RESOLUTION.height));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('分辨率必须是数字');
  }
  if (
    width < RESOLUTION_LIMITS.minWidth ||
    width > RESOLUTION_LIMITS.maxWidth ||
    height < RESOLUTION_LIMITS.minHeight ||
    height > RESOLUTION_LIMITS.maxHeight
  ) {
    throw new Error(
      `分辨率超出范围（宽 ${RESOLUTION_LIMITS.minWidth}–${RESOLUTION_LIMITS.maxWidth}，高 ${RESOLUTION_LIMITS.minHeight}–${RESOLUTION_LIMITS.maxHeight}）`,
    );
  }
  return { width, height };
}

function normalizeTitle(title) {
  const value = String(title ?? '').trim();
  if (!value) throw new Error('项目标题不能为空');
  if (value.length > 200) throw new Error('项目标题不能超过 200 字');
  return value;
}

function defaultLayout() {
  return {
    leftWidth: 280,
    rightWidth: 320,
    timelineHeight: 200,
    rightCollapsed: false,
    leftBottomPanel: 'variables',
    assetView: 'grid',
    assetTypeFilter: 'all',
  };
}

function defaultEditorState() {
  return {
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedNodeIds: ['n_opening'],
    selectedEdgeId: null,
    selectedAssetId: null,
    activeTab: 'blueprint',
    timelinePlayheadMs: 0,
  };
}

// 新建项目的默认内容：必须满足 schema（nodes 至少 1 个），并给蓝图阶段留一个开场节点。
function defaultProject({ title, resolution, author = '' } = {}) {
  const normalizedTitle = normalizeTitle(title ?? '未命名项目');
  const normalizedResolution = normalizeResolution(resolution);
  const now = nowIso();
  return {
    $schema: '../schema/schema.json',
    schemaVersion: 1,
    meta: {
      id: randomProjectId(),
      title: normalizedTitle,
      author: String(author ?? ''),
      description: '',
      version: '0.1.0',
      createdAt: now,
      updatedAt: now,
    },
    settings: {
      startNodeId: 'n_opening',
      resolution: normalizedResolution,
      backgroundColor: '#101418',
      textSpeedCps: 30,
      autoSave: { enabled: true, onSceneEnter: true },
    },
    assets: { images: [], audio: [], videos: [], minigames: [] },
    variables: {},
    nodes: [
      {
        id: 'n_opening',
        type: 'dialogue',
        name: '开场',
        position: { x: 0, y: 0 },
        exits: [{ id: 'next', name: 'next' }],
        text: '新项目：在蓝图中双击空白处开始编写剧情。',
        speaker: null,
        portrait: null,
        voice: null,
        speedCps: null,
        autoAdvanceMs: null,
      },
    ],
    edges: [],
    timelines: {},
    layout: defaultLayout(),
    editor: defaultEditorState(),
  };
}

async function ensureProjectDir(projectDir) {
  paths.ensureProjectDirs(projectDir);
  return projectDir;
}

async function writeProjectFile(projectPath, project) {
  const json = `${JSON.stringify(project, null, 2)}\n`;
  const tmp = `${projectPath}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, json, 'utf8');
  // Windows 上杀毒/索引可能短暂占用目标文件，rename 会报 EPERM/EBUSY，重试几次。
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fsp.rename(tmp, projectPath);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) break;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  // 最后兜底：直接覆盖写，避免临时文件残留导致保存失败。
  try {
    await fsp.writeFile(projectPath, json, 'utf8');
    await fsp.rm(tmp, { force: true }).catch(() => {});
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw lastError ?? error;
  }
}

async function createProjectInDir(projectDir, options = {}) {
  const dir = path.resolve(projectDir);
  const projectFile = paths.projectFilePath(dir);
  if (fs.existsSync(projectFile)) {
    const err = new Error('该目录下已存在 project.json，请选择其他位置');
    err.code = 'PROJECT_EXISTS';
    throw err;
  }
  await ensureProjectDir(dir);
  const project = defaultProject(options);
  schema.assertValidProject(project);
  await writeProjectFile(projectFile, project);
  return { project, projectPath: projectFile, projectDir: dir };
}

// 在父目录下按标题创建子目录（重名自动加后缀）。
async function createProjectUnder(parentDir, options = {}) {
  const parent = path.resolve(parentDir);
  const baseName = paths.safeDirName(options.title ?? '未命名项目');
  let target = path.join(parent, baseName);
  let index = 2;
  while (fs.existsSync(target) && fs.existsSync(paths.projectFilePath(target))) {
    target = path.join(parent, `${baseName}-${index}`);
    index += 1;
  }
  return createProjectInDir(target, options);
}

function normalizeProjectPath(projectPathOrDir) {
  const resolved = path.resolve(String(projectPathOrDir ?? ''));
  if (!String(projectPathOrDir ?? '').trim()) throw new Error('项目路径不能为空');
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`项目路径不存在：${resolved}`);
  }
  if (stat.isDirectory()) {
    return { projectFile: path.join(resolved, 'project.json'), projectDir: resolved };
  }
  return { projectFile: resolved, projectDir: path.dirname(resolved) };
}

async function openProject(projectPathOrDir) {
  const { projectFile, projectDir } = normalizeProjectPath(projectPathOrDir);
  let raw;
  try {
    raw = await fsp.readFile(projectFile, 'utf8');
  } catch {
    throw new Error(`找不到项目文件：${projectFile}`);
  }
  let project;
  try {
    project = JSON.parse(raw);
  } catch (error) {
    throw new Error(`project.json 不是合法 JSON：${error.message}`);
  }
  if (project.schemaVersion !== schema.SCHEMA_VERSION) {
    const err = new Error(
      `项目文件 schemaVersion=${project.schemaVersion} 与编辑器支持的版本 ${schema.SCHEMA_VERSION} 不一致`,
    );
    err.code = 'SCHEMA_VERSION_MISMATCH';
    throw err;
  }
  schema.assertValidProject(project);
  return { project, projectPath: projectFile, projectDir };
}

async function saveProject(projectPathOrDir, project) {
  const { projectFile, projectDir } = normalizeProjectPath(projectPathOrDir);
  const next = typeof structuredClone === 'function' ? structuredClone(project) : JSON.parse(JSON.stringify(project));
  next.meta = { ...(next.meta ?? {}), updatedAt: nowIso() };
  schema.assertValidProject(next);
  await fsp.mkdir(path.dirname(projectFile), { recursive: true });
  await writeProjectFile(projectFile, next);
  return { project: next, projectPath: projectFile, projectDir };
}

function letSafeProjectNameFallback(title) {
  return paths.safeDirName(title, 'vn-project');
}

module.exports = {
  DEFAULT_RESOLUTION,
  RESOLUTION_LIMITS,
  nowIso,
  defaultLayout,
  defaultEditorState,
  defaultProject,
  normalizeResolution,
  normalizeTitle,
  createProjectInDir,
  createProjectUnder,
  openProject,
  saveProject,
  ensureProjectDir,
  letSafeProjectNameFallback,
};
