/**
 * VN Studio 浏览器运行时 UI（stage 5）。
 *
 * 纯 ESM / 原生 DOM + Canvas，不依赖编辑器、React 或 Electron：
 * - Canvas 舞台：按项目分辨率绘制背景 / 立绘 / UI 图 / 文本框 / 逐字台词；
 * - 交互：点击 / Space / Enter 推进，选项 DOM 按钮 + 数字键，小游戏 iframe，视频覆盖层；
 * - 音频：BGM / 语音 / 音效全部用 HTMLAudioElement；
 * - 存档：IndexedDB（storage.js），标题界面 / 存档菜单 / 结束界面。
 *
 * 只 import './engine.js' 与 './storage.js'。
 */

import * as engineModule from './engine.js';
import { createIndexedDbStorage } from './storage.js';

const FONT_STACK =
  '"Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif';

const ENGINE_STATUS = engineModule.ENGINE_STATUS || {
  RUNNING: 'running',
  ENDED: 'ended',
  ERROR: 'error',
};

const DEFAULT_TEXTBOX = Object.freeze({
  x: 0.5,
  y: 0.84,
  width: 0.92,
  height: 0.22,
  fontSizePx: 28,
  color: '#ffffff',
  background: '#000000',
  backgroundOpacity: 0.55,
  opacity: 1,
});

const SAVE_SLOTS = [
  { kind: 'auto', slot: 0, label: '自动存档', readonly: true },
  { kind: 'quick', slot: 0, label: '快速存档', readonly: false },
  ...Array.from({ length: 9 }, (_, index) => ({
    kind: 'manual',
    slot: index + 1,
    label: `手动存档 ${index + 1}`,
    readonly: false,
  })),
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function makeButton(label, variant, onClick) {
  const button = el('button', `vnrt-btn${variant ? ` vnrt-btn--${variant}` : ''}`, label);
  button.type = 'button';
  if (typeof onClick === 'function') button.addEventListener('click', onClick);
  return button;
}

function asNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value, fallback = 1) {
  return clamp(asNumber(value, fallback), 0, 1);
}

