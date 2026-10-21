// phase2 媒体层单测：ffmpeg stderr 解析（纯函数）、图片元信息、真实 ffmpeg 冒烟。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const media = require('../../editor/electron/lib/media.cjs');
const utils = require('../../editor/electron/lib/asset-utils.cjs');

const MP4_STDERR = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'C:\\tmp\\test.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf58.24.101
  Duration: 00:00:02.02, start: 0.000000, bitrate: 132 kb/s
    Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 320x240 [SAR 1:1 DAR 4:3], 45 kb/s, 30 fps, 30 tbr, 15360 tbn, 60 tbc (default)
    Metadata:
      handler_name    : VideoHandler
    Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 73 kb/s (default)
    Metadata:
      handler_name    : SoundHandler
At least one output file must be specified
`;

const OGG_STDERR = `Input #0, ogg, from 'C:\\tmp\\test.ogg':
  Duration: 00:00:03.5, start: 0.000000, bitrate: 26 kb/s
    Stream #0:0: Audio: vorbis, 44100 Hz, mono, fltp, 96 kb/s
    Metadata:
      ENCODER         : Lavc58.42.102 libvorbis
At least one output file must be specified
`;

const WEBM_STDERR = `Input #0, matroska,webm, from 'clip.webm':
  Duration: 00:00:10.00, start: 0.000000, bitrate: 500 kb/s
    Stream #0:0(eng): Video: vp9 (Profile 0), yuv420p(tv), 1920x1080, SAR 1:1 DAR 16:9, 25 fps, 25 tbr, 1k tbn, 1k tbc (default)
At least one output file must be specified
`;

const ATTACHED_PIC_STDERR = `Input #0, mp3, from 'song.mp3':
  Duration: 00:03:00.00, start: 0.000000, bitrate: 128 kb/s
    Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s
    Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc), 600x600 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)
At least one output file must be specified
`;

const PNG_STDERR = `Input #0, png_pipe, from 'x.png':
  Duration: N/A, bitrate: N/A
    Stream #0:0: Video: png, rgb24(pc), 64x48 [SAR 1:1 DAR 4:3], 25 tbr, 25 tbn, 25 tbc
At least one output file must be specified
`;

test('parseFfmpegProbe 解析 mp4（视频 + 音频 + 时长）', () => {
  const parsed = media.parseFfmpegProbe(MP4_STDERR);
  assert.equal(parsed.durationMs, 2020);
  assert.equal(parsed.formatName, 'mov,mp4,m4a,3gp,3g2,mj2');
  assert.deepEqual(parsed.video, { codec: 'h264', width: 320, height: 240 });
  assert.deepEqual(parsed.audio, { codec: 'aac' });
  assert.equal(parsed.hasAudio, true);
});

test('parseFfmpegProbe 解析纯音频（一位小数时长）', () => {
  const parsed = media.parseFfmpegProbe(OGG_STDERR);
  assert.equal(parsed.durationMs, 3500);
  assert.equal(parsed.formatName, 'ogg');
  assert.equal(parsed.video, null);
  assert.deepEqual(parsed.audio, { codec: 'vorbis' });
  assert.equal(parsed.hasAudio, true);
});

test('parseFfmpegProbe 解析 webm / vp9，无音轨', () => {
  const parsed = media.parseFfmpegProbe(WEBM_STDERR);
  assert.equal(parsed.durationMs, 10000);
  assert.equal(parsed.formatName, 'matroska,webm');
  assert.deepEqual(parsed.video, { codec: 'vp9', width: 1920, height: 1080 });
  assert.equal(parsed.audio, null);
  assert.equal(parsed.hasAudio, false);
});

test('parseFfmpegProbe 忽略封面图（attached pic）', () => {
  const parsed = media.parseFfmpegProbe(ATTACHED_PIC_STDERR);
  assert.equal(parsed.durationMs, 180000);
  assert.equal(parsed.video, null);
  assert.deepEqual(parsed.audio, { codec: 'mp3' });
  assert.equal(parsed.hasAudio, true);
});

test('parseFfmpegProbe 兼容 Duration: N/A 与旧版 avc 别名', () => {
  const png = media.parseFfmpegProbe(PNG_STDERR);
  assert.equal(png.durationMs, null);
  assert.deepEqual(png.video, { codec: 'png', width: 64, height: 48 });
  assert.equal(png.hasAudio, false);

  const avc = media.parseFfmpegProbe(
    `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':\n  Duration: 00:00:01.00, start: 0.000000, bitrate: 10 kb/s\n    Stream #0:0: Video: avc (High), yuv420p, 640x360, 25 fps\n`,
  );
  assert.deepEqual(avc.video, { codec: 'h264', width: 640, height: 360 });
});

