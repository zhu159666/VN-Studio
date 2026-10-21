import { useEffect, useMemo, useState } from 'react';

export const POSITION_PRESETS = [
  { key: 'left', label: '左侧', x: 0.25, y: 0.62 },
  { key: 'center', label: '中间', x: 0.5, y: 0.62 },
  { key: 'right', label: '右侧', x: 0.75, y: 0.62 },
];

export default function SpritePositionModal({ open, asset, project, onCancel, onConfirm }) {
  const spriteImages = useMemo(
    () => (project.assets?.images ?? []).filter((image) => image.role === 'sprite' || image.role === 'ui'),
    [project.assets?.images],
  );
  const [assetId, setAssetId] = useState(asset?.id ?? spriteImages[0]?.id ?? '');
  const [preset, setPreset] = useState('center');
  const [x, setX] = useState(0.5);
  const [y, setY] = useState(0.62);
  const [scale, setScale] = useState(1);
  const [zIndex, setZIndex] = useState(10);
  const [opacity, setOpacity] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setAssetId(asset?.id ?? spriteImages[0]?.id ?? '');
    setPreset('center');
    setX(0.5);
    setY(0.62);
    setScale(1);
    setZIndex(10);
    setOpacity(1);
    setError('');
  }, [open, asset?.id, spriteImages]);

  if (!open) return null;

  const applyPreset = (nextPreset) => {
    setPreset(nextPreset);
    const found = POSITION_PRESETS.find((item) => item.key === nextPreset);
    if (found) {
      setX(found.x);
      setY(found.y);
    }
  };

  const submit = () => {
    const numericScale = Number(scale);
    const numericZ = Number(zIndex);
    const numericOpacity = Number(opacity);
    if (!assetId) {
      setError('请选择图片素材');
      return;
    }
    if (!Number.isFinite(numericScale) || numericScale < 0.05 || numericScale > 10) {
      setError('缩放必须在 0.05–10 之间');
      return;
    }
    if (!Number.isInteger(numericZ) || numericZ < 0 || numericZ > 1000) {
      setError('层级必须是 0–1000 的整数');
      return;
    }
    if (!Number.isFinite(numericOpacity) || numericOpacity < 0 || numericOpacity > 1) {
      setError('透明度必须在 0–1 之间');
      return;
    }
    onConfirm({
      assetId,
      x: Number(x),
      y: Number(y),
      scale: numericScale,
      zIndex: numericZ,
      opacity: numericOpacity,
    });
  };

  return (
    <div className="vn-bp-modal-overlay" role="presentation" onMouseDown={onCancel}>
      <div
        className="vn-bp-modal"
        role="dialog"
        aria-modal="true"
        aria-label="立绘位置与表情"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="vn-bp-modal__head">
          <div>
            <h2>添加到场景</h2>
            <p>选择位置、表情素材与层级；确认后可继续在属性面板微调。</p>
          </div>
          <button type="button" className="vn-btn vn-btn--ghost" onClick={onCancel}>
            取消
          </button>
        </header>

        <div className="vn-bp-modal__body">
          <label className="vn-bp-modal__field">
            <span>表情 / 图片素材</span>
            <select className="vn-select" value={assetId} onChange={(event) => setAssetId(event.target.value)}>
              {spriteImages.map((image) => (
                <option key={image.id} value={image.id}>
                  {image.name}（{image.role}）
                </option>
              ))}
            </select>
          </label>

          <div className="vn-bp-modal__row">
            <span className="vn-bp-modal__label">位置预设</span>
            <div className="vn-bp-modal__presets">
              {POSITION_PRESETS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`vn-btn ${preset === item.key ? '' : 'vn-btn--ghost'}`}
                  onClick={() => applyPreset(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="vn-bp-modal__grid2">
            <label className="vn-bp-modal__field">
              <span>x（0–1）</span>
              <input
                className="vn-input"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={x}
                onChange={(event) => setX(event.target.value)}
              />
            </label>
            <label className="vn-bp-modal__field">
              <span>y（0–1）</span>
              <input
                className="vn-input"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={y}
                onChange={(event) => setY(event.target.value)}
              />
            </label>
            <label className="vn-bp-modal__field">
              <span>缩放（0.05–10）</span>
              <input
                className="vn-input"
                type="number"
                step="0.05"
                min="0.05"
                max="10"
                value={scale}
                onChange={(event) => setScale(event.target.value)}
              />
            </label>
            <label className="vn-bp-modal__field">
              <span>层级（0–1000）</span>
              <input
                className="vn-input"
                type="number"
                step="1"
                min="0"
                max="1000"
                value={zIndex}
                onChange={(event) => setZIndex(event.target.value)}
              />
            </label>
            <label className="vn-bp-modal__field">
              <span>透明度（0–1）</span>
              <input
                className="vn-input"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={opacity}
                onChange={(event) => setOpacity(event.target.value)}
              />
            </label>
          </div>

          {error ? <div className="vn-bp-modal__error">{error}</div> : null}
        </div>

        <footer className="vn-bp-modal__foot">
          <button type="button" className="vn-btn vn-btn--ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="vn-btn" onClick={submit}>
            添加到场景
          </button>
        </footer>
      </div>
    </div>
  );
}
