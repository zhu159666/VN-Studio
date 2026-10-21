/**
 * 图片编辑纯函数（不依赖 DOM / React，可直接在 Node 中测试）。
 *
 * 渲染顺序约定（与 ImageEditor 的预览、导出一致）：
 *   原图 → 按裁剪框绘制到目标尺寸 → 亮度/对比度 → 纯色去背景（含羽化）
 */

/** 裁剪预设：width/height 为 null 表示「原尺寸」（导出尺寸 = 裁剪框尺寸）。 */
export const CROP_PRESETS = [
  { key: 'source', label: '原尺寸', width: null, height: null },
  { key: '16-9-1920', label: '16:9 1920×1080', width: 1920, height: 1080 },
  { key: '16-9-1280', label: '16:9 1280×720', width: 1280, height: 720 },
  { key: '4-3-1024', label: '4:3 1024×768', width: 1024, height: 768 },
  { key: '1-1-1024', label: '1:1 1024×1024', width: 1024, height: 1024 },
  { key: '9-16-1080', label: '9:16 1080×1920', width: 1080, height: 1920 },
];

/** 颜色距离的最大可能值（RGB 立方体对角线 255√3）。 */
const MAX_COLOR_DISTANCE = Math.sqrt(3 * 255 * 255);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 十六进制颜色转 RGB。支持 #rgb / #rrggbb（#rrggbbaa 会忽略 alpha）。
 * @param {string} hex
 * @returns {{r:number,g:number,b:number}|null} 非法输入返回 null
 */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let text = hex.trim().replace(/^#/, '');
  if (text.length === 3) {
    text = text
      .split('')
      .map((ch) => ch + ch)
      .join('');
  } else if (text.length === 8) {
    text = text.slice(0, 6);
  }
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return null;
  const value = parseInt(text, 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/**
 * RGB 转 #rrggbb。
 * @param {{r:number,g:number,b:number}} color
 */
export function rgbToHex(color) {
  const toHex = (v) => clamp(Math.round(finiteNumber(v, 0)), 0, 255).toString(16).padStart(2, '0');
  if (!color) return '#000000';
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

/**
 * 计算源图上的裁剪框（cover 逻辑：先按目标宽高比取最大可用区域，再按 zoom 收缩）。
 *
 * @param {object} options
 * @param {number} options.sourceWidth  源图宽（像素）
 * @param {number} options.sourceHeight 源图高（像素）
 * @param {number|null} [options.aspectRatio] 目标宽高比；null 表示取全图
 * @param {number} [options.zoom] 1–3；>1 时裁剪框相对基准收缩
 * @param {number} [options.offsetX] -1–1，-1 贴左、0 居中、1 贴右
 * @param {number} [options.offsetY] -1–1，-1 贴上、0 居中、1 贴下
 * @returns {{x:number,y:number,width:number,height:number}} 源图像素整数裁剪框
 */
export function computeCropRect({
  sourceWidth,
  sourceHeight,
  aspectRatio = null,
  zoom = 1,
  offsetX = 0,
  offsetY = 0,
} = {}) {
  const sw = Math.max(1, Math.round(finiteNumber(sourceWidth, 1)));
  const sh = Math.max(1, Math.round(finiteNumber(sourceHeight, 1)));
  const ratio = Number(aspectRatio);
  const ar = Number.isFinite(ratio) && ratio > 0 ? ratio : null;
  if (ar === null) return { x: 0, y: 0, width: sw, height: sh };

  const z = clamp(finiteNumber(zoom, 1), 1, 100);
  // 基准框：cover —— 取源图内能覆盖目标比例的最大区域
  let width;
  let height;
  if (sw / sh > ar) {
    height = sh;
    width = sh * ar;
  } else {
    width = sw;
    height = sw / ar;
  }
  // zoom 收缩
  width /= z;
  height /= z;

  // 先取整并限制在源图内，再按整数尺寸算偏移，保证永不出界
  width = clamp(Math.round(width), 1, sw);
  height = clamp(Math.round(height), 1, sh);

  const ox = clamp(finiteNumber(offsetX, 0), -1, 1);
  const oy = clamp(finiteNumber(offsetY, 0), -1, 1);
  const maxX = sw - width;
  const maxY = sh - height;
  const x = clamp(Math.round(((1 + ox) / 2) * maxX), 0, maxX);
  const y = clamp(Math.round(((1 + oy) / 2) * maxY), 0, maxY);
  return { x, y, width, height };
}

/**
 * 就地调整亮度 / 对比度（只改 RGB，不动 alpha）。
 * 亮度：-100..100 线性映射到 -255..255 偏移；
 * 对比度：标准公式 f = (259(c+255)) / (255(259-c))，c = contrast * 2.55。
 *
 * @param {Uint8ClampedArray} pixels RGBA 像素数组
 * @param {{brightness?:number,contrast?:number}} adjustments
 * @returns {Uint8ClampedArray} 同一个数组（就地修改）
 */
export function applyAdjustments(pixels, { brightness = 0, contrast = 0 } = {}) {
  if (!pixels || typeof pixels.length !== 'number') return pixels;
  const b = clamp(finiteNumber(brightness, 0), -100, 100);
  const c = clamp(finiteNumber(contrast, 0), -100, 100);
  if (b === 0 && c === 0) return pixels;

  const offset = (b / 100) * 255;
  const cScaled = c * 2.55;
  let factor = (259 * (cScaled + 255)) / (255 * (259 - cScaled));
  if (!Number.isFinite(factor)) factor = 1;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = factor * (pixels[i] + offset - 128) + 128;
    const g = factor * (pixels[i + 1] + offset - 128) + 128;
    const bl = factor * (pixels[i + 2] + offset - 128) + 128;
    // Uint8ClampedArray 赋值时自动四舍五入并截断到 0..255
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = bl;
  }
  return pixels;
}

/**
 * 对 alpha 通道做可分离盒式模糊（滑动窗口，O(n)）。
 * 返回值不修改入参。
 */
function boxBlurAlpha(src, width, height, radius) {
  const count = width * height;
  const horizontal = new Float32Array(count);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) {
      if (x >= 0 && x < width) sum += src[row + x];
    }
    for (let x = 0; x < width; x += 1) {
      const start = Math.max(0, x - radius);
      const end = Math.min(width - 1, x + radius);
      horizontal[row + x] = sum / (end - start + 1);
      const leaving = x - radius;
      if (leaving >= 0) sum -= src[row + leaving];
      const entering = x + radius + 1;
      if (entering < width) sum += src[row + entering];
    }
  }

  const result = new Float32Array(count);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      if (y >= 0 && y < height) sum += horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      const start = Math.max(0, y - radius);
      const end = Math.min(height - 1, y + radius);
      result[y * width + x] = sum / (end - start + 1);
      const leaving = y - radius;
      if (leaving >= 0) sum -= horizontal[leaving * width + x];
      const entering = y + radius + 1;
      if (entering < height) sum += horizontal[entering * width + x];
    }
  }
  return result;
}