test('parseFfmpegProbe 无有效流时返回空结果', () => {
  const parsed = media.parseFfmpegProbe('clip.bin: Invalid data found when processing input\r\n');
  assert.equal(parsed.durationMs, null);
  assert.equal(parsed.formatName, null);
  assert.equal(parsed.video, null);
  assert.equal(parsed.audio, null);
  assert.equal(parsed.hasAudio, false);
  assert.deepEqual(media.parseFfmpegProbe(''), {
    durationMs: null,
    formatName: null,
    video: null,
    audio: null,
    hasAudio: false,
  });
});

test('normalizeTrim（经 asset-utils 引入）边界', () => {
  assert.deepEqual(utils.normalizeTrim(null, 2000), { trim: null });
  assert.deepEqual(utils.normalizeTrim({ startMs: -10, endMs: 99999 }, 2000), {
    trim: { startMs: 0, endMs: 2000 },
  });
  const invalid = utils.normalizeTrim({ startMs: 900, endMs: 100 }, 2000);
  assert.equal(invalid.trim, null);
  assert.ok(invalid.error);
});

test('导出常量与 ffmpeg 可用性探测', () => {
  assert.equal(typeof media.FFMPEG, 'string');
  assert.ok(media.FFMPEG.length > 0);
  assert.equal(typeof media.isFfmpegAvailable(), 'boolean');
  assert.equal(typeof media.runFfmpeg, 'function');
  assert.equal(typeof media.processAudio, 'function');
});

// ---------------------------------------------------------------------------
// 以下测试需要本机 ffmpeg；不可用时 skip。
// ---------------------------------------------------------------------------

const ffmpegReady = media.isFfmpegAvailable();

// 临时目录：优先 os.tmpdir()。某些受限执行环境（如带文件系统沙箱的进程）会禁止
// ffmpeg 子进程写系统临时目录，此时回退到仓库内的临时目录，测试结束统一清理。
let tempBasePromise = null;

async function pickTempBase() {
  if (!ffmpegReady) return os.tmpdir();
  const candidates = [os.tmpdir(), path.join(process.cwd(), '.tmp-phase2-media')];
  for (const base of candidates) {
    let probeDir = null;
    try {
      await fsp.mkdir(base, { recursive: true });
      probeDir = await fsp.mkdtemp(path.join(base, 'vn-probe-'));
      await media.runFfmpeg([
        '-hide_banner',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=0.2',
        '-c:a',
        'libvorbis',
        '-q:a',
        '5',
        path.join(probeDir, 'probe.ogg'),
      ]);
      await fsp.rm(probeDir, { recursive: true, force: true });
      return base;
    } catch {
      if (probeDir) await fsp.rm(probeDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return os.tmpdir();
}

async function createTempDir() {
  if (!tempBasePromise) tempBasePromise = pickTempBase();
  const base = await tempBasePromise;
  return fsp.mkdtemp(path.join(base, 'vn-media-'));
}

after(async () => {
  await fsp
    .rm(path.join(process.cwd(), '.tmp-phase2-media'), { recursive: true, force: true })
    .catch(() => {});
});


test('ffmpeg 真实生成 mp4/ogg 后用 probeMedia 探测', { skip: !ffmpegReady }, async (t) => {
  const dir = await createTempDir();
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });
  const mp4Path = path.join(dir, 'clip.mp4');
  const oggPath = path.join(dir, 'voice.ogg');

  await media.runFfmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x120:rate=15:duration=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    mp4Path,
  ]);
  await media.runFfmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    'libvorbis',
    '-q:a',
    '5',
    oggPath,
  ]);

  const mp4Info = await media.probeMedia(mp4Path);
  assert.ok(mp4Info.durationMs >= 700 && mp4Info.durationMs <= 1400, `mp4 时长异常：${mp4Info.durationMs}`);
  assert.ok(mp4Info.video, '应探测到视频流');
  assert.equal(mp4Info.video.codec, 'h264');
  assert.equal(mp4Info.video.width, 160);
  assert.equal(mp4Info.video.height, 120);
  assert.equal(mp4Info.hasAudio, true);
  assert.ok(mp4Info.stderr.includes('Input #0'), '应返回原始 stderr');

  const oggInfo = await media.probeMedia(oggPath);
  assert.ok(oggInfo.durationMs >= 700 && oggInfo.durationMs <= 1400, `ogg 时长异常：${oggInfo.durationMs}`);
  assert.equal(oggInfo.video, null);
  assert.equal(oggInfo.audio.codec, 'vorbis');
  assert.equal(oggInfo.hasAudio, true);
});

