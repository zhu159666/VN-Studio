/**
 * AssetPanel —— 左栏素材库（阶段二）
 *
 * 结构：标题 + 导入菜单 / 搜索 / 类型筛选 / 列表·网格 / 素材列表 / 下方三选一面板。
 * 交互只通过 props；仅图片缩略图通过 api.assetDataUrl 读取 dataUrl。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assetDataUrl } from '../api.js';
import LeftBottomPanels from './LeftBottomPanels.jsx';
import '../styles/assets.css';

const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'audio', label: '音频' },
  { key: 'video', label: '视频' },
  { key: 'minigame', label: '小游戏' },
];

const IMAGE_ROLES = [
  { role: 'background', label: '背景', desc: '舞台背景图' },
  { role: 'sprite', label: '立绘', desc: '角色立绘' },
  { role: 'ui', label: 'UI', desc: '界面装饰图' },
  { role: 'other', label: '其他', desc: '通用图片' },
];

const AUDIO_ROLES = [
  { role: 'bgm', label: 'BGM', desc: '背景音乐' },
  { role: 'sfx', label: '音效', desc: '短音效' },
  { role: 'voice', label: '语音', desc: '角色语音' },
];

const IMAGE_ROLE_LABELS = { background: '背景', sprite: '立绘', ui: 'UI', other: '其他' };
const AUDIO_ROLE_LABELS = { bgm: 'BGM', sfx: '音效', voice: '语音' };

/* ───────────── inline SVG 图标 ───────────── */

const strokeProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

function IconImage() {
  return (
    <svg {...strokeProps} width="18" height="18">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M21 16l-5-5-6 6-3-3-4 4" />
    </svg>
  );
}

function IconAudio() {
  return (
    <svg {...strokeProps} width="18" height="18">
      <path d="M9 17V5l10-2v12" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </svg>
  );
}

function IconVideo() {
  return (
    <svg {...strokeProps} width="18" height="18">
      <rect x="3" y="5" width="13" height="14" rx="2" />
      <path d="M16 10.5 21 8v8l-5-2.5z" />
    </svg>
  );
}

function IconMinigame() {
  return (
    <svg {...strokeProps} width="18" height="18">
      <rect x="2" y="7" width="20" height="11" rx="5" />
      <path d="M7 12h3M8.5 10.5v3" />
      <circle cx="16" cy="11" r="0.7" />
      <circle cx="18" cy="13.5" r="0.7" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg {...strokeProps} width="13" height="13">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg {...strokeProps} width="13" height="13">
      <rect x="3" y="3" width="7" height="7" rx="1.2" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" />
      <rect x="14" y="14" width="7" height="7" rx="1.2" />
    </svg>
  );
}

