'use strict';

// Web 包导出：校验 → 复制 runtime / 素材 → 写 game.json。
// 纯 Node（不 require electron），便于单元测试与 CLI 使用。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const paths = require('./paths.cjs');
const schema = require('./schema.cjs');
const { validateProjectForExport } = require('./validate-project.cjs');

const RUNTIME_FILES = [
  'index.html',
  'runtime.js',
  'engine.js',
  'expression.js',
  'timeline.js',
  'storage.js',
  'runtime.css',
];

const ASSET_EXT_BY_FORMAT = {
  png: '.png',
  webp: '.webp',
  jpg: '.jpg',
  ogg: '.ogg',
  mp3: '.mp3',
  mp4: '.mp4',
  webm: '.webm',
};

function fail(message, code = 'EXPORT_FAILED', extra = {}) {
  return { ok: false, error: message, errors: [{ code, message, ...extra }], warnings: [] };
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyFileEnsured(source, target) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(source, target);
}

async function walkFiles(root) {
  const result = [];
  async function visit(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else result.push(full);
    }
  }
  await visit(root);
  return result;
}

function sanitizedOutputBase(title) {
  return `${paths.safeDirName(title || 'vn-project', 'vn-project')}-web`;
}

async function uniqueOutputDir(parentDir, baseName) {
  for (let index = 1; index < 100; index += 1) {
    const name = index === 1 ? baseName : `${baseName}-${index}`;
    const candidate = path.join(parentDir, name);
    if (!(await exists(candidate))) {
      await fsp.mkdir(candidate, { recursive: true });
      return candidate;
    }
  }
  throw new Error('无法创建导出目录（同名目录过多）');
}

function buildGameJson(project) {
  const game = JSON.parse(JSON.stringify(project));
  delete game.$schema;
  delete game.layout;
  delete game.editor;
  schema.assertValidProject(game);
  return game;
}

async function exportProjectWeb({ project, projectDir, outputParentDir } = {}) {
  if (!project || typeof project !== 'object') return fail('缺少项目数据', 'NO_PROJECT');
  if (!projectDir) return fail('缺少项目目录', 'NO_PROJECT_DIR');
  if (!outputParentDir) return fail('缺少导出位置', 'NO_OUTPUT_DIR');

  const validation = await validateProjectForExport(project, {
    projectDir,
    checkFiles: true,
  });
  if (!validation.ok) {
    return {
      ok: false,
      error: `导出校验失败：${validation.errors.length} 个错误`,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  const runtimeDir = paths.runtimeDir();
  for (const file of RUNTIME_FILES) {
    if (!(await exists(path.join(runtimeDir, file)))) {
      return fail(`运行时文件缺失：runtime/${file}`, 'RUNTIME_MISSING');
    }
  }

  let outputDir = null;
  const written = [];
  try {
    const parent = path.resolve(outputParentDir);
    await fsp.mkdir(parent, { recursive: true });
    outputDir = await uniqueOutputDir(parent, sanitizedOutputBase(project.meta?.title));

    for (const file of RUNTIME_FILES) {
      const target = path.join(outputDir, file);
      await copyFileEnsured(path.join(runtimeDir, file), target);
      written.push(file);
    }

    const assets = project.assets ?? {};
    const collections = [
      ['images', assets.images ?? []],
      ['audio', assets.audio ?? []],
      ['videos', assets.videos ?? []],
      ['minigames', assets.minigames ?? []],
    ];
    const copiedSource = new Set();
    for (const [kind, list] of collections) {
      await fsp.mkdir(path.join(outputDir, 'assets', kind), { recursive: true });
      for (const asset of list) {
        const relativePath = String(asset?.path ?? '');
        if (!relativePath.startsWith(`assets/${kind}/`)) {
          const error = new Error(`素材路径不在 assets/${kind}/ 下：${relativePath}`);
          error.code = 'ASSET_PATH_INVALID';
          throw error;
        }
        if (relativePath.includes('/.source/')) {
          const error = new Error(`导出包不能包含原始文件目录：${relativePath}`);
          error.code = 'ASSET_SOURCE_EXCLUDED';
          throw error;
        }
        const source = paths.resolveInside(projectDir, relativePath);
        if (!(await exists(source))) {
          const error = new Error(`素材文件不存在：${relativePath}`);
          error.code = 'ASSET_FILE_MISSING';
          throw error;
        }
        if (copiedSource.has(relativePath)) continue;
        copiedSource.add(relativePath);
        await copyFileEnsured(source, path.join(outputDir, relativePath));
        written.push(relativePath);
      }
    }

    const game = buildGameJson(project);
    await fsp.writeFile(path.join(outputDir, 'game.json'), `${JSON.stringify(game, null, 2)}\n`, 'utf8');
    written.push('game.json');

    const allFiles = await walkFiles(outputDir);
    let bytes = 0;
    for (const file of allFiles) {
      bytes += (await fsp.stat(file)).size;
    }

    return {
      ok: true,
      outputDir,
      files: allFiles.map((file) => path.relative(outputDir, file).replace(/\\/g, '/')),
      bytes,
      warnings: validation.warnings,
    };
  } catch (error) {
    if (outputDir) {
      await fsp.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
    return {
      ok: false,
      error: error.message || String(error),
      errors: [{ code: error.code || 'EXPORT_FAILED', message: error.message || String(error) }],
      warnings: validation.warnings,
    };
  }
}

module.exports = {
  RUNTIME_FILES,
  ASSET_EXT_BY_FORMAT,
  exportProjectWeb,
  buildGameJson,
};
