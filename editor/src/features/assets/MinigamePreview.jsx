import React, { useEffect, useState } from 'react';
import { assetsApi } from '../../api.js';
import '../../styles/asset-editor.css';

/**
 * 小游戏素材预览：以 vnasset:// URL 在受限 iframe 中运行（sandbox 仅 allow-scripts）。
 *
 * @param {object} props
 * @param {object} props.asset minigameAsset
 * @param {string} props.projectDir 项目绝对目录
 */
export default function MinigamePreview({ asset, projectDir }) {
  const [state, setState] = useState({ status: 'loading' });
  const [frameFailed, setFrameFailed] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);

  const relativePath = asset?.path;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setFrameFailed(false);
    setFrameLoaded(false);
    if (!projectDir || !relativePath) {
      setState({ status: 'error', message: '缺少项目目录或素材路径' });
      return () => {
        cancelled = true;
      };
    }
    assetsApi
      .assetUrl({ projectDir, relativePath })
      .then(({ url }) => {
        if (!cancelled) setState({ status: 'ready', url });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ status: 'error', message: error?.message || '无法获取小游戏地址' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectDir, relativePath]);

  const exits = Array.isArray(asset?.declaredExits) ? asset.declaredExits : [];

  return (
    <section className="vn-ed vn-ed-minigame">
      <header className="vn-ed-head">
        <h3 className="vn-ed-title">小游戏预览</h3>
        <span className="vn-ed-meta">
          <span className="vn-ed-mono">{asset?.path || '—'}</span>
          <span className="vn-ed-tag">mode: {asset?.mode || 'blocking'}</span>
        </span>
      </header>

      <div className="vn-ed-minigame-exits">
        <span className="vn-ed-info-label">声明出口</span>
        {exits.length === 0 && <span className="vn-ed-hint">未声明出口</span>}
        {exits.map((exit) => (
          <span className="vn-ed-chip is-static" key={exit}>
            {exit}
          </span>
        ))}
      </div>

      <div className="vn-ed-minigame-frame-wrap">
        {state.status === 'loading' && <div className="vn-ed-state">正在加载小游戏…</div>}
        {state.status === 'error' && (
          <div className="vn-ed-placeholder">
            <div className="vn-ed-state vn-ed-state-error">小游戏加载失败：{state.message}</div>
            <div className="vn-ed-mono">{asset?.path || '—'}</div>
          </div>
        )}
        {state.status === 'ready' && frameFailed && (
          <div className="vn-ed-placeholder">
            <div className="vn-ed-state vn-ed-state-error">
              小游戏页面加载失败（iframe 无法打开），请检查文件是否存在。
            </div>
            <div className="vn-ed-mono">{asset?.path || '—'}</div>
          </div>
        )}
        {state.status === 'ready' && !frameFailed && (
          <iframe
            key={state.url}
            className="vn-ed-minigame-frame"
            title={asset?.name || '小游戏预览'}
            src={state.url}
            sandbox="allow-scripts"
            onLoad={() => setFrameLoaded(true)}
            onError={() => setFrameFailed(true)}
          />
        )}
      </div>

      {frameLoaded && !frameFailed && (
        <div className="vn-ed-hint">
          预览在 sandbox="allow-scripts" 的 iframe 中运行（无同源 / 无插件权限）。
        </div>
      )}

      <div className="vn-ed-info-card">
        <div className="vn-ed-panel-title">运行时约定</div>
        <ul className="vn-ed-list">
          <li>
            结果上报格式：
            <code className="vn-ed-code">
              postMessage({'{'}type:'minigame-result', result:'&lt;string&gt;'{'}'})
            </code>
          </li>
          <li>节点必须为每个声明出口配置出口（declaredExits 需被节点出口完整覆盖）。</li>
          <li>导入时已校验远程资源：小游戏必须是自包含 HTML，不引用 http(s) / 协议相对地址。</li>
          <li>阶段二仅提供预览与元数据；在蓝图节点中挂接小游戏属于阶段 3。</li>
        </ul>
      </div>
    </section>
  );
}
