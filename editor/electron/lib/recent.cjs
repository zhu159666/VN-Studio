'use strict';

// 最近项目列表（存于 Electron userData，不进入项目文件）。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const paths = require('./paths.cjs');

const MAX_RECENT = 12;

function recentFile() {
  return paths.userDataFile('recent-projects.json');
}

async function readRaw() {
  try {
    const text = await fsp.readFile(recentFile(), 'utf8');
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeRaw(items) {
  const file = recentFile();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(items.slice(0, MAX_RECENT), null, 2)}\n`, 'utf8');
}

async function listRecent() {
  const items = await readRaw();
  return items
    .map((item) => ({
      projectPath: item.projectPath,
      title: item.title || path.basename(path.dirname(item.projectPath)),
      updatedAt: item.updatedAt || null,
      missing: !fs.existsSync(item.projectPath),
    }))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    .slice(0, MAX_RECENT);
}

async function addRecent(projectPath, project) {
  const absolute = path.resolve(projectPath);
  const items = (await readRaw()).filter((item) => path.resolve(item.projectPath) !== absolute);
  items.unshift({
    projectPath: absolute,
    title: project?.meta?.title ?? path.basename(path.dirname(absolute)),
    updatedAt: project?.meta?.updatedAt ?? new Date().toISOString(),
  });
  await writeRaw(items);
}

async function removeRecent(projectPath) {
  const absolute = path.resolve(projectPath);
  const items = (await readRaw()).filter((item) => path.resolve(item.projectPath) !== absolute);
  await writeRaw(items);
}

module.exports = { MAX_RECENT, listRecent, addRecent, removeRecent };
