// phase2 素材工具函数单测：只测 asset-utils.cjs（不导入 assets.cjs，避免依赖 electron）。
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const utils = require('../../editor/electron/lib/asset-utils.cjs');

const ROOT = path.join(os.tmpdir(), 'vn-asset-utils-test');

test('扩展名 / 角色常量与契约一致', () => {
  assert.deepEqual(utils.IMAGE_EXTS, ['png', 'webp', 'jpg', 'jpeg']);
  assert.deepEqual(utils.AUDIO_EXTS, ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac']);
  assert.deepEqual(utils.VIDEO_EXTS, ['mp4', 'webm']);
  assert.deepEqual(utils.IMAGE_ROLES, ['background', 'sprite', 'ui', 'other']);
  assert.deepEqual(utils.AUDIO_ROLES, ['bgm', 'sfx', 'voice']);
});

test('makeAssetId 生成 前缀_8位小写base36 且符合 ASSET_ID_RE', () => {
  const expectations = [
    ['img', /^img_[a-z0-9]{8}$/],
    ['aud', /^aud_[a-z0-9]{8}$/],
    ['vid', /^vid_[a-z0-9]{8}$/],
    ['mg', /^mg_[a-z0-9]{8}$/],
  ];
  for (const [prefix, pattern] of expectations) {
    const id = utils.makeAssetId(prefix);
    assert.match(id, pattern);
    assert.ok(utils.ASSET_ID_RE.test(id), `${id} 应匹配 ASSET_ID_RE`);
  }
  assert.throws(() => utils.makeAssetId('foo'), /未知的素材 id 前缀/);
});

test('ASSET_ID_RE 与 schema 对齐：兼容旧工程/短 id，也拒绝非法形态', () => {
  assert.ok(utils.ASSET_ID_RE.test('img_0123456789'));
  assert.ok(utils.ASSET_ID_RE.test('mg_abcdefghijklmnop'));
  assert.ok(utils.ASSET_ID_RE.test('img_bg_dorm'), '旧工程的短 id 必须允许编辑');
  assert.ok(utils.ASSET_ID_RE.test('img_char-xixi'), '连字符 id 必须允许编辑');
  assert.ok(utils.ASSET_ID_RE.test('IMG_abcdefgh'), 'schema 允许大写开头');
  assert.ok(!utils.ASSET_ID_RE.test('1bad-id'), '数字开头应拒绝');
  assert.ok(!utils.ASSET_ID_RE.test(''), '空 id 应拒绝');
  assert.ok(!utils.ASSET_ID_RE.test('a'.repeat(65)), '超过 64 字符应拒绝');
});

test('makeAssetId 避免与数组 / Set 中的已有 id 冲突，批量生成唯一', () => {
  const first = utils.makeAssetId('img');
  const fromArray = utils.makeAssetId('img', [first]);
  assert.notEqual(fromArray, first);
  assert.ok(![first].includes(fromArray));

  const existing = new Set([first, fromArray]);
  const fromSet = utils.makeAssetId('img', existing);
  assert.ok(!existing.has(fromSet));

  const ids = new Set();
  for (let i = 0; i < 200; i += 1) {
    const id = utils.makeAssetId('mg', ids);
    assert.ok(!ids.has(id), `第 ${i} 个 id 重复：${id}`);
    ids.add(id);
    assert.match(id, /^mg_[a-z0-9]{8,}$/);
  }
  assert.equal(ids.size, 200);
});

test('slugify 处理空格/符号/中文并支持 fallback', () => {
  assert.equal(utils.slugify('Hello World!'), 'hello-world');
  assert.equal(utils.slugify('  Mixed__Case  Name '), 'mixed-case-name');
  assert.equal(utils.slugify('A/B:C*D?E'), 'a-b-c-d-e');
  assert.equal(utils.slugify('我的 游戏 项目'), '我的-游戏-项目');
  assert.equal(utils.slugify('---'), 'asset');
  assert.equal(utils.slugify('', 'fallback-name'), 'fallback-name');
  assert.equal(utils.slugify(null, ''), 'asset');
  assert.equal(utils.slugify('项目', 'ignored'), '项目');
});

test('extnameLower / normalizeExt', () => {
  assert.equal(utils.extnameLower('a.PNG'), 'png');
  assert.equal(utils.extnameLower('a.tar.gz'), 'gz');
  assert.equal(utils.extnameLower('.jpeg'), 'jpeg');
  assert.equal(utils.extnameLower('noext'), '');
  assert.equal(utils.extnameLower('C:\\x\\y\\a.Webm'), 'webm');
  assert.equal(utils.normalizeExt('.PNG'), 'png');
  assert.equal(utils.normalizeExt('WAV'), 'wav');
  assert.equal(utils.normalizeExt('assets/images/a.webp'), 'webp');
  assert.equal(utils.normalizeExt(''), '');
  assert.equal(utils.normalizeExt(undefined), '');
});

test('toPosix 统一分隔符', () => {
  assert.equal(utils.toPosix('assets\\images\\a.png'), 'assets/images/a.png');
  assert.equal(utils.toPosix('assets/images/a.png'), 'assets/images/a.png');
  assert.equal(utils.toPosix(null), '');
});

test('isInside 判断目录包含关系', () => {
  assert.ok(utils.isInside(ROOT, path.join(ROOT, 'assets/images/a.webp')));
  assert.ok(utils.isInside(ROOT, ROOT), '同目录视为内部');
  assert.ok(!utils.isInside(ROOT, path.join(ROOT, '..', 'elsewhere')));
  assert.ok(!utils.isInside(ROOT, path.join(path.dirname(ROOT), 'sibling')));
  assert.ok(!utils.isInside('', ROOT));
});

test('safeJoin 拼接合法相对路径，拒绝绝对路径与 .. 逃逸', () => {
  assert.equal(
    utils.safeJoin(ROOT, 'assets/images/img_abcd1234.webp'),
    path.join(ROOT, 'assets', 'images', 'img_abcd1234.webp'),
  );
  assert.equal(
    utils.safeJoin(ROOT, 'assets/.source/images/img_abcd1234.png'),
    path.join(ROOT, 'assets', '.source', 'images', 'img_abcd1234.png'),
  );
  assert.equal(utils.safeJoin(ROOT, 'assets\\audio\\aud_abcd1234.ogg'), path.join(ROOT, 'assets', 'audio', 'aud_abcd1234.ogg'));

  assert.throws(() => utils.safeJoin(ROOT, '../outside.png'), /\.\./);
  assert.throws(() => utils.safeJoin(ROOT, 'assets/../../outside.png'), /\.\./);
  assert.throws(() => utils.safeJoin(ROOT, 'assets\\..\\outside.png'), /\.\./);
  assert.throws(() => utils.safeJoin(ROOT, path.join(ROOT, 'absolute.png')), /绝对路径/);
  assert.throws(() => utils.safeJoin(ROOT, '/etc/passwd'), /绝对路径/);
  assert.throws(() => utils.safeJoin(ROOT, ''), /无效/);
  assert.throws(() => utils.safeJoin(ROOT, '   '), /无效/);
  assert.throws(() => utils.safeJoin(ROOT, 'assets/a\0b.png'), /空字符/);
  assert.throws(() => utils.safeJoin('', 'assets/a.png'), /项目目录无效/);
});

test('sourceRelPath / final*RelPath 路径构造', () => {
  assert.equal(utils.sourceRelPath('images', 'img_abcd1234', 'PNG'), 'assets/.source/images/img_abcd1234.png');
  assert.equal(utils.sourceRelPath('image', 'img_abcd1234', 'jpeg'), 'assets/.source/images/img_abcd1234.jpeg');
  assert.equal(utils.sourceRelPath('audio', 'aud_abcd1234', 'mp3'), 'assets/.source/audio/aud_abcd1234.mp3');
  assert.equal(utils.sourceRelPath('video', 'vid_abcd1234', 'mp4'), 'assets/.source/videos/vid_abcd1234.mp4');
  assert.throws(() => utils.sourceRelPath('minigame', 'mg_abcd1234', 'html'), /未知的素材分类/);
  assert.throws(() => utils.sourceRelPath('images', '1bad-id', 'png'), /素材 id 非法/);
  assert.throws(() => utils.sourceRelPath('images', 'img_abcd1234', ''), /扩展名非法/);

  assert.equal(utils.finalImageRelPath('img_abcd1234'), 'assets/images/img_abcd1234.webp');
  assert.equal(utils.finalImageRelPath('img_abcd1234', 'PNG'), 'assets/images/img_abcd1234.png');
  assert.throws(() => utils.finalImageRelPath('img_abcd1234', 'jpg'), /png\/webp/);

  assert.equal(utils.finalAudioRelPath('aud_abcd1234'), 'assets/audio/aud_abcd1234.ogg');
  assert.equal(utils.finalAudioRelPath('aud_abcd1234', 'mp3'), 'assets/audio/aud_abcd1234.mp3');
  assert.throws(() => utils.finalAudioRelPath('aud_abcd1234', 'wav'), /ogg\/mp3/);

  assert.equal(utils.finalVideoRelPath('vid_abcd1234', 'mp4'), 'assets/videos/vid_abcd1234.mp4');
  assert.equal(utils.finalVideoRelPath('vid_abcd1234', 'webm'), 'assets/videos/vid_abcd1234.webm');
  assert.throws(() => utils.finalVideoRelPath('vid_abcd1234', 'mkv'), /mp4\/webm/);

  assert.equal(utils.finalMinigameRelPath('mg_abcd1234'), 'assets/minigames/mg_abcd1234.html');
});

test('normalizeTrim 夹取边界 / 取整 / 错误分支', () => {
  assert.deepEqual(utils.normalizeTrim(null, 1000), { trim: null });
  assert.deepEqual(utils.normalizeTrim(undefined, 1000), { trim: null });
  assert.deepEqual(utils.normalizeTrim({ startMs: 100, endMs: 900 }, 1000), {
    trim: { startMs: 100, endMs: 900 },
  });
  assert.deepEqual(utils.normalizeTrim({ startMs: 100.4, endMs: 200.6 }, 1000), {
    trim: { startMs: 100, endMs: 201 },
  });
  assert.deepEqual(utils.normalizeTrim({ startMs: -50, endMs: 5000 }, 1000), {
    trim: { startMs: 0, endMs: 1000 },
  });
  assert.deepEqual(utils.normalizeTrim({ startMs: 200, endMs: 2000 }, 1000), {
    trim: { startMs: 200, endMs: 1000 },
  });
  assert.deepEqual(utils.normalizeTrim({ startMs: 5000, endMs: 6000 }, 1000), {
    trim: { startMs: 999, endMs: 1000 },
  });

  const equal = utils.normalizeTrim({ startMs: 500, endMs: 500 }, 1000);
  assert.equal(equal.trim, null);
  assert.match(equal.error, /结束时间必须大于开始时间/);

  const reversed = utils.normalizeTrim({ startMs: 800, endMs: 200 }, 1000);
  assert.equal(reversed.trim, null);
  assert.ok(reversed.error);

  const nan = utils.normalizeTrim({ startMs: 'x', endMs: 100 }, 1000);
  assert.equal(nan.trim, null);
  assert.match(nan.error, /毫秒数字/);

  const badDuration = utils.normalizeTrim({ startMs: 0, endMs: 100 }, 0);
  assert.equal(badDuration.trim, null);
  assert.match(badDuration.error, /时长无效/);
});

test('角色与扩展名辅助判断', () => {
  assert.ok(utils.imageRoleValid('background'));
  assert.ok(utils.imageRoleValid('sprite'));
  assert.ok(!utils.imageRoleValid('bgm'));
  assert.ok(utils.audioRoleValid('bgm'));
  assert.ok(utils.audioRoleValid('voice'));
  assert.ok(!utils.audioRoleValid('sprite'));

  assert.ok(utils.isSupportedImageExt('PNG'));
  assert.ok(utils.isSupportedImageExt('a/b.jpeg'));
  assert.ok(!utils.isSupportedImageExt('gif'));
  assert.ok(utils.isSupportedAudioExt('wav'));
  assert.ok(utils.isSupportedAudioExt('m4a'));
  assert.ok(!utils.isSupportedAudioExt('webm'));
  assert.ok(utils.isSupportedVideoExt('mp4'));
  assert.ok(!utils.isSupportedVideoExt('avi'));
  assert.ok(utils.isSupportedImageAudioExt('ogg'));
  assert.ok(utils.isSupportedImageAudioExt('webp'));
  assert.ok(!utils.isSupportedImageAudioExt('mp4'));
});

test('dataUrlForBuffer 生成带正确 MIME 的 data URL', () => {
  const buffer = Buffer.from('hello-vn');
  const png = utils.dataUrlForBuffer(buffer, 'png');
  assert.equal(png, `data:image/png;base64,${buffer.toString('base64')}`);
  assert.equal(Buffer.from(png.split(',')[1], 'base64').toString('utf8'), 'hello-vn');
  assert.ok(utils.dataUrlForBuffer(buffer, 'jpg').startsWith('data:image/jpeg;base64,'));
  assert.ok(utils.dataUrlForBuffer(buffer, 'jpeg').startsWith('data:image/jpeg;base64,'));
  assert.ok(utils.dataUrlForBuffer(buffer, 'webp').startsWith('data:image/webp;base64,'));
  assert.ok(utils.dataUrlForBuffer(buffer, 'wav').startsWith('data:audio/wav;base64,'));
  assert.ok(utils.dataUrlForBuffer(buffer, 'mp3').startsWith('data:audio/mpeg;base64,'));
  assert.ok(utils.dataUrlForBuffer(buffer, 'ogg').startsWith('data:audio/ogg;base64,'));
  assert.ok(utils.dataUrlForBuffer(buffer, 'mp4').startsWith('data:video/mp4;base64,'));
  assert.ok(utils.dataUrlForBuffer(buffer, 'webm').startsWith('data:video/webm;base64,'));
  assert.ok(utils.dataUrlForBuffer(buffer, 'html').startsWith('data:text/html;base64,'));
  assert.ok(utils.dataUrlForBuffer(buffer, 'bin').startsWith('data:application/octet-stream;base64,'));
});

test('makeVnAssetUrl 与协议解码规则往返一致', () => {
  const rel = 'assets/images/img_abcd1234.webp';
  const url = utils.makeVnAssetUrl(rel);
  assert.equal(url, `vnasset://asset/${encodeURIComponent(rel)}`);
  assert.equal(decodeURIComponent(url.slice('vnasset://asset/'.length)), rel);

  // Windows 反斜杠归一化
  assert.equal(
    utils.makeVnAssetUrl('assets\\audio\\aud_abcd1234.ogg'),
    `vnasset://asset/${encodeURIComponent('assets/audio/aud_abcd1234.ogg')}`,
  );
  assert.throws(() => utils.makeVnAssetUrl(''), /素材路径无效/);
  assert.throws(() => utils.makeVnAssetUrl(null), /素材路径无效/);
});
