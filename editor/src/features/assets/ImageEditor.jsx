import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assetsApi } from '../../api.js';
import {
  CROP_PRESETS,
  applyAdjustments,
  applyChromaKey,
  computeCropRect,
  hexToRgb,
  rgbToHex,
} from './lib/imageEdits.js';
import '../../styles/asset-editor.css';

/** 预览画布长边上限（大图不在预览里按源分辨率计算）。 */
const PREVIEW_MAX_EDGE = 1400;
/** 滑块拖动时预览重算的防抖间隔（ms）。 */
const PREVIEW_DEBOUNCE_MS = 60;
/** 去背景默认参数。 */
const DEFAULT_REMOVE_BG = { color: '#00ff00', tolerance: 0.12, softness: 2 };
const DEFAULT_ADJUSTMENTS = { brightness: 0, contrast: 0 };

function presetByKey(key) {
  return CROP_PRESETS.find((preset) => preset.key === key) || CROP_PRESETS[0];
}

function presetAspect(preset) {
  return preset.width && preset.height ? preset.width / preset.height : null;
}

/**
 * 由已保存的 edit.crop 反推 UI 状态（预设 / 缩放 / 偏移），让控件与预览一致。
 * 反推不精确时只影响滑块初值，不会自动改写已保存的裁剪框。
 */