function truncate(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// ---------------------------------------------------------------------------
// 界面材质（settings.uiSkin / 场景 textbox.material / choice.material）
// ---------------------------------------------------------------------------

const MATERIAL_MODES = new Set(['stretch', 'cover', 'contain']);

function normalizeMaterial(source) {
  if (!source || typeof source !== 'object') return null;
  const material = {};
  if (typeof source.imageAssetId === 'string' && source.imageAssetId) {
    material.imageAssetId = source.imageAssetId;
  }
  if (MATERIAL_MODES.has(source.imageMode)) material.imageMode = source.imageMode;
  if (source.imageOpacity !== null && source.imageOpacity !== undefined) {
    material.imageOpacity = clamp01(source.imageOpacity, 1);
  }
  if (typeof source.borderColor === 'string' && source.borderColor) {
    material.borderColor = source.borderColor;
  }
  if (source.borderWidthPx !== null && source.borderWidthPx !== undefined) {
    material.borderWidthPx = clamp(asNumber(source.borderWidthPx, 0), 0, 24);
  }
  if (source.borderRadiusPx !== null && source.borderRadiusPx !== undefined) {
    material.borderRadiusPx = clamp(asNumber(source.borderRadiusPx, 0), 0, 120);
  }
  if (typeof source.textColor === 'string' && source.textColor) material.textColor = source.textColor;
  if (source.gapPx !== null && source.gapPx !== undefined) {
    material.gapPx = clamp(asNumber(source.gapPx, 0), 0, 60);
  }
  if (typeof source.hoverBackgroundColor === 'string' && source.hoverBackgroundColor) {
    material.hoverBackgroundColor = source.hoverBackgroundColor;
  }
  if (typeof source.hoverBorderColor === 'string' && source.hoverBorderColor) {
    material.hoverBorderColor = source.hoverBorderColor;
  }
  return Object.keys(material).length ? material : null;
}

function materialBackgroundSize(mode) {
  if (mode === 'cover') return 'cover';
  if (mode === 'contain') return 'contain';
  return '100% 100%';
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(asNumber(ms, 0)));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatSavedAt(value) {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function roundRectPath(context, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

/**
 * 创建运行时实例。
 * @param {object} options
 * @param {HTMLElement} options.root
 * @param {object} options.project schema 根对象（game.json）
 * @param {string} [options.assetBaseUrl]
 * @param {((relativePath: string) => (string|Promise<string>))|null} [options.resolveAssetUrl]
 * @param {object|null} [options.storage]
 * @param {boolean} [options.autoStart]
 * @param {boolean} [options.showTitle]
 * @param {boolean} [options.muted] 静音预览（编辑器浮动小窗使用；不影响正常播放器）
 * @param {boolean} [options.keyboard] 是否绑定全局键盘（Space/Enter/数字选择/方向键）；浮动小窗应传 false
 * @param {((state: object) => void)|null} [options.onStateChange]
 */
export function createRuntime(options = {}) {
  const {
    root,
    project,
    assetBaseUrl = './',
    resolveAssetUrl = null,
    storage: providedStorage = null,
    autoStart = false,
    showTitle = true,
    muted = false,
    keyboard = true,
    onStateChange = null,
  } = options || {};
  const silent = muted === true;

  if (typeof document === 'undefined') {
    throw new Error('createRuntime：当前环境没有 DOM，无法启动浏览器运行时');
  }
  if (!root || typeof root.appendChild !== 'function') {
    throw new Error('createRuntime：root 必须是 HTMLElement');
  }
  if (!project || typeof project !== 'object' || !Array.isArray(project.nodes)) {
    throw new Error('createRuntime：缺少有效的项目对象（nodes 数组）');
  }

  const settings = project.settings || {};
  const resolution = {
    width: Math.max(320, Math.round(asNumber(settings.resolution?.width, 1280))),
    height: Math.max(240, Math.round(asNumber(settings.resolution?.height, 720))),
  };
  const stageWidth = resolution.width;
  const stageHeight = resolution.height;
  const projectId = project.meta?.id || 'unknown-project';
  const projectTitle = project.meta?.title || '未命名项目';
  const startNodeId = settings.startNodeId ?? null;
  const uiSkin = settings.uiSkin && typeof settings.uiSkin === 'object' ? settings.uiSkin : {};

  const imageAssets = new Map();
  const audioAssets = new Map();
  const videoAssets = new Map();
  const minigameAssets = new Map();
  for (const asset of project.assets?.images || []) {
    if (asset?.id) imageAssets.set(asset.id, asset);
  }
  for (const asset of project.assets?.audio || []) {
    if (asset?.id) audioAssets.set(asset.id, asset);
  }
  for (const asset of project.assets?.videos || []) {
    if (asset?.id) videoAssets.set(asset.id, asset);
  }
  for (const asset of project.assets?.minigames || []) {
    if (asset?.id) minigameAssets.set(asset.id, asset);
  }

  // ---------------------------------------------------------------------------
  // 基础 DOM
  // ---------------------------------------------------------------------------

  const wrap = el('div', 'vnrt-root');
  const frame = el('div', 'vnrt-frame vnrt-stage');
  const canvas = document.createElement('canvas');
  canvas.className = 'vnrt-canvas';
  canvas.width = stageWidth;
  canvas.height = stageHeight;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '视觉小说舞台');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('createRuntime：无法创建 Canvas 2D 绘图上下文');

  frame.append(canvas);
  wrap.append(frame);
  root.append(wrap);

  const topbar = el('div', 'vnrt-topbar');
  const menuButton = makeButton('菜单', 'small', () => openSaveMenu());
  menuButton.classList.add('vnrt-menu-btn');
  menuButton.title = '打开存档菜单';
  topbar.append(menuButton);
  frame.append(topbar);

  // 标题界面
  const titleOverlay = el('div', 'vnrt-title');
  titleOverlay.hidden = true;
  const titleCard = el('div', 'vnrt-title__card');
  const titleHeading = el('h1', 'vnrt-title__title', projectTitle);
  const authorText = project.meta?.author ? `作者：${project.meta.author}` : '';
  const titleAuthor = el('div', 'vnrt-title__author', authorText);
  titleAuthor.hidden = !authorText;
  const descriptionText = project.meta?.description || '';
  const titleDescription = el('p', 'vnrt-title__desc', descriptionText);
  titleDescription.hidden = !descriptionText;
  const titleActions = el('div', 'vnrt-title__actions');
  const startButton = makeButton('开始游戏', 'primary', () => startNewGame());
  const continueButton = makeButton('继续（自动存档）', '', () => {
    continueAuto();
  });
  const titleLoadButton = makeButton('读取存档', '', () => openSaveMenu('load'));
  titleActions.append(startButton, continueButton, titleLoadButton);
  const titleHint = el('div', 'vnrt-title__hint');
  titleCard.append(titleHeading, titleAuthor, titleDescription, titleActions, titleHint);
  titleOverlay.append(titleCard);
  frame.append(titleOverlay);

  // 结束 / 错误界面
  const endOverlay = el('div', 'vnrt-ended');
  endOverlay.hidden = true;
  const endCard = el('div', 'vnrt-ended__card');
  const endHeading = el('h2', 'vnrt-ended__title', '已到结尾');
  const endMessage = el('p', 'vnrt-ended__message', '');
  const endActions = el('div', 'vnrt-ended__actions');
  const restartButton = makeButton('重新开始', 'primary', () => startNewGame());
  const backTitleButton = makeButton('返回标题', '', () => showTitleScreen());
  endActions.append(restartButton, backTitleButton);
  endCard.append(endHeading, endMessage, endActions);
  endOverlay.append(endCard);
  frame.append(endOverlay);

  // 存档菜单
  const menuOverlay = el('div', 'vnrt-menu');
  menuOverlay.hidden = true;
  const menuPanel = el('div', 'vnrt-menu__panel');
  const menuHead = el('div', 'vnrt-menu__head');
  const menuHeading = el('h2', 'vnrt-menu__heading', '存档');
  const menuClose = makeButton('×', 'small', () => closeSaveMenu());
  menuClose.classList.add('vnrt-menu__close');
  menuClose.title = '关闭';
  menuHead.append(menuHeading, menuClose);
  const menuTabs = el('div', 'vnrt-menu__tabs');
  const saveTabButton = el('button', 'vnrt-menu__tab is-active', '保存');
  saveTabButton.type = 'button';
  const loadTabButton = el('button', 'vnrt-menu__tab', '读取');
  loadTabButton.type = 'button';
  menuTabs.append(saveTabButton, loadTabButton);
  const menuStatusEl = el('div', 'vnrt-menu__status');
  const menuGrid = el('div', 'vnrt-menu__grid');
  const menuFoot = el(
    'div',
    'vnrt-menu__foot',
    '手动 / 快速槽位可覆盖保存；自动存档只读。读取会立即恢复变量与场景进度。',
  );
  menuPanel.append(menuHead, menuTabs, menuStatusEl, menuGrid, menuFoot);
  menuOverlay.append(menuPanel);
  frame.append(menuOverlay);

  // 二次确认
  const confirmOverlay = el('div', 'vnrt-confirm');
  confirmOverlay.hidden = true;
  const confirmCard = el('div', 'vnrt-confirm__card');
  const confirmMessage = el('p', 'vnrt-confirm__message', '');
  const confirmActions = el('div', 'vnrt-confirm__actions');
  const confirmCancel = makeButton('取消', '', () => settleConfirm(false));
  const confirmOk = makeButton('确认', 'danger', () => settleConfirm(true));
  confirmActions.append(confirmCancel, confirmOk);
  confirmCard.append(confirmMessage, confirmActions);
  confirmOverlay.append(confirmCard);
  frame.append(confirmOverlay);

  // 提示条
  const toastEl = el('div', 'vnrt-toast');

  // ---------------------------------------------------------------------------
  // 运行时状态
  // ---------------------------------------------------------------------------

  let engine = null;
  let engineBroken = false;
  let destroyed = false;
  let phase = 'loading'; // loading | title | playing
  let halted = false;
  let lastState = null;
  let lastNodeId = null;
  let lastEmitted = null;
  let lastRenderTimestamp = 0;
  let rafId = 0;
  let typing = { nodeId: null, full: '', shown: 0, speed: 0, done: false };
  let autoAdvanceTimer = null;
  let menuOpen = false;
  let menuTab = 'save';
  let menuListToken = 0;
  let saveIndex = new Map();
  let confirmResolve = null;
  let choiceSession = null;
  let minigameSession = null;
  let videoSession = null;
  let bgm = null;
  let voiceAudio = null;
  let voiceKey = null;
  let sfxAudios = [];
  let suppressAutoSaveOnce = false;
  let audioUnlocked = false;
  let toastTimer = null;
  let endKind = null;
  let endMessageValue = '';

  // 存档后端：默认 IndexedDB；不支持时保留错误信息供 UI 提示
  let storage = providedStorage || null;
  let storageError = '';
  if (!storage) {
    try {
      storage = createIndexedDbStorage();
    } catch (error) {
      storage = null;
      storageError = error?.message || String(error);
      console.warn(`[runtime] 存档功能不可用：${storageError}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 资源 URL / 图片缓存
  // ---------------------------------------------------------------------------

  const urlCache = new Map();
  const urlPending = new Map();
  let baseUrl = assetBaseUrl;
  try {
    baseUrl = new URL(assetBaseUrl, document.baseURI).href;
  } catch {
    baseUrl = assetBaseUrl;
  }

  function resolveUrl(relativePath) {
    if (typeof relativePath !== 'string' || relativePath === '') return Promise.resolve('');
    if (urlCache.has(relativePath)) return Promise.resolve(urlCache.get(relativePath));
    if (urlPending.has(relativePath)) return urlPending.get(relativePath);
    const pending = (async () => {
      let url = '';
      try {
        if (typeof resolveAssetUrl === 'function') {
          const value = await resolveAssetUrl(relativePath);
          if (typeof value === 'string') url = value;
        } else {
          url = new URL(relativePath, baseUrl).href;
        }
      } catch (error) {
        console.warn(`[runtime] 资源地址解析失败：${relativePath}`, error);
      }
      if (!url) console.warn(`[runtime] 资源地址为空：${relativePath}`);
      urlCache.set(relativePath, url);
      urlPending.delete(relativePath);
      return url;
    })();
    urlPending.set(relativePath, pending);
    return pending;
  }

  const imageEntries = new Map();
  const warnedMissingImages = new Set();

  function ensureImage(assetId) {
    if (!assetId) return null;
    const asset = imageAssets.get(assetId);
    if (!asset) {
      if (!warnedMissingImages.has(assetId)) {
        warnedMissingImages.add(assetId);
        console.warn(`[runtime] 未找到图片素材：${assetId}`);
      }
      return null;
    }
    const existing = imageEntries.get(assetId);
    if (existing) return existing;
    const image = new Image();
    const entry = { asset, image, status: 'loading' };
    image.decoding = 'async';
    image.addEventListener('load', () => {
      entry.status = 'ready';
    });
    image.addEventListener('error', () => {
      entry.status = 'error';
      console.warn(`[runtime] 图片加载失败：${asset.path}`);
    });
    imageEntries.set(assetId, entry);
    resolveUrl(asset.path).then((url) => {
      if (!url) {
        entry.status = 'error';
        return;
      }
      image.src = url;
    });
    return entry;
  }

  function drawImageInBox(image, dx, dy, dw, dh, mode) {
    const iw = image.naturalWidth || image.width || 0;
    const ih = image.naturalHeight || image.height || 0;
    if (!iw || !ih || dw <= 0 || dh <= 0) return;
    if (!mode || mode === 'stretch') {
      context.drawImage(image, dx, dy, dw, dh);
      return;
    }
    const scale = mode === 'contain' ? Math.min(dw / iw, dh / ih) : Math.max(dw / iw, dh / ih);
    const width = iw * scale;
    const height = ih * scale;
    context.drawImage(image, dx + (dw - width) / 2, dy + (dh - height) / 2, width, height);
  }

  /** 给 DOM 面板挂材质：图片由 CSS 伪元素绘制，边框/圆角用内联样式。 */
  function applyMaterialToElement(element, source) {
    if (!element) return;
    const material = normalizeMaterial(source);
    element.classList.remove('vnrt-materialized');
    element.style.removeProperty('--vnrt-material-image');
    element.style.removeProperty('--vnrt-material-size');
    element.style.removeProperty('--vnrt-material-opacity');
    element.style.borderColor = '';
    element.style.borderWidth = '';
    element.style.borderRadius = '';
    if (!material) return;
    if (material.borderColor) element.style.borderColor = material.borderColor;
    if (material.borderWidthPx !== undefined) element.style.borderWidth = `${material.borderWidthPx}px`;
    if (material.borderRadiusPx !== undefined) element.style.borderRadius = `${material.borderRadiusPx}px`;
    const asset = material.imageAssetId ? imageAssets.get(material.imageAssetId) : null;
    if (!asset) return;
    element.classList.add('vnrt-materialized');
    element.style.setProperty('--vnrt-material-size', materialBackgroundSize(material.imageMode));
    element.style.setProperty('--vnrt-material-opacity', String(material.imageOpacity ?? 1));
    resolveUrl(asset.path).then((url) => {
      if (url) element.style.setProperty('--vnrt-material-image', `url("${url}")`);
    });
  }

  /** 标题界面整屏背景材质。 */
  function applyBackdropToElement(element, source) {
    if (!element) return;
    const material = normalizeMaterial(source);
    element.classList.remove('vnrt-materialized');
    element.style.removeProperty('--vnrt-material-image');
    element.style.removeProperty('--vnrt-material-size');
    element.style.removeProperty('--vnrt-material-opacity');
    if (!material) return;
    const asset = material.imageAssetId ? imageAssets.get(material.imageAssetId) : null;
    if (!asset) return;
    element.classList.add('vnrt-materialized');
    element.style.setProperty('--vnrt-material-size', materialBackgroundSize(material.imageMode));
    element.style.setProperty('--vnrt-material-opacity', String(material.imageOpacity ?? 1));
    resolveUrl(asset.path).then((url) => {
      if (url) element.style.setProperty('--vnrt-material-image', `url("${url}")`);
    });
  }

  /** 选项按钮材质：通过 CSS 变量作用于 overlay 下的所有按钮。 */
  function applyChoiceMaterial(overlay, source) {
    if (!overlay) return;
    const material = normalizeMaterial(source);
    if (!material) return;
    const style = overlay.style;
    if (material.borderColor) style.setProperty('--vnrt-choice-border', material.borderColor);
    if (material.borderWidthPx !== undefined) {
      style.setProperty('--vnrt-choice-border-width', `${material.borderWidthPx}px`);
    }
    if (material.borderRadiusPx !== undefined) {
      style.setProperty('--vnrt-choice-radius', `${material.borderRadiusPx}px`);
    }
    if (material.textColor) style.setProperty('--vnrt-choice-text', material.textColor);
    if (material.gapPx !== undefined) style.setProperty('--vnrt-choice-gap', `${material.gapPx}px`);
    if (material.hoverBackgroundColor) {
      style.setProperty('--vnrt-choice-hover-bg', material.hoverBackgroundColor);
    }
    if (material.hoverBorderColor) {
      style.setProperty('--vnrt-choice-hover-border', material.hoverBorderColor);
    }
    const asset = material.imageAssetId ? imageAssets.get(material.imageAssetId) : null;
    if (!asset) return;
    style.setProperty('--vnrt-choice-size', materialBackgroundSize(material.imageMode));
    style.setProperty('--vnrt-choice-image-opacity', String(material.imageOpacity ?? 1));
    resolveUrl(asset.path).then((url) => {
      if (url) style.setProperty('--vnrt-choice-image', `url("${url}")`);
    });
  }

  // ---------------------------------------------------------------------------
  // 舞台布局 / 绘制
  // ---------------------------------------------------------------------------

  function layout() {
    if (destroyed) return;
    const rect = root.getBoundingClientRect();
    const availableWidth = rect.width > 1 ? rect.width : Math.min(stageWidth, 1280);
    const availableHeight = rect.height > 1 ? rect.height : Math.min(stageHeight, 720);
    const ratio = stageWidth / stageHeight;
    let width = availableWidth;
    let height = width / ratio;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * ratio;
    }
    frame.style.width = `${Math.max(1, Math.round(width))}px`;
    frame.style.height = `${Math.max(1, Math.round(height))}px`;
    frame.style.left = `${Math.max(0, Math.round((availableWidth - width) / 2))}px`;
    frame.style.top = `${Math.max(0, Math.round((availableHeight - height) / 2))}px`;
  }

  let resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => layout());
    resizeObserver.observe(root);
  }
  window.addEventListener('resize', layout);
  layout();

  function drawMissingPlaceholder(cx, cy, width, height, label) {
    const x = cx - width / 2;
    const y = cy - height / 2;
    context.save();
    context.fillStyle = 'rgba(28, 34, 44, 0.72)';
    roundRectPath(context, x, y, Math.max(8, width), Math.max(8, height), 8);
    context.fill();
    context.strokeStyle = 'rgba(176, 128, 120, 0.7)';
    context.lineWidth = 1.5;
    context.setLineDash([6, 5]);
    roundRectPath(context, x, y, Math.max(8, width), Math.max(8, height), 8);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = '#c9aaa3';
    context.font = `${clamp(height * 0.1, 11, 16)}px ${FONT_STACK}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(truncate(label || '资源缺失', 40), cx, cy);
    context.restore();
  }

  function drawBackground(state) {
    const fallback = settings.backgroundColor || '#070b11';
    context.fillStyle = fallback;
    context.fillRect(0, 0, stageWidth, stageHeight);
    const background = state?.stage?.background;
    if (!background || !background.assetId) return;
    const entry = ensureImage(background.assetId);
    if (!entry) return;
    if (entry.status === 'error') {
      drawMissingPlaceholder(
        stageWidth / 2,
        stageHeight / 2,
        Math.min(stageWidth * 0.6, 720),
        Math.min(stageHeight * 0.32, 260),
        `背景缺失：${entry.asset?.path || background.assetId}`,
      );
      return;
    }
    if (entry.status !== 'ready') return;
    const imageWidth = entry.image.naturalWidth || entry.asset.width || stageWidth;
    const imageHeight = entry.image.naturalHeight || entry.asset.height || stageHeight;
    const fit =
      background.fit === 'contain' || background.fit === 'stretch' ? background.fit : 'cover';
    const scale = clamp(asNumber(background.scale, 1), 0.05, 10);
    let drawWidth;
    let drawHeight;
    if (fit === 'stretch') {
      drawWidth = stageWidth * scale;
      drawHeight = stageHeight * scale;
    } else {
      const base =
        fit === 'cover'
          ? Math.max(stageWidth / imageWidth, stageHeight / imageHeight)
          : Math.min(stageWidth / imageWidth, stageHeight / imageHeight);
      drawWidth = imageWidth * base * scale;
      drawHeight = imageHeight * base * scale;
    }
    const cx = clamp01(background.x, 0.5) * stageWidth;
    const cy = clamp01(background.y, 0.5) * stageHeight;
    context.save();
    context.globalAlpha = clamp01(background.opacity, 1);
    context.drawImage(entry.image, cx - drawWidth / 2, cy - drawHeight / 2, drawWidth, drawHeight);
    context.restore();
  }

  function drawStageImages(state) {
    const sprites = Array.isArray(state?.stage?.sprites) ? state.stage.sprites : [];
    const uiImages = Array.isArray(state?.stage?.uiImages) ? state.stage.uiImages : [];
    const items = [...sprites, ...uiImages];
    if (items.length === 0) return;
    items.sort((a, b) => asNumber(a?.zIndex, 0) - asNumber(b?.zIndex, 0));
    for (const item of items) {
      if (!item || !item.assetId) continue;
      const entry = ensureImage(item.assetId);
      if (!entry) continue;
      const opacity = clamp01(item.opacity, 1);
      const naturalWidth = entry.image?.naturalWidth || entry.asset?.width || 0;
      const naturalHeight = entry.image?.naturalHeight || entry.asset?.height || 0;
      const scale = clamp(asNumber(item.scale, 1), 0.05, 10);
      const width = naturalWidth * scale;
      const height = naturalHeight * scale;
      const cx = clamp01(item.x, 0.5) * stageWidth;
      const cy = clamp01(item.y, 0.5) * stageHeight;
      if (entry.status === 'error') {
        drawMissingPlaceholder(
          cx,
          cy,
          Math.min(Math.max(width, 120), 360),
          Math.min(Math.max(height, 120), 280),
          entry.asset?.name || item.assetId,
        );
        continue;
      }
      if (entry.status !== 'ready' || naturalWidth <= 0 || naturalHeight <= 0) continue;
      context.save();
      context.globalAlpha = opacity;
      context.drawImage(entry.image, cx - width / 2, cy - height / 2, width, height);
      context.restore();
    }
  }

  function drawPortrait(state) {
    const portrait = state?.dialogue?.portrait;
    if (!portrait || !portrait.assetId) return;
    const entry = ensureImage(portrait.assetId);
    if (!entry) return;
    const opacity = 1;
    const naturalWidth = entry.image?.naturalWidth || entry.asset?.width || 0;
    const naturalHeight = entry.image?.naturalHeight || entry.asset?.height || 0;
    const scale = clamp(asNumber(portrait.scale, 1), 0.05, 10);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    const cx = clamp01(portrait.x, 0.5) * stageWidth;
    const cy = clamp01(portrait.y, 0.5) * stageHeight;
    if (entry.status === 'error') {
      drawMissingPlaceholder(
        cx,
        cy,
        Math.min(Math.max(width, 120), 360),
        Math.min(Math.max(height, 120), 280),
        `立绘缺失：${entry.asset?.path || portrait.assetId}`,
      );
      return;
    }
    if (entry.status !== 'ready' || naturalWidth <= 0 || naturalHeight <= 0) return;
    context.save();
    context.globalAlpha = opacity;
    context.drawImage(entry.image, cx - width / 2, cy - height / 2, width, height);
    context.restore();
  }

  function wrapText(text, maxWidth, fontSize) {
    const content = String(text ?? '');
    if (!content) return [];
    context.font = `${fontSize}px ${FONT_STACK}`;
    const lines = [];
    for (const paragraph of content.split('\n')) {
      if (paragraph === '') {
        lines.push('');
        continue;
      }
      let line = '';
      for (const char of Array.from(paragraph)) {
        const candidate = line + char;
        if (line && context.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = char;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  function drawTextbox(state) {
    const source = state?.stage?.textbox || {};
    const box = { ...DEFAULT_TEXTBOX, ...source };
    const opacity = clamp01(box.opacity, 1);
    const width = clamp(asNumber(box.width, DEFAULT_TEXTBOX.width), 0.05, 1) * stageWidth;
    const height = clamp(asNumber(box.height, DEFAULT_TEXTBOX.height), 0.05, 1) * stageHeight;
    const left = clamp01(box.x, DEFAULT_TEXTBOX.x) * stageWidth - width / 2;
    const top = clamp01(box.y, DEFAULT_TEXTBOX.y) * stageHeight - height / 2;
    const material = normalizeMaterial(box.material);
    const radius =
      material?.borderRadiusPx !== undefined ? material.borderRadiusPx : Math.min(14, height * 0.08);

    context.save();
    context.globalAlpha = clamp01(box.backgroundOpacity, DEFAULT_TEXTBOX.backgroundOpacity) * opacity;
    context.fillStyle = box.background || DEFAULT_TEXTBOX.background;
    roundRectPath(context, left, top, width, height, radius);
    context.fill();
    context.restore();

    // 材质图片：按圆角裁剪后按 stretch/cover/contain 绘制。
    if (material?.imageAssetId) {
      const entry = ensureImage(material.imageAssetId);
      if (entry && entry.status === 'ready') {
        context.save();
        roundRectPath(context, left, top, width, height, radius);
        context.clip();
        context.globalAlpha = opacity * (material.imageOpacity ?? 1);
        drawImageInBox(entry.image, left, top, width, height, material.imageMode);
        context.restore();
      }
    }

    const borderColor = material?.borderColor || 'rgba(152, 180, 212, 0.32)';
    const borderWidth = material?.borderWidthPx !== undefined ? material.borderWidthPx : 1.5;
    if (borderWidth > 0) {
      context.save();
      context.globalAlpha = material?.borderColor ? opacity : opacity * 0.55;
      context.strokeStyle = borderColor;
      context.lineWidth = borderWidth;
      roundRectPath(context, left, top, width, height, radius);
      context.stroke();
      context.restore();
    }

    const dialogue = state?.dialogue;
    if (!dialogue) return;

    const fontSize = clamp(asNumber(box.fontSizePx, DEFAULT_TEXTBOX.fontSizePx), 8, 200);
    const padding = clamp(
      asNumber(box.paddingPx, Math.round(fontSize * 0.85)),
      0,
      Math.max(0, Math.min(width, height) / 2 - 4),
    );
    const color = box.color || DEFAULT_TEXTBOX.color;
    const lineHeight = Math.round(fontSize * 1.5);
    const speaker = typeof dialogue.speaker === 'string' ? dialogue.speaker.trim() : '';

    if (speaker) {
      const speakerSize = Math.max(12, Math.round(fontSize * 0.78));
      context.save();
      context.font = `600 ${speakerSize}px ${FONT_STACK}`;
      const textWidth = context.measureText(speaker).width;
      const chipWidth = Math.min(width - 8, textWidth + 22);
      const chipHeight = speakerSize + 12;
      const chipX = left + Math.min(padding, 14);
      let chipY = top - chipHeight - 6;
      if (chipY < 4) chipY = top + 4;
      context.globalAlpha = opacity;
      context.fillStyle = 'rgba(7, 12, 19, 0.84)';
      roundRectPath(context, chipX, chipY, chipWidth, chipHeight, 6);
      context.fill();
      context.strokeStyle = 'rgba(140, 170, 206, 0.35)';
      context.lineWidth = 1;
      roundRectPath(context, chipX, chipY, chipWidth, chipHeight, 6);
      context.stroke();
      context.fillStyle = '#ffd98a';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillText(truncate(speaker, 40), chipX + 10, chipY + chipHeight / 2 + 1);
      context.restore();
    }

    const fullText = typeof dialogue.text === 'string' ? dialogue.text : '';
    const typingThisNode = typing.nodeId === state.nodeId;
    const visibleCount = typingThisNode
      ? Math.max(0, Math.floor(typing.shown))
      : fullText.length;
    const visibleText = fullText.slice(0, visibleCount);
    const contentWidth = Math.max(0, width - padding * 2);
    const contentHeight = Math.max(0, height - padding * 2);

    context.save();
    context.beginPath();
    context.rect(left + padding, top + padding, contentWidth, contentHeight);
    context.clip();
    context.globalAlpha = opacity;
    context.fillStyle = color;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    const lines = wrapText(visibleText, contentWidth, fontSize);
    const startY = top + padding;
    for (let index = 0; index < lines.length; index += 1) {
      const lineY = startY + index * lineHeight;
      if (lineY > top + height) break;
      context.fillText(lines[index], left + padding, lineY);
    }
    context.restore();

    if (typingThisNode && typing.done && phase === 'playing' && !menuOpen) {
      const blink = 0.55 + 0.45 * Math.sin(performance.now() / 380);
      const indicatorX = left + width - padding - 12;
      const indicatorY = top + height - padding - 6;
      context.save();
      context.globalAlpha = blink * opacity;
      context.fillStyle = '#cfe2f7';
      context.beginPath();
      context.moveTo(indicatorX, indicatorY);
      context.lineTo(indicatorX + 12, indicatorY);
      context.lineTo(indicatorX + 6, indicatorY + 8);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  function draw(state) {
    if (destroyed) return;
    context.save();
    context.globalAlpha = 1;
    context.clearRect(0, 0, stageWidth, stageHeight);
    drawBackground(state);
    drawStageImages(state);
    drawPortrait(state);
    drawTextbox(state);
    context.restore();
  }

  // ---------------------------------------------------------------------------
  // 音频
  // ---------------------------------------------------------------------------

  function tryPlay(audio, label = '音频') {
    try {
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch((error) => {
          if (error?.name === 'NotAllowedError') {
            console.warn(`[runtime] ${label}自动播放被浏览器拦截，等待用户交互`);
          } else {
            console.warn(`[runtime] ${label}播放失败`, error);
          }
        });
      }
    } catch (error) {
      console.warn(`[runtime] ${label}播放失败`, error);
    }
  }

  function playBgmSession(session) {
    if (!session || bgm !== session || videoSession || menuOpen) return;
    if (!session.audio.paused || session.blocked) return;
    try {
      const promise = session.audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch((error) => {
          if (error?.name === 'NotAllowedError') {
            session.blocked = true;
            console.warn('[runtime] 浏览器拦截了 BGM 自动播放，等待用户交互');
          } else {
            console.warn('[runtime] BGM 播放失败', error);
          }
        });
      }
    } catch (error) {
      console.warn('[runtime] BGM 播放失败', error);
    }
  }

  function stopBgm() {
    if (!bgm) return;
    const session = bgm;
    bgm = null;
    try {
      session.audio.pause();
      session.audio.removeAttribute('src');
      session.audio.load();
    } catch {
      /* ignore */
    }
  }

  function ensureBgm(state) {
    if (silent) {
      stopBgm();
      return;
    }
    const audioState = state?.stage?.audio || null;
    const desiredId = audioState?.bgmAssetId || null;
    if (!desiredId) {
      stopBgm();
      return;
    }
    if (bgm && bgm.assetId === desiredId) return;
    stopBgm();
    const asset = audioAssets.get(desiredId);
    if (!asset) {
      console.warn(`[runtime] 未找到 BGM 素材：${desiredId}`);
      return;
    }
    const audio = new Audio();
    audio.preload = 'auto';
    audio.loop = audioState?.loop !== false;
    audio.volume = 0;
    const session = {
      assetId: desiredId,
      audio,
      blocked: false,
      pausedForVideo: false,
      startedAt: performance.now(),
      fadeMs: Math.max(0, asNumber(audioState?.fadeInMs, 0)),
    };
    bgm = session;
    resolveUrl(asset.path).then((url) => {
      if (bgm !== session) return;
      if (!url) {
        session.blocked = true;
        return;
      }
      audio.src = url;
      playBgmSession(session);
    });
  }

  function applyStageAudio(state) {
    ensureBgm(state);
    if (!bgm) return;
    const audioState = state?.stage?.audio || null;
    const target = clamp01(audioState?.volume, 0.8);
    const fade =
      bgm.fadeMs > 0
        ? clamp((performance.now() - bgm.startedAt) / bgm.fadeMs, 0, 1)
        : 1;
    try {
      bgm.audio.volume = clamp01(target * fade, 0);
      if (audioState && typeof audioState.loop === 'boolean') bgm.audio.loop = audioState.loop;
    } catch {
      /* ignore */
    }
    if (videoSession) {
      if (!bgm.audio.paused) {
        try {
          bgm.audio.pause();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (menuOpen || bgm.pausedForVideo) return;
    if (bgm.audio.paused && !bgm.blocked) playBgmSession(bgm);
  }

  function stopVoice() {
    if (!voiceAudio) return;
    const audio = voiceAudio;
    voiceAudio = null;
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch {
      /* ignore */
    }
  }

  function ensureVoice(state) {
    if (silent) {
      if (voiceAudio) stopVoice();
      return;
    }
    const dialogue = state?.dialogue || null;
    const voice = dialogue?.voice || null;
    const assetId = voice?.assetId || null;
    const key = assetId ? `${state.nodeId}:${assetId}` : null;
    if (voiceKey === key) {
      if (!assetId && voiceAudio) stopVoice();
      return;
    }
    voiceKey = key;
    stopVoice();
    if (!assetId) return;
    const asset = audioAssets.get(assetId);
    if (!asset) {
      console.warn(`[runtime] 未找到语音素材：${assetId}`);
      return;
    }
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = clamp01(voice.volume, 1);
    voiceAudio = audio;
    audio.addEventListener('ended', () => {
      if (voiceAudio === audio) voiceAudio = null;
    });
    resolveUrl(asset.path).then((url) => {
      if (voiceAudio !== audio) return;
      if (!url) return;
      audio.src = url;
      tryPlay(audio, '语音');
    });
  }

  function stopSceneSfx() {
    const list = sfxAudios;
    sfxAudios = [];
    for (const audio of list) {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {
        /* ignore */
      }
    }
  }

  function playSceneSfx(state, node) {
    stopSceneSfx();
    if (silent) return;
    const list =
      (Array.isArray(state?.stage?.audio?.sfx) && state.stage.audio.sfx) ||
      (Array.isArray(node?.audio?.sfx) && node.audio.sfx) ||
      [];
    for (const item of list) {
      const assetId = item?.assetId;
      if (!assetId) continue;
      const asset = audioAssets.get(assetId);
      if (!asset) {
        console.warn(`[runtime] 未找到音效素材：${assetId}`);
        continue;
      }
      const audio = new Audio();
      audio.preload = 'auto';
      audio.loop = item.loop === true;
      audio.volume = clamp01(item.volume, 1);
      sfxAudios.push(audio);
      audio.addEventListener('ended', () => {
        sfxAudios = sfxAudios.filter((candidate) => candidate !== audio);
      });
      resolveUrl(asset.path).then((url) => {
        if (!url || !sfxAudios.includes(audio)) return;
        audio.src = url;
        tryPlay(audio, '音效');
      });
    }
  }

  function unlockAudio() {
    if (destroyed) return;
    if (audioUnlocked) return;
    audioUnlocked = true;
    if (bgm) {
      bgm.blocked = false;
      if (bgm.audio.paused) playBgmSession(bgm);
    }
  }

  // ---------------------------------------------------------------------------
  // 节点 / 场景切换
  // ---------------------------------------------------------------------------

  function getNode(nodeId) {
    if (!nodeId) return null;
    return project.nodes.find((node) => node?.id === nodeId) || null;
  }

  function nodeTypeOf(state) {
    return state?.nodeType || getNode(state?.nodeId)?.type || null;
  }

  function makeEngine() {
    if (typeof engineModule.createEngine !== 'function') {
      throw new Error('运行时引擎模块不可用（缺少 createEngine 导出）');
    }
    return engineModule.createEngine({ project, startNodeId, autoStart: false });
  }

  function getRenderStateSafe() {
    if (!engine) return null;
    try {
      return engine.getRenderState();
    } catch (error) {
      console.error('[runtime] 读取渲染状态失败', error);
      showEndOverlay('error', `读取渲染状态失败：${error?.message || error}`);
      return null;
    }
  }

  function invokeEngine(method, ...args) {
    if (!engine || typeof engine[method] !== 'function') return null;
    try {
      return engine[method](...args);
    } catch (error) {
      console.error(`[runtime] 引擎调用失败：${method}`, error);
      showEndOverlay('error', `${method} 失败：${error?.message || error}`);
      return null;
    }
  }

  function resetTracking() {
    lastState = null;
    lastNodeId = null;
    lastEmitted = null;
    typing = { nodeId: null, full: '', shown: 0, speed: 0, done: false };
    stopAutoAdvance();
    destroyChoice();
    destroyMinigame();
    destroyVideo();
    voiceKey = null;
    stopVoice();
  }

  function handleTransitions(state) {
    if (!state) return;
    const suppressSave = suppressAutoSaveOnce;
    suppressAutoSaveOnce = false;
    const nodeId = state.nodeId ?? null;
    if (nodeId === lastNodeId) return;
    lastNodeId = nodeId;
    const node = getNode(nodeId);
    const type = nodeTypeOf(state);
    if (type === 'scene' || node?.type === 'scene') {
      playSceneSfx(state, node);
      if (!suppressSave) autoSaveScene(node);
    }
  }

  function autoSaveScene(node) {
    if (!storage || !engine || phase !== 'playing' || destroyed) return;
    const autoSave = settings.autoSave || {};
    if (autoSave.enabled === false) return;
    if (autoSave.onSceneEnter === false) return;
    try {
      const saveState = engine.serialize({
        kind: 'auto',
        slot: 0,
        projectTitle,
        thumbnailDataUrl: makeThumbnail(),
        label: node?.name ? String(node.name).slice(0, 100) : null,
      });
      Promise.resolve(storage.put(saveState)).catch((error) => {
        console.warn('[runtime] 自动存档失败', error);
      });
    } catch (error) {
      console.warn('[runtime] 自动存档失败', error);
    }
  }

  // ---------------------------------------------------------------------------
  // 逐字 / 推进
  // ---------------------------------------------------------------------------

  function resolveSpeed(value) {
    const source = value ?? settings.textSpeedCps ?? 30;
    const speed = Number(source);
    if (!Number.isFinite(speed) || speed <= 0) return 0;
    return speed;
  }

  function stopAutoAdvance() {
    if (autoAdvanceTimer) {
      window.clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  function scheduleAutoAdvance(dialogue) {
    stopAutoAdvance();
    const raw = dialogue?.autoAdvanceMs;
    if (raw === null || raw === undefined) return;
    const delay = Number(raw);
    if (!Number.isFinite(delay) || delay < 0) return;
    autoAdvanceTimer = window.setTimeout(() => {
      autoAdvanceTimer = null;
      if (destroyed || phase !== 'playing' || menuOpen || confirmResolve) return;
      if (!lastState?.dialogue) return;
      handleAdvance();
    }, delay);
  }

  function syncTyping(state, deltaMs) {
    const dialogue = state?.dialogue || null;
    if (!dialogue) {
      typing = { nodeId: null, full: '', shown: 0, speed: 0, done: false };
      stopAutoAdvance();
      return;
    }
    const full = typeof dialogue.text === 'string' ? dialogue.text : '';
    if (typing.nodeId !== state.nodeId || typing.full !== full) {
      stopAutoAdvance();
      const speed = resolveSpeed(dialogue.speedCps);
      typing = {
        nodeId: state.nodeId,
        full,
        shown: speed === 0 ? full.length : 0,
        speed,
        done: false,
      };
    }
    if (typing.speed === 0) {
      typing.shown = typing.full.length;
    } else if (deltaMs > 0) {
      typing.shown = Math.min(typing.full.length, typing.shown + (typing.speed * deltaMs) / 1000);
    }
    if (typing.full.length === 0 || typing.shown >= typing.full.length) {
      typing.shown = typing.full.length;
      if (!typing.done) {
        typing.done = true;
        scheduleAutoAdvance(dialogue);
      }
    }
  }

  function handleAdvance() {
    if (destroyed || phase !== 'playing' || menuOpen || confirmResolve) return;
    const state = lastState;
    if (!state) return;
    if (state.minigame || state.video || state.choice) return;
    if (state.dialogue && !typing.done) {
      typing.shown = typing.full.length;
      typing.done = true;
      stopAutoAdvance();
      scheduleAutoAdvance(state.dialogue);
      tickOnce(0);
      return;
    }
    const status = state.status || engine?.status;
    if (status && status !== ENGINE_STATUS.RUNNING && status !== 'running') return;
    if (!engine || typeof engine.advance !== 'function') return;
    stopAutoAdvance();
    const result = invokeEngine('advance');
    if (result && result.ok === false) {
      console.warn(`[runtime] 无法推进：${result.error || '未知原因'}`);
    }
    tickOnce(0);
  }

  function handleChoose(exitId) {
    if (destroyed || !exitId || phase !== 'playing' || menuOpen) return;
    if (!lastState?.choice) return;
    stopAutoAdvance();
    const result = invokeEngine('choose', exitId);
    if (result && result.ok === false) {
      console.warn(`[runtime] 选项推进失败：${result.error || '未知原因'}`);
    }
    destroyChoice();
    tickOnce(0);
  }

  // ---------------------------------------------------------------------------
  // 选项 / 菜单状态
  // ---------------------------------------------------------------------------

  function destroyChoice() {
    if (!choiceSession) return;
    choiceSession.overlay?.remove();
    choiceSession = null;
  }

  function updateChoice(state) {
    const choice = state?.choice || null;
    if (!choice || phase !== 'playing') {
      destroyChoice();
      return;
    }
    const options = Array.isArray(choice.options) ? choice.options : [];
    const sessionKey = `${state.nodeId}|${choice.prompt || ''}|${options
      .map((option) => `${option.id}:${option.label || option.name}`)
      .join('|')}`;
    if (choiceSession?.key === sessionKey) return;
    destroyChoice();
    const overlay = el('div', 'vnrt-choice');
    const prompt = choice.prompt || getNode(state.nodeId)?.prompt || '';
    if (prompt) overlay.append(el('div', 'vnrt-choice__prompt', prompt));
    const list = el('div', 'vnrt-choice__options');
    options.forEach((option, index) => {
      if (!option || !option.id) return;
      const button = el('button', 'vnrt-choice__btn');
      button.type = 'button';
      button.append(
        el('span', 'vnrt-choice__key', index < 9 ? String(index + 1) : '·'),
        el('span', 'vnrt-choice__label', option.label || option.name || option.id),
      );
      if (option.description) button.title = option.description;
      button.addEventListener('click', () => handleChoose(option.id));
      list.append(button);
    });
    overlay.append(list);
    frame.append(overlay);
    applyChoiceMaterial(overlay, getNode(state.nodeId)?.material);
    choiceSession = { key: sessionKey, overlay };
  }

  function updateTopbar(state) {
    const hide =
      phase !== 'playing' || menuOpen || halted || Boolean(state?.minigame) || Boolean(state?.video);
    topbar.hidden = hide;
    menuButton.disabled = menuOpen;
  }

  // ---------------------------------------------------------------------------
  // 小游戏
  // ---------------------------------------------------------------------------

  function updateMinigameTimer() {
    if (!minigameSession || !minigameSession.deadline) return;
    const remaining = Math.max(0, minigameSession.deadline - performance.now());
    minigameSession.timerEl.textContent = `剩余 ${(remaining / 1000).toFixed(1)}s`;
  }

  function destroyMinigame() {
    const session = minigameSession;
    if (!session) return;
    minigameSession = null;
    if (session.timeoutTimer) window.clearTimeout(session.timeoutTimer);
    if (session.onMessage) window.removeEventListener('message', session.onMessage);
    try {
      session.iframe?.removeAttribute('src');
    } catch {
      /* ignore */
    }
    session.overlay?.remove();
  }

  function ensureMinigame(state) {
    const info = state?.minigame || null;
    if (!info || phase !== 'playing' || halted) {
      destroyMinigame();
      return;
    }
    if (minigameSession && minigameSession.nodeId === state.nodeId) return;
    destroyMinigame();
    startMinigame(state.nodeId, info, state);
  }

  function startMinigame(nodeId, info, state) {
    const node = getNode(nodeId);
    const overlay = el('div', 'vnrt-minigame');
    const bar = el('div', 'vnrt-minigame__bar');
    const name = el('span', 'vnrt-minigame__name', info.name || node?.name || '小游戏');
    const instructions = el('span', 'vnrt-minigame__instructions', info.instructions || node?.instructions || '');
    const timerEl = el('span', 'vnrt-minigame__timer', '');
    bar.append(name, instructions, timerEl);

    const iframe = document.createElement('iframe');
    iframe.className = 'vnrt-minigame__frame';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('title', info.name || node?.name || '小游戏');
    overlay.append(bar, iframe);
    wrap.append(overlay);

    const session = {
      nodeId,
      overlay,
      iframe,
      timerEl,
      done: false,
      timeoutTimer: null,
      onMessage: null,
      deadline: 0,
    };
    minigameSession = session;

    const asset = minigameAssets.get(info.minigameAssetId) || null;
    const path = info.path || asset?.path || '';
    resolveUrl(path).then((url) => {
      if (minigameSession !== session || session.done) return;
      if (!url) {
        console.warn('[runtime] 小游戏地址无效，无法加载');
        return;
      }
      iframe.src = url;
    });

    session.onMessage = (event) => handleMinigameMessage(event, session);
    window.addEventListener('message', session.onMessage);

    const timeoutMs = Math.max(
      0,
      asNumber(info.timeoutMs, asNumber(settings.runtime?.defaultMinigameTimeoutMs, 0)),
    );
    if (timeoutMs > 0) {
      session.deadline = performance.now() + timeoutMs;
      session.timeoutTimer = window.setTimeout(() => {
        if (minigameSession !== session || session.done) return;
        session.done = true;
        console.warn(`[runtime] 小游戏超时（${timeoutMs}ms），按无匹配结果处理`);
        destroyMinigame();
        invokeEngine('timeoutMinigame');
        tickOnce(0);
      }, timeoutMs);
    }
  }

  function handleMinigameMessage(event, session) {
    if (minigameSession !== session || session.done) return;
    if (!session.iframe || event.source !== session.iframe.contentWindow) {
      // 来源不是当前小游戏 iframe：静默忽略（页面里可能有其他 postMessage）
      return;
    }
    const data = event.data;
    if (
      !data ||
      typeof data !== 'object' ||
      data.type !== 'minigame-result' ||
      typeof data.result !== 'string'
    ) {
      console.warn('[runtime] 已丢弃非法的小游戏消息（需要 {type:"minigame-result", result:string}）');
      return;
    }
    session.done = true;
    destroyMinigame();
    const result = invokeEngine('submitMinigameResult', data.result);
    if (result && result.ok === false) {
      console.warn(`[runtime] 小游戏结果未被接受：${result.error || '未知原因'}`);
    }
    tickOnce(0);
  }

  // ---------------------------------------------------------------------------
  // 视频
  // ---------------------------------------------------------------------------

  function destroyVideo() {
    const session = videoSession;
    if (!session) return;
    videoSession = null;
    try {
      session.video.pause();
      session.video.removeAttribute('src');
      session.video.load();
    } catch {
      /* ignore */
    }
    session.overlay?.remove();
    if (bgm) {
      bgm.pausedForVideo = false;
      if (!bgm.blocked && bgm.audio.paused && !menuOpen && phase === 'playing') {
        playBgmSession(bgm);
      }
    }
  }

  function showVideoError(session, message) {
    if (videoSession !== session || session.done) return;
    session.errorShown = true;
    session.errorEl.textContent = message;
    session.errorEl.hidden = false;
    console.warn(`[runtime] ${message}：${session.video.currentSrc || session.video.src || '未知路径'}`);
  }

  function updateVideoSkip() {
    const session = videoSession;
    if (!session) return;
    if (session.skip.hidden) return;
    const elapsed = Math.max(0, asNumber(session.video.currentTime, 0) * 1000);
    const skipAfter = session.skipAfterMs || 0;
    const enabled = session.errorShown || elapsed >= skipAfter;
    session.skip.disabled = !enabled;
    session.skip.textContent = enabled
      ? '跳过'
      : `跳过（${Math.max(0, Math.ceil((skipAfter - elapsed) / 1000))}s）`;
  }

  function finishVideo(outcome) {
    const session = videoSession;
    if (!session || session.done) return;
    session.done = true;
    destroyVideo();
    const result = invokeEngine('completeVideo', outcome);
    if (result && result.ok === false) {
      console.warn(`[runtime] 视频结束处理失败：${result.error || '未知原因'}`);
    }
    tickOnce(0);
  }

  function ensureVideo(state) {
    const info = state?.video || null;
    if (!info || phase !== 'playing' || halted) {
      destroyVideo();
      return;
    }
    if (videoSession && videoSession.nodeId === state.nodeId) return;
    destroyVideo();
    startVideo(state.nodeId, info);
  }

  function startVideo(nodeId, info) {
    const node = getNode(nodeId);
    const overlay = el('div', 'vnrt-video');
    const video = document.createElement('video');
    video.className = 'vnrt-video__el';
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.volume = silent ? 0 : clamp01(info.volume, 0.8);
    video.muted = silent;
    video.loop = info.loop === true;

    const name = el('div', 'vnrt-video__name', info.name || node?.name || '视频');
    const skip = makeButton('跳过', 'small', () => finishVideo('skipped'));
    skip.classList.add('vnrt-video__skip');
    const errorEl = el('div', 'vnrt-video__error', '');
    errorEl.hidden = true;
    overlay.append(video, name, skip, errorEl);
    wrap.append(overlay);

    const session = {
      nodeId,
      overlay,
      video,
      skip,
      errorEl,
      done: false,
      errorShown: false,
      skipAfterMs: 0,
    };
    videoSession = session;

    const asset = videoAssets.get(info.videoAssetId) || null;
    const path = info.path || asset?.path || '';
    resolveUrl(path).then((url) => {
      if (videoSession !== session || session.done) return;
      if (!url) {
        showVideoError(session, '视频地址无效');
        return;
      }
      video.src = url;
      tryPlay(video, '视频');
    });

    skip.hidden = info.showSkipButton === false;
    session.skipAfterMs =
      info.skipAfterMs === null || info.skipAfterMs === undefined
        ? 0
        : Math.max(0, asNumber(info.skipAfterMs, 0));
    updateVideoSkip();

    video.addEventListener('ended', () => finishVideo('completed'));
    video.addEventListener('error', () => showVideoError(session, '视频加载或播放失败'));
    skip.addEventListener('click', () => finishVideo('skipped'));

    if (bgm?.audio) {
      bgm.pausedForVideo = true;
      try {
        bgm.audio.pause();
      } catch {
        /* ignore */
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 主循环 / 状态同步
  // ---------------------------------------------------------------------------

  function tickOnce(deltaMs) {
    if (destroyed || halted) return;
    const state = getRenderStateSafe();
    if (!state) return;
    lastState = state;
    if (phase === 'playing') syncTyping(state, deltaMs);
    ensureMinigame(state);
    ensureVideo(state);
    applyStageAudio(state);
    ensureVoice(state);
    updateChoice(state);
    updateMinigameTimer();
    updateVideoSkip();
    draw(state);
    handleTransitions(state);
    handleStatus(state);
    updateTopbar(state);
    emitState(state);
  }

  function handleStatus(state) {
    if (!state || phase !== 'playing') return;
    const status = state.status || engine?.status;
    if (status === ENGINE_STATUS.ENDED || status === 'ended') {
      showEndOverlay('ended', `共游玩 ${formatDuration(state.playtimeMs || engine?.playtimeMs || 0)}。`, state);
    } else if (status === ENGINE_STATUS.ERROR || status === 'error') {
      showEndOverlay('error', state.error || engine?.error || '运行时错误', state);
    } else {
      hideEndOverlay();
    }
  }

  function showEndOverlay(kind, message, state) {
    const text = message || '';
    if (endKind === kind && endMessageValue === text) {
      endOverlay.hidden = false;
      return;
    }
    endKind = kind;
    endMessageValue = text;
    halted = true;
    endHeading.textContent = kind === 'ended' ? '已到结尾' : '运行时错误';
    endMessage.textContent = text;
    backTitleButton.hidden = !showTitle;
    endOverlay.hidden = false;
    destroyChoice();
    destroyMinigame();
    destroyVideo();
    stopAutoAdvance();
    stopBgm();
    stopVoice();
    stopSceneSfx();
    updateTopbar(state);
    emitState(state);
  }

  function hideEndOverlay() {
    if (endKind === null) {
      endOverlay.hidden = true;
      return;
    }
    endKind = null;
    endMessageValue = '';
    halted = false;
    endOverlay.hidden = true;
  }

  function emitState(state) {
    let status = state?.status || engine?.status || 'running';
    let error = state?.error || engine?.error || null;
    if (endKind === 'error') {
      status = ENGINE_STATUS.ERROR;
      error = error || endMessageValue || '运行时错误';
    } else if (endKind === 'ended') {
      status = ENGINE_STATUS.ENDED;
    }
    const nodeId = state?.nodeId ?? engine?.nodeId ?? null;
    const signature = `${phase}|${status}|${nodeId || ''}|${error || ''}|${menuOpen ? 1 : 0}|${
      endKind || ''
    }`;
    if (signature === lastEmitted) return;
    lastEmitted = signature;
    if (typeof onStateChange !== 'function') return;
    try {
      const payload = state && typeof state === 'object' ? { ...state } : {};
      payload.status = status;
      payload.error = error;
      payload.nodeId = nodeId;
      payload.nodeType = nodeTypeOf(state);
      payload.playtimeMs = state?.playtimeMs ?? engine?.playtimeMs ?? 0;
      payload.ended = status === ENGINE_STATUS.ENDED || status === 'ended';
      payload.phase = phase;
      payload.menuOpen = menuOpen;
      onStateChange(payload);
    } catch (callbackError) {
      console.warn('[runtime] onStateChange 回调异常', callbackError);
    }
  }

  function frameLoop(timestamp) {
    if (destroyed) return;
    rafId = window.requestAnimationFrame(frameLoop);
    const delta = lastRenderTimestamp
      ? Math.min(100, Math.max(0, timestamp - lastRenderTimestamp))
      : 0;
    lastRenderTimestamp = timestamp;
    if (phase !== 'playing' || menuOpen || confirmResolve || halted) return;
    if (engine && typeof engine.tick === 'function') {
      try {
        engine.tick(delta);
      } catch (error) {
        console.error('[runtime] 引擎 tick 失败', error);
        showEndOverlay('error', `运行时推进失败：${error?.message || error}`, lastState);
        return;
      }
    }
    tickOnce(delta);
  }

  // ---------------------------------------------------------------------------
  // 标题 / 结束 / 开始 / 读档
  // ---------------------------------------------------------------------------

  async function refreshTitleAvailability() {
    if (!continueButton) return;
    titleHint.classList.remove('is-error');
    if (!storage) {
      continueButton.disabled = true;
      titleHint.textContent = storageError
        ? `存档不可用：${storageError}`
        : '当前环境不支持存档';
      titleHint.classList.toggle('is-error', Boolean(storageError));
      return;
    }
    try {
      const save = await storage.get(projectId, 'auto', 0);
      continueButton.disabled = !save;
      if (save) {
        titleHint.textContent = `自动存档：${formatSavedAt(save.savedAt)}`;
      } else {
        titleHint.textContent = '暂无自动存档，开始新游戏后进入场景会自动保存。';
      }
    } catch (error) {
      continueButton.disabled = true;
      titleHint.classList.add('is-error');
      titleHint.textContent = `读取自动存档失败：${error?.message || error}`;
    }
  }

  function showTitleScreen() {
    if (destroyed) return;
    closeMenuInternal();
    hideEndOverlay();
    destroyChoice();
    destroyMinigame();
    destroyVideo();
    stopAutoAdvance();
    stopBgm();
    stopVoice();
    stopSceneSfx();
    phase = 'title';
    lastState = null;
    titleOverlay.hidden = false;
    topbar.hidden = true;
    draw(null);
    refreshTitleAvailability();
    emitState(null);
  }

  function startNewGame() {
    if (destroyed) return { ok: false, error: '运行时已销毁' };
    closeMenuInternal();
    hideEndOverlay();
    titleOverlay.hidden = true;
    destroyChoice();
    destroyMinigame();
    destroyVideo();
    stopBgm();
    stopVoice();
    stopSceneSfx();
    resetTracking();
    phase = 'playing';
    try {
      engine = makeEngine();
      engineBroken = false;
    } catch (error) {
      engine = null;
      engineBroken = true;
      console.error('[runtime] 创建引擎失败', error);
      phase = 'playing';
      showEndOverlay('error', `创建引擎失败：${error?.message || error}`, null);
      return { ok: false, error: error?.message || String(error) };
    }
    let result = null;
    try {
      result = engine.start();
    } catch (error) {
      console.error('[runtime] 引擎启动失败', error);
      showEndOverlay('error', `引擎启动失败：${error?.message || error}`, null);
      return { ok: false, error: error?.message || String(error) };
    }
    if (result && result.ok === false) {
      console.warn(`[runtime] 引擎启动失败：${result.error || '未知原因'}`);
    }
    tickOnce(0);
    return { ok: true };
  }

  async function applyLoad(saveState) {
    if (!saveState || typeof saveState !== 'object') {
      return { ok: false, error: '存档内容为空' };
    }
    let fresh;
    try {
      fresh = makeEngine();
    } catch (error) {
      return { ok: false, error: `创建引擎失败：${error?.message || error}` };
    }
    let result;
    try {
      result = fresh.loadSave(saveState);
    } catch (error) {
      console.warn('[runtime] 读档失败', error);
      return { ok: false, error: `读档失败：${error?.message || error}` };
    }
    if (result && result.ok === false) {
      console.warn(`[runtime] 读档失败：${result.error || '未知原因'}`);
      return result;
    }
    closeMenuInternal();
    hideEndOverlay();
    titleOverlay.hidden = true;
    destroyChoice();
    destroyMinigame();
    destroyVideo();
    stopBgm();
    stopVoice();
    stopSceneSfx();
    engine = fresh;
    resetTracking();
    suppressAutoSaveOnce = true;
    phase = 'playing';
    tickOnce(0);
    showToast('已读取存档');
    return { ok: true };
  }

  async function continueAuto() {
    if (!storage) {
      const error = storageError || '存档功能不可用';
      showToast(error, 'error');
      return { ok: false, error };
    }
    try {
      const save = await storage.get(projectId, 'auto', 0);
      if (!save) {
        showToast('没有可用的自动存档', 'error');
        return { ok: false, error: '没有自动存档' };
      }
      return await applyLoad(save);
    } catch (error) {
      console.warn('[runtime] 读取自动存档失败', error);
      showToast(`读取自动存档失败：${error?.message || error}`, 'error');
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function loadSlot({ kind = 'manual', slot = 1 } = {}) {
    if (!storage) {
      const error = storageError || '存档功能不可用';
      showToast(error, 'error');
      return { ok: false, error };
    }
    try {
      const save = await storage.get(projectId, kind, slot);
      if (!save) {
        showToast('该槽位没有存档', 'error');
        return { ok: false, error: '该槽位没有存档' };
      }
      return await applyLoad(save);
    } catch (error) {
      console.warn('[runtime] 读取存档失败', error);
      showToast(`读取存档失败：${error?.message || error}`, 'error');
      return { ok: false, error: error?.message || String(error) };
    }
  }

  function restart() {
    return startNewGame();
  }

  // ---------------------------------------------------------------------------
  // 存档菜单
  // ---------------------------------------------------------------------------

  function setMenuStatus(text, kind = '') {
    menuStatusEl.textContent = text || '';
    menuStatusEl.className = 'vnrt-menu__status' + (kind ? ` is-${kind}` : '');
  }

  function updateMenuTabs() {
    saveTabButton.classList.toggle('is-active', menuTab === 'save');
    loadTabButton.classList.toggle('is-active', menuTab === 'load');
    saveTabButton.setAttribute('aria-selected', menuTab === 'save' ? 'true' : 'false');
    loadTabButton.setAttribute('aria-selected', menuTab === 'load' ? 'true' : 'false');
  }

  function slotKey(def) {
    return `${def.kind}:${def.slot}`;
  }

  function renderSaveCard(def, tab, save) {
    const card = el('div', 'vnrt-save-card');
    if (!save) card.classList.add('is-empty');
    const thumb = el('div', 'vnrt-save-card__thumb');
    if (save?.thumbnailDataUrl) {
      const image = document.createElement('img');
      image.src = save.thumbnailDataUrl;
      image.alt = `${def.label} 缩略图`;
      image.loading = 'lazy';
      thumb.append(image);
    } else {
      thumb.textContent = def.readonly ? '自动存档' : '无截图';
    }
    thumb.append(el('span', 'vnrt-save-card__badge', def.label));

    const body = el('div', 'vnrt-save-card__body');
    body.append(el('div', 'vnrt-save-card__slot', save ? def.label : `${def.label} · 空槽位`));
    body.append(el('div', 'vnrt-save-card__time', save ? formatSavedAt(save.savedAt) : '—'));
    if (save) {
      let titleText = save.projectTitle || projectTitle;
      if (save.label) titleText = `${titleText} · ${save.label}`;
      body.append(el('div', 'vnrt-save-card__title', titleText));
    } else {
      body.append(el('div', 'vnrt-save-card__title', def.readonly ? '自动写入，不可覆盖' : '尚未保存'));
    }

    const actions = el('div', 'vnrt-save-card__actions');
    if (tab === 'save') {
      if (def.readonly) {
        if (save) {
          actions.append(makeButton('读取', 'ghost', () => loadFrom(def)));
        } else {
          actions.append(el('div', 'vnrt-save-card__hint', '自动存档只读'));
        }
      } else {
        actions.append(
          makeButton(save ? '覆盖保存' : '保存', 'primary', () => saveTo(def)),
        );
        if (save) actions.append(makeButton('删除', 'danger', () => deleteSlot(def)));
      }
    } else if (save) {
      actions.append(makeButton('读取', 'primary', () => loadFrom(def)));
      if (!def.readonly) actions.append(makeButton('删除', 'danger', () => deleteSlot(def)));
    } else {
      actions.append(el('div', 'vnrt-save-card__hint', '空槽位'));
    }

    card.append(thumb, body, actions);
    return card;
  }

  function renderEmptyStorageCards() {
    menuGrid.replaceChildren();
    for (const def of SAVE_SLOTS) {
      menuGrid.append(renderSaveCard(def, menuTab, null));
    }
  }

  async function refreshSaveList() {
    const token = ++menuListToken;
    if (!storage) {
      renderEmptyStorageCards();
      setMenuStatus(storageError || '当前环境不支持存档', 'error');
      return;
    }
    let list = [];
    try {
      list = await storage.list(projectId);
    } catch (error) {
      console.warn('[runtime] 读取存档列表失败', error);
      if (token === menuListToken) setMenuStatus(`读取存档列表失败：${error?.message || error}`, 'error');
      list = [];
    }
    if (token !== menuListToken || !menuOpen) return;
    saveIndex = new Map();
    for (const item of list) {
      if (!item || !item.kind) continue;
      saveIndex.set(`${item.kind}:${item.slot}`, item);
    }
    menuGrid.replaceChildren();
    for (const def of SAVE_SLOTS) {
      const save = saveIndex.get(slotKey(def)) || null;
      menuGrid.append(renderSaveCard(def, menuTab, save));
    }
  }

  function openSaveMenu(preferredTab) {
    if (destroyed || confirmResolve) return;
    menuOpen = true;
    menuTab =
      preferredTab === 'load' || preferredTab === 'save'
        ? preferredTab
        : phase === 'title'
          ? 'load'
          : 'save';
    menuOverlay.hidden = false;
    updateMenuTabs();
    setMenuStatus(storageError || '', storageError ? 'error' : '');
    refreshSaveList();
    stopAutoAdvance();
    updateTopbar(lastState);
    emitState(lastState);
    try {
      menuClose.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }

  function closeMenuInternal() {
    if (confirmResolve) settleConfirm(false);
    menuOpen = false;
    menuOverlay.hidden = true;
    menuButton.disabled = false;
    updateTopbar(lastState);
    if (phase === 'playing' && lastState?.dialogue && typing.done) {
      scheduleAutoAdvance(lastState.dialogue);
    }
  }

  function closeSaveMenu() {
    if (confirmResolve) return;
    closeMenuInternal();
    emitState(lastState);
  }

  function confirmAction(message) {
    return new Promise((resolve) => {
      if (confirmResolve) settleConfirm(false);
      confirmResolve = resolve;
      confirmMessage.textContent = message;
      confirmOverlay.hidden = false;
      try {
        confirmOk.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    });
  }

  function settleConfirm(value) {
    if (!confirmResolve) return;
    const resolve = confirmResolve;
    confirmResolve = null;
    confirmOverlay.hidden = true;
    resolve(value);
  }

  function makeThumbnail() {
    try {
      if (!canvas.width || !canvas.height) return null;
      const dataUrl = canvas.toDataURL('image/webp', 0.8);
      return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : null;
    } catch (error) {
      console.warn('[runtime] 生成存档缩略图失败（可能因跨域资源）', error);
      return null;
    }
  }

  function currentNodeLabel() {
    try {
      const node =
        typeof engine?.getCurrentNode === 'function' ? engine.getCurrentNode() : getNode(engine?.nodeId);
      return node?.name ? String(node.name).slice(0, 100) : null;
    } catch {
      return null;
    }
  }

  async function saveTo(def) {
    if (confirmResolve) return;
    if (!storage) {
      setMenuStatus(storageError || '存档功能不可用', 'error');
      return;
    }
    if (!engine || phase !== 'playing' || typeof engine.serialize !== 'function') {
      setMenuStatus('请先开始游戏再保存', 'error');
      return;
    }
    const key = slotKey(def);
    if (saveIndex.has(key)) {
      const confirmed = await confirmAction(`覆盖「${def.label}」的已有存档？`);
      if (!confirmed || !menuOpen) return;
    }
    let saveState;
    try {
      saveState = engine.serialize({
        kind: def.kind,
        slot: def.slot,
        projectTitle,
        thumbnailDataUrl: makeThumbnail(),
        label: currentNodeLabel(),
      });
    } catch (error) {
      console.warn('[runtime] 生成存档失败', error);
      setMenuStatus(`生成存档失败：${error?.message || error}`, 'error');
      return;
    }
    try {
      await storage.put(saveState);
    } catch (error) {
      console.warn('[runtime] 写入存档失败', error);
      setMenuStatus(`写入存档失败：${error?.message || error}`, 'error');
      return;
    }
    setMenuStatus(`已保存到「${def.label}」`, 'ok');
    showToast(`已保存到${def.label}`);
    await refreshSaveList();
    refreshTitleAvailability();
  }

  async function loadFrom(def) {
    if (!storage) {
      setMenuStatus(storageError || '存档功能不可用', 'error');
      return;
    }
    setMenuStatus('正在读取存档…');
    let save = saveIndex.get(slotKey(def)) || null;
    if (!save) {
      try {
        save = await storage.get(projectId, def.kind, def.slot);
      } catch (error) {
        setMenuStatus(`读取存档失败：${error?.message || error}`, 'error');
        return;
      }
    }
    if (!save) {
      setMenuStatus('该槽位没有存档', 'error');
      return;
    }
    const result = await applyLoad(save);
    if (result && result.ok === false) {
      setMenuStatus(result.error || '读取失败', 'error');
    }
  }

  async function deleteSlot(def) {
    if (confirmResolve) return;
    if (!storage) {
      setMenuStatus(storageError || '存档功能不可用', 'error');
      return;
    }
    const confirmed = await confirmAction(`删除「${def.label}」的存档？此操作不可恢复。`);
    if (!confirmed || !menuOpen) return;
    try {
      await storage.remove(projectId, def.kind, def.slot);
    } catch (error) {
      console.warn('[runtime] 删除存档失败', error);
      setMenuStatus(`删除存档失败：${error?.message || error}`, 'error');
      return;
    }
    setMenuStatus(`已删除「${def.label}」`, 'ok');
    await refreshSaveList();
    refreshTitleAvailability();
  }

  function showToast(message, kind = '') {
    toastEl.textContent = message;
    toastEl.className = 'vnrt-toast is-visible' + (kind ? ` is-${kind}` : '');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastTimer = null;
      toastEl.className = 'vnrt-toast' + (kind ? ` is-${kind}` : '');
    }, 2600);
  }

  // ---------------------------------------------------------------------------
  // 事件绑定
  // ---------------------------------------------------------------------------

  function onCanvasClick() {
    if (phase !== 'playing' || menuOpen || confirmResolve || halted) return;
    handleAdvance();
  }

  function onKeyDown(event) {
    if (destroyed) return;
    unlockAudio();
    const target = event.target;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    if (event.key === 'Escape') {
      if (confirmResolve) {
        settleConfirm(false);
        event.preventDefault();
        return;
      }
      if (menuOpen) {
        closeSaveMenu();
        event.preventDefault();
      }
      return;
    }
    if (menuOpen || phase !== 'playing' || confirmResolve || halted) return;
    const state = lastState;
    if (!state || state.minigame || state.video) return;
    if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') {
      if (target && typeof target.closest === 'function' && target.closest('button')) return;
      if (state.choice) return;
      event.preventDefault();
      handleAdvance();
      return;
    }
    if (state.choice) {
      const index = Number(event.key);
      if (Number.isInteger(index) && index >= 1 && index <= 9) {
        const option = state.choice.options?.[index - 1];
        if (option?.id) {
          event.preventDefault();
          handleChoose(option.id);
        }
      }
    }
  }

  canvas.addEventListener('click', onCanvasClick);
  wrap.addEventListener('pointerdown', unlockAudio, { passive: true });
  wrap.addEventListener('keydown', unlockAudio);
  // 编辑器里的浮动小窗会同时存在多个运行时，不能抢占全局 Space/Enter。
  if (keyboard) window.addEventListener('keydown', onKeyDown);

  startButton.addEventListener('click', () => startNewGame());
  titleLoadButton.addEventListener('click', () => openSaveMenu('load'));
  saveTabButton.addEventListener('click', () => {
    if (menuTab === 'save') return;
    menuTab = 'save';
    setMenuStatus('');
    updateMenuTabs();
    refreshSaveList();
  });
  loadTabButton.addEventListener('click', () => {
    if (menuTab === 'load') return;
    menuTab = 'load';
    setMenuStatus('');
    updateMenuTabs();
    refreshSaveList();
  });
  menuOverlay.addEventListener('click', (event) => {
    if (event.target === menuOverlay) closeSaveMenu();
  });

  // ---------------------------------------------------------------------------
  // 初始化 & 公共接口
  // ---------------------------------------------------------------------------

  try {
    engine = makeEngine();
  } catch (error) {
    engine = null;
    engineBroken = true;
    console.error('[runtime] 引擎初始化失败', error);
  }

  frame.append(toastEl);

  // 全局界面材质：标题 / 结束 / 存档菜单（对话框与选项分别由场景/节点材质驱动）。
  applyMaterialToElement(titleCard, uiSkin.title?.card);
  applyBackdropToElement(titleOverlay, uiSkin.title?.backdrop);
  applyMaterialToElement(endCard, uiSkin.ending?.card);
  applyMaterialToElement(menuPanel, uiSkin.menu?.panel);

  if (autoStart || !showTitle) {
    phase = 'playing';
    startNewGame();
  } else {
    phase = 'title';
    titleOverlay.hidden = false;
    topbar.hidden = true;
    draw(null);
    refreshTitleAvailability();
    emitState(null);
  }

  rafId = window.requestAnimationFrame(frameLoop);
  layout();
  if (engineBroken && phase === 'title') {
    titleHint.textContent = '运行时引擎未就绪，请检查 engine.js。';
    titleHint.classList.add('is-error');
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    stopAutoAdvance();
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (confirmResolve) settleConfirm(false);
    destroyMinigame();
    destroyVideo();
    destroyChoice();
    stopVoice();
    stopSceneSfx();
    stopBgm();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    window.removeEventListener('resize', layout);
    if (keyboard) window.removeEventListener('keydown', onKeyDown);
    wrap.removeEventListener('pointerdown', unlockAudio);
    wrap.removeEventListener('keydown', unlockAudio);
    if (wrap.parentNode === root) root.removeChild(wrap);
    else wrap.remove?.();
    imageEntries.clear();
    urlCache.clear();
    urlPending.clear();
  }

  return {
    startNewGame,
    continueAuto,
    loadSlot,
    openSaveMenu,
    restart,
    getEngine: () => engine,
    destroy,
    // 额外调试接口（不参与契约）
    getState: () => lastState,
    getCanvas: () => canvas,
  };
}
