import React, { useEffect, useMemo, useState } from 'react';
import { assetsApi } from '../../api.js';
import '../../styles/asset-editor.css';

function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  if (total === 0) return '未知';
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '未知';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const CODEC_LABEL = { h264: 'H.264', vp8: 'VP8', vp9: 'VP9' };

/**
 * 视频素材预览：vnasset:// 播放 + 元数据信息行。
 *
 * @param {object} props
 * @param {object} props.asset videoAsset
 * @param {string} props.projectDir 项目绝对目录
 */
export default function VideoPreview({ asset, projectDir }) {
  const [state, setState] = useState({ status: 'loading' });

  const relativePath = asset?.path;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
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
          setState({ status: 'error', message: error?.message || '无法获取视频地址' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectDir, relativePath]);

  const infoRows = useMemo(
    () => [
      { label: '格式', value: asset?.format ? String(asset.format).toUpperCase() : '未探测' },
      { label: '编码', value: asset?.codec ? CODEC_LABEL[asset.codec] || asset.codec : '未探测' },
      {
        label: '分辨率',
        value:
          asset?.width && asset?.height ? `${asset.width}×${asset.height}` : '未探测',
      },
      { label: '时长', value: formatDuration(asset?.durationMs) },
      { label: '音轨', value: asset?.hasAudio === true ? '有' : asset?.hasAudio === false ? '无' : '未探测' },
      { label: '大小', value: formatBytes(asset?.sizeBytes) },
    ],
    [asset?.format, asset?.codec, asset?.width, asset?.height, asset?.durationMs, asset?.hasAudio, asset?.sizeBytes],
  );

  return (
    <section className="vn-ed vn-ed-video">
      <header className="vn-ed-head">
        <h3 className="vn-ed-title">视频预览</h3>
        <span className="vn-ed-meta">{asset?.name || asset?.id}</span>
      </header>

      <div className="vn-ed-video-stage">
        {state.status === 'loading' && <div className="vn-ed-state">正在加载视频…</div>}
        {state.status === 'error' && (
          <div className="vn-ed-state vn-ed-state-error">视频加载失败：{state.message}</div>
        )}
        {state.status === 'ready' && (
          <video
            className="vn-ed-video-el"
            src={state.url}
            controls
            preload="metadata"
            playsInline
          >
            当前环境不支持 HTML5 视频播放。
          </video>
        )}
      </div>

      <div className="vn-ed-video-info">
        {infoRows.map((row) => (
          <div className="vn-ed-info-row" key={row.label}>
            <span className="vn-ed-info-label">{row.label}</span>
            <span className="vn-ed-info-value">{row.value}</span>
          </div>
        ))}
        <div className="vn-ed-info-row">
          <span className="vn-ed-info-label">路径</span>
          <span className="vn-ed-info-value vn-ed-mono">{asset?.path || '—'}</span>
        </div>
      </div>

      <div className="vn-ed-hint">
        视频素材只读预览；导入时已校验容器与编码（mp4 → H.264，webm → VP8/VP9）。
      </div>
    </section>
  );
}
