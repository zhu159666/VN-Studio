'use strict';

// 素材导入 / 读取 / 导出 / 删除的主进程实现。
// main.cjs 直接调用这里导出的函数，并在外面包 { ok: true } / { ok: false, error }。
// 本文件只在 Electron 主进程中 require（dialog），单元测试不直接导入它。

const fsp = require('fs/promises');
const path = require('path');

const utils = require('./asset-utils.cjs');
const media = require('./media.cjs');
const minigame = require('./minigame.cjs');

const MAX_DATA_URL_BYTES = 40 * 1024 * 1024;

const DIRS = {
  images: 'assets/images',
  audio: 'assets/audio',
  videos: 'assets/videos',
  minigames: 'assets/minigames',
  sourceImages: 'assets/.source/images',
  sourceAudio: 'assets/.source/audio',
};

const EXTS_BY_KIND = {
  image: utils.IMAGE_EXTS,
  audio: utils.AUDIO_EXTS,
  video: utils.VIDEO_EXTS,
  minigame: ['html'],
};

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------

function requireProjectDir(projectDir) {
  if (typeof projectDir !== 'string' || !projectDir.trim()) {
    throw new Error('项目目录无效');
  }
  const trimmed = projectDir.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new Error('项目目录必须是绝对路径');
  }
  return path.resolve(trimmed);
}

async function ensureProjectDirs(root) {
  for (const dir of Object.values(DIRS)) {
    await fsp.mkdir(path.join(root, dir), { recursive: true });
  }
}

async function unlinkQuiet(absPath) {
  if (typeof absPath !== 'string' || !absPath.trim()) return;
  try {
    await fsp.unlink(absPath);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      // 清理失败不应掩盖主流程，调用方根据需要决定是否提示
    }
  }
}

async function statOrNull(absPath) {
  try {
    return await fsp.stat(absPath);
  } catch {
    return null;
  }
}

function assetNameFromFile(filePath, fallbackId) {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext).trim();
  const name = base || fallbackId;
  return name.slice(0, 200);
}

function nowIso() {
  return new Date().toISOString();
}

/** 扫描目录中已存在的素材 id（文件名去掉扩展名）。 */
async function collectExistingIds(root, dirs) {
  const ids = new Set();
  for (const dir of dirs) {
    let entries;
    try {
      entries = await fsp.readdir(path.join(root, dir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const base = entry.replace(/\.[^.]+$/, '');
      if (utils.ASSET_ID_RE.test(base)) ids.add(base);
    }
  }
  return ids;
}

async function allocateAssetId(root, prefix, dirs) {
  const existing = await collectExistingIds(root, dirs);
  return utils.makeAssetId(prefix, existing);
}

/**
 * 打开系统文件选择框。main.cjs 负责把 canceled 包装成 {ok:true,canceled:true}。
 * @param {{title:string, extensions:string[]}} options
 */
async function showFiles({ title, extensions }) {
  let dialog;
  try {
    ({ dialog } = require('electron'));
  } catch {
    dialog = null;
  }
  if (!dialog || typeof dialog.showOpenDialog !== 'function') {
    throw new Error('当前环境不可用文件选择对话框');
  }
  const result = await dialog.showOpenDialog({
    title,
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: '素材文件',
        extensions,
      },
    ],
  });
  if (!result || result.canceled) {
    return { canceled: true, filePaths: [] };
  }
  return { canceled: false, filePaths: Array.isArray(result.filePaths) ? result.filePaths : [] };
}

// ---------------------------------------------------------------------------
// 无 ffmpeg 时的音频时长估算（仅 mp3 / ogg 的兜底路径需要）
// ---------------------------------------------------------------------------

const MPEG1_LAYER3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_LAYER3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

