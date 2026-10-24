'use strict';

// 素材模块的纯工具函数：id 生成、路径安全、扩展名/角色校验、data URL 与 vnasset URL。
// 不依赖 electron，可被主进程与单元测试直接 require。

const crypto = require('crypto');
const path = require('path');

/** 素材 id 与项目 schema 的 assetId 对齐：字母开头，允许字母/数字/下划线/连字符。
 *  生成器仍使用前缀+8位 base36；这里放宽是为了让旧工程/手写工程的合法 id 也能被素材编辑器编辑。 */
const ASSET_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const ASSET_ID_PREFIXES = ['img', 'aud', 'vid', 'mg'];
const GENERATED_ASSET_ID_RE = /^(?:img|aud|vid|mg)_[a-z0-9]{8,}$/;

const IMAGE_EXTS = ['png', 'webp', 'jpg', 'jpeg'];
const AUDIO_EXTS = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'];
const VIDEO_EXTS = ['mp4', 'webm'];

const IMAGE_ROLES = ['background', 'sprite', 'ui', 'other'];
const AUDIO_ROLES = ['bgm', 'sfx', 'voice'];

const MIME_BY_EXT = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  html: 'text/html',
  htm: 'text/html',
};

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 生成指定长度的小写 base36 随机串。 */
function randomBase36(length) {
  const bytes = crypto.randomBytes(length + 8);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += BASE36[bytes[i] % BASE36.length];
  }
  return out;
}

function toIdSet(existingIds) {
  if (existingIds instanceof Set) return existingIds;
  if (Array.isArray(existingIds)) return new Set(existingIds);
  if (existingIds && typeof existingIds[Symbol.iterator] === 'function') {
    return new Set(existingIds);
  }
  return new Set();
}

/**
 * 生成一个不与 existingIds 冲突的素材 id。
 * 冲突时先重试，多次仍冲突则加长随机串（8 → 10 → 12 …）。
 * @param {'img'|'aud'|'vid'|'mg'} prefix
 * @param {Iterable<string>} [existingIds]
 * @returns {string}
 */
function makeAssetId(prefix, existingIds) {
  const bare = String(prefix || '')
    .trim()
    .toLowerCase()
    .replace(/_+$/, '');
  if (!ASSET_ID_PREFIXES.includes(bare)) {
    throw new Error(`未知的素材 id 前缀：${prefix}（应为 ${ASSET_ID_PREFIXES.join('/')}）`);
  }
  const existing = toIdSet(existingIds);
  let length = 8;
  for (let attempt = 0; attempt < 5000; attempt += 1) {
    if (attempt > 0 && attempt % 500 === 0) length += 2;
    const id = `${bare}_${randomBase36(length)}`;
    if (!existing.has(id)) return id;
  }
  throw new Error('无法生成唯一素材 id，请检查已有素材是否异常');
}

/**
 * 把任意文本转成安全 slug（用于文件名/目录名）。保留中文、英文、数字、连字符。
 * @param {string} text
 * @param {string} [fallback]
 */
function slugify(text, fallback = 'asset') {
  let base = String(text == null ? '' : text).normalize('NFKD');
  // 去掉拉丁重音符号（NFKD 分解出的组合字符）
  base = base.replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // 文件名非法字符转空格，再统一成连字符
  base = base.replace(/[\\/:*?"<>|]+/g, ' ');
  // 仅保留英文、数字、中文与连字符/空白/下划线
  base = base.replace(/[^a-z0-9\u3400-\u9fff\-\s_]+/g, '');
  base = base
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length > 60) base = base.slice(0, 60).replace(/-+$/g, '');
  if (base) return base;

  let fb = String(fallback == null ? '' : fallback).toLowerCase();
  fb = fb
    .replace(/[^a-z0-9\u3400-\u9fff\-\s_]+/g, ' ')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return fb || 'asset';
}

/**
 * 小写扩展名（不含点）。兼容 '.PNG' / 'a.b.JPG' / 'C:\\x\\a.PNG' 这类输入。
 * @param {string} p
 */
function extnameLower(p) {
  if (typeof p !== 'string') return '';
  const value = p.trim();
  if (!value) return '';
  const raw = path.extname(value);
  if (raw) return raw.replace(/^\./, '').toLowerCase();
  // 只有 '.png' 这类「点 + 扩展名」的输入，path.extname 会当成 dotfile
  const dot = /^\.([A-Za-z0-9]+)$/.exec(value);
  return dot ? dot[1].toLowerCase() : '';
}

/** 归一化扩展名：接受 'PNG' / '.png' / 'a/b.PNG'。 */
function normalizeExt(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('.')) {
    return extnameLower(trimmed);
  }
  return trimmed.replace(/^\./, '');
}

