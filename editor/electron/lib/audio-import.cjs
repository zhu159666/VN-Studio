'use strict';

// 音频导入校验：Base64 → 格式嗅探 → 交给主进程 ffmpeg 转 ogg。
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

function detectAudioExt(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const ascii = (start, end) => buffer.toString('ascii', start, end);
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (ascii(0, 3) === 'ID3') return 'mp3';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    // MPEG audio frame（MP3）或 ADTS（AAC）无法仅凭帧头完全区分，交给 ffmpeg 探测
    return 'mp3';
  }
  if (ascii(4, 8) === 'ftyp') return 'm4a';
  return null;
}

function decodeAudioBase64(data) {
  if (typeof data !== 'string' || !data.trim()) {
    const error = new Error('base64_data 不能为空');
    error.code = 'E_AUDIO_EMPTY';
    throw error;
  }
  const raw = data.replace(/^data:audio\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
  let buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    const error = new Error('Base64 解码失败');
    error.code = 'E_AUDIO_INVALID';
    throw error;
  }
  if (!buffer.length) {
    const error = new Error('Base64 音频数据为空');
    error.code = 'E_AUDIO_EMPTY';
    throw error;
  }
  if (buffer.length > MAX_INPUT_BYTES) {
    const error = new Error(`音频超过 ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB 限制`);
    error.code = 'E_AUDIO_TOO_LARGE';
    throw error;
  }
  const ext = detectAudioExt(buffer);
  if (!ext) {
    const error = new Error('仅支持 WAV / MP3 / OGG / FLAC / M4A / AAC 音频');
    error.code = 'E_AUDIO_FORMAT';
    throw error;
  }
  return { buffer, ext };
}

module.exports = { MAX_INPUT_BYTES, detectAudioExt, decodeAudioBase64 };