function mp3DurationMs(buffer) {
  let offset = 0;
  if (buffer.length > 10 && buffer.toString('latin1', 0, 3) === 'ID3') {
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    offset = Math.min(buffer.length, 10 + size);
  }
  let audioEnd = buffer.length;
  if (audioEnd - offset > 128 && buffer.toString('latin1', audioEnd - 128, audioEnd - 125) === 'TAG') {
    audioEnd -= 128; // ID3v1
  }
  const limit = Math.min(audioEnd - 4, offset + 512 * 1024);
  for (let i = offset; i <= limit; i += 1) {
    if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (buffer[i + 1] >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layerBits = (buffer[i + 1] >> 1) & 0x03; // 1=Layer III
    if (versionBits === 1 || layerBits !== 1) continue;
    const bitrateIndex = (buffer[i + 2] >> 4) & 0x0f;
    const sampleRateIndex = (buffer[i + 2] >> 2) & 0x03;
    if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) continue;
    const table = versionBits === 3 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES;
    const bitrateKbps = table[bitrateIndex];
    if (!bitrateKbps) continue;
    const audioBytes = audioEnd - i;
    // CBR 估算：bits / kbps = ms
    return Math.max(1, Math.round((audioBytes * 8) / bitrateKbps));
  }
  return null;
}

function oggVorbisDurationMs(buffer) {
  const marker = Buffer.from('vorbis', 'latin1');
  const firstPacket = buffer.indexOf(marker);
  if (firstPacket < 1) return null;
  // 包结构：0x01 'vorbis' version(u32) channels(u8) sampleRate(u32) ...
  // 'vorbis' 位于包内偏移 1，故 sampleRate = (markerIndex - 1) + 12 = markerIndex + 11
  if (firstPacket + 15 > buffer.length) return null;
  const sampleRate = buffer.readUInt32LE(firstPacket + 11);
  if (!sampleRate) return null;

  let lastGranule = -1;
  let pageIndex = buffer.lastIndexOf(Buffer.from('OggS', 'latin1'));
  while (pageIndex >= 0) {
    if (pageIndex + 14 <= buffer.length) {
      const granule = Number(buffer.readBigUInt64LE(pageIndex + 6));
      if (Number.isFinite(granule) && granule > 0) {
        lastGranule = granule;
        break;
      }
    }
    if (pageIndex === 0) break;
    pageIndex = buffer.lastIndexOf(Buffer.from('OggS', 'latin1'), pageIndex - 1);
  }
  if (lastGranule <= 0) return null;
  return Math.max(1, Math.round((lastGranule / sampleRate) * 1000));
}

async function guessAudioDurationMs(absPath, ext) {
  const e = utils.normalizeExt(ext);
  if (!['mp3', 'ogg'].includes(e)) return null;
  let buffer;
  try {
    buffer = await fsp.readFile(absPath);
  } catch {
    return null;
  }
  try {
    return e === 'mp3' ? mp3DurationMs(buffer) : oggVorbisDurationMs(buffer);
  } catch {
    return null;
  }
}

async function detectAudioDurationMs(absPath, ext) {
  if (media.isFfmpegAvailable()) {
    try {
      const info = await media.probeMedia(absPath);
      if (Number.isInteger(info.durationMs) && info.durationMs > 0) return info.durationMs;
    } catch {
      // 落到下面的兜底估算
    }
  }
  return guessAudioDurationMs(absPath, ext);
}

// ---------------------------------------------------------------------------
// 导入：图片
// ---------------------------------------------------------------------------

/**
 * @param {{projectDir:string, role?:string}} options
 * @returns {Promise<{canceled:true}|{assets:object[],warnings:string[]}>}
 */