/** Windows 反斜杠统一成正斜杠（项目内路径统一用 posix 风格）。 */
function toPosix(p) {
  return String(p == null ? '' : p).replace(/\\/g, '/');
}

/**
 * target 是否等于 base 或位于 base 目录内部（都用绝对路径解析后比较）。
 * @param {string} base
 * @param {string} target
 */
function isInside(base, target) {
  if (typeof base !== 'string' || typeof target !== 'string') return false;
  if (!base.trim() || !target.trim()) return false;
  const baseAbs = path.resolve(base);
  const targetAbs = path.resolve(target);
  const rel = path.relative(baseAbs, targetAbs);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/**
 * 把项目内相对路径安全地解析成绝对路径。
 * 拒绝：空路径、绝对路径、包含 `..` 段的路径、解析后逃出 projectDir 的路径。
 * @param {string} projectDir
 * @param {string} relativePath
 * @returns {string} 绝对路径
 */
function safeJoin(projectDir, relativePath) {
  if (typeof projectDir !== 'string' || !projectDir.trim()) {
    throw new Error('项目目录无效');
  }
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('素材路径无效');
  }
  if (relativePath.includes('\0')) {
    throw new Error('素材路径非法：包含空字符');
  }
  const rel = toPosix(relativePath.trim());
  if (/^[A-Za-z]:/.test(rel) || path.isAbsolute(rel) || rel.startsWith('/')) {
    throw new Error(`素材路径不能是绝对路径：${relativePath}`);
  }
  const segments = rel.split('/').filter(Boolean);
  if (segments.includes('..')) {
    throw new Error(`素材路径不能包含 .. 逃逸：${relativePath}`);
  }
  const baseAbs = path.resolve(projectDir);
  const targetAbs = path.resolve(baseAbs, rel);
  if (!isInside(baseAbs, targetAbs)) {
    throw new Error(`素材路径越出项目目录：${relativePath}`);
  }
  return targetAbs;
}

/** 原始文件相对路径：assets/.source/<images|audio>/<id>.<ext> */
function sourceRelPath(category, assetId, ext) {
  const key = String(category == null ? '' : category)
    .trim()
    .toLowerCase();
  const dirs = {
    image: 'images',
    images: 'images',
    audio: 'audio',
    audios: 'audio',
    video: 'videos',
    videos: 'videos',
  };
  const dir = dirs[key];
  if (!dir) throw new Error(`未知的素材分类：${category}`);
  if (typeof assetId !== 'string' || !ASSET_ID_RE.test(assetId)) {
    throw new Error(`素材 id 非法：${assetId}`);
  }
  const e = normalizeExt(ext);
  if (!e || !/^[a-z0-9]+$/.test(e)) throw new Error(`素材扩展名非法：${ext}`);
  return `assets/.source/${dir}/${assetId}.${e}`;
}

/** 图片最终文件路径：assets/images/<id>.<png|webp> */
function finalImageRelPath(assetId, ext = 'webp') {
  if (typeof assetId !== 'string' || !ASSET_ID_RE.test(assetId)) {
    throw new Error(`素材 id 非法：${assetId}`);
  }
  const e = normalizeExt(ext);
  if (!['png', 'webp'].includes(e)) throw new Error(`图片最终格式只支持 png/webp：${ext}`);
  return `assets/images/${assetId}.${e}`;
}

/** 音频最终文件路径：assets/audio/<id>.<ogg|mp3> */
function finalAudioRelPath(assetId, ext = 'ogg') {
  if (typeof assetId !== 'string' || !ASSET_ID_RE.test(assetId)) {
    throw new Error(`素材 id 非法：${assetId}`);
  }
  const e = normalizeExt(ext);
  if (!['ogg', 'mp3'].includes(e)) throw new Error(`音频最终格式只支持 ogg/mp3：${ext}`);
  return `assets/audio/${assetId}.${e}`;
}

/** 视频最终文件路径：assets/videos/<id>.<mp4|webm> */
function finalVideoRelPath(assetId, ext) {
  if (typeof assetId !== 'string' || !ASSET_ID_RE.test(assetId)) {
    throw new Error(`素材 id 非法：${assetId}`);
  }
  const e = normalizeExt(ext);
  if (!VIDEO_EXTS.includes(e)) throw new Error(`视频最终格式只支持 mp4/webm：${ext}`);
  return `assets/videos/${assetId}.${e}`;
}

