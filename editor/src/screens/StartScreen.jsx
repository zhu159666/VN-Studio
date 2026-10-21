/**
 * StartScreen —— 开始界面（阶段二）
 *
 * 四入口固定顺序：创建项目 / 音乐管理 / 立绘·背景管理 / 打包（阶段 6 占位）。
 * 本组件不直接调用 IPC：所有动作都通过 props 交给 App（Lead）。
 * 创建项目的 modal 内部完成标题 + 分辨率校验，再交给 onCreateProject。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import '../styles/start.css';

/** 分辨率预设（自定义范围与 schema settings.resolution 一致） */
const RESOLUTION_PRESETS = [
  { key: '1280x720', label: '1280 × 720', hint: '16:9 · 默认', width: 1280, height: 720 },
  { key: '1920x1080', label: '1920 × 1080', hint: '16:9 · 全高清', width: 1920, height: 1080 },
  { key: '720x1280', label: '720 × 1280', hint: '9:16 · 竖屏', width: 720, height: 1280 },
  { key: '800x600', label: '800 × 600', hint: '4:3 · 兼容', width: 800, height: 600 },
  { key: 'custom', label: '自定义', hint: '手动输入宽高' },
];

const WIDTH_MIN = 320;
const WIDTH_MAX = 7680;
const HEIGHT_MIN = 240;
const HEIGHT_MAX = 4320;

/* ───────────── inline SVG 图标（不引第三方图标库） ───────────── */

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