async function importImages({ projectDir, role } = {}) {
  const root = requireProjectDir(projectDir);
  const picked = await showFiles({ title: '导入图片', extensions: EXTS_BY_KIND.image });
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true };

  await ensureProjectDirs(root);
  const ffmpegAvailable = media.isFfmpegAvailable();
  const assets = [];
  const warnings = [];
  const validRole = utils.imageRoleValid(role) ? role : 'other';
  const idDirs = [DIRS.images, DIRS.sourceImages];

  for (const filePath of picked.filePaths) {
    const displayName = path.basename(filePath);
    const created = [];
    try {
      const ext = utils.extnameLower(filePath);
      if (!utils.isSupportedImageExt(ext)) {
        warnings.push(
          `${displayName}：不支持的图片格式${ext ? `（.${ext}）` : ''}，仅支持 ${utils.IMAGE_EXTS.join(' / ')}`,
        );
        continue;
      }

      const id = await allocateAssetId(root, 'img', idDirs);
      const sourceRel = utils.sourceRelPath('images', id, ext);
      const sourceAbs = utils.safeJoin(root, sourceRel);
      await fsp.mkdir(path.dirname(sourceAbs), { recursive: true });
      await fsp.copyFile(filePath, sourceAbs);
      created.push(sourceAbs);
      const sourceStat = await fsp.stat(sourceAbs);
      const sourceInfo = await media.imageInfo(sourceAbs);

      let finalRel;
      let finalFormat;
      if (ffmpegAvailable) {
        finalFormat = 'webp';
        finalRel = utils.finalImageRelPath(id, 'webp');
        const finalAbs = utils.safeJoin(root, finalRel);
        await media.convertImageToWebp(sourceAbs, finalAbs, 90);
        created.push(finalAbs);
      } else if (ext === 'png' || ext === 'webp') {
        finalFormat = ext;
        finalRel = utils.finalImageRelPath(id, ext);
        const finalAbs = utils.safeJoin(root, finalRel);
        await fsp.copyFile(sourceAbs, finalAbs);
        created.push(finalAbs);
      } else {
        throw new Error(`ffmpeg 不可用，无法把 .${ext} 转换为 png/webp`);
      }

      const finalAbs = utils.safeJoin(root, finalRel);
      const finalStat = await statOrNull(finalAbs);
      if (!finalStat || !finalStat.size) throw new Error('生成的图片文件为空');

      assets.push({
        id,
        kind: 'image',
        name: assetNameFromFile(filePath, id),
        role: validRole,
        path: finalRel,
        width: sourceInfo.width,
        height: sourceInfo.height,
        format: finalFormat,
        sizeBytes: finalStat.size,
        importedAt: nowIso(),
        edit: { crop: null, removeBackground: null, adjustments: { brightness: 0, contrast: 0 } },
        source: {
          path: sourceRel,
          format: ext,
          width: sourceInfo.width,
          height: sourceInfo.height,
          sizeBytes: sourceStat.size,
        },
      });
    } catch (error) {
      warnings.push(`${displayName}：${error && error.message ? error.message : '导入失败'}`);
      for (const createdPath of created) await unlinkQuiet(createdPath);
    }
  }

  return { assets, warnings };
}

// ---------------------------------------------------------------------------
// 导入：音频
// ---------------------------------------------------------------------------

/**
 * @param {{projectDir:string, role?:string}} options
 * @returns {Promise<{canceled:true}|{assets:object[],warnings:string[]}>}
 */
async function importAudio({ projectDir, role } = {}) {
  const root = requireProjectDir(projectDir);
  const picked = await showFiles({ title: '导入音频', extensions: EXTS_BY_KIND.audio });
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true };

  await ensureProjectDirs(root);
  const ffmpegAvailable = media.isFfmpegAvailable();
  const assets = [];
  const warnings = [];
  const validRole = utils.audioRoleValid(role) ? role : 'bgm';
  const idDirs = [DIRS.audio, DIRS.sourceAudio];

  for (const filePath of picked.filePaths) {
    const displayName = path.basename(filePath);
    const created = [];
    try {
      const ext = utils.extnameLower(filePath);
      if (!utils.isSupportedAudioExt(ext)) {
        warnings.push(
          `${displayName}：不支持的音频格式${ext ? `（.${ext}）` : ''}，仅支持 ${utils.AUDIO_EXTS.join(' / ')}`,
        );
        continue;
      }

      const id = await allocateAssetId(root, 'aud', idDirs);
      const sourceRel = utils.sourceRelPath('audio', id, ext);
      const sourceAbs = utils.safeJoin(root, sourceRel);
      await fsp.mkdir(path.dirname(sourceAbs), { recursive: true });
      await fsp.copyFile(filePath, sourceAbs);
      created.push(sourceAbs);
      const sourceStat = await fsp.stat(sourceAbs);

      if (!ffmpegAvailable && ext !== 'mp3' && ext !== 'ogg') {
        throw new Error(`ffmpeg 不可用，无法把 .${ext} 转换为 ogg/mp3`);
      }
      const sourceDurationMs = await detectAudioDurationMs(sourceAbs, ext);
      if (!sourceDurationMs || sourceDurationMs < 1) {
        throw new Error('无法读取音频时长（文件可能损坏或格式不受支持）');
      }

      let finalRel;
      let finalFormat;
      if (ffmpegAvailable) {
        finalFormat = 'ogg';
        finalRel = utils.finalAudioRelPath(id, 'ogg');
        const finalAbs = utils.safeJoin(root, finalRel);
        await media.processAudio({
          sourceAbs,
          outAbs: finalAbs,
          trim: null,
          gainDb: 0,
          format: 'ogg',
        });
        created.push(finalAbs);
      } else {
        finalFormat = ext;
        finalRel = utils.finalAudioRelPath(id, ext);
        const finalAbs = utils.safeJoin(root, finalRel);
        await fsp.copyFile(sourceAbs, finalAbs);
        created.push(finalAbs);
      }

      const finalAbs = utils.safeJoin(root, finalRel);
      const finalStat = await statOrNull(finalAbs);
      if (!finalStat || !finalStat.size) throw new Error('生成的音频文件为空');

      assets.push({
        id,
        kind: 'audio',
        name: assetNameFromFile(filePath, id),
        role: validRole,
        path: finalRel,
        format: finalFormat,
        durationMs: sourceDurationMs,
        sizeBytes: finalStat.size,
        importedAt: nowIso(),
        trim: null,
        gainDb: 0,
        loop: false,
        source: {
          path: sourceRel,
          format: ext,
          durationMs: sourceDurationMs,
          sizeBytes: sourceStat.size,
        },
      });
    } catch (error) {
      warnings.push(`${displayName}：${error && error.message ? error.message : '导入失败'}`);
      for (const createdPath of created) await unlinkQuiet(createdPath);
    }
  }

  return { assets, warnings };
}

