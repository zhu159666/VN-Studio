'use strict';

// ffmpeg / 图片元信息封装。全部使用绝对路径；本机没有 ffprobe，因此用 `ffmpeg -i` 的 stderr 解析元数据。
// 该文件不依赖 electron，可被主进程与单元测试直接 require。

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { imageSize } = require('image-size');

function resolveFfmpegPath() {
  if (process.env.VN_FFMPEG_PATH) return process.env.VN_FFMPEG_PATH;
  if (process.resourcesPath) {
    const candidates =
      process.platform === 'win32'
        ? [path.join(process.resourcesPath, 'bin', 'ffmpeg.exe')]
        : [path.join(process.resourcesPath, 'bin', 'ffmpeg')];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'ffmpeg';
}

const FFMPEG = resolveFfmpegPath();
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_STDERR_TAIL = 2000;

let ffmpegAvailableCache = null;

/** 探测本机 ffmpeg 是否可用（结果缓存；可用 VN_FFMPEG_PATH 覆盖路径）。 */
function isFfmpegAvailable() {
  if (ffmpegAvailableCache !== null) return ffmpegAvailableCache;
  try {
    execFileSync(FFMPEG, ['-version'], {
      stdio: 'ignore',
      timeout: 10000,
      windowsHide: true,
    });
    ffmpegAvailableCache = true;
  } catch {
    ffmpegAvailableCache = false;
  }
  return ffmpegAvailableCache;
}

/** 仅供测试/排障：清空 ffmpeg 可用性缓存。 */
function resetFfmpegCache() {
  ffmpegAvailableCache = null;
}

/**
 * 执行 ffmpeg，无论退出码都收集 stdout/stderr（用于 `ffmpeg -i` 这类「非 0 退出但 stderr 有用」的场景）。
 * @returns {Promise<{stdout:string,stderr:string,code:number|null,timedOut:boolean,error:Error|null}>}
 */
function execFfmpegRaw(args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const argv = (Array.isArray(args) ? args : []).map(String);
  const timeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    execFile(
      FFMPEG,
      argv,
      {
        timeout,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          code: error ? (typeof error.code === 'number' ? error.code : null) : 0,
          timedOut: Boolean(error && error.killed),
          error: error || null,
        });
      },
    );
  });
}

/**
 * 运行 ffmpeg，失败时抛错（Error 上带 stderr 尾部 2000 字符）。
 * @param {string[]} args
 * @param {{timeoutMs?:number}} [options]
 * @returns {Promise<{stdout:string,stderr:string}>}
 */
async function runFfmpeg(args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const result = await execFfmpegRaw(args, { timeoutMs });
  if (!result.error) {
    return { stdout: result.stdout, stderr: result.stderr };
  }
  const tail = String(result.stderr || '').slice(-MAX_STDERR_TAIL);
  let message;
  if (result.error.code === 'ENOENT') {
    message = `未找到 ffmpeg 可执行文件（${FFMPEG}），请确认已安装并加入 PATH`;
  } else if (result.timedOut) {
    message = `ffmpeg 执行超时（${timeoutMs}ms）${tail ? `：${tail}` : ''}`;
  } else {
    message = `ffmpeg 执行失败（退出码 ${result.code == null ? '未知' : result.code}）${tail ? `：${tail}` : ''}`;
  }
  const error = new Error(message);
  error.stderr = tail;
  error.code = result.code;
  error.cause = result.error;
  throw error;
}

/** codec 归一化：h264/avc/avc1 → h264，vp8/vp9 保留，其他转小写。 */
function normalizeCodec(raw) {
  const codec = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase();
  if (!codec) return '';
  const aliases = {
    h264: 'h264',
    avc: 'h264',
    avc1: 'h264',
    'h.264': 'h264',
    vp8: 'vp8',
    vp9: 'vp9',
  };
  return aliases[codec] || codec;
}

