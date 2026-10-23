import { useState } from 'react';

import { aiApi, assetsApi } from '../api';
import '../styles/ai.css';

export default function AIAssistantPanel({ projectDir, notify, onCreated, onOpenSettings, onClose }) {
  const [assetType, setAssetType] = useState('character');
  const [prompt, setPrompt] = useState('雾港夜色中的银发少女，黑色高领风衣，冷色轮廓光，视觉小说立绘，半身，透明背景');
  const [autoRemoveBg, setAutoRemoveBg] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [asset, setAsset] = useState(null);

  const handleGenerate = async () => {
    if (!projectDir) {
      setError('请先打开项目');
      return;
    }
    if (!prompt.trim()) {
      setError('请输入提示词');
      return;
    }
    setLoading(true);
    setError('');
    setPreview(null);
    setAsset(null);
    try {
      const result = await aiApi.generateImage({
        projectDir,
        prompt: prompt.trim(),
        assetType,
        autoRemoveBg: assetType === 'character' && autoRemoveBg,
      });
      const created = result.asset ?? result.assetRecord;
      if (!created) throw new Error('生图接口没有返回素材记录');
      setAsset(created);
      onCreated?.(created);
      const data = await assetsApi.readDataUrl({ projectDir, relativePath: created.path }).catch(() => null);
      if (data?.dataUrl) setPreview(data.dataUrl);
      notify?.(`已生成并导入素材：${created.name}`, 'success');
    } catch (err) {
      if (err.code === 'E_AI_NOT_CONFIGURED' || /尚未配置/.test(err.message)) {
        setError('尚未配置外部 AI 服务');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="vn-ai-overlay vn-ai-overlay--right" role="dialog" aria-modal="true" aria-label="AI 助手">
      <div className="vn-ai-drawer">
        <div className="vn-ai-modal__head">
          <div>
            <h2>AI 助手</h2>
            <p className="vn-ai-subtle">调用你配置的外部生图服务，图片会自动走导入管道。</p>
          </div>
          <button type="button" className="vn-ai-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="vn-ai-modal__body">
          <label className="vn-ai-field">
            <span>素材类型</span>
            <select value={assetType} onChange={(event) => setAssetType(event.target.value)}>
              <option value="character">角色立绘（512×1024，可去背景）</option>
              <option value="background">背景图（1920×1080）</option>
            </select>
          </label>
          <label className="vn-ai-field">
            <span>提示词</span>
            <textarea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </label>
          {assetType === 'character' ? (
            <label className="vn-ai-check">
              <input type="checkbox" checked={autoRemoveBg} onChange={(event) => setAutoRemoveBg(event.target.checked)} />
              自动移除纯色背景
            </label>
          ) : null}

          {error ? (
            <div className="vn-ai-error">
              {error}
              {/尚未配置/.test(error) ? (
                <button type="button" className="vn-btn vn-btn--ghost" onClick={onOpenSettings}>去设置</button>
              ) : null}
            </div>
          ) : null}

          {preview ? (
            <div className="vn-ai-preview">
              <img src={preview} alt={asset?.name || '生成的素材'} />
              <div className="vn-ai-preview__meta">
                <span>{asset?.id}</span>
                <span>{asset?.width}×{asset?.height}</span>
                <span>{asset?.role}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="vn-ai-modal__foot">
          <button type="button" className="vn-btn vn-btn--ghost" onClick={onOpenSettings}>外部 AI 设置</button>
          <div className="vn-ai-spacer" />
          <button type="button" className="vn-btn vn-btn--ghost" onClick={onClose}>关闭</button>
          <button type="button" className="vn-btn" onClick={handleGenerate} disabled={loading}>
            {loading ? '生成中…' : '生成并导入'}
          </button>
        </div>
      </div>
    </div>
  );
}