// ---------------------------------------------------------------------------
// 生成音频（编辑器「音频工坊」）
// ---------------------------------------------------------------------------

/**
 * 保存渲染层合成的 WAV：写入 .source，转成 ogg 作为最终文件，返回完整素材记录。
 * @param {{projectDir:string, name?:string, role?:string, wavBase64:string, durationMs?:number}} options
 */
async function saveGeneratedAudio({ projectDir, name, role, wavBase64, durationMs } = {}) {
  const root = requireProjectDir(projectDir);
  if (typeof wavBase64 !== 'string' || !wavBase64.trim()) throw new Error('缺少生成的音频数据');
  const rawBase64 = wavBase64.replace(/^data:[^,]*,/, '');
  const buffer = Buffer.from(rawBase64, 'base64');
  if (!buffer.length) throw new Error('生成的音频数据为空');
  if (!media.isFfmpegAvailable()) {
    throw new Error('ffmpeg 不可用，无法把生成的 WAV 转成 ogg（请安装 ffmpeg 后重试）');
  }

  const validRole = utils.audioRoleValid(role) ? role : 'bgm';
  await ensureProjectDirs(root);
  const idDirs = [DIRS.audio, DIRS.sourceAudio];
  const id = await allocateAssetId(root, 'aud', idDirs);
  const sourceRel = utils.sourceRelPath('audio', id, 'wav');
  const sourceAbs = utils.safeJoin(root, sourceRel);
  await fsp.mkdir(path.dirname(sourceAbs), { recursive: true });
  await fsp.writeFile(sourceAbs, buffer);
  const created = [sourceAbs];

  try {
    const sourceStat = await fsp.stat(sourceAbs);
    let sourceDurationMs = Math.round(Number(durationMs));
    if (!Number.isInteger(sourceDurationMs) || sourceDurationMs < 1) {
      sourceDurationMs = await detectAudioDurationMs(sourceAbs, 'wav');
    }
    if (!Number.isInteger(sourceDurationMs) || sourceDurationMs < 1 || sourceDurationMs > 600000) {
      throw new Error('生成的音频时长无效（需在 1 毫秒–10 分钟之间）');
    }

    const finalRel = utils.finalAudioRelPath(id, 'ogg');
    const finalAbs = utils.safeJoin(root, finalRel);
    await media.processAudio({ sourceAbs, outAbs: finalAbs, trim: null, gainDb: 0, format: 'ogg' });
    created.push(finalAbs);
    const finalStat = await statOrNull(finalAbs);
    if (!finalStat || !finalStat.size) throw new Error('生成的 ogg 文件为空');

    let finalDurationMs = await detectAudioDurationMs(finalAbs, 'ogg');
    if (!Number.isInteger(finalDurationMs) || finalDurationMs < 1) finalDurationMs = sourceDurationMs;
    const cleanName =
      String(name ?? '')
        .trim()
        .slice(0, 200) || `生成的音频 ${id}`;

    return {
      id,
      kind: 'audio',
      name: cleanName,
      role: validRole,
      path: finalRel,
      format: 'ogg',
      durationMs: finalDurationMs,
      sizeBytes: finalStat.size,
      importedAt: nowIso(),
      trim: null,
      gainDb: 0,
      loop: validRole === 'bgm',
      source: {
        path: sourceRel,
        format: 'wav',
        durationMs: sourceDurationMs,
        sizeBytes: sourceStat.size,
      },
    };
  } catch (error) {
    for (const createdPath of created) await unlinkQuiet(createdPath);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 导入：视频
// ---------------------------------------------------------------------------

/** 视频编码矩阵：mp4 → h264，webm → vp8/vp9。 */
function videoCodecAllowed(format, codec) {
  if (format === 'mp4') return codec === 'h264';
  if (format === 'webm') return codec === 'vp8' || codec === 'vp9';
  return false;
}

/**
 * @param {{projectDir:string}} options
 * @returns {Promise<{canceled:true}|{assets:object[],warnings:string[]}>}
 */
async function importVideos({ projectDir } = {}) {
  const root = requireProjectDir(projectDir);
  const picked = await showFiles({ title: '导入视频', extensions: EXTS_BY_KIND.video });
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true };

  await ensureProjectDirs(root);
  const ffmpegAvailable = media.isFfmpegAvailable();
  const assets = [];
  const warnings = [];
  const idDirs = [DIRS.videos];

  for (const filePath of picked.filePaths) {
    const displayName = path.basename(filePath);
    try {
      const ext = utils.extnameLower(filePath);
      if (!utils.isSupportedVideoExt(ext)) {
        warnings.push(
          `${displayName}：不支持的视频格式${ext ? `（.${ext}）` : ''}，仅支持 ${utils.VIDEO_EXTS.join(' / ')}`,
        );
        continue;
      }
      if (!ffmpegAvailable) {
        warnings.push(`${displayName}：ffmpeg 不可用，无法检测视频编码，已跳过`);
        continue;
      }

      const probe = await media.probeMedia(filePath);
      const codec = probe.video && probe.video.codec ? probe.video.codec : null;
      if (!codec) {
        warnings.push(`${displayName}：无法检测编码，请转码为 H.264 / vp8 / vp9 后重试`);
        continue;
      }
      if (!videoCodecAllowed(ext, codec)) {
        warnings.push(
          `${displayName}：编码 ${codec} 与容器 ${ext} 不匹配（mp4 需要 H.264，webm 需要 vp8/vp9），请转码后重试`,
        );
        continue;
      }

      const id = await allocateAssetId(root, 'vid', idDirs);
      const finalRel = utils.finalVideoRelPath(id, ext);
      const finalAbs = utils.safeJoin(root, finalRel);
      await fsp.mkdir(path.dirname(finalAbs), { recursive: true });
      await fsp.copyFile(filePath, finalAbs);
      const finalStat = await statOrNull(finalAbs);
      if (!finalStat || !finalStat.size) {
        await unlinkQuiet(finalAbs);
        warnings.push(`${displayName}：复制视频文件失败`);
        continue;
      }

      const asset = {
        id,
        kind: 'video',
        name: assetNameFromFile(filePath, id),
        path: finalRel,
        format: ext,
        codec,
        hasAudio: Boolean(probe.hasAudio),
        sizeBytes: finalStat.size,
        importedAt: nowIso(),
      };
      if (Number.isInteger(probe.durationMs) && probe.durationMs > 0) asset.durationMs = probe.durationMs;
      if (Number.isInteger(probe.video.width) && probe.video.width > 0) asset.width = probe.video.width;
      if (Number.isInteger(probe.video.height) && probe.video.height > 0) asset.height = probe.video.height;
      assets.push(asset);
    } catch (error) {
      warnings.push(`${displayName}：${error && error.message ? error.message : '导入失败'}`);
    }
  }

  return { assets, warnings };
}

// ---------------------------------------------------------------------------
// 导入：小游戏
// ---------------------------------------------------------------------------

/**
 * @param {{projectDir:string}} options
 * @returns {Promise<{canceled:true}|{assets:object[],warnings:string[]}>}
 */
async function importMinigames({ projectDir } = {}) {
  const root = requireProjectDir(projectDir);
  const picked = await showFiles({ title: '导入小游戏', extensions: EXTS_BY_KIND.minigame });
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true };

  await ensureProjectDirs(root);
  const assets = [];
  const warnings = [];
  const idDirs = [DIRS.minigames];

  for (const filePath of picked.filePaths) {
    const displayName = path.basename(filePath);
    try {
      const ext = utils.extnameLower(filePath);
      if (ext !== 'html') {
        warnings.push(`${displayName}：小游戏必须是 .html 文件`);
        continue;
      }
      let html;
      try {
        html = await fsp.readFile(filePath, 'utf8');
      } catch (error) {
        warnings.push(`${displayName}：无法读取文件（${error && error.message ? error.message : '未知错误'}）`);
        continue;
      }

      const validated = minigame.validateMinigameHtml(html);
      if (!validated.ok) {
        warnings.push(`${displayName}：${validated.errors.join('；')}`);
        continue;
      }

      const id = await allocateAssetId(root, 'mg', idDirs);
      const finalRel = utils.finalMinigameRelPath(id);
      const finalAbs = utils.safeJoin(root, finalRel);
      await fsp.mkdir(path.dirname(finalAbs), { recursive: true });
      await fsp.copyFile(filePath, finalAbs);
      const finalStat = await statOrNull(finalAbs);
      if (!finalStat || !finalStat.size) {
        await unlinkQuiet(finalAbs);
        warnings.push(`${displayName}：复制小游戏文件失败`);
        continue;
      }

      assets.push({
        id,
        kind: 'minigame',
        name: assetNameFromFile(filePath, id),
        path: finalRel,
        declaredExits: validated.exits,
        mode: 'blocking',
        sizeBytes: finalStat.size,
        importedAt: nowIso(),
      });
    } catch (error) {
      warnings.push(`${displayName}：${error && error.message ? error.message : '导入失败'}`);
    }
  }

  return { assets, warnings };
}

// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------

/**
 * 小文件以 data URL 形式返回（> 40MB 拒绝）。
 * @param {{projectDir:string, relativePath:string}} options
 */
async function readDataUrl({ projectDir, relativePath } = {}) {
  const root = requireProjectDir(projectDir);
  const absPath = utils.safeJoin(root, relativePath);
  const stat = await statOrNull(absPath);
  if (!stat) throw new Error(`文件不存在：${relativePath}`);
  if (stat.size > MAX_DATA_URL_BYTES) {
    throw new Error('文件过大，请使用 assetUrl 流式读取');
  }
  const buffer = await fsp.readFile(absPath);
  const ext = utils.extnameLower(absPath);
  return { dataUrl: utils.dataUrlForBuffer(buffer, ext), mime: utils.mimeForExt(ext) };
}

/**
 * @param {{projectDir:string, relativePath:string}} options
 */
async function readText({ projectDir, relativePath } = {}) {
  const root = requireProjectDir(projectDir);
  const absPath = utils.safeJoin(root, relativePath);
  try {
    const text = await fsp.readFile(absPath, 'utf8');
    return { text };
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(`文件不存在：${relativePath}`);
    throw error;
  }
}

/**
 * 返回 vnasset:// 地址（大文件流式读取用）。
 * @param {{projectDir:string, relativePath:string}} options
 */
