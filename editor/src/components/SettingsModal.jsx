import { useEffect, useState } from 'react';

import { aiApi } from '../api';
import '../styles/ai.css';

const SIZES = ['1024x1024', '1536x1024', '1024x1536'];

export default function SettingsModal({ onClose, notify }) {
  const [config, setConfig] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    aiApi
      .getConfig()
      .then((result) => {
        if (alive) setConfig(result.config ?? result);
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  if (!config) {
    return (
      <div className="vn-ai-overlay" role="dialog" aria-modal="true" aria-label="设置">
        <div className="vn-ai-modal">
          <div className="vn-ai-modal__head">
            <h2>设置</h2>
            <button type="button" className="vn-ai-close" onClick={onClose} aria-label="关闭">×</button>
          </div>
          <div className="vn-ai-modal__body">{error ? <p className="vn-ai-error">{error}</p> : '读取配置…'}</div>
        </div>
      </div>
    );
  }

  const patch = (key, value) => setConfig((previous) => ({ ...previous, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await aiApi.setConfig({
        baseUrl: config.baseUrl,
        model: config.model,
        imageSize: config.imageSize,
        timeoutMs: Number(config.timeoutMs),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : null),
      });
      setConfig(saved.config ?? saved);
      setApiKey('');
      notify?.('外部 AI 服务配置已保存', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const result = await aiApi.testService();
      setStatus({ ok: result.connected !== false, message: result.message || result.error || `HTTP ${result.status}` });
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="vn-ai-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <div className="vn-ai-modal">
        <div className="vn-ai-modal__head">
          <div>
            <h2>设置</h2>
            <p className="vn-ai-subtle">API Key 只保存在本机 userData，不会写入项目文件。</p>
          </div>
          <button type="button" className="vn-ai-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="vn-ai-modal__body">
          <h3 className="vn-ai-section-title">外部 AI 服务（OpenAI 兼容）</h3>
          <label className="vn-ai-field">
            <span>Base URL</span>
            <input value={config.baseUrl ?? ''} onChange={(event) => patch('baseUrl', event.target.value)} placeholder="https://api.openai.com/v1" />
          </label>
          <label className="vn-ai-field">
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={config.hasApiKey ? `已保存 ${config.keyPreview}` : 'sk-...'}
              autoComplete="off"
            />
          </label>
          <div className="vn-ai-row">
            <label className="vn-ai-field">
              <span>模型</span>
              <input value={config.model ?? ''} onChange={(event) => patch('model', event.target.value)} />
            </label>
            <label className="vn-ai-field">
              <span>生图尺寸</span>
              <select value={config.imageSize} onChange={(event) => patch('imageSize', event.target.value)}>
                {SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <label className="vn-ai-field">
              <span>超时（秒）</span>
              <input
                type="number"
                min={5}
                max={300}
                value={Math.round((config.timeoutMs ?? 60000) / 1000)}
                onChange={(event) => patch('timeoutMs', Number(event.target.value) * 1000)}
              />
            </label>
          </div>
          {status ? (
            <p className={`vn-ai-status ${status.ok ? 'is-ok' : 'is-error'}`}>{status.message}</p>
          ) : null}
          {error ? <p className="vn-ai-error">{error}</p> : null}
        </div>

        <div className="vn-ai-modal__foot">
          <button type="button" className="vn-btn vn-btn--ghost" onClick={handleTest} disabled={testing || saving}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <div className="vn-ai-spacer" />
          <button type="button" className="vn-btn vn-btn--ghost" onClick={onClose} disabled={saving}>关闭</button>
          <button type="button" className="vn-btn" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
