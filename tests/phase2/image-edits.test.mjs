import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CROP_PRESETS,
  applyAdjustments,
  applyChromaKey,
  computeCropRect,
  hexToRgb,
} from '../../editor/src/features/assets/lib/imageEdits.js';

/** 构造 RGBA 像素数组。 */
function rgba(list) {
  return new Uint8ClampedArray(list.flat());
}

/** 读取第 index 个像素的 alpha。 */
function alphaAt(pixels, index) {
  return pixels[index * 4 + 3];
}

// ── CROP_PRESETS ────────────────────────────────────────────────────────
test('CROP_PRESETS：包含原尺寸与契约要求的全部预设', () => {
  assert.ok(Array.isArray(CROP_PRESETS));
  const keys = CROP_PRESETS.map((preset) => preset.key);
  assert.deepEqual(new Set(keys).size, keys.length, '预设 key 不应重复');
  const labels = CROP_PRESETS.map((preset) => preset.label).join(' ');
  for (const expected of ['原尺寸', '1920×1080', '1280×720', '1024×768', '1024×1024', '1080×1920']) {
    assert.ok(labels.includes(expected), `缺少预设 ${expected}`);
  }
  const source = CROP_PRESETS.find((preset) => preset.key === 'source');
  assert.equal(source.width, null);
  assert.equal(source.height, null);
  for (const preset of CROP_PRESETS) {
    if (preset.key === 'source') continue;
    assert.ok(Number.isInteger(preset.width) && preset.width > 0);
    assert.ok(Number.isInteger(preset.height) && preset.height > 0);
  }
  assert.equal(CROP_PRESETS.find((preset) => preset.key === '16-9-1920').width, 1920);
  assert.equal(CROP_PRESETS.find((preset) => preset.key === '9-16-1080').height, 1920);
});