async function assetUrl({ projectDir, relativePath } = {}) {
  const root = requireProjectDir(projectDir);
  const absPath = utils.safeJoin(root, relativePath);
  const rel = utils.toPosix(path.relative(root, absPath));
  return { url: utils.makeVnAssetUrl(rel) };
}

// ---------------------------------------------------------------------------
// 图片导出
// ---------------------------------------------------------------------------

function normalizeCrop(crop) {
  if (!crop || typeof crop !== 'object') return null;
  const x = Number(crop.x);
  const y = Number(crop.y);
  const width = Number(crop.width);
  const height = Number(crop.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width < 1 || height < 1) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function normalizeRemoveBackground(value) {
  if (!value || typeof value !== 'object') return null;
  const color = typeof value.color === 'string' ? value.color.trim() : '';
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) return null;
  const tolerance = Number(value.tolerance);
  if (!Number.isFinite(tolerance)) return null;
  const result = { color, tolerance: Math.min(1, Math.max(0, tolerance)) };
  const softness = Number(value.softness);
  if (Number.isFinite(softness)) result.softness = Math.min(20, Math.max(0, softness));
  return result;
}

function normalizeAdjustments(value) {
  const clamp = (input, min, max) => {
    const number = Number(input);
    if (!Number.isFinite(number)) return 0;
    return Math.min(max, Math.max(min, number));
  };
  if (!value || typeof value !== 'object') return { brightness: 0, contrast: 0 };
  return {
    brightness: clamp(value.brightness, -100, 100),
    contrast: clamp(value.contrast, -100, 100),
  };
}

