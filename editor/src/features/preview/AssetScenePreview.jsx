import { useEffect, useMemo, useState } from 'react';

import { assetsApi } from '../../api';
import '../../styles/asset-editor.css';

const ROLE_LABEL = {
  background: '背景',
  sprite: '立绘',
  ui: 'UI',
  other: '图片',
};

/**
 * 素材编辑里的「场景预览」浮窗：
 * 把当前素材按它在场景里的使用方式（背景/立绘/UI/视频/小游戏）实时放到 16:9 舞台里，
 * 图片编辑器会把当前裁剪/去背景结果通过 liveDataUrl 传进来，因此未保存也能看到效果。
 */
export default function AssetScenePreview({ asset, project, projectDir, liveDataUrl }) {
  const [collapsed, setCollapsed] = useState(false);
  const [assetUrl, setAssetUrl] = useState('');
  const [backdropUrl, setBackdropUrl] = useState('');

  const backdropAsset = useMemo(() => {
    const scenes = (project?.nodes || []).filter((node) => node?.type === 'scene');
    const scene = scenes.find((node) => node.background?.assetId);
    if (!scene) return null;
    return (project?.assets?.images || []).find((item) => item.id === scene.background.assetId) || null;
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    setAssetUrl('');
    if (!asset?.path || !projectDir) return undefined;
    assetsApi
      .assetUrl({ projectDir, relativePath: asset.path })
      .then(({ url }) => {
        if (!cancelled) setAssetUrl(url || '');
      })
      .catch(() => {
        if (!cancelled) setAssetUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [asset?.id, asset?.path, projectDir]);

  useEffect(() => {
    let cancelled = false;
    setBackdropUrl('');
    if (!backdropAsset?.path || !projectDir) return undefined;
    assetsApi
      .assetUrl({ projectDir, relativePath: backdropAsset.path })
      .then(({ url }) => {
        if (!cancelled) setBackdropUrl(url || '');
      })
      .catch(() => {
        if (!cancelled) setBackdropUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [backdropAsset?.path, projectDir]);

  if (!asset || asset.kind === 'audio') return null;

  const imageSrc = asset.kind === 'image' ? liveDataUrl || assetUrl : '';
  const role = asset.role || 'other';
  const showBackdrop = asset.kind === 'image' && (role === 'sprite' || role === 'ui');
  const title =
    asset.kind === 'video' ? '视频在画面中的样子' : asset.kind === 'minigame' ? '小游戏预览' : '在场景中的样子';

  return (
    <aside className={`vn-asset-scene${collapsed ? ' is-collapsed' : ''}`} aria-label={title}>
      <header className="vn-asset-scene__head">
        <span className="vn-asset-scene__title">{title}</span>
        <span className="vn-asset-scene__role">
          {asset.kind === 'image' ? ROLE_LABEL[role] || '图片' : asset.kind === 'video' ? '视频' : '小游戏'}
        </span>
        <button
          type="button"
          className="vn-asset-scene__toggle"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </header>

      {!collapsed && (
        <div className="vn-asset-scene__stage">
          {showBackdrop && backdropUrl ? (
            <img className="vn-asset-scene__backdrop" src={backdropUrl} alt="" />
          ) : null}

          {asset.kind === 'image' && imageSrc ? (
            <img
              className={`vn-asset-scene__image vn-asset-scene__image--${role}`}
              src={imageSrc}
              alt={asset.name || '素材预览'}
            />
          ) : null}

          {asset.kind === 'image' && !imageSrc ? (
            <div className="vn-asset-scene__empty">正在生成预览…</div>
          ) : null}

          {asset.kind === 'video' && assetUrl ? (
            <video className="vn-asset-scene__video" src={assetUrl} controls autoPlay muted loop />
          ) : null}

          {asset.kind === 'minigame' && assetUrl ? (
            <iframe className="vn-asset-scene__frame" src={assetUrl} title="小游戏预览" sandbox="allow-scripts" />
          ) : null}

          {asset.kind === 'video' && !assetUrl ? (
            <div className="vn-asset-scene__empty">正在加载视频…</div>
          ) : null}
        </div>
      )}

      <footer className="vn-asset-scene__hint">
        {asset.kind === 'image'
          ? role === 'background'
            ? '按背景层铺满画面'
            : role === 'sprite'
              ? '按立绘层叠加在场景上'
              : role === 'ui'
                ? '按 UI 层叠加'
                : '按图片层等比显示'
          : asset.kind === 'video'
            ? '视频节点会以整屏形式播放'
            : '独立小游戏窗口'}
      </footer>
    </aside>
  );
}