test('imageInfo / convertImageToWebp 真实图片', { skip: !ffmpegReady }, async (t) => {
  const dir = await createTempDir();
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });
  const pngPath = path.join(dir, 'src.png');
  const webpPath = path.join(dir, 'out.webp');

  await media.runFfmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red@0.5:s=64x48:d=1',
    '-frames:v',
    '1',
    pngPath,
  ]);
  const pngInfo = await media.imageInfo(pngPath);
  assert.equal(pngInfo.width, 64);
  assert.equal(pngInfo.height, 48);

  await media.convertImageToWebp(pngPath, webpPath, 90);
  const webpInfo = await media.imageInfo(webpPath);
  assert.equal(webpInfo.width, 64);
  assert.equal(webpInfo.height, 48);
  const stat = await fsp.stat(webpPath);
  assert.ok(stat.size > 0);

  await assert.rejects(() => media.imageInfo(path.join(dir, 'missing.png')), /不存在/);
  const textPath = path.join(dir, 'not-image.txt');
  await fsp.writeFile(textPath, 'not an image');
  await assert.rejects(() => media.imageInfo(textPath), /无法识别图片格式/);
});

test('processAudio 截取 + 增益 + ogg/mp3 输出', { skip: !ffmpegReady }, async (t) => {
  const dir = await createTempDir();
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });
  const source = path.join(dir, 'source.ogg');
  const trimmedOgg = path.join(dir, 'trim.ogg');
  const trimmedMp3 = path.join(dir, 'trim.mp3');

  await media.runFfmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-c:a',
    'libvorbis',
    '-q:a',
    '5',
    source,
  ]);

  await media.processAudio({
    sourceAbs: source,
    outAbs: trimmedOgg,
    trim: { startMs: 500, endMs: 1500 },
    gainDb: 3,
    format: 'ogg',
  });
  const oggInfo = await media.probeMedia(trimmedOgg);
  assert.ok(oggInfo.audio && oggInfo.audio.codec === 'vorbis');
  assert.ok(
    oggInfo.durationMs >= 600 && oggInfo.durationMs <= 1700,
    `截取后的 ogg 时长异常：${oggInfo.durationMs}`,
  );

  await media.processAudio({
    sourceAbs: source,
    outAbs: trimmedMp3,
    trim: null,
    gainDb: 0,
    format: 'mp3',
  });
  const mp3Info = await media.probeMedia(trimmedMp3);
  assert.ok(mp3Info.audio && mp3Info.audio.codec === 'mp3');
  assert.ok(mp3Info.durationMs >= 2500, `mp3 时长异常：${mp3Info.durationMs}`);
});

test('runFfmpeg 失败时抛错并附带 stderr', { skip: !ffmpegReady }, async (t) => {
  const dir = await createTempDir();
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });
  await assert.rejects(
    () =>
      media.runFfmpeg(['-hide_banner', '-i', path.join(dir, 'nope.mp4'), '-f', 'null', '-']),
    (error) => {
      assert.match(error.message, /ffmpeg 执行失败/);
      assert.equal(typeof error.stderr, 'string');
      assert.ok(error.stderr.length > 0);
      return true;
    },
  );
});
