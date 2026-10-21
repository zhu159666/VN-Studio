#!/usr/bin/env node
// 把系统 ffmpeg 复制进 electron-builder 的 buildResources，供桌面包内置。
// 优先 VN_FFMPEG_PATH，其次 PATH / 常见位置；已存在则跳过。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(ROOT, 'editor', 'build');
const TARGET = path.join(BUILD_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

function findOnPath() {
  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const output = execFileSync(command, ['ffmpeg'], { encoding: 'utf8', timeout: 10000 });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => fs.existsSync(line));
  } catch {
    return null;
  }
}

function resolveSource() {
  const candidates = [
    process.env.VN_FFMPEG_PATH,
    process.platform === 'win32' ? 'D:/ffmpeg.exe' : null,
    findOnPath(),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function writeNotice(source) {
  fs.writeFileSync(
    path.join(BUILD_DIR, 'FFMPEG-NOTICE.txt'),
    `VN Studio 随包分发 ffmpeg（${source}）。\n` +
      'ffmpeg 是独立开源项目，版权归其作者所有；许可证与源码获取见 https://ffmpeg.org/。\n' +
      '本项目只把 ffmpeg 作为外部转码工具调用，不修改其源码。\n',
    'utf8',
  );
}

if (fs.existsSync(TARGET)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  writeNotice('已内置的 build/ffmpeg');
  console.log(`[prepare-ffmpeg] 已存在：${TARGET}`);
  process.exit(0);
}

const source = resolveSource();
if (!source) {
  console.error(
    '[prepare-ffmpeg] 未找到 ffmpeg。请把 ffmpeg 可执行文件放到 PATH，或设置 VN_FFMPEG_PATH=/path/to/ffmpeg。',
  );
  process.exit(1);
}

fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.copyFileSync(source, TARGET);
const size = (fs.statSync(TARGET).size / 1024 / 1024).toFixed(1);
console.log(`[prepare-ffmpeg] ${source} → ${TARGET}（${size} MB）`);
writeNotice(source);