function IconCreate() {
  return (
    <svg {...strokeProps} width="24" height="24">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}

function IconAudio() {
  return (
    <svg {...strokeProps} width="24" height="24">
      <path d="M9 17V5l10-2v12" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg {...strokeProps} width="24" height="24">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M21 16l-5-5-6 6-3-3-4 4" />
    </svg>
  );
}

function IconPackage() {
  return (
    <svg {...strokeProps} width="24" height="24">
      <path d="M21 8.2 12 3 3 8.2l9 5.1 9-5.1z" />
      <path d="M3 8.2v7.9l9 5.1 9-5.1V8.2" />
      <path d="M12 13.3v8" />
    </svg>
  );
}

function IconOk() {
  return (
    <svg {...strokeProps} width="14" height="14">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconWarn() {
  return (
    <svg {...strokeProps} width="14" height="14">
      <path d="M12 3 2.4 20h19.2L12 3z" />
      <path d="M12 9v5M12 17.5v.01" />
    </svg>
  );
}

/* ───────────── 小工具 ───────────── */

/** 本地化更新时间；非法值降级为占位文案 */
function formatUpdatedAt(value) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  try {
    return date.toLocaleString('zh-CN');
  } catch {
    return date.toISOString();
  }
}

/** 从绝对路径兜底取项目名 */
function projectNameFromPath(projectPath) {
  const parts = String(projectPath || '').split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '未命名项目';
}

export default function StartScreen({
  appInfo,
  recentProjects,
  busy = false,
  onCreateProject,
  onOpenProject,
  onOpenRecent,
  onOpenAssetManager,
  onOpenPackaging,
  // 契约外可选：最近项目移除按钮，未传则隐藏
  onRemoveRecent,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState('未命名项目');
  const [presetKey, setPresetKey] = useState('1280x720');
  const [customWidth, setCustomWidth] = useState('1280');
  const [customHeight, setCustomHeight] = useState('720');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const titleRef = useRef(null);

  const recent = Array.isArray(recentProjects) ? recentProjects : [];
  const ffmpegKnown = appInfo != null;
  const ffmpegWarning = ffmpegKnown && appInfo.ffmpegAvailable === false;
  const modalBusy = busy || submitting;

  // 计算当前选择的输出分辨率；自定义非法时返回 null
  const resolution = (() => {
    if (presetKey === 'custom') {
      const width = Number(customWidth);
      const height = Number(customHeight);
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < WIDTH_MIN ||
        width > WIDTH_MAX ||
        height < HEIGHT_MIN ||
        height > HEIGHT_MAX
      ) {
        return null;
      }
      return { width, height };
    }
    const preset = RESOLUTION_PRESETS.find((item) => item.key === presetKey) || RESOLUTION_PRESETS[0];
    return { width: preset.width, height: preset.height };
  })();

  const closeModal = useCallback(() => {
    if (modalBusy) return;
    setModalOpen(false);
    setFormError('');
  }, [modalBusy]);

  const openCreateModal = useCallback(() => {
    if (busy) return;
    setTitle('未命名项目');
    setPresetKey('1280x720');
    setCustomWidth('1280');
    setCustomHeight('720');
    setFormError('');
    setModalOpen(true);
  }, [busy]);

  // 打开 modal 后自动聚焦并全选默认标题；Esc 关闭（busy 时不可关）
  useEffect(() => {
    if (!modalOpen) return undefined;
    const input = titleRef.current;
    if (input) {
      input.focus();
      input.select();
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !modalBusy) {
        setModalOpen(false);
        setFormError('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalOpen, modalBusy]);

  const handleCreate = useCallback(async () => {
    if (busy || submitting) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setFormError('请输入项目标题');
      return;
    }
    if (cleanTitle.length > 200) {
      setFormError('项目标题不能超过 200 个字符');
      return;
    }
    if (!resolution) {
      setFormError(`自定义分辨率需在 ${WIDTH_MIN}–${WIDTH_MAX} × ${HEIGHT_MIN}–${HEIGHT_MAX} 范围内`);
      return;
    }
    if (typeof onCreateProject !== 'function') {
      setFormError('创建项目功能暂不可用');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await onCreateProject({ title: cleanTitle, resolution });
      setModalOpen(false);
    } catch (err) {
      setFormError(err?.message || '创建项目失败');
    } finally {
      setSubmitting(false);
    }
  }, [busy, submitting, title, resolution, onCreateProject]);

  /** 卡片/按钮的通用兜底：捕获错误并显示在开始界面 */
  const runAction = useCallback(
    async (fn, fallback) => {
      if (busy) return;
      setActionError('');
      if (typeof fn !== 'function') {
        setActionError('该功能暂不可用');
        return;
      }
      try {
        await fn();
      } catch (err) {
        setActionError(err?.message || fallback);
      }
    },
    [busy],
  );

  const handleOpenRecent = useCallback(
    async (projectPath) => {
      if (busy) return;
      setActionError('');
      if (typeof onOpenRecent !== 'function') {
        setActionError('打开最近项目功能暂不可用');
        return;
      }
      try {
        await onOpenRecent(projectPath);
      } catch (err) {
        setActionError(err?.message || '打开最近项目失败');
      }
    },
    [busy, onOpenRecent],
  );

  const handleRemoveRecent = useCallback(
    async (event, projectPath) => {
      event.stopPropagation();
      if (busy || typeof onRemoveRecent !== 'function') return;
      setActionError('');
      try {
        await onRemoveRecent(projectPath);
      } catch (err) {
        setActionError(err?.message || '移除最近项目失败');
      }
    },
    [busy, onRemoveRecent],
  );

  return (
    <div className="vn-start-screen">
      <header className="vn-start-top">
        <div className="vn-start-brand">
          <div className="vn-start-wordmark">
            VN<span>STUDIO</span>
          </div>
          <div className="vn-start-subtitle">桌面视觉小说创作套件</div>
          <div className="vn-start-tagline">本地项目 · 蓝图叙事 · 浏览器运行时</div>
        </div>

        <div className="vn-start-status">
          <span className="vn-start-version" title="编辑器版本">
            v{appInfo?.version || '0.0.0'}
          </span>
          {!ffmpegKnown ? (
            <span className="vn-start-ffmpeg vn-start-ffmpeg--unknown" title="正在检测 ffmpeg">
              ffmpeg 检测中…
            </span>
          ) : ffmpegWarning ? (
            <span className="vn-start-ffmpeg vn-start-ffmpeg--warn" title="素材音频 / 视频处理需要 ffmpeg">
              <IconWarn />
              ffmpeg 未就绪
            </span>
          ) : (
            <span className="vn-start-ffmpeg vn-start-ffmpeg--ok" title="音频 / 视频素材处理可用">
              <IconOk />
              ffmpeg 就绪
            </span>
          )}
        </div>
      </header>

      {ffmpegWarning && (
        <div className="vn-start-warnbar" role="alert">
          未检测到 ffmpeg：素材音频 / 视频处理需要 ffmpeg，请安装并加入 PATH 后重新启动编辑器。
        </div>
      )}

      {actionError && (
        <div className="vn-start-alert" role="alert">
          {actionError}
        </div>
      )}

      <main className="vn-start-main">
        <div className="vn-start-cards">
          <button
            type="button"
            className="vn-start-card vn-start-card--primary"
            onClick={openCreateModal}
            disabled={busy}
            title="新建一个本地项目"
          >
            <span className="vn-start-card__icon">
              <IconCreate />
            </span>
            <span className="vn-start-card__title">创建项目</span>
            <span className="vn-start-card__desc">选择目录，生成 project.json 与素材目录</span>
          </button>

          <button
            type="button"
            className="vn-start-card"
            onClick={() => runAction(typeof onOpenAssetManager === 'function' ? () => onOpenAssetManager('audio') : null, '打开音乐管理失败')}
            disabled={busy}
            title="管理音乐与音效素材"
          >
            <span className="vn-start-card__icon">
              <IconAudio />
            </span>
            <span className="vn-start-card__title">音乐管理</span>
            <span className="vn-start-card__desc">BGM · 音效 · 语音的导入与整理</span>
          </button>

          <button
            type="button"
            className="vn-start-card"
            onClick={() => runAction(typeof onOpenAssetManager === 'function' ? () => onOpenAssetManager('image') : null, '打开立绘 / 背景管理失败')}
            disabled={busy}
            title="管理立绘与背景素材"
          >
            <span className="vn-start-card__icon">
              <IconImage />
            </span>
            <span className="vn-start-card__title">立绘 / 背景管理</span>
            <span className="vn-start-card__desc">背景 · 立绘 · UI 图片素材</span>
          </button>

          <button
            type="button"
            className="vn-start-card"
            onClick={() => runAction(onOpenPackaging, '打开打包功能失败')}
            disabled={busy}
            title="导出可部署的静态 Web 包"
          >
            <span className="vn-start-card__badge">Web</span>
            <span className="vn-start-card__icon">
              <IconPackage />
            </span>
            <span className="vn-start-card__title">打包</span>
            <span className="vn-start-card__desc">导出 index.html + assets + game.json</span>
          </button>
        </div>

        <section className="vn-start-recent" aria-label="最近项目">
          <div className="vn-start-recent__head">
            <h2>最近项目</h2>
            <span className="vn-start-recent__count">{recent.length}</span>
          </div>

          {recent.length === 0 ? (
            <p className="vn-start-empty">还没有最近项目，先创建一个。</p>
          ) : (
            <ul className="vn-start-recent__list">
              {recent.map((item) => {
                const projectPath = item?.projectPath || '';
                const missing = Boolean(item?.missing);
                return (
                  <li
                    key={projectPath || item?.title}
                    className={`vn-start-recent__item${missing ? ' is-missing' : ''}`}
                  >
                    <button
                      type="button"
                      className="vn-start-recent__open"
                      onClick={() => handleOpenRecent(projectPath)}
                      disabled={busy}
                      title={missing ? '项目文件已丢失' : `打开 ${projectPath}`}
                    >
                      <span className="vn-start-recent__title">
                        {item?.title || projectNameFromPath(projectPath)}
                        {missing && <span className="vn-start-recent__badge">已丢失</span>}
                      </span>
                      <span className="vn-start-recent__path">{projectPath}</span>
                      <span className="vn-start-recent__meta">{formatUpdatedAt(item?.updatedAt)}</span>
                    </button>

                    {typeof onRemoveRecent === 'function' && (
                      <button
                        type="button"
                        className="vn-start-recent__remove"
                        onClick={(event) => handleRemoveRecent(event, projectPath)}
                        disabled={busy}
                        title="从最近项目列表移除"
                        aria-label={`从最近项目列表移除 ${item?.title || projectPath}`}
                      >
                        <svg {...strokeProps} width="14" height="14">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <footer className="vn-start-footer">
        <span className="vn-start-footer__hint">
          <kbd>Ctrl</kbd>+<kbd>O</kbd> 打开项目
        </span>
        <span className="vn-start-footer__hint">
          <kbd>Ctrl</kbd>+<kbd>N</kbd> 新建项目
        </span>
        <span className="vn-start-footer__note">所有数据保存在本地项目目录</span>
      </footer>

      {modalOpen && (
        <div
          className="vn-start-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div
            className="vn-start-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vn-start-modal-title"
          >
            <div className="vn-start-modal__head">
              <h2 id="vn-start-modal-title">创建项目</h2>
              <p>确认后主进程会弹出目录选择框，并在所选目录下生成项目文件夹。</p>
            </div>

            <label className="vn-start-field">
              <span className="vn-start-field__label">项目标题</span>
              <input
                ref={titleRef}
                className="vn-start-input"
                type="text"
                value={title}
                maxLength={200}
                placeholder="给项目起个名字"
                disabled={modalBusy}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (formError) setFormError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleCreate();
                  }
                }}
              />
              <span className="vn-start-field__hint">{title.length}/200</span>
            </label>

            <div className="vn-start-field">
              <span className="vn-start-field__label">分辨率</span>
              <div className="vn-start-presets" role="group" aria-label="分辨率预设">
                {RESOLUTION_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className={`vn-start-preset${presetKey === preset.key ? ' is-active' : ''}`}
                    onClick={() => setPresetKey(preset.key)}
                    disabled={modalBusy}
                    aria-pressed={presetKey === preset.key}
                  >
                    <span className="vn-start-preset__label">{preset.label}</span>
                    <span className="vn-start-preset__hint">{preset.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {presetKey === 'custom' && (
              <div className="vn-start-custom">
                <label className="vn-start-custom__field">
                  <span>宽度</span>
                  <input
                    className="vn-start-input"
                    type="number"
                    min={WIDTH_MIN}
                    max={WIDTH_MAX}
                    step={1}
                    value={customWidth}
                    disabled={modalBusy}
                    onChange={(event) => {
                      setCustomWidth(event.target.value);
                      if (formError) setFormError('');
                    }}
                  />
                </label>
                <span className="vn-start-custom__times">×</span>
                <label className="vn-start-custom__field">
                  <span>高度</span>
                  <input
                    className="vn-start-input"
                    type="number"
                    min={HEIGHT_MIN}
                    max={HEIGHT_MAX}
                    step={1}
                    value={customHeight}
                    disabled={modalBusy}
                    onChange={(event) => {
                      setCustomHeight(event.target.value);
                      if (formError) setFormError('');
                    }}
                  />
                </label>
              </div>
            )}

            <p className="vn-start-modal__summary">
              {resolution ? `输出画布：${resolution.width} × ${resolution.height}` : '输出画布：分辨率无效'}
            </p>
            <p className="vn-start-modal__tips">
              画布分辨率创建后写入项目设置，后续可在项目设置中查看。
            </p>

            {formError && (
              <p className="vn-start-modal__error" role="alert">
                {formError}
              </p>
            )}

            <div className="vn-start-modal__actions">
              <button
                type="button"
                className="vn-start-btn"
                onClick={closeModal}
                disabled={modalBusy}
              >
                取消
              </button>
              <button
                type="button"
                className="vn-start-btn vn-start-btn--primary"
                onClick={handleCreate}
                disabled={modalBusy}
              >
                {submitting ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