/**
 * 就地执行纯色去背景（色键）。
 * - 与目标色距离 ≤ tolerance * 441.67 的像素 alpha 置 0；
 * - softness > 0 时，对非背景区域边缘做半径约 softness 像素的 alpha 羽化（线性过渡）。
 *
 * @param {Uint8ClampedArray} pixels RGBA 像素数组
 * @param {object} options
 * @param {string|{r:number,g:number,b:number}} options.color 背景色（#rrggbb 或 {r,g,b}）
 * @param {number} [options.tolerance] 0–1，默认 0.12
 * @param {number} [options.softness] 0–20 像素，默认 0（不羽化）
 * @param {number} [options.width] 图像宽（羽化必需）
 * @param {number} [options.height] 图像高（羽化必需）
 * @returns {Uint8ClampedArray} 同一个数组（就地修改）
 */
export function applyChromaKey(pixels, { color, tolerance = 0.12, softness = 0, width, height } = {}) {
  if (!pixels || typeof pixels.length !== 'number') return pixels;
  const target = typeof color === 'string' ? hexToRgb(color) : color;
  if (!target || !Number.isFinite(target.r) || !Number.isFinite(target.g) || !Number.isFinite(target.b)) {
    return pixels;
  }
  const tol = clamp(finiteNumber(tolerance, 0.12), 0, 1);
  const soft = clamp(finiteNumber(softness, 0), 0, 20);
  const limit = tol * MAX_COLOR_DISTANCE;
  const pixelCount = Math.floor(pixels.length / 4);
  const isBackground = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i += 1) {
    const o = i * 4;
    const dr = pixels[o] - target.r;
    const dg = pixels[o + 1] - target.g;
    const db = pixels[o + 2] - target.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance <= limit) {
      isBackground[i] = 1;
      pixels[o + 3] = 0;
    }
  }

  const dimsValid =
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width * height === pixelCount;
  if (soft <= 0 || !dimsValid) return pixels;

  // 羽化：先按当前 alpha 求模糊值，再只在非背景像素上取 min(原 alpha, 模糊值)。
  // 背景像素保持 0，保证「纯背景全透明」的语义。
  const source = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) source[i] = pixels[i * 4 + 3];
  const radius = Math.max(1, Math.min(20, Math.round(soft)));
  const blurred = boxBlurAlpha(source, width, height, radius);
  for (let i = 0; i < pixelCount; i += 1) {
    if (isBackground[i]) continue;
    const feathered = Math.min(source[i], blurred[i]);
    pixels[i * 4 + 3] = Math.round(feathered);
  }
  return pixels;
}