function parseDurationMs(stderr) {
  const match = /Duration:\s*(\d{1,3}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?/.exec(stderr);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] ? Number(`0.${match[4]}`) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  const total = ((hours * 60 + minutes) * 60 + seconds + fraction) * 1000;
  if (!Number.isFinite(total) || total < 0) return null;
  return Math.round(total);
}

function parseFormatName(stderr) {
  // 例：Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':
  const match = /Input #\d+,\s*(.+?),\s*from\s+/.exec(stderr);
  if (!match) return null;
  const value = match[1].trim();
  return value || null;
}

/**
 * 解析 `ffmpeg -i` 的 stderr（纯函数，便于单测）。
 * 兼容 2018 旧版 ffmpeg 的输出：
 *   Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':
 *     Duration: 00:00:02.02, start: 0.000000, bitrate: 132 kb/s
 *     Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 320x240 ...
 *     Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp ...
 * @param {string} stderr
 * @returns {{durationMs:number|null,formatName:string|null,video:{codec:string,width:number|null,height:number|null}|null,audio:{codec:string}|null,hasAudio:boolean}}
 */
function parseFfmpegProbe(stderr) {
  const text = typeof stderr === 'string' ? stderr : '';
  const result = {
    durationMs: parseDurationMs(text),
    formatName: parseFormatName(text),
    video: null,
    audio: null,
    hasAudio: false,
  };
  if (!text) return result;

  const streamRe = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*(Video|Audio):\s*([^\r\n]+)/g;
  const videoCandidates = [];
  let match;
  while ((match = streamRe.exec(text)) !== null) {
    const kind = match[1];
    const rest = match[2];
    const codecMatch = /^([A-Za-z0-9_.]+)/.exec(rest);
    const codec = normalizeCodec(codecMatch ? codecMatch[1] : '');
    if (kind === 'Video') {
      const attached = /attached\s*pic/i.test(rest);
      const dims = /(\d{2,5})x(\d{2,5})/.exec(rest);
      videoCandidates.push({
        codec,
        attached,
        width: dims ? Number(dims[1]) : null,
        height: dims ? Number(dims[2]) : null,
      });
    } else if (!result.audio) {
      result.audio = { codec };
      result.hasAudio = true;
    }
  }

  // 忽略封面图（attached pic），优先带分辨率的真实视频流
  const usable = videoCandidates.filter((candidate) => !candidate.attached);
  const chosen = usable.find((candidate) => candidate.width && candidate.height) || usable[0] || null;
  if (chosen) {
    result.video = { codec: chosen.codec, width: chosen.width, height: chosen.height };
  }
  return result;
}

/**
 * 用 `ffmpeg -hide_banner -i <absPath>` 探测媒体信息。
 * 该命令不生成输出文件，会以非 0 退出，stderr 才是有效信息（属正常）。
 * @param {string} absPath
 */
async function probeMedia(absPath) {
  if (typeof absPath !== 'string' || !absPath.trim()) {
    throw new Error('媒体路径无效');
  }
  if (!isFfmpegAvailable()) {
    throw new Error('ffmpeg 不可用，无法探测媒体信息');
  }
  const result = await execFfmpegRaw(['-hide_banner', '-i', absPath], { timeoutMs: 15000 });
  const stderr = result.stderr || '';
  if (!stderr.trim()) {
    if (result.error && result.error.code === 'ENOENT') {
      throw new Error(`未找到 ffmpeg 可执行文件（${FFMPEG}），请确认已安装并加入 PATH`);
    }
    throw new Error(`无法读取媒体信息：${path.basename(absPath)}`);
  }
  return { ...parseFfmpegProbe(stderr), stderr };
}

/**
 * 读取图片宽高（image-size 支持 Buffer 调用）。
 * @param {string} absPath
 * @returns {Promise<{width:number,height:number,type:string}>}
 */