function inferCropUi(crop, sourceWidth, sourceHeight) {
  if (!crop || crop.width <= 0 || crop.height <= 0) {
    return { presetKey: 'source', zoom: 1, offsetX: 0, offsetY: 0 };
  }
  const aspect = crop.width / crop.height;
  let presetKey = 'source';
  for (const preset of CROP_PRESETS) {
    const target = presetAspect(preset);
    if (target && Math.abs(target - aspect) / target < 0.02) {
      presetKey = preset.key;
      break;
    }
  }
  if (presetKey === 'source') return { presetKey, zoom: 1, offsetX: 0, offsetY: 0 };

  const preset = presetByKey(presetKey);
  const base = computeCropRect({
    sourceWidth,
    sourceHeight,
    aspectRatio: presetAspect(preset),
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const zoom = Math.min(3, Math.max(1, base.width / Math.max(1, crop.width)));
  const maxX = sourceWidth - crop.width;
  const maxY = sourceHeight - crop.height;
  const offsetX = maxX > 0 ? Math.min(1, Math.max(-1, (crop.x / maxX) * 2 - 1)) : 0;
  const offsetY = maxY > 0 ? Math.min(1, Math.max(-1, (crop.y / maxY) * 2 - 1)) : 0;
  return {
    presetKey,
    zoom: Math.round(zoom * 100) / 100,
    offsetX: Math.round(offsetX * 100) / 100,
    offsetY: Math.round(offsetY * 100) / 100,
  };
}

/**
 * 渲染管线（预览与导出共用，只差输出尺寸）：
 * 按裁剪框把源图画到目标尺寸 → 逐像素调整亮度/对比度 → 逐像素去背景。
 */
function renderEditedCanvas(canvas, image, cropRect, removeBackground, adjustments, outWidth, outHeight) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, outWidth, outHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    image,
    cropRect.x,
    cropRect.y,
    cropRect.width,
    cropRect.height,
    0,
    0,
    outWidth,
    outHeight,
  );

  const needsAdjust =
    adjustments && (adjustments.brightness !== 0 || adjustments.contrast !== 0);
  if (!needsAdjust && !removeBackground) return;

  const imageData = ctx.getImageData(0, 0, outWidth, outHeight);
  if (needsAdjust) applyAdjustments(imageData.data, adjustments);
  if (removeBackground) {
    const color = removeBackground.color || DEFAULT_REMOVE_BG.color;
    applyChromaKey(imageData.data, {
      color,
      tolerance: removeBackground.tolerance,
      softness: removeBackground.softness,
      width: outWidth,
      height: outHeight,
    });
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * 图片素材编辑器：裁剪 / 去背景 / 亮度对比度，预览与导出共用同一条像素管线。
 *
 * @param {object} props
 * @param {object} props.asset imageAsset
 * @param {string} props.projectDir 项目绝对目录
 * @param {(asset:object)=>void} [props.onAssetUpdated] 导出成功后的新资产
 * @param {(message:string, kind?:string)=>void} [props.notify]
 */
export default function ImageEditor({ asset, projectDir, onAssetUpdated, notify }) {
  const safeNotify = typeof notify === 'function' ? notify : () => {};

  const [load, setLoad] = useState({ status: 'loading' });
  const [presetKey, setPresetKey] = useState('source');
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [crop, setCrop] = useState(null);
  const [removeBackground, setRemoveBackground] = useState(null);
  const [adjustments, setAdjustments] = useState(DEFAULT_ADJUSTMENTS);
  const [format, setFormat] = useState(asset.format === 'png' ? 'png' : 'webp');
  const [pickedColor, setPickedColor] = useState(null);
  const [pickMode, setPickMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const imageRef = useRef(null);
  const previewCanvasRef = useRef(null);

  // ── 加载原图（source 优先，缺失回退 path）──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const relativePath = asset?.source?.path ?? asset?.path;
    imageRef.current = null;
    setLoad({ status: 'loading' });
    setPickMode(false);
    if (!projectDir || !relativePath) {
      setLoad({ status: 'error', message: '缺少项目目录或素材路径' });
      return () => {
        cancelled = true;
      };
    }

    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const edit = asset?.edit || {};
      const initialCrop =
        edit.crop && edit.crop.width > 0 && edit.crop.height > 0 ? { ...edit.crop } : null;
      const initialRemoveBg =
        edit.removeBackground && edit.removeBackground.color
          ? {
              color: edit.removeBackground.color,
              tolerance:
                typeof edit.removeBackground.tolerance === 'number'
                  ? edit.removeBackground.tolerance
                  : DEFAULT_REMOVE_BG.tolerance,
              softness:
                typeof edit.removeBackground.softness === 'number'
                  ? edit.removeBackground.softness
                  : DEFAULT_REMOVE_BG.softness,
            }
          : null;
      const initialAdjustments = {
        brightness:
          typeof edit.adjustments?.brightness === 'number' ? edit.adjustments.brightness : 0,
        contrast: typeof edit.adjustments?.contrast === 'number' ? edit.adjustments.contrast : 0,
      };
      const ui = inferCropUi(initialCrop, width, height);
      setPresetKey(ui.presetKey);
      setZoom(ui.zoom);
      setOffsetX(ui.offsetX);
      setOffsetY(ui.offsetY);
      setCrop(initialCrop);
      setRemoveBackground(initialRemoveBg);
      setAdjustments(initialAdjustments);
      setFormat(asset?.format === 'png' ? 'png' : 'webp');
      setPickedColor(initialRemoveBg?.color ?? null);
      setLoad({ status: 'ready', width, height });
    };
    image.onerror = () => {
      if (cancelled) return;
      setLoad({ status: 'error', message: '图片解码失败，文件可能已损坏' });
    };

    assetsApi
      .readDataUrl({ projectDir, relativePath })
      .then(({ dataUrl }) => {
        if (!cancelled) image.src = dataUrl;
      })
      .catch((error) => {
        if (cancelled) return;
        setLoad({ status: 'error', message: error?.message || '读取原图失败' });
      });

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [asset?.id, asset?.path, asset?.source?.path, projectDir]);

  // ── 当前裁剪框（null = 全图）──────────────────────────────────────────
  const cropRect = useMemo(() => {
    if (load.status !== 'ready') return null;
    return crop ?? { x: 0, y: 0, width: load.width, height: load.height };
  }, [crop, load]);

  // ── 输出尺寸：预设固定尺寸优先，「原尺寸」等于裁剪框尺寸 ──────────────
  const outputSize = useMemo(() => {
    if (!cropRect) return null;
    const preset = presetByKey(presetKey);
    if (preset.width && preset.height) return { width: preset.width, height: preset.height };
    return { width: Math.max(1, Math.round(cropRect.width)), height: Math.max(1, Math.round(cropRect.height)) };
  }, [cropRect, presetKey]);

  // ── 预览：防抖重算（源分辨率裁剪后缩到 ≤1400 长边再跑像素操作）──────────
  const drawPreview = useCallback(() => {
    const image = imageRef.current;
    const canvas = previewCanvasRef.current;
    if (!image || !canvas || !cropRect) return;
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(cropRect.width, cropRect.height));
    const previewWidth = Math.max(1, Math.round(cropRect.width * scale));
    const previewHeight = Math.max(1, Math.round(cropRect.height * scale));
    if (canvas.width !== previewWidth || canvas.height !== previewHeight) {
      canvas.width = previewWidth;
      canvas.height = previewHeight;
    }
    renderEditedCanvas(canvas, image, cropRect, removeBackground, adjustments, previewWidth, previewHeight);
  }, [cropRect, removeBackground, adjustments]);

  useEffect(() => {
    if (load.status !== 'ready') return undefined;
    const timer = setTimeout(drawPreview, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [load.status, drawPreview]);

  // ── 裁剪参数变化：按预设比例 + zoom/offset 重算源图裁剪框 ───────────────
  const applyCropControl = useCallback(
    (patch) => {
      if (load.status !== 'ready') return;
      const next = { presetKey, zoom, offsetX, offsetY, ...patch };
      const preset = presetByKey(next.presetKey);
      const rect = computeCropRect({
        sourceWidth: load.width,
        sourceHeight: load.height,
        // 「原尺寸」预设沿用源图宽高比，这样 zoom / offset 仍然有效；
        // 未修改参数时结果正好等于全图（导出裁剪框为 null）。
        aspectRatio: presetAspect(preset) ?? load.width / load.height,
        zoom: next.zoom,
        offsetX: next.offsetX,
        offsetY: next.offsetY,
      });
      setPresetKey(next.presetKey);
      setZoom(next.zoom);
      setOffsetX(next.offsetX);
      setOffsetY(next.offsetY);
      const isFull =
        rect.x === 0 &&
        rect.y === 0 &&
        rect.width === load.width &&
        rect.height === load.height;
      setCrop(isFull ? null : rect);
    },
    [load, presetKey, zoom, offsetX, offsetY],
  );

  const handlePresetClick = useCallback(
    (preset) => {
      if (preset.width && preset.height) {
        applyCropControl({ presetKey: preset.key });
      } else {
        // 原尺寸：回到全图，重置缩放与偏移
        applyCropControl({ presetKey: preset.key, zoom: 1, offsetX: 0, offsetY: 0 });
      }
    },
    [applyCropControl],
  );

  // ── 去背景控件 ────────────────────────────────────────────────────────
  const toggleRemoveBackground = useCallback(() => {
    setPickMode(false);
    if (removeBackground) {
      setRemoveBackground(null);
      return;
    }
    const color = pickedColor || DEFAULT_REMOVE_BG.color;
    setPickedColor(color);
    setRemoveBackground({
      color,
      tolerance: DEFAULT_REMOVE_BG.tolerance,
      softness: DEFAULT_REMOVE_BG.softness,
    });
  }, [pickedColor, removeBackground]);

  const updateRemoveBackground = useCallback((patch) => {
    setRemoveBackground((previous) => (previous ? { ...previous, ...patch } : previous));
  }, []);

  // ── 吸管取色：预览坐标 → 源图像素（取源图原始颜色，不受已调整像素影响）──
  const handleCanvasClick = useCallback(
    (event) => {
      if (!pickMode || load.status !== 'ready') return;
      const canvas = previewCanvasRef.current;
      const image = imageRef.current;
      if (!canvas || !image || !cropRect) return;
      const bounds = canvas.getBoundingClientRect();
      const ratioX = (event.clientX - bounds.left) / Math.max(1, bounds.width);
      const ratioY = (event.clientY - bounds.top) / Math.max(1, bounds.height);
      const sourceX = Math.min(
        load.width - 1,
        Math.max(0, Math.floor(cropRect.x + ratioX * cropRect.width)),
      );
      const sourceY = Math.min(
        load.height - 1,
        Math.max(0, Math.floor(cropRect.y + ratioY * cropRect.height)),
      );
      try {
        const sample = document.createElement('canvas');
        sample.width = 1;
        sample.height = 1;
        const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
        sampleCtx.drawImage(image, sourceX, sourceY, 1, 1, 0, 0, 1, 1);
        const [r, g, b] = sampleCtx.getImageData(0, 0, 1, 1).data;
        const hex = rgbToHex({ r, g, b });
        setPickedColor(hex);
        setRemoveBackground((previous) => ({
          color: hex,
          tolerance: previous?.tolerance ?? DEFAULT_REMOVE_BG.tolerance,
          softness: previous?.softness ?? DEFAULT_REMOVE_BG.softness,
        }));
        setPickMode(false);
      } catch (error) {
        safeNotify(error?.message || '取色失败', 'error');
        setPickMode(false);
      }
    },
    [pickMode, load, cropRect, safeNotify],
  );

  // ── 亮度 / 对比度 ─────────────────────────────────────────────────────
  const updateAdjustment = useCallback((key, value) => {
    setAdjustments((previous) => ({ ...previous, [key]: value }));
  }, []);

  const resetAdjustments = useCallback(() => setAdjustments(DEFAULT_ADJUSTMENTS), []);

  // ── 保存导出 ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (load.status !== 'ready' || !cropRect || saving) return;
    const image = imageRef.current;
    if (!image) return;
    setSaving(true);
    try {
      const targetWidth = outputSize.width;
      const targetHeight = outputSize.height;
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      renderEditedCanvas(canvas, image, cropRect, removeBackground, adjustments, targetWidth, targetHeight);
      const mime = format === 'png' ? 'image/png' : 'image/webp';
      const dataUrl = canvas.toDataURL(mime, 0.92);
      const commaIndex = dataUrl.indexOf(',');
      if (commaIndex < 0) throw new Error('画布导出失败');
      const dataBase64 = dataUrl.slice(commaIndex + 1);
      const edit = {
        crop: crop
          ? {
              x: Math.round(crop.x),
              y: Math.round(crop.y),
              width: Math.max(1, Math.round(crop.width)),
              height: Math.max(1, Math.round(crop.height)),
            }
          : null,
        removeBackground: removeBackground
          ? {
              color: removeBackground.color,
              tolerance: removeBackground.tolerance,
              softness: removeBackground.softness,
            }
          : null,
        adjustments: {
          brightness: adjustments.brightness,
          contrast: adjustments.contrast,
        },
      };
      const response = await assetsApi.exportImage({
        projectDir,
        asset,
        // 兼容契约里 exportImage 也可能按 assetId 取素材的写法；主进程只取其一。
        assetId: asset?.id,
        edit,
        format,
        width: targetWidth,
        height: targetHeight,
        dataBase64,
      });
      if (response?.asset) onAssetUpdated?.(response.asset);
      safeNotify('图片已保存并导出', 'success');
    } catch (error) {
      safeNotify(error?.message || '保存图片失败', 'error');
    } finally {
      setSaving(false);
    }
  }, [
    load.status,
    cropRect,
    saving,
    outputSize,
    removeBackground,
    adjustments,
    crop,
    format,
    projectDir,
    asset,
    onAssetUpdated,
    safeNotify,
  ]);

  // ── 渲染 ──────────────────────────────────────────────────────────────
  const removeBgColor = removeBackground?.color || pickedColor || '#00ff00';
  const swatchColor = hexToRgb(removeBgColor) ? removeBgColor : '#00ff00';
  const cropInfo = cropRect
    ? `x ${Math.round(cropRect.x)} · y ${Math.round(cropRect.y)} · ${Math.round(cropRect.width)}×${Math.round(cropRect.height)}`
    : '';
  const preset = presetByKey(presetKey);

  return (
    <section className="vn-ed vn-ed-img">
      <header className="vn-ed-head">
        <h3 className="vn-ed-title">图片编辑</h3>
        {load.status === 'ready' && (
          <span className="vn-ed-meta">
            原图 {load.width}×{load.height}
            {outputSize ? ` · 输出 ${outputSize.width}×${outputSize.height}` : ''}
          </span>
        )}
      </header>

      {!asset?.source && load.status === 'ready' && (
        <div className="vn-ed-notice">
          无原始文件，编辑将基于当前最终文件（裁剪坐标以该文件为基准）。
        </div>
      )}

      {load.status === 'loading' && <div className="vn-ed-state">正在加载原图…</div>}
      {load.status === 'error' && (
        <div className="vn-ed-state vn-ed-state-error">原图加载失败：{load.message}</div>
      )}

      {load.status === 'ready' && (
        <>
          <div className="vn-ed-img-stage">
            <div className="vn-ed-img-canvas-wrap">
              <canvas
                ref={previewCanvasRef}
                className={`vn-ed-img-canvas${pickMode ? ' is-picking' : ''}`}
                onClick={handleCanvasClick}
              />
              <div className="vn-ed-img-crop-frame" aria-hidden="true" />
              {pickMode && <div className="vn-ed-img-pick-hint">取色模式：点击画面拾取背景色</div>}
            </div>
          </div>

          <div className="vn-ed-img-tools">
            {/* 1. 裁剪 */}
            <div className="vn-ed-panel">
              <div className="vn-ed-panel-title">裁剪</div>
              <div className="vn-ed-preset-grid">
                {CROP_PRESETS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`vn-ed-chip${presetKey === item.key ? ' is-active' : ''}`}
                    onClick={() => handlePresetClick(item)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="vn-ed-slider-row">
                <span className="vn-ed-label">缩放</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={(event) => applyCropControl({ zoom: Number(event.target.value) })}
                />
                <span className="vn-ed-value">{zoom.toFixed(2)}×</span>
              </div>
              <div className="vn-ed-slider-row">
                <span className="vn-ed-label">水平偏移</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={offsetX}
                  onChange={(event) => applyCropControl({ offsetX: Number(event.target.value) })}
                />
                <span className="vn-ed-value">{offsetX.toFixed(2)}</span>
              </div>
              <div className="vn-ed-slider-row">
                <span className="vn-ed-label">垂直偏移</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={offsetY}
                  onChange={(event) => applyCropControl({ offsetY: Number(event.target.value) })}
                />
                <span className="vn-ed-value">{offsetY.toFixed(2)}</span>
              </div>
              <div className="vn-ed-hint">裁剪框（源图像素）：{cropInfo}</div>
            </div>

            {/* 2. 去背景 */}
            <div className="vn-ed-panel">
              <div className="vn-ed-panel-title">去背景</div>
              <div className="vn-ed-row">
                <button
                  type="button"
                  className={`vn-ed-btn${removeBackground ? ' is-active' : ''}`}
                  onClick={toggleRemoveBackground}
                >
                  {removeBackground ? '已启用' : '启用去背景'}
                </button>
                <button
                  type="button"
                  className={`vn-ed-btn${pickMode ? ' is-active' : ''}`}
                  disabled={!removeBackground}
                  onClick={() => setPickMode((value) => !value)}
                >
                  {pickMode ? '取色中…' : '吸管取色'}
                </button>
                <span
                  className="vn-ed-swatch"
                  style={{ background: swatchColor }}
                  title={removeBackground?.color || '未取色'}
                />
                <span className="vn-ed-value">{removeBackground?.color || '未取色'}</span>
              </div>

              <div className="vn-ed-slider-row">
                <span className="vn-ed-label">容差</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={removeBackground?.tolerance ?? DEFAULT_REMOVE_BG.tolerance}
                  disabled={!removeBackground}
                  onChange={(event) =>
                    updateRemoveBackground({ tolerance: Number(event.target.value) })
                  }
                />
                <span className="vn-ed-value">
                  {(removeBackground?.tolerance ?? DEFAULT_REMOVE_BG.tolerance).toFixed(2)}
                </span>
              </div>
              <div className="vn-ed-slider-row">
                <span className="vn-ed-label">羽化</span>
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  value={removeBackground?.softness ?? DEFAULT_REMOVE_BG.softness}
                  disabled={!removeBackground}
                  onChange={(event) =>
                    updateRemoveBackground({ softness: Number(event.target.value) })
                  }
                />
                <span className="vn-ed-value">
                  {removeBackground?.softness ?? DEFAULT_REMOVE_BG.softness} px
                </span>
              </div>
              {!removeBackground && (
                <div className="vn-ed-hint">启用后可点「吸管取色」从画面拾取背景色。</div>
              )}
            </div>

            {/* 3. 亮度 / 对比度 */}
            <div className="vn-ed-panel">
              <div className="vn-ed-panel-title">亮度 / 对比度</div>
              <div className="vn-ed-slider-row">
                <span className="vn-ed-label">亮度</span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={adjustments.brightness}
                  onChange={(event) =>
                    updateAdjustment('brightness', Number(event.target.value))
                  }
                />
                <span className="vn-ed-value">{adjustments.brightness}</span>
              </div>
              <div className="vn-ed-slider-row">
                <span className="vn-ed-label">对比度</span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={adjustments.contrast}
                  onChange={(event) => updateAdjustment('contrast', Number(event.target.value))}
                />
                <span className="vn-ed-value">{adjustments.contrast}</span>
              </div>
              <div className="vn-ed-row">
                <button type="button" className="vn-ed-btn" onClick={resetAdjustments}>
                  重置调整
                </button>
              </div>
            </div>

            {/* 4. 输出 */}
            <div className="vn-ed-panel">
              <div className="vn-ed-panel-title">输出</div>
              <div className="vn-ed-row">
                <label className="vn-ed-radio">
                  <input
                    type="radio"
                    name="vn-ed-img-format"
                    checked={format === 'png'}
                    onChange={() => setFormat('png')}
                  />
                  PNG
                </label>
                <label className="vn-ed-radio">
                  <input
                    type="radio"
                    name="vn-ed-img-format"
                    checked={format === 'webp'}
                    onChange={() => setFormat('webp')}
                  />
                  WebP
                </label>
              </div>
              <div className="vn-ed-hint">
                {preset.width && preset.height
                  ? `导出尺寸 ${preset.width}×${preset.height} px（预设）`
                  : `导出尺寸 ${outputSize ? `${outputSize.width}×${outputSize.height}` : '—'} px（裁剪框原尺寸）`}
              </div>
              <button
                type="button"
                className="vn-ed-btn vn-ed-btn-primary"
                disabled={saving || load.status !== 'ready'}
                onClick={handleSave}
              >
                {saving ? '正在保存…' : '保存图片'}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