// ── hexToRgb ────────────────────────────────────────────────────────────
test('hexToRgb：支持 #rgb 与 #rrggbb', () => {
  assert.deepEqual(hexToRgb('#fff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb('#000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hexToRgb('#5aa9ff'), { r: 90, g: 169, b: 255 });
  assert.deepEqual(hexToRgb('#ABC'), { r: 170, g: 187, b: 204 });
  assert.deepEqual(hexToRgb('00ff00'), { r: 0, g: 255, b: 0 });
});

test('hexToRgb：非法输入返回 null', () => {
  assert.equal(hexToRgb(''), null);
  assert.equal(hexToRgb('xyz'), null);
  assert.equal(hexToRgb('#12345'), null);
  assert.equal(hexToRgb(null), null);
  assert.equal(hexToRgb(123), null);
});

// ── computeCropRect ─────────────────────────────────────────────────────
test('computeCropRect：aspectRatio 为 null 时取全图', () => {
  assert.deepEqual(computeCropRect({ sourceWidth: 400, sourceHeight: 300, aspectRatio: null }), {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
});

test('computeCropRect：横图按 16:9 cover（高度受限）并居中', () => {
  const rect = computeCropRect({ sourceWidth: 400, sourceHeight: 300, aspectRatio: 16 / 9 });
  assert.equal(rect.width, 400);
  assert.equal(rect.height, 225);
  assert.equal(rect.x, 0);
  assert.equal(rect.y, Math.round((300 - 225) / 2));
  assert.equal(rect.width / rect.height, 400 / 225);
});

test('computeCropRect：竖图按 16:9 cover（宽度受限）并居中', () => {
  const rect = computeCropRect({ sourceWidth: 300, sourceHeight: 400, aspectRatio: 16 / 9 });
  assert.equal(rect.width, 300);
  assert.equal(rect.height, 169);
  assert.ok(rect.x >= 0 && rect.y >= 0);
  assert.equal(rect.x, 0);
  assert.equal(rect.y, Math.round((400 - rect.height) / 2));
  assert.ok(rect.y + rect.height <= 400);
});

test('computeCropRect：方图按 1:1 时取全图', () => {
  assert.deepEqual(computeCropRect({ sourceWidth: 300, sourceHeight: 300, aspectRatio: 1 }), {
    x: 0,
    y: 0,
    width: 300,
    height: 300,
  });
});

test('computeCropRect：zoom=1 时覆盖源图的一个方向', () => {
  const rect = computeCropRect({ sourceWidth: 1920, sourceHeight: 1080, aspectRatio: 16 / 9 });
  assert.deepEqual(rect, { x: 0, y: 0, width: 1920, height: 1080 });
});

test('computeCropRect：zoom>1 收缩裁剪框', () => {
  const base = computeCropRect({ sourceWidth: 400, sourceHeight: 300, aspectRatio: 16 / 9 });
  const zoomed = computeCropRect({
    sourceWidth: 400,
    sourceHeight: 300,
    aspectRatio: 16 / 9,
    zoom: 2,
  });
  assert.equal(zoomed.width, 200);
  assert.equal(zoomed.height, 113);
  assert.ok(zoomed.width < base.width);
  assert.ok(zoomed.height < base.height);
  // 收缩后仍居中
  assert.equal(zoomed.x, Math.round((400 - zoomed.width) / 2));
  assert.equal(zoomed.y, Math.round((300 - zoomed.height) / 2));
});

test('computeCropRect：offset 平移且不出界', () => {
  const left = computeCropRect({
    sourceWidth: 400,
    sourceHeight: 300,
    aspectRatio: 1,
    offsetX: -1,
  });
  assert.equal(left.x, 0);
  const right = computeCropRect({
    sourceWidth: 400,
    sourceHeight: 300,
    aspectRatio: 1,
    offsetX: 1,
  });
  assert.equal(right.x, 400 - right.width);
  assert.ok(right.x + right.width <= 400);

  const top = computeCropRect({
    sourceWidth: 400,
    sourceHeight: 300,
    aspectRatio: 16 / 9,
    offsetY: -1,
  });
  assert.equal(top.y, 0);
  const bottom = computeCropRect({
    sourceWidth: 400,
    sourceHeight: 300,
    aspectRatio: 16 / 9,
    offsetY: 1,
  });
  assert.equal(bottom.y, 300 - bottom.height);
});

test('computeCropRect：任意参数组合都返回图内整数框', () => {
  const sources = [
    [400, 300],
    [300, 400],
    [1920, 1080],
    [337, 911],
  ];
  const ratios = [null, 16 / 9, 9 / 16, 4 / 3, 1];
  for (const [sourceWidth, sourceHeight] of sources) {
    for (const aspectRatio of ratios) {
      for (const zoom of [1, 1.3, 2, 3]) {
        for (const offsetX of [-1, -0.4, 0, 0.7, 1]) {
          for (const offsetY of [-1, 0, 1]) {
            const rect = computeCropRect({
              sourceWidth,
              sourceHeight,
              aspectRatio,
              zoom,
              offsetX,
              offsetY,
            });
            assert.ok(Number.isInteger(rect.x), 'x 应为整数');
            assert.ok(Number.isInteger(rect.y), 'y 应为整数');
            assert.ok(Number.isInteger(rect.width), 'width 应为整数');
            assert.ok(Number.isInteger(rect.height), 'height 应为整数');
            assert.ok(rect.x >= 0 && rect.y >= 0);
            assert.ok(rect.width >= 1 && rect.height >= 1);
            assert.ok(rect.x + rect.width <= sourceWidth, '横向不越界');
            assert.ok(rect.y + rect.height <= sourceHeight, '纵向不越界');
          }
        }
      }
    }
  }
});

// ── applyAdjustments ────────────────────────────────────────────────────
function grayPixels() {
  return rgba([
    [128, 128, 128, 255],
    [128, 128, 128, 255],
  ]);
}

test('applyAdjustments：brightness +50 变亮', () => {
  const pixels = grayPixels();
  applyAdjustments(pixels, { brightness: 50, contrast: 0 });
  assert.ok(pixels[0] > 128, `期望变亮，实际 ${pixels[0]}`);
  assert.ok(pixels[4] > 128);
  assert.equal(pixels[3], 255, 'alpha 不应被修改');
  assert.equal(pixels[7], 255);
});

test('applyAdjustments：brightness -50 变暗', () => {
  const pixels = grayPixels();
  applyAdjustments(pixels, { brightness: -50, contrast: 0 });
  assert.ok(pixels[0] < 128, `期望变暗，实际 ${pixels[0]}`);
  assert.ok(pixels[4] < 128);
});

test('applyAdjustments：contrast 0 且 brightness 0 时不变', () => {
  const pixels = rgba([
    [10, 20, 30, 255],
    [200, 100, 50, 128],
    [0, 255, 77, 255],
  ]);
  const before = Array.from(pixels);
  applyAdjustments(pixels, { brightness: 0, contrast: 0 });
  assert.deepEqual(Array.from(pixels), before);
});

test('applyAdjustments：极端参数下输出仍在 0..255', () => {
  const cases = [
    { brightness: 100, contrast: 100 },
    { brightness: -100, contrast: -100 },
    { brightness: 100, contrast: -100 },
    { brightness: -100, contrast: 100 },
  ];
  for (const adjustments of cases) {
    const pixels = rgba([
      [0, 64, 128, 255],
      [128, 192, 255, 255],
    ]);
    applyAdjustments(pixels, adjustments);
    for (let i = 0; i < pixels.length; i += 1) {
      assert.ok(pixels[i] >= 0 && pixels[i] <= 255, `第 ${i} 个分量越界：${pixels[i]}`);
    }
  }
});

// ── applyChromaKey ──────────────────────────────────────────────────────
const GREEN = { r: 0, g: 255, b: 0 };

function solidImage(width, height, color) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = color.r;
    pixels[i * 4 + 1] = color.g;
    pixels[i * 4 + 2] = color.b;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

test('applyChromaKey：纯绿背景全部变透明', () => {
  const pixels = solidImage(4, 4, GREEN);
  applyChromaKey(pixels, { color: GREEN, tolerance: 0, softness: 0, width: 4, height: 4 });
  for (let i = 0; i < 16; i += 1) {
    assert.equal(alphaAt(pixels, i), 0, `像素 ${i} 应透明`);
  }
});

test('applyChromaKey：非背景像素保留，RGB 不变', () => {
  const pixels = solidImage(6, 2, GREEN);
  const whiteIndexes = [3, 4, 5, 9, 10, 11]; // 右半边白色
  for (const index of whiteIndexes) {
    pixels[index * 4] = 255;
    pixels[index * 4 + 1] = 255;
    pixels[index * 4 + 2] = 255;
  }
  applyChromaKey(pixels, { color: GREEN, tolerance: 0.12, softness: 0, width: 6, height: 2 });
  for (const index of [0, 1, 2, 6, 7, 8]) {
    assert.equal(alphaAt(pixels, index), 0, `绿色像素 ${index} 应透明`);
  }
  for (const index of whiteIndexes) {
    assert.equal(alphaAt(pixels, index), 255, `白色像素 ${index} 应保留`);
    assert.equal(pixels[index * 4], 255);
  }
});

test('applyChromaKey：tolerance 控制去除范围', () => {
  // (0,128,0) 与纯绿距离 127
  const make = () => solidImage(2, 1, { r: 0, g: 128, b: 0 });
  const narrow = make();
  applyChromaKey(narrow, { color: GREEN, tolerance: 0.12, softness: 0, width: 2, height: 1 });
  assert.equal(alphaAt(narrow, 0), 255, '低容差不应去掉接近的背景色');

  const wide = make();
  applyChromaKey(wide, { color: GREEN, tolerance: 0.5, softness: 0, width: 2, height: 1 });
  assert.equal(alphaAt(wide, 0), 0, '高容差应去掉接近的背景色');
});

test('applyChromaKey：softness>0 时边缘产生半透明羽化', () => {
  // 1×5：两像素绿背景 + 三像素白前景
  const pixels = solidImage(5, 1, GREEN);
  for (const index of [2, 3, 4]) {
    pixels[index * 4] = 255;
    pixels[index * 4 + 1] = 255;
    pixels[index * 4 + 2] = 255;
  }
  applyChromaKey(pixels, { color: GREEN, tolerance: 0.12, softness: 2, width: 5, height: 1 });
  // 背景像素仍完全透明
  assert.equal(alphaAt(pixels, 0), 0);
  assert.equal(alphaAt(pixels, 1), 0);
  // 紧邻背景的前景像素被羽化
  const edgeAlpha = alphaAt(pixels, 2);
  assert.ok(edgeAlpha > 0 && edgeAlpha < 255, `边缘 alpha 应在 (0,255)，实际 ${edgeAlpha}`);
  // 远离背景的前景像素保持不透明
  assert.equal(alphaAt(pixels, 4), 255);
});

test('applyChromaKey：接受 #rrggbb 字符串颜色与缺省参数', () => {
  const pixels = solidImage(2, 2, GREEN);
  applyChromaKey(pixels, { color: '#00ff00', width: 2, height: 2 });
  for (let i = 0; i < 4; i += 1) {
    assert.equal(alphaAt(pixels, i), 0);
  }
  // 非法颜色不修改像素
  const untouched = solidImage(1, 1, GREEN);
  applyChromaKey(untouched, { color: 'not-a-color', width: 1, height: 1 });
  assert.equal(alphaAt(untouched, 0), 255);
});
