'use strict';

// 图片导入预处理：解码校验、纯色背景抠像、预设裁剪缩放。
// 复用安装包内置的 ffmpeg，避免 sharp 原生 ABI / jimp 额外依赖带来的打包问题。
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const media = require('./media.cjs');

const PRESETS = {
  character: { width: 512, height: 1024, role: 'sprite' },
  background: { width: 1920, height: 1080, role: 'background' },
};
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

function detectImageExt(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function decodeBase64(data) {
  if (typeof data !== 'string' || !data.trim()) {
    const error = new Error('base64_data 不能为空');
    error.code = 'E_IMAGE_EMPTY';
    throw error;
  }
  const raw = data.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
  let buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    const error = new Error('Base64 解码失败');
    error.code = 'E_IMAGE_INVALID';
    throw error;
  }
  if (!buffer.length) {
    const error = new Error('Base64 图片数据为空');
    error.code = 'E_IMAGE_EMPTY';
    throw error;
  }
  if (buffer.length > MAX_INPUT_BYTES) {
    const error = new Error(`图片超过 ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB 限制`);
    error.code = 'E_IMAGE_TOO_LARGE';
    throw error;
  }
  const ext = detectImageExt(buffer);
  if (!ext) {
    const error = new Error('仅支持 PNG / JPEG / WebP 图片');
    error.code = 'E_IMAGE_FORMAT';
    throw error;
  }
  return { buffer, ext };
}

function ffmpegRaw(args) {
  try {
    return execFileSync(media.FFMPEG, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60000,
      windowsHide: true,
    });
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).slice(-800) : '';
    const wrapped = new Error(`ffmpeg 图片处理失败${stderr ? `：${stderr}` : ''}`);
    wrapped.code = 'E_IMAGE_PROCESS_FAILED';
    throw wrapped;
  }
}

function sampleBorderColors(file, width, height) {
  const points = [
    [0, 0],
    [Math.max(0, width - 1), 0],
    [0, Math.max(0, height - 1)],
    [Math.max(0, width - 1), Math.max(0, height - 1)],
    [Math.floor(width / 2), 0],
    [Math.floor(width / 2), Math.max(0, height - 1)],
    [0, Math.floor(height / 2)],
    [Math.max(0, width - 1), Math.floor(height / 2)],
  ];
  const counts = new Map();
  for (const [x, y] of points) {
    try {
      const raw = ffmpegRaw([
        '-v',
        'error',
        '-i',
        file,
        '-vf',
        `crop=1:1:${x}:${y},format=rgba`,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-',
      ]);
      if (raw.length < 4) continue;
      const alpha = raw[3];
      if (alpha < 32) continue;
      // 量化到 8 的倍数，降低抗锯齿/噪点导致的抖动
      const r = raw[0] & 0xf8;
      const g = raw[1] & 0xf8;
      const b = raw[2] & 0xf8;
      const key = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
        .toString(16)
        .padStart(2, '0')}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    } catch {
      /* 单个采样失败不影响整体 */
    }
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * @param {{buffer:Buffer, assetType:'character'|'background', autoRemoveBg:boolean}} options
 */
async function processImportedImage({ buffer, assetType, autoRemoveBg = true }) {
  const preset = PRESETS[assetType];
  if (!preset) {
    const error = new Error('asset_type 必须是 character 或 background');
    error.code = 'E_IMAGE_TYPE';
    throw error;
  }
  if (!media.isFfmpegAvailable()) {
    const error = new Error('当前环境没有可用的 ffmpeg，无法处理图片');
    error.code = 'E_FFMPEG_UNAVAILABLE';
    throw error;
  }
  const detected = detectImageExt(buffer);
  if (!detected) {
    const error = new Error('仅支持 PNG / JPEG / WebP 图片');
    error.code = 'E_IMAGE_FORMAT';
    throw error;
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vns-image-'));
  const inputPath = path.join(tempDir, `input.${detected}`);
  const outputPath = path.join(tempDir, 'output.png');
  try {
    await fsp.writeFile(inputPath, buffer);
    const sourceInfo = await media.imageInfo(inputPath);
    if (!sourceInfo?.width || !sourceInfo?.height) {
      const error = new Error('无法读取图片尺寸');
      error.code = 'E_IMAGE_INVALID';
      throw error;
    }

    const removeBg = assetType === 'character' && autoRemoveBg === true;
    const keyColor = removeBg ? sampleBorderColors(inputPath, sourceInfo.width, sourceInfo.height) : null;
    const filters = [];
    if (removeBg && keyColor) filters.push(`colorkey=${keyColor}:0.22:0.08`);
    filters.push(
      `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase`,
      `crop=${preset.width}:${preset.height}`,
      'format=rgba',
    );

    ffmpegRaw([
      '-y',
      '-v',
      'error',
      '-i',
      inputPath,
      '-vf',
      filters.join(','),
      '-frames:v',
      '1',
      '-c:v',
      'png',
      outputPath,
    ]);
    const processed = await fsp.readFile(outputPath);
    if (!processed.length) {
      const error = new Error('图片处理后为空');
      error.code = 'E_IMAGE_PROCESS_FAILED';
      throw error;
    }
    return {
      buffer: processed,
      format: 'png',
      width: preset.width,
      height: preset.height,
      role: preset.role,
      sourceWidth: sourceInfo.width,
      sourceHeight: sourceInfo.height,
      sourceFormat: detected,
      removedBackground: Boolean(removeBg && keyColor),
      keyColor,
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { PRESETS, MAX_INPUT_BYTES, detectImageExt, decodeBase64, processImportedImage };