function IconList() {
  return (
    <svg {...strokeProps} width="13" height="13">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg {...strokeProps} width="13" height="13">
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

/* ───────────── 小工具 ───────────── */

/** 毫秒 → mm:ss；缺时长返回占位 */
function formatDuration(durationMs) {
  const total = Number(durationMs);
  if (!Number.isFinite(total) || total <= 0) return '时长未知';
  const totalSeconds = Math.floor(total / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 素材副信息：格式 / 尺寸 / 时长 / 出口数 */
function assetMetaText(asset, kind) {
  if (!asset) return '';
  switch (kind) {
    case 'image': {
      const size = asset.width && asset.height ? `${asset.width} × ${asset.height}` : '尺寸未知';
      return `${asset.format ? String(asset.format).toUpperCase() : '图片'} · ${size}`;
    }
    case 'audio':
      return `${asset.format ? String(asset.format).toUpperCase() : '音频'} · ${formatDuration(asset.durationMs)}`;
    case 'video': {
      const size = asset.width && asset.height ? `${asset.width} × ${asset.height}` : '分辨率未知';
      return `${asset.format ? String(asset.format).toUpperCase() : '视频'} · ${formatDuration(asset.durationMs)} · ${size}`;
    }
    case 'minigame': {
      const count = Array.isArray(asset.declaredExits) ? asset.declaredExits.length : 0;
      return `${count} 个声明出口`;
    }
    default:
      return '';
  }
}

/** 素材 role 标签 */
function assetRoleLabel(asset, kind) {
  if (kind === 'image') return IMAGE_ROLE_LABELS[asset?.role] || '';
  if (kind === 'audio') return AUDIO_ROLE_LABELS[asset?.role] || '';
  return '';
}

function KindIcon({ kind }) {
  if (kind === 'audio') return <IconAudio />;
  if (kind === 'video') return <IconVideo />;
  if (kind === 'minigame') return <IconMinigame />;
  return <IconImage />;
}

/**
 * 图片缩略图：进入视口后再请求 dataUrl（懒加载），卸载后不再 setState。
 * 返回 null 时显示占位图标。
 */
function ImageThumb({ projectDir, asset, name }) {
  const hostRef = useRef(null);
  const [inView, setInView] = useState(false);
  const [dataUrl, setDataUrl] = useState(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || !projectDir || !asset?.path) return undefined;
    let alive = true;
    let task;
    setDataUrl(null); // 路径变化时先回到占位符，避免闪现旧图
    try {
      task = assetDataUrl(projectDir, asset);
    } catch {
      return () => {
        alive = false;
      };
    }
    Promise.resolve(task)
      .then((url) => {
        if (alive && typeof url === 'string' && url) setDataUrl(url);
      })
      .catch(() => {
        /* 缩略图失败只在视觉上退化为占位符，不打断列表 */
      });
    return () => {
      alive = false;
    };
    // 依赖 id/path：编辑导出后 path 变化需要重新取图
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, projectDir, asset?.id, asset?.path, asset?.format]);

  return (
    <span className="vn-asset-thumb" ref={hostRef}>
      {dataUrl ? (
        <img
          className="vn-asset-thumb__img"
          src={dataUrl}
          alt={name || '素材缩略图'}
          draggable={false}
          onError={() => setDataUrl(null)}
        />
      ) : (
        <span className="vn-asset-thumb__ph" aria-hidden="true">
          <IconImage />
        </span>
      )}
    </span>
  );
}

/* ───────────── 主组件 ───────────── */

export default function AssetPanel({
  project,
  projectDir,
  selectedAssetId,
  onSelectAsset,
  filter,
  onFilterChange,
  view,
  onViewChange,
  query,
  onQueryChange,
  onImportImages,
  onImportAudio,
  onImportVideos,
  onImportMinigames,
  onOpenAudioStudio,
  onRemoveAsset,
  notify,
  lowerPanel,
  onLowerPanelChange,
  onVariablesChange,
  onSelectAssetById,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState('');
  const [removingId, setRemovingId] = useState('');
  const menuRef = useRef(null);

  // project.assets 四个数组扁平化，保留 asset 引用
  const allItems = useMemo(() => {
    const assets = project?.assets || {};
    const build = (list, fallbackKind) =>
      (Array.isArray(list) ? list : []).map((asset) => ({
        asset,
        kind: asset?.kind || fallbackKind,
      }));
    return [
      ...build(assets.images, 'image'),
      ...build(assets.audio, 'audio'),
      ...build(assets.videos, 'video'),
      ...build(assets.minigames, 'minigame'),
    ];
  }, [project]);

  const counts = useMemo(() => {
    const map = { all: allItems.length, image: 0, audio: 0, video: 0, minigame: 0 };
    for (const item of allItems) {
      map[item.kind] = (map[item.kind] || 0) + 1;
    }
    return map;
  }, [allItems]);

  const activeFilter = FILTER_TABS.some((tab) => tab.key === filter) ? filter : 'all';
  const activeView = view === 'list' ? 'list' : 'grid';

  const visibleItems = useMemo(() => {
    const needle = String(query ?? '').trim().toLowerCase();
    return allItems.filter((item) => {
      if (activeFilter !== 'all' && item.kind !== activeFilter) return false;
      if (!needle) return true;
      const name = String(item.asset?.name || '').toLowerCase();
      const id = String(item.asset?.id || '').toLowerCase();
      return name.includes(needle) || id.includes(needle);
    });
  }, [allItems, activeFilter, query]);

  // 导入菜单：点击外部 / Esc 关闭
  useEffect(() => {
    if (!menuOpen) return undefined;
    const handlePointerDown = (event) => {
      const root = menuRef.current;
      if (root && !root.contains(event.target)) setMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const safeNotify = useCallback(
    (message, kind) => {
      try {
        notify?.(message, kind);
      } catch {
        /* notify 自身异常不应打断界面 */
      }
    },
    [notify],
  );

  /** 执行一次导入：busy 期间禁止重复点击，catch 后 error 提示 */
  const runImport = useCallback(
    async (label, fn) => {
      if (importing) return;
      setMenuOpen(false);
      if (typeof fn !== 'function') {
        safeNotify('该导入功能暂不可用', 'error');
        return;
      }
      setImporting(label);
      try {
        const result = await fn();
        if (result && result.canceled) return;
        if (result && Array.isArray(result.assets)) {
          const count = result.assets.length;
          if (count > 0) safeNotify(`已导入 ${count} 个素材`, 'success');
          else safeNotify('未导入任何素材', 'info');
        } else {
          // 兼容调用方不返回 { assets } 的情况
          safeNotify('素材导入完成', 'success');
        }
      } catch (err) {
        safeNotify(err?.message || '导入素材失败', 'error');
      } finally {
        setImporting('');
      }
    },
    [importing, safeNotify],
  );

  const handleFilterChange = useCallback(
    (key) => {
      if (key === activeFilter) return;
      try {
        onFilterChange?.(key);
      } catch (err) {
        safeNotify(err?.message || '切换类型筛选失败', 'error');
      }
    },
    [activeFilter, onFilterChange, safeNotify],
  );

  const handleViewChange = useCallback(
    (nextView) => {
      if (nextView === activeView) return;
      try {
        onViewChange?.(nextView);
      } catch (err) {
        safeNotify(err?.message || '切换视图失败', 'error');
      }
    },
    [activeView, onViewChange, safeNotify],
  );

  const handleQueryChange = useCallback(
    (value) => {
      try {
        onQueryChange?.(value);
      } catch (err) {
        safeNotify(err?.message || '搜索失败', 'error');
      }
    },
    [onQueryChange, safeNotify],
  );

  const handleSelect = useCallback(
    (asset) => {
      try {
        onSelectAsset?.(asset);
      } catch (err) {
        safeNotify(err?.message || '选择素材失败', 'error');
      }
    },
    [onSelectAsset, safeNotify],
  );

  /** 删除素材：二次确认后交给 onRemoveAsset（主进程删文件） */
  const handleRemove = useCallback(
    async (event, asset) => {
      event.stopPropagation();
      if (removingId) return;
      if (typeof onRemoveAsset !== 'function') {
        safeNotify('删除功能暂不可用', 'error');
        return;
      }
      const name = asset?.name || asset?.id || '未命名';
      const confirmed = window.confirm(
        `确定删除素材「${name}」？将同时删除磁盘文件，且引用它的节点/时间轴会失效。`,
      );
      if (!confirmed) return;
      setRemovingId(asset.id);
      try {
        await onRemoveAsset(asset);
      } catch (err) {
        safeNotify(err?.message || '删除素材失败', 'error');
      } finally {
        setRemovingId('');
      }
    },
    [removingId, onRemoveAsset, safeNotify],
  );

  const renderItem = (item) => {
    const { asset, kind } = item;
    const selected = Boolean(asset?.id) && asset.id === selectedAssetId;
    const roleLabel = assetRoleLabel(asset, kind);
    const meta = assetMetaText(asset, kind);
    const displayName = asset?.name || asset?.id || '未命名素材';
    return (
      <div
        className={`vn-asset-item vn-asset-item--${activeView}${selected ? ' is-selected' : ''}`}
        key={asset?.id || displayName}
      >
        <button
          type="button"
          className="vn-asset-item__main"
          onClick={() => handleSelect(asset)}
          title={`${displayName}  ·  ${asset?.id || ''}（可拖到蓝图）`}
          aria-pressed={selected}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(
              'application/x-vn-asset',
              JSON.stringify({ assetId: asset.id, kind, role: asset.role ?? null }),
            );
            event.dataTransfer.effectAllowed = 'copy';
          }}
        >
          <span className={`vn-asset-item__thumb vn-asset-item__thumb--${kind}`}>
            {kind === 'image' ? (
              <ImageThumb projectDir={projectDir} asset={asset} name={displayName} />
            ) : (
              <span className="vn-asset-thumb vn-asset-thumb--icon" aria-hidden="true">
                <KindIcon kind={kind} />
              </span>
            )}
          </span>
          <span className="vn-asset-item__info">
            <span className="vn-asset-item__name">{displayName}</span>
            <span className="vn-asset-item__meta">
              {roleLabel && <span className={`vn-asset-role vn-asset-role--${kind}`}>{roleLabel}</span>}
              <span className="vn-asset-item__meta-text">{meta}</span>
            </span>
          </span>
        </button>

        <button
          type="button"
          className="vn-asset-item__del"
          onClick={(event) => handleRemove(event, asset)}
          disabled={Boolean(removingId)}
          title={removingId === asset?.id ? '正在删除…' : `删除素材「${displayName}」`}
          aria-label={`删除素材 ${displayName}`}
        >
          <IconTrash />
        </button>
      </div>
    );
  };

  return (
    <div className="vn-asset-panel">
      <div className="vn-asset-head">
        <div className="vn-asset-head__title">
          <span>素材库</span>
          <span className="vn-asset-head__count" title="全部素材数量">
            {allItems.length}
          </span>
        </div>

        <div className="vn-asset-import" ref={menuRef}>
          <button
            type="button"
            className="vn-asset-add-btn"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={Boolean(importing)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="导入素材"
          >
            <span className="vn-asset-add-btn__plus" aria-hidden="true">
              +
            </span>
            {importing ? `导入中·${importing}` : '导入'}
          </button>

          {menuOpen && (
            <div className="vn-asset-menu" role="menu" aria-label="导入素材">
              <div className="vn-asset-menu__group" role="presentation">
                图片
              </div>
              {IMAGE_ROLES.map((role) => (
                <button
                  key={role.role}
                  type="button"
                  role="menuitem"
                  className="vn-asset-menu__item"
                  onClick={() =>
                    runImport(`图片·${role.label}`, () =>
                      onImportImages?.(role.role),
                    )
                  }
                >
                  <span className="vn-asset-menu__item-label">{role.label}</span>
                  <span className="vn-asset-menu__item-desc">{role.desc}</span>
                </button>
              ))}

              <div className="vn-asset-menu__group" role="presentation">
                音频
              </div>
              {AUDIO_ROLES.map((role) => (
                <button
                  key={role.role}
                  type="button"
                  role="menuitem"
                  className="vn-asset-menu__item"
                  onClick={() =>
                    runImport(`音频·${role.label}`, () =>
                      onImportAudio?.(role.role),
                    )
                  }
                >
                  <span className="vn-asset-menu__item-label">{role.label}</span>
                  <span className="vn-asset-menu__item-desc">{role.desc}</span>
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className="vn-asset-menu__item"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenAudioStudio?.();
                }}
              >
                <span className="vn-asset-menu__item-label">制作音频…</span>
                <span className="vn-asset-menu__item-desc">内置合成器生成 BGM / 音效</span>
              </button>

              <div className="vn-asset-menu__sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="vn-asset-menu__item"
                onClick={() => runImport('视频', onImportVideos)}
              >
                <span className="vn-asset-menu__item-label">视频</span>
                <span className="vn-asset-menu__item-desc">mp4 / webm 实拍或动画</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="vn-asset-menu__item"
                onClick={() => runImport('小游戏', onImportMinigames)}
              >
                <span className="vn-asset-menu__item-label">小游戏</span>
                <span className="vn-asset-menu__item-desc">自包含 HTML5（需 window.MINIGAME_EXITS）</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="vn-asset-search">
        <span className="vn-asset-search__icon" aria-hidden="true">
          <IconSearch />
        </span>
        <input
          className="vn-asset-search__input"
          type="text"
          value={query ?? ''}
          placeholder="搜索名称或 ID"
          aria-label="搜索素材"
          onChange={(event) => handleQueryChange(event.target.value)}
        />
        {String(query ?? '').length > 0 && (
          <button
            type="button"
            className="vn-asset-search__clear"
            title="清空搜索"
            aria-label="清空搜索"
            onClick={() => handleQueryChange('')}
          >
            ×
          </button>
        )}
      </div>

      <div className="vn-asset-tabs" role="tablist" aria-label="素材类型筛选">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeFilter === tab.key}
            className={`vn-asset-tab${activeFilter === tab.key ? ' is-active' : ''}`}
            onClick={() => handleFilterChange(tab.key)}
            title={`${tab.label}（${counts[tab.key] ?? 0}）`}
          >
            {tab.label}
            <span className="vn-asset-tab__count">{counts[tab.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="vn-asset-toolbar">
        <span className="vn-asset-toolbar__stats">
          显示 {visibleItems.length} / {allItems.length}
        </span>
        <div className="vn-asset-view" role="group" aria-label="视图切换">
          <button
            type="button"
            className={`vn-asset-view__btn${activeView === 'list' ? ' is-active' : ''}`}
            onClick={() => handleViewChange('list')}
            aria-pressed={activeView === 'list'}
            title="列表视图"
            aria-label="列表视图"
          >
            <IconList />
          </button>
          <button
            type="button"
            className={`vn-asset-view__btn${activeView === 'grid' ? ' is-active' : ''}`}
            onClick={() => handleViewChange('grid')}
            aria-pressed={activeView === 'grid'}
            title="网格视图"
            aria-label="网格视图"
          >
            <IconGrid />
          </button>
        </div>
      </div>

      <div className={`vn-asset-list vn-asset-list--${activeView}`}>
        {visibleItems.length === 0 ? (
          <p className="vn-asset-empty">
            {allItems.length === 0
              ? '素材库是空的。点击右上角「导入」，添加背景、立绘、音乐、视频或小游戏。'
              : '没有匹配的素材。试试清空搜索或切换类型筛选。'}
          </p>
        ) : (
          visibleItems.map(renderItem)
        )}
      </div>

      <div className="vn-asset-lower">
        <LeftBottomPanels
          project={project}
          activePanel={lowerPanel}
          onPanelChange={onLowerPanelChange}
          onVariablesChange={onVariablesChange}
          onSelectAssetById={onSelectAssetById}
          notify={notify}
        />
      </div>
    </div>
  );
}