/** 小游戏最终文件路径：assets/minigames/<id>.html */
function finalMinigameRelPath(assetId) {
  if (typeof assetId !== 'string' || !ASSET_ID_RE.test(assetId)) {
    throw new Error(`素材 id 非法：${assetId}`);
  }
  return `assets/minigames/${assetId}.html`;
}

/**
 * 校验并归一化音频截取区间。
 * - trim 为空（null/undefined）返回 { trim: null }
 * - start 夹到 0..duration-1，end 夹到 start+1..duration，均取整
 * - end <= start（取整后）返回 { trim: null, error }
 * @param {{startMs:number,endMs:number}|null|undefined} trim
 * @param {number} durationMs
 * @returns {{trim:{startMs:number,endMs:number}|null,error?:string}}
 */
function normalizeTrim(trim, durationMs) {
  if (trim === null || trim === undefined) return { trim: null };
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { trim: null, error: '音频时长无效，无法校验截取区间' };
  }
  const durationInt = Math.max(1, Math.round(duration));
  const rawStart = Number(trim.startMs);
  const rawEnd = Number(trim.endMs);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
    return { trim: null, error: '截取区间必须是毫秒数字' };
  }
  const startRaw = Math.round(rawStart);
  const endRaw = Math.round(rawEnd);
  if (endRaw <= startRaw) {
    return { trim: null, error: '截取区间无效：结束时间必须大于开始时间' };
  }
  const startMs = Math.min(Math.max(startRaw, 0), durationInt - 1);
  const endMs = Math.min(Math.max(endRaw, startMs + 1), durationInt);
  if (endMs <= startMs) {
    return { trim: null, error: '截取区间无效：结束时间必须大于开始时间' };
  }
  return { trim: { startMs, endMs } };
}

function imageRoleValid(role) {
  return IMAGE_ROLES.includes(role);
}

function audioRoleValid(role) {
  return AUDIO_ROLES.includes(role);
}

function isSupportedImageExt(value) {
  return IMAGE_EXTS.includes(normalizeExt(value));
}

function isSupportedAudioExt(value) {
  return AUDIO_EXTS.includes(normalizeExt(value));
}

function isSupportedVideoExt(value) {
  return VIDEO_EXTS.includes(normalizeExt(value));
}

/** 图片或音频的受支持扩展名（导入对话框等场景的合并判断）。 */
function isSupportedImageAudioExt(value) {
  return isSupportedImageExt(value) || isSupportedAudioExt(value);
}

/** 扩展名 → MIME；未知返回 application/octet-stream。 */
function mimeForExt(ext) {
  return MIME_BY_EXT[normalizeExt(ext)] || 'application/octet-stream';
}

/**
 * 生成 vnasset:// 地址。规则与主进程协议处理器保持一致：
 * `vnasset://asset/` + encodeURIComponent(相对路径)。
 * @param {string} relativePath
 */
function makeVnAssetUrl(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('素材路径无效');
  }
  const rel = toPosix(relativePath.trim()).replace(/^\.\/+/, '').replace(/^\/+/, '');
  if (!rel) throw new Error('素材路径无效');
  return `vnasset://asset/${encodeURIComponent(rel)}`;
}

/**
 * Buffer → data URL。
 * @param {Buffer|Uint8Array} buffer
 * @param {string} ext
 */
function dataUrlForBuffer(buffer, ext) {
  const mime = mimeForExt(ext);
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}

module.exports = {
  ASSET_ID_RE,
  IMAGE_EXTS,
  AUDIO_EXTS,
  VIDEO_EXTS,
  IMAGE_ROLES,
  AUDIO_ROLES,
  MIME_BY_EXT,
  makeAssetId,
  slugify,
  extnameLower,
  normalizeExt,
  toPosix,
  isInside,
  safeJoin,
  sourceRelPath,
  finalImageRelPath,
  finalAudioRelPath,
  finalVideoRelPath,
  finalMinigameRelPath,
  normalizeTrim,
  imageRoleValid,
  audioRoleValid,
  isSupportedImageExt,
  isSupportedAudioExt,
  isSupportedVideoExt,
  isSupportedImageAudioExt,
  mimeForExt,
  makeVnAssetUrl,
  dataUrlForBuffer,
};
