'use strict';

// Electron 侧存档文件读写（saves/slot_N.json / auto.json / quick.json）。
// 纯 Node（不 require electron），可被单元测试直接使用。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const paths = require('./paths.cjs');
const schema = require('./schema.cjs');

function fileNameFor(kind, slot) {
  if (kind === 'manual') {
    const number = Math.max(1, Math.min(999, Math.round(Number(slot) || 1)));
    return `slot_${number}.json`;
  }
  if (kind === 'auto') return 'auto.json';
  if (kind === 'quick') return 'quick.json';
  throw new Error(`未知存档类型：${kind}`);
}

function savesDir(projectDir) {
  const dir = path.join(path.resolve(projectDir), 'saves');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function writeJsonAtomic(file, data) {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, json, 'utf8');
  try {
    await fsp.rename(tmp, file);
  } catch (error) {
    if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 60));
    await fsp.rename(tmp, file);
  }
}

function normalizeSave(save) {
  const result = schema.validateSaveState(save);
  if (!result.ok) {
    const preview = result.errors
      .slice(0, 4)
      .map((item) => `${item.path} ${item.message}`)
      .join('；');
    const error = new Error(`存档结构不符合 schema：${preview}`);
    error.code = 'SAVE_SCHEMA_INVALID';
    error.errors = result.errors;
    throw error;
  }
  return save;
}

async function listSaves(projectDir) {
  const dir = savesDir(projectDir);
  const entries = await fsp.readdir(dir).catch(() => []);
  const saves = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await fsp.readFile(path.join(dir, name), 'utf8');
      const save = JSON.parse(raw);
      if (schema.validateSaveState(save).ok) saves.push(save);
    } catch {
      /* 跳过损坏存档 */
    }
  }
  return saves.sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')));
}

async function readSave(projectDir, kind, slot) {
  const file = path.join(savesDir(projectDir), fileNameFor(kind, slot));
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const save = JSON.parse(raw);
    return schema.validateSaveState(save).ok ? save : null;
  } catch {
    return null;
  }
}

async function writeSave(projectDir, save) {
  normalizeSave(save);
  const file = path.join(savesDir(projectDir), fileNameFor(save.kind, save.slot));
  await writeJsonAtomic(file, save);
  return save;
}

async function deleteSave(projectDir, kind, slot) {
  const file = path.join(savesDir(projectDir), fileNameFor(kind, slot));
  await fsp.rm(file, { force: true });
  return { removed: true };
}

module.exports = { fileNameFor, listSaves, readSave, writeSave, deleteSave };
