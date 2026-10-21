/**
 * SceneMiniPreview —— 画布左下角的“场景预览”浮动小窗（画中画）。
 *
 * 选中场景节点后：
 *  - 以该场景为起始节点启动一个静音运行时，按时间轴播放场景动画；
 *  - 对白按 autoAdvanceMs 自动推进，选项自动选择第一个出口；
 *  - 走到结尾后自动回到该场景重播，形成循环演示；
 *  - 可拖动标题栏移动、可收起；项目编辑后（防抖）重建，保证看到的是编辑后的效果。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { assetsApi } from '../../api';
import { createRuntime } from '../../../../runtime/runtime.js';
import '../../../../runtime/runtime.css';
import '../../styles/scene-preview.css';

const DIALOGUE_AUTO_ADVANCE_MS = 1600;
const DEFAULT_NODE_ADVANCE_MS = 1800;
const CHOICE_PICK_DELAY_MS = 1500;
const VIDEO_SKIP_DELAY_MS = 2200;
const MINIGAME_GIVEUP_MS = 9000;
const LOOP_RESTART_DELAY_MS = 1000;
const PROJECT_REBUILD_DEBOUNCE_MS = 450;
const PANEL_WIDTH = 300;

const STATUS_TEXT = {
  loading: '加载中…',
  running: '自动演示中',
  ended: '重播中…',
  error: '预览出错',
};

function buildPreviewProject(project, sceneId) {
  const clone = JSON.parse(JSON.stringify(project));
  clone.settings = { ...(clone.settings || {}), startNodeId: sceneId };
  clone.nodes = (clone.nodes || []).map((node) =>
    node?.type === 'dialogue' ? { ...node, autoAdvanceMs: DIALOGUE_AUTO_ADVANCE_MS } : node,
  );
  return clone;
}

export default function SceneMiniPreview({ project, projectDir, sceneNode }) {
  const panelRef = useRef(null);
  const stageRef = useRef(null);
  const runtimeRef = useRef(null);
  const dragRef = useRef(null);

  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [liveProject, setLiveProject] = useState(project);

  const sceneId = sceneNode?.id ?? null;
  const sceneName = sceneNode?.name || sceneId || '';
  const resolution = project?.settings?.resolution ?? { width: 1280, height: 720 };

  // 编辑过程中频繁更新，防抖后再重建预览，避免每次拖动滑块都销毁运行时。
  useEffect(() => {
    const timer = setTimeout(() => setLiveProject(project), PROJECT_REBUILD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [project]);

  const previewProject = useMemo(
    () => (sceneId ? buildPreviewProject(liveProject, sceneId) : null),
    [liveProject, sceneId],
  );

  useEffect(() => {
    setStatus('loading');
    setError('');
  }, [sceneId]);

  // 运行时初始化：场景 / 防抖后的项目 / 折叠状态变化时重建。
  useEffect(() => {
    if (!sceneId || collapsed || !previewProject) return undefined;
    const stage = stageRef.current;
    if (!stage) return undefined;

    let alive = true;
    let nodeTimer = null;
    let choiceTimer = null;
    let restartTimer = null;
    let watchedNodeId = null;

    const clearNodeTimer = () => {
      if (nodeTimer) window.clearTimeout(nodeTimer);
      nodeTimer = null;
    };
    const canvasClick = () => {
      const canvas = stage.querySelector('canvas');
      if (canvas) canvas.click();
    };
    const clickChoice = () => {
      const button = stage.querySelector('.vnrt-choice__btn');
      if (button) button.click();
    };

    const restartLoop = () => {
      if (!alive) return;
      try {
        runtimeRef.current?.restart?.();
      } catch (runtimeError) {
        console.warn('[scene-preview] 重播失败', runtimeError);
      }
    };

    const resolveAssetUrl = async (relativePath) => {
      try {
        const result = await assetsApi.assetUrl({ projectDir, relativePath });
        return result?.url || '';
      } catch {
        return '';
      }
    };

    // 小窗不写存档，使用内存空实现。
    const storage = {
      list: async () => [],
      get: async () => null,
      put: async (save) => save,
      remove: async () => {},
    };

    const scheduleNodeAdvance = (nodeId, nodeType) => {
      clearNodeTimer();
      if (nodeType === 'dialogue') {
        // 对白由 clone 中注入的 autoAdvanceMs 驱动；这里不再定时点击，避免抢在打字完成前推进。
        return;
      }
      if (nodeType === 'choice') {
        choiceTimer = window.setTimeout(() => {
          if (alive) clickChoice();
        }, CHOICE_PICK_DELAY_MS);
        return;
      }
      if (nodeType === 'video') {
        nodeTimer = window.setTimeout(() => {
          if (!alive) return;
          const skip = stage.querySelector('.vnrt-video__skip');
          if (skip) skip.click();
        }, VIDEO_SKIP_DELAY_MS);
        return;
      }
      if (nodeType === 'minigame') {
        // 小游戏需要外部输入；演示无法继续时回到场景开头，避免卡死。
        nodeTimer = window.setTimeout(() => {
          if (!alive) return;
          const state = runtimeRef.current?.getState?.();
          if (state?.nodeId === nodeId) restartLoop();
        }, MINIGAME_GIVEUP_MS);
        return;
      }
      const duration = Number(previewProject.timelines?.[nodeId]?.durationMs);
      const delay = Number.isFinite(duration) && duration > 0 ? duration + 500 : DEFAULT_NODE_ADVANCE_MS;
      nodeTimer = window.setTimeout(() => {
        if (!alive) return;
        const state = runtimeRef.current?.getState?.();
        if (state?.nodeId === nodeId) canvasClick();
      }, delay);
    };

    try {
      const runtime = createRuntime({
        root: stage,
        project: previewProject,
        resolveAssetUrl,
        storage,
        autoStart: true,
        showTitle: false,
        muted: true,
        keyboard: false,
        onStateChange: (state) => {
          if (!alive) return;
          setStatus(state?.status || 'running');
          setError(state?.error || '');
          const nodeId = state?.nodeId ?? null;
          const nodeType = state?.nodeType ?? null;
          if (!nodeId) return;

          if (state?.ended) {
            clearNodeTimer();
            if (restartTimer) window.clearTimeout(restartTimer);
            restartTimer = window.setTimeout(restartLoop, LOOP_RESTART_DELAY_MS);
            return;
          }
          if (restartTimer) {
            window.clearTimeout(restartTimer);
            restartTimer = null;
          }
          if (state?.choice) {
            clearNodeTimer();
            if (choiceTimer) window.clearTimeout(choiceTimer);
            choiceTimer = window.setTimeout(() => {
              if (alive) clickChoice();
            }, CHOICE_PICK_DELAY_MS);
            return;
          }
          if (choiceTimer) {
            window.clearTimeout(choiceTimer);
            choiceTimer = null;
          }
          if (nodeId !== watchedNodeId) {
            watchedNodeId = nodeId;
            scheduleNodeAdvance(nodeId, nodeType);
          }
        },
      });
      runtimeRef.current = runtime;
    } catch (runtimeError) {
      console.error('[scene-preview] 启动失败', runtimeError);
      setError(runtimeError?.message || String(runtimeError));
      setStatus('error');
    }

    return () => {
      alive = false;
      clearNodeTimer();
      if (choiceTimer) window.clearTimeout(choiceTimer);
      if (restartTimer) window.clearTimeout(restartTimer);
      try {
        runtimeRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      runtimeRef.current = null;
    };
  }, [sceneId, previewProject, projectDir, collapsed]);

  const handleReplay = useCallback(() => {
    try {
      runtimeRef.current?.restart?.();
      setError('');
      setStatus('running');
    } catch (runtimeError) {
      setError(runtimeError?.message || String(runtimeError));
    }
  }, []);

  // 拖动标题栏移动小窗（限制在画布范围内）。
  const handleDragStart = useCallback((event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button')) return;
    const panel = panelRef.current;
    const container = panel?.offsetParent;
    if (!panel || !container) return;
    const panelRect = panel.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const maxLeft = Math.max(8, containerRect.width - panelRect.width - 8);
    const maxTop = Math.max(8, containerRect.height - panelRect.height - 8);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      left: panelRect.left - containerRect.left,
      top: panelRect.top - containerRect.top,
      maxLeft,
      maxTop,
    };
    event.preventDefault();
    const onMove = (moveEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setPos({
        left: Math.min(Math.max(8, drag.left + moveEvent.clientX - drag.startX), drag.maxLeft),
        top: Math.min(Math.max(8, drag.top + moveEvent.clientY - drag.startY), drag.maxTop),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  if (!sceneNode) return null;

  const panelStyle = {
    width: `${PANEL_WIDTH}px`,
    ...(pos ? { left: `${pos.left}px`, top: `${pos.top}px`, bottom: 'auto' } : null),
  };

  return (
    <section className={`vn-scene-preview${collapsed ? ' is-collapsed' : ''}`} ref={panelRef} style={panelStyle}>
      <header
        className="vn-scene-preview__head"
        onPointerDown={handleDragStart}
        title="拖动可移动小窗"
      >
        <span className="vn-scene-preview__dot" aria-hidden="true" />
        <span className="vn-scene-preview__title">场景预览</span>
        <span className="vn-scene-preview__name" title={sceneName}>
          {sceneName}
        </span>
        <span className={`vn-scene-preview__state is-${status}`}>{STATUS_TEXT[status] ?? status}</span>
        <button
          type="button"
          className="vn-scene-preview__btn"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? '展开预览' : '收起预览'}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </header>

      {collapsed ? null : (
        <div className="vn-scene-preview__body">
          <div
            className="vn-scene-preview__stage"
            ref={stageRef}
            style={{ aspectRatio: `${resolution.width} / ${resolution.height}` }}
          />
          {error ? (
            <div className="vn-scene-preview__error" title={error}>
              {error}
            </div>
          ) : (
            <div className="vn-scene-preview__hint">
              自动循环演示 · 可点击画面推进
              <button type="button" className="vn-scene-preview__replay" onClick={handleReplay}>
                重播
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