async function imageInfo(absPath) {
  if (typeof absPath !== 'string' || !absPath.trim()) throw new Error('图片路径无效');
  let buffer;
  try {
    buffer = await fsp.readFile(absPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`图片文件不存在：${path.basename(absPath)}`);
    }
    throw new Error(`无法读取图片文件：${path.basename(absPath)}（${error && error.message ? error.message : '未知错误'}）`);
  }
  let info;
  try {
    info = imageSize(buffer);
  } catch (error) {
    throw new Error(`无法识别图片格式：${path.basename(absPath)}（${error && error.message ? error.message : '未知错误'}）`);
  }
  const width = Number(info && info.width);
  const height = Number(info && info.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`无法读取图片尺寸：${path.basename(absPath)}`);
  }
  return { width, height, type: (info && info.type) || '' };
}

/**
 * 图片转 webp（保留透明度）。
 * @param {string} inputAbs
 * @param {string} outputAbs
 * @param {number} [quality]
 */
async function convertImageToWebp(inputAbs, outputAbs, quality = 90) {
  if (typeof inputAbs !== 'string' || !inputAbs.trim()) throw new Error('输入图片路径无效');
  if (typeof outputAbs !== 'string' || !outputAbs.trim()) throw new Error('输出图片路径无效');
  await fsp.mkdir(path.dirname(outputAbs), { recursive: true });
  const q = Math.min(100, Math.max(1, Math.round(Number(quality) || 90)));
  const result = await runFfmpeg([
    '-y',
    '-i',
    inputAbs,
    '-c:v',
    'libwebp',
    '-quality',
    String(q),
    '-pix_fmt',
    'yuva420p',
    outputAbs,
  ]);
  const stat = await fsp.stat(outputAbs).catch(() => null);
  if (!stat || !stat.size) {
    throw new Error(`图片转换失败：未生成 ${path.basename(outputAbs)}`);
  }
  return result;
}

/**
 * 音频截取 + 增益 + 重编码。
 * @param {{sourceAbs:string,outAbs:string,trim?:{startMs:number,endMs:number}|null,gainDb?:number,format?:'ogg'|'mp3'}} options
 * @returns {Promise<{stdout:string,stderr:string}>}
 */
async function processAudio({ sourceAbs, outAbs, trim = null, gainDb = 0, format = 'ogg' } = {}) {
  if (typeof sourceAbs !== 'string' || !sourceAbs.trim()) throw new Error('音频源文件路径无效');
  if (typeof outAbs !== 'string' || !outAbs.trim()) throw new Error('音频输出路径无效');
  const fmt = String(format || 'ogg').toLowerCase();
  if (!['ogg', 'mp3'].includes(fmt)) {
    throw new Error(`不支持的音频输出格式：${format}（只支持 ogg/mp3）`);
  }
  await fsp.mkdir(path.dirname(outAbs), { recursive: true });

  const args = ['-y', '-i', sourceAbs];
  if (trim && Number.isFinite(Number(trim.startMs)) && Number.isFinite(Number(trim.endMs))) {
    const startSec = Math.max(0, Number(trim.startMs) / 1000);
    const durationSec = (Number(trim.endMs) - Number(trim.startMs)) / 1000;
    if (durationSec > 0) {
      args.push('-ss', startSec.toFixed(3), '-t', durationSec.toFixed(3));
    }
  }
  const gain = Number(gainDb);
  if (Number.isFinite(gain) && gain !== 0) {
    args.push('-af', `volume=${gain}dB`);
  }
  args.push('-vn');
  if (fmt === 'ogg') {
    args.push('-c:a', 'libvorbis', '-q:a', '5');
  } else {
    args.push('-c:a', 'libmp3lame', '-b:a', '192k');
  }
  args.push(outAbs);

  const result = await runFfmpeg(args, { timeoutMs: 60000 });
  const stat = await fsp.stat(outAbs).catch(() => null);
  if (!stat || !stat.size) {
    throw new Error(`音频转换失败：未生成 ${path.basename(outAbs)}`);
  }
  return result;
}

module.exports = {
  FFMPEG,
  isFfmpegAvailable,
  resetFfmpegCache,
  runFfmpeg,
  execFfmpegRaw,
  parseFfmpegProbe,
  normalizeCodec,
  probeMedia,
  imageInfo,
  convertImageToWebp,
  processAudio,
};