function normalizeImageEdit(edit, fallback) {
  const primary = edit && typeof edit === 'object' ? edit : null;
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const source = primary || base;
  return {
    crop: normalizeCrop(source.crop),
    removeBackground: normalizeRemoveBackground(source.removeBackground),
    adjustments: normalizeAdjustments(source.adjustments),
  };
}

/**
 * 渲染层 canvas 输出 base64 后落盘，更新素材记录。
 * 契约要求 main 传入完整 asset（返回值需要 name/role/source 等字段）。
 * @param {{projectDir:string, asset?:object, assetId?:string, edit?:object, format?:'png'|'webp', width?:number, height?:number, dataBase64:string}} options
 */
async function exportImage({ projectDir, asset, assetId, edit, format, width, height, dataBase64 } = {}) {
  const root = requireProjectDir(projectDir);
  const base = asset && typeof asset === 'object' ? asset : null;
  const id = (base && base.id) || assetId;
  if (typeof id !== 'string' || !utils.ASSET_ID_RE.test(id)) throw new Error('素材 id 无效');
  if (base && base.kind && base.kind !== 'image') throw new Error('该素材不是图片素材');
  if (typeof dataBase64 !== 'string' || !dataBase64.trim()) throw new Error('缺少图片数据');

  const fmt = String(format || (base && base.format) || 'webp').toLowerCase();
  if (!['png', 'webp'].includes(fmt)) {
    throw new Error(`不支持的图片导出格式：${format || ''}（只支持 png / webp）`);
  }
  const outWidth = Number(width ?? (base && base.width));
  const outHeight = Number(height ?? (base && base.height));
  if (!Number.isInteger(outWidth) || outWidth < 1 || outWidth > 32768) throw new Error('图片宽度无效');
  if (!Number.isInteger(outHeight) || outHeight < 1 || outHeight > 32768) throw new Error('图片高度无效');

  const rawBase64 = dataBase64.replace(/^data:[^,]*,/, '');
  const buffer = Buffer.from(rawBase64, 'base64');
  if (!buffer.length) throw new Error('图片数据为空');

  const finalRel = utils.finalImageRelPath(id, fmt);
  const finalAbs = utils.safeJoin(root, finalRel);
  await fsp.mkdir(path.dirname(finalAbs), { recursive: true });
  await fsp.writeFile(finalAbs, buffer);
  const stat = await fsp.stat(finalAbs);

  // 旧最终文件路径不同（换了扩展名）时删除旧文件
  if (base && typeof base.path === 'string' && base.path && base.path !== finalRel) {
    try {
      const oldAbs = utils.safeJoin(root, base.path);
      if (oldAbs !== finalAbs) await unlinkQuiet(oldAbs);
    } catch {
      // 旧路径非法时忽略，不影响新文件落盘
    }
  }

  const updated = {
    ...(base || {}),
    id,
    kind: 'image',
    name: (base && base.name) || id,
    role: utils.imageRoleValid(base && base.role) ? base.role : 'other',
    path: finalRel,
    width: outWidth,
    height: outHeight,
    format: fmt,
    sizeBytes: stat.size,
    importedAt: (base && base.importedAt) || nowIso(),
    edit: normalizeImageEdit(edit, base && base.edit),
  };
  if (base && base.source) updated.source = base.source;
  return updated;
}

// ---------------------------------------------------------------------------
// 音频导出
// ---------------------------------------------------------------------------

/**
 * 基于 asset.source（缺失回退 asset.path）截取 + 增益 + 重编码。
 * @param {{projectDir:string, asset:object, trim?:{startMs:number,endMs:number}|null, gainDb?:number, format?:'ogg'|'mp3'}} options
 */
async function exportAudio({ projectDir, asset, trim, gainDb, format } = {}) {
  const root = requireProjectDir(projectDir);
  if (!asset || typeof asset !== 'object') throw new Error('缺少音频素材信息');
  const id = asset.id;
  if (typeof id !== 'string' || !utils.ASSET_ID_RE.test(id)) throw new Error('素材 id 无效');
  if (asset.kind && asset.kind !== 'audio') throw new Error('该素材不是音频素材');

  const fmt = String(format || asset.format || 'ogg').toLowerCase();
  if (!['ogg', 'mp3'].includes(fmt)) {
    throw new Error(`不支持的音频导出格式：${format || ''}（只支持 ogg / mp3）`);
  }

  const sourceRel = (asset.source && asset.source.path) || asset.path;
  if (typeof sourceRel !== 'string' || !sourceRel.trim()) {
    throw new Error('素材缺少源文件路径，无法导出');
  }
  const sourceAbs = utils.safeJoin(root, sourceRel);
  const sourceStat = await statOrNull(sourceAbs);
  if (!sourceStat) throw new Error(`原始音频文件不存在：${sourceRel}`);

  let sourceDurationMs =
    (asset.source && asset.source.durationMs) || asset.durationMs || null;
  if (media.isFfmpegAvailable()) {
    try {
      const probe = await media.probeMedia(sourceAbs);
      if (Number.isInteger(probe.durationMs) && probe.durationMs > 0) sourceDurationMs = probe.durationMs;
    } catch {
      // 用记录里的时长兜底
    }
  }
  if (!Number.isInteger(sourceDurationMs) || sourceDurationMs < 1) {
    throw new Error('无法读取音频时长，无法校验截取区间');
  }

  const normalized = utils.normalizeTrim(trim == null ? asset.trim : trim, sourceDurationMs);
  if (normalized.error) throw new Error(normalized.error);

  let gain = Number(gainDb == null ? asset.gainDb : gainDb);
  if (!Number.isFinite(gain)) gain = 0;
  gain = Math.min(24, Math.max(-60, gain));

  const finalRel = utils.finalAudioRelPath(id, fmt);
  const finalAbs = utils.safeJoin(root, finalRel);
  await fsp.mkdir(path.dirname(finalAbs), { recursive: true });
  await media.processAudio({
    sourceAbs,
    outAbs: finalAbs,
    trim: normalized.trim,
    gainDb: gain,
    format: fmt,
  });
  const stat = await statOrNull(finalAbs);
  if (!stat || !stat.size) throw new Error('导出的音频文件为空');

  // 旧最终文件路径不同（换了扩展名）时删除旧文件
  if (typeof asset.path === 'string' && asset.path && asset.path !== finalRel) {
    try {
      const oldAbs = utils.safeJoin(root, asset.path);
      if (oldAbs !== finalAbs) await unlinkQuiet(oldAbs);
    } catch {
      // 旧路径非法时忽略
    }
  }

  const durationMs = normalized.trim
    ? normalized.trim.endMs - normalized.trim.startMs
    : sourceDurationMs;

  return {
    ...asset,
    id,
    kind: 'audio',
    path: finalRel,
    format: fmt,
    durationMs: Math.max(1, Math.round(durationMs)),
    trim: normalized.trim,
    gainDb: gain,
    sizeBytes: stat.size,
  };
}

// ---------------------------------------------------------------------------
// 删除
// ---------------------------------------------------------------------------

/**
 * 删除最终文件与原始文件（存在时）。找不到文件不算失败。
 * @param {{projectDir:string, asset:object}} options
 */
async function remove({ projectDir, asset } = {}) {
  const root = requireProjectDir(projectDir);
  if (!asset || typeof asset !== 'object') throw new Error('缺少素材信息');

  const targets = [];
  if (typeof asset.path === 'string' && asset.path.trim()) targets.push(asset.path);
  if (asset.source && typeof asset.source.path === 'string' && asset.source.path.trim()) {
    targets.push(asset.source.path);
  }

  for (const rel of targets) {
    let absPath;
    try {
      absPath = utils.safeJoin(root, rel);
    } catch {
      throw new Error(`素材路径非法，拒绝删除：${rel}`);
    }
    await unlinkQuiet(absPath);
  }
  return { removed: true };
}

module.exports = {
  importImages,
  importAudio,
  importVideos,
  importMinigames,
  saveGeneratedAudio,
  readDataUrl,
  readText,
  assetUrl,
  exportImage,
  exportAudio,
  remove,
};
