import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useProjectController } from '../../state/ProjectContext';
import {
  DEFAULT_TIMELINE_DURATION,
  EASING_PRESET_KEYS,
  EASING_PRESETS,
  PROPERTY_META,
  TRACK_KINDS,
  addKeyframeToTrack,
  clamp,
  clampTrackValue,
  createTimeline,
  createTrackDraft,
  easingToPreset,
  evaluateTrack,
  formatTime,
  hasTrackFor,
  intensityToBezier,
  listTrackCandidates,
  nextKeyframeTime,
  prevKeyframeTime,
  removeKeyframeFromTrack,
  removeTrackFromTimeline,
  staticValueForTrack,
  trackExpandedLabel,
  updateKeyframeInTrack,
} from './timelineUtils';
import '../../styles/timeline.css';

const LABEL_WIDTH = 190;
const RULER_HEIGHT = 26;
const TRACK_HEIGHT = 34;
const BASE_PX_PER_SECOND = 120;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

const TICK_STEPS_MS = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000];
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

function pxPerMsFor(zoom) {
  return (BASE_PX_PER_SECOND * zoom) / 1000;
}

function tickInterval(zoom) {
  const pxPerMs = pxPerMsFor(zoom);
  return TICK_STEPS_MS.find((ms) => ms * pxPerMs >= 56) ?? TICK_STEPS_MS[TICK_STEPS_MS.length - 1];
}

function candidateLabel(project, sceneNode, trackLike) {
  return trackExpandedLabel(project, sceneNode, trackLike);
}

function staticText(sceneNode, track) {
  const value = staticValueForTrack(sceneNode, track);
  const meta = PROPERTY_META[track.property];
  return value.toFixed(meta?.integer ? 0 : 2);
}

function KeyframeInspector({ track, keyframe, durationMs, onChange, onDelete, notify }) {
  const meta = PROPERTY_META[track.property] ?? { min: -9999, max: 9999, step: 0.01, label: track.property };
  const [timeDraft, setTimeDraft] = useState(String(keyframe.time));
  const [valueDraft, setValueDraft] = useState(String(keyframe.value));
  const [preset, setPreset] = useState('linear');
  const [intensity, setIntensity] = useState(0);

  useEffect(() => {
    setTimeDraft(String(keyframe.time));
    setValueDraft(String(keyframe.value));
    const parsed = easingToPreset(keyframe.easing);
    setPreset(parsed.presetKey);
    setIntensity(parsed.intensity);
  }, [keyframe.time, keyframe.value, keyframe.easing]);

  const commitTime = () => {
    const next = Math.round(Number(timeDraft));
    if (!Number.isFinite(next) || next < 0 || next > durationMs) {
      notify(`时间必须是 0–${durationMs} 的整数毫秒`, 'error');
      setTimeDraft(String(keyframe.time));
      return;
    }
    if (next === keyframe.time) return;
    if (track.keys.some((item) => item.time === next)) {
      notify('该时间已经有另一个关键帧了', 'error');
      setTimeDraft(String(keyframe.time));
      return;
    }
    onChange({ time: next });
  };

  const commitValue = () => {
    const raw = Number(valueDraft);
    if (!Number.isFinite(raw) || raw < meta.min || raw > meta.max) {
      notify(`数值必须在 ${meta.min}–${meta.max} 之间`, 'error');
      setValueDraft(String(keyframe.value));
      return;
    }
    const next = clampTrackValue(track.property, raw);
    if (next !== keyframe.value) onChange({ value: next });
  };

  const applyEasing = (presetKey, intensityValue) => {
    const safeIntensity = presetKey === 'linear' ? 0 : clamp(intensityValue, 0, 1);
    onChange({ easing: intensityToBezier(presetKey, safeIntensity) });
  };

  const bezier = keyframe.easing ?? intensityToBezier('linear', 0);

  return (
    <div className="vn-tl-inspector">
      <div className="vn-tl-inspector__title">
        <span>关键帧</span>
        <span className="vn-tl-inspector__meta">{PROPERTY_META[track.property]?.label ?? track.property}</span>
      </div>
      <label className="vn-tl-field">
        <span>时间 ms</span>
        <input
          className="vn-input"
          type="number"
          step="1"
          min="0"
          max={durationMs}
          value={timeDraft}
          onChange={(event) => setTimeDraft(event.target.value)}
          onBlur={commitTime}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </label>
      <label className="vn-tl-field">
        <span>数值</span>
        <input
          className="vn-input"
          type="number"
          step={meta.step}
          min={meta.min}
          max={meta.max}
          value={valueDraft}
          onChange={(event) => setValueDraft(event.target.value)}
          onBlur={commitValue}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </label>
      <div className="vn-tl-easing">
        <span className="vn-tl-easing__label">缓动</span>
        {EASING_PRESET_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className={`vn-tl-easing__btn${preset === key ? ' is-active' : ''}`}
            onClick={() => {
              setPreset(key);
              setIntensity(key === 'linear' ? 0 : intensity || 0.5);
              applyEasing(key, key === 'linear' ? 0 : intensity || 0.5);
            }}
          >
            {EASING_PRESETS[key].label}
          </button>
        ))}
        <input
          className="vn-tl-easing__slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={intensity}
          disabled={preset === 'linear'}
          title="缓动强度"
          onChange={(event) => {
            const next = Number(event.target.value);
            setIntensity(next);
            applyEasing(preset, next);
          }}
        />
        <span className="vn-tl-easing__value">
          {preset === 'linear' ? '—' : `${Math.round(intensity * 100)}%`}
        </span>
        <code className="vn-tl-easing__code">
          p1 [{bezier.p1[0]}, {bezier.p1[1]}] p2 [{bezier.p2[0]}, {bezier.p2[1]}]
        </code>
        <button
          type="button"
          className="vn-btn vn-btn--danger vn-tl-delete-key"
          onClick={onDelete}
        >
          删除关键帧
        </button>
      </div>
    </div>
  );
}

export default function TimelineEditor({ project, sceneNode }) {
  const controller = useProjectController();
  const { actions, notify } = controller;
  const sceneId = sceneNode?.id ?? null;
  const timeline = sceneNode ? project.timelines?.[sceneId] ?? null : null;
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  const rootRef = useRef(null);
  const contentRef = useRef(null);
  const menuRef = useRef(null);
  const addMenuRef = useRef(null);
  const scrollRef = useRef(null);

  const [zoom, setZoom] = useState(1);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [durationDraft, setDurationDraft] = useState(String(timeline?.durationMs ?? DEFAULT_TIMELINE_DURATION));

  const pxPerMs = pxPerMsFor(zoom);
  const durationMs = timeline?.durationMs ?? DEFAULT_TIMELINE_DURATION;
  const totalWidth = Math.max(280, durationMs * pxPerMs);

  const selectedTrack = selected ? timeline?.tracks?.find((track) => track.id === selected.trackId) ?? null : null;
  const selectedKey = selectedTrack
    ? selectedTrack.keys.find((key) => key.time === selected.time) ?? null
    : null;

  const commitTimeline = useCallback(
    (nextTimeline) => {
      if (!sceneId || !nextTimeline) return;
      actions.setTimeline(sceneId, nextTimeline);
    },
    [actions, sceneId],
  );

  const commitTrack = useCallback(
    (nextTrack) => {
      const current = timelineRef.current;
      if (!current) return;
      commitTimeline({
        ...current,
        tracks: current.tracks.map((track) => (track.id === nextTrack.id ? nextTrack : track)),
      });
    },
    [commitTimeline],
  );

  // 场景切换时重置本地状态
  useEffect(() => {
    setPlayhead(0);
    setPlaying(false);
    setSelected(null);
    setMenuOpen(false);
    setDragPreview(null);
    setZoom(1);
  }, [sceneId]);

  useEffect(() => {
    setDurationDraft(String(timeline?.durationMs ?? DEFAULT_TIMELINE_DURATION));
  }, [timeline?.durationMs]);

  useEffect(() => {
    if (playhead > durationMs) setPlayhead(durationMs);
  }, [durationMs, playhead]);

  // 播放
  useEffect(() => {
    if (!playing || !timeline) return undefined;
    const loop = Boolean(timeline.loop);
    const duration = timeline.durationMs;
    const startedAt = performance.now();
    const startPlayhead = playhead >= duration ? 0 : playhead;
    let raf = 0;
    const tick = (now) => {
      const elapsed = now - startedAt;
      let next = startPlayhead + elapsed;
      if (next >= duration) {
        if (loop) {
          next %= duration;
        } else {
          setPlayhead(duration);
          setPlaying(false);
          return;
        }
      }
      setPlayhead(Math.round(next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timeline?.durationMs, timeline?.loop]);

  // Ctrl/Cmd + 滚轮缩放（原生监听以阻止默认滚动）
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;
    const onWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      const index = ZOOM_STEPS.findIndex((step) => step >= zoom);
      const nextIndex = clamp((index < 0 ? ZOOM_STEPS.length - 1 : index) + direction, 0, ZOOM_STEPS.length - 1);
      setZoom(ZOOM_STEPS[nextIndex]);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [zoom]);

  // 菜单外部点击关闭
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event) => {
      // 按钮自身交给 onClick 切换，避免 mousedown 先关闭、click 又立刻打开。
      if (addMenuRef.current?.contains(event.target)) return;
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  // 「+ 轨道」菜单通过 portal 渲染到 body：
  // 1) 工具栏 overflow-x:auto 会同时裁剪纵向内容，菜单位于工具栏之外会被裁掉/被轨道遮住；
  // 2) 时间轴贴在窗口底部，向下空间不足时改为向上弹出。
  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return undefined;
    }
    const measure = () => {
      const rect = addMenuRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const menuWidth = 310;
      const menuMaxHeight = 320;
      const right = Math.max(
        margin,
        Math.min(window.innerWidth - rect.right, window.innerWidth - menuWidth - margin),
      );
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
      const maxHeight = Math.round(Math.max(96, Math.min(menuMaxHeight, openUp ? spaceAbove : spaceBelow)));
      setMenuPos(
        openUp
          ? { bottom: Math.round(window.innerHeight - rect.top + 4), right: Math.round(right), maxHeight }
          : { top: Math.round(rect.bottom + 4), right: Math.round(right), maxHeight },
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [menuOpen]);

  const createNewTimeline = () => {
    if (!sceneNode) return;
    const next = createTimeline(sceneNode.id, DEFAULT_TIMELINE_DURATION);
    commitTimeline(next);
    setPlayhead(0);
    notify('已创建时间轴（5 秒）', 'success');
    rootRef.current?.focus();
  };

  const removeTimeline = () => {
    if (!timeline || !sceneId) return;
    if (!window.confirm('删除该场景的整条时间轴？关键帧会全部丢失。')) return;
    actions.removeTimeline(sceneId);
    setSelected(null);
    setPlaying(false);
    setPlayhead(0);
    notify('已删除时间轴', 'success');
  };

  const setDuration = () => {
    if (!timeline) return;
    const next = Math.round(Number(durationDraft));
    const maxKey = Math.max(0, ...timeline.tracks.flatMap((track) => track.keys.map((key) => key.time)));
    if (!Number.isFinite(next) || next < 100 || next > 600000) {
      notify('时长必须是 100–600000 的整数毫秒', 'error');
      setDurationDraft(String(timeline.durationMs));
      return;
    }
    if (next < maxKey) {
      notify(`时长不能小于已有最大关键帧时间（${maxKey}ms）`, 'error');
      setDurationDraft(String(timeline.durationMs));
      return;
    }
    actions.setTimelineDuration(sceneId, next);
  };

  const addTrack = (candidate) => {
    if (!timeline || !sceneNode) return;
    const draft = createTrackDraft({
      sceneNode,
      timeline,
      kind: candidate.kind,
      target: candidate.target,
      property: candidate.property,
    });
    if (draft.error) {
      notify(draft.error, 'error');
      return;
    }
    commitTimeline({ ...timeline, tracks: [...timeline.tracks, draft.track] });
    setSelected({ trackId: draft.track.id, time: 0 });
    setPlayhead(0);
    setMenuOpen(false);
    notify('已添加轨道', 'success');
  };

  const removeTrack = (track) => {
    if (!timeline) return;
    if (!window.confirm('删除该轨道及其全部关键帧？')) return;
    commitTimeline(removeTrackFromTimeline(timeline, track.id));
    if (selected?.trackId === track.id) setSelected(null);
  };

  const selectKeyframe = (track, key, alsoSeek = true) => {
    setSelected({ trackId: track.id, time: key.time });
    if (alsoSeek) setPlayhead(key.time);
  };

  const updateSelectedKey = (patch) => {
    if (!selectedTrack || !selectedKey) return;
    const nextTrack = updateKeyframeInTrack(selectedTrack, selectedKey.time, patch);
    commitTrack(nextTrack);
    if (patch.time !== undefined) {
      setSelected({ trackId: selectedTrack.id, time: patch.time });
      setPlayhead(patch.time);
    }
  };

  const deleteSelectedKey = () => {
    if (!selectedTrack || !selectedKey) return;
    const nextTrack = removeKeyframeFromTrack(selectedTrack, selectedKey.time);
    commitTrack(nextTrack);
    setSelected(null);
    notify('已删除关键帧', 'success');
  };

  const addKeyframeAt = (track, timeMs, value) => {
    const safeTime = clamp(Math.round(timeMs), 0, durationMs);
    const baseValue = value ?? evaluateTrack(track, safeTime);
    const nextTrack = addKeyframeToTrack(track, safeTime, baseValue, intensityToBezier('linear', 0));
    commitTrack(nextTrack);
    setSelected({ trackId: track.id, time: safeTime });
    setPlayhead(safeTime);
  };

  const addAtPlayhead = () => {
    if (!timeline) return;
    const track = selectedTrack ?? timeline.tracks[0];
    if (!track) {
      notify('请先添加一条轨道', 'warn');
      return;
    }
    addKeyframeAt(track, playhead);
  };

  const jumpKeyframe = (direction) => {
    if (!timeline) return;
    const tracks = selectedTrack ? [selectedTrack] : timeline.tracks;
    const times = tracks.flatMap((track) =>
      direction < 0 ? [prevKeyframeTime(track, playhead)] : [nextKeyframeTime(track, playhead)],
    ).filter((time) => time !== null);
    if (times.length === 0) return;
    setPlayhead(direction < 0 ? Math.max(...times) : Math.min(...times));
  };

  const timeFromClientX = (clientX, element, includeLabel = false) => {
    const rect = (element ?? contentRef.current)?.getBoundingClientRect();
    if (!rect) return 0;
    const offset = clientX - rect.left - (includeLabel ? LABEL_WIDTH : 0);
    return clamp(Math.round(offset / pxPerMs), 0, durationMs);
  };

  const startScrub = (event) => {
    if (!timeline) return;
    event.preventDefault();
    rootRef.current?.focus();
    setPlaying(false);
    const content = contentRef.current;
    const update = (clientX) => setPlayhead(timeFromClientX(clientX, content, true));
    update(event.clientX);
    const onMove = (moveEvent) => update(moveEvent.clientX);
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const startKeyDrag = (event, track, key) => {
    event.preventDefault();
    event.stopPropagation();
    rootRef.current?.focus();
    setSelected({ trackId: track.id, time: key.time });
    setPlayhead(key.time);
    const trackElement = event.currentTarget.parentElement;
    const rect = trackElement.getBoundingClientRect();
    const fromTime = key.time;
    let toTime = key.time;
    setDragPreview({ trackId: track.id, fromTime, toTime });
    const onMove = (moveEvent) => {
      toTime = clamp(Math.round((moveEvent.clientX - rect.left) / pxPerMs), 0, durationMs);
      setDragPreview({ trackId: track.id, fromTime, toTime });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      setDragPreview(null);
      if (toTime !== fromTime) {
        const current = timelineRef.current;
        const currentTrack = current?.tracks.find((item) => item.id === track.id);
        if (currentTrack) {
          const occupied = currentTrack.keys.some((item) => item.time === toTime && item.time !== fromTime);
          if (occupied) {
            notify('该时间已经有另一个关键帧了', 'error');
          } else {
            const nextTrack = updateKeyframeInTrack(currentTrack, fromTime, { time: toTime });
            commitTrack(nextTrack);
            setSelected({ trackId: track.id, time: toTime });
            setPlayhead(toTime);
          }
        }
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const onTrackDoubleClick = (event, track) => {
    event.preventDefault();
    const time = timeFromClientX(event.clientX, event.currentTarget, false);
    addKeyframeAt(track, time);
  };

  const onKeyDown = (event) => {
    const target = event.target;
    if (
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) ||
      target?.isContentEditable
    ) {
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      if (timeline) setPlaying((value) => !value);
      return;
    }
    if (event.key.toLowerCase() === 'k') {
      event.preventDefault();
      addAtPlayhead();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      jumpKeyframe(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!selectedKey) return;
      event.preventDefault();
      deleteSelectedKey();
    }
  };

  const handleRootPointerDown = (event) => {
    const target = event.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return;
    rootRef.current?.focus({ preventScroll: true });
  };

  const zoomBy = (direction) => {
    const index = ZOOM_STEPS.findIndex((step) => step >= zoom);
    const currentIndex = index < 0 ? ZOOM_STEPS.length - 1 : index;
    const nextIndex = clamp(currentIndex + direction, 0, ZOOM_STEPS.length - 1);
    setZoom(ZOOM_STEPS[nextIndex]);
  };

  if (!sceneNode) {
    return (
      <div className="vn-tl vn-tl--empty" ref={rootRef} tabIndex={0}>
        <div className="vn-tl-empty">
          <strong>时间轴</strong>
          <span>在蓝图选中一个场景节点后，在这里编辑轨道与关键帧</span>
        </div>
      </div>
    );
  }

  if (!timeline) {
    return (
      <div className="vn-tl vn-tl--empty" ref={rootRef} tabIndex={0} onPointerDown={handleRootPointerDown}>
        <div className="vn-tl-empty">
          <strong>场景「{sceneNode.name}」还没有时间轴</strong>
          <span>时间轴关键帧会覆盖蓝图静态值，未覆盖的属性沿用蓝图。</span>
          <button type="button" className="vn-btn" onClick={createNewTimeline}>
            创建时间轴
          </button>
        </div>
      </div>
    );
  }

  const candidates = listTrackCandidates(sceneNode);
  const grouped = ['sprite', 'background', 'audio', 'textbox'].map((kind) => ({
    kind,
    label: TRACK_KINDS[kind]?.label ?? kind,
    items: candidates.filter((candidate) => candidate.kind === kind),
  }));
  const interval = tickInterval(zoom);
  const tickCount = Math.floor(durationMs / interval) + 1;
  const ticks = Array.from({ length: tickCount }, (_, index) => index * interval);
  const playheadLeft = LABEL_WIDTH + playhead * pxPerMs;

  return (
    <div
      className="vn-tl"
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={handleRootPointerDown}
    >
      <div className="vn-tl-toolbar">
        <div className="vn-tl-toolbar__left">
          <span className="vn-tl-title">时间轴</span>
          <span className="vn-tl-scene">{sceneNode.name}</span>
          <button
            type="button"
            className="vn-btn vn-btn--ghost vn-tl-play"
            onClick={() => setPlaying((value) => !value)}
            title="Space 播放/暂停"
          >
            {playing ? '暂停' : '播放'}
          </button>
          <span className="vn-tl-time">
            {formatTime(playhead)} / {formatTime(durationMs)}
          </span>
        </div>
        <div className="vn-tl-toolbar__right">
          <label className="vn-tl-inline-field">
            时长
            <input
              className="vn-input vn-tl-duration"
              type="number"
              min="100"
              max="600000"
              step="100"
              value={durationDraft}
              onChange={(event) => setDurationDraft(event.target.value)}
              onBlur={setDuration}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            ms
          </label>
          <label className="vn-tl-inline-check">
            <input
              type="checkbox"
              checked={Boolean(timeline.loop)}
              onChange={(event) => commitTimeline({ ...timeline, loop: event.target.checked })}
            />
            循环
          </label>
          <span className="vn-tl-zoom">
            <button type="button" className="vn-btn vn-btn--ghost" onClick={() => zoomBy(-1)} title="缩小">
              −
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" className="vn-btn vn-btn--ghost" onClick={() => zoomBy(1)} title="放大">
              +
            </button>
          </span>
          <div className="vn-tl-add" ref={addMenuRef}>
            <button type="button" className="vn-btn" onClick={() => setMenuOpen((open) => !open)}>
              + 轨道
            </button>
          </div>
          <button type="button" className="vn-btn vn-btn--danger" onClick={removeTimeline}>
            删除时间轴
          </button>
        </div>
      </div>

      {menuOpen && menuPos
        ? createPortal(
            <div
              className="vn-tl-menu vn-tl-menu--floating"
              role="menu"
              aria-label="添加轨道"
              ref={menuRef}
              style={{
                position: 'fixed',
                top: menuPos.top ?? 'auto',
                bottom: menuPos.bottom ?? 'auto',
                right: menuPos.right,
                maxHeight: menuPos.maxHeight,
              }}
            >
              {grouped.map((group) => (
                <div key={group.kind} className="vn-tl-menu__group">
                  <div className="vn-tl-menu__title">
                    {group.label}
                    {group.items.length === 0 ? <span className="vn-tl-menu__empty">（无可用目标）</span> : null}
                  </div>
                  {group.items.map((candidate) => {
                    const disabled = hasTrackFor(
                      timeline,
                      candidate.kind,
                      candidate.target,
                      candidate.property,
                    );
                    return (
                      <button
                        key={`${candidate.kind}-${candidate.target ?? ''}-${candidate.property}`}
                        type="button"
                        className="vn-tl-menu__item"
                        disabled={disabled}
                        onClick={() => addTrack(candidate)}
                        title={disabled ? '该属性已有轨道' : '添加轨道'}
                      >
                        {candidateLabel(project, sceneNode, {
                          kind: candidate.kind,
                          target: candidate.target,
                          property: candidate.property,
                        })}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}

      <div className="vn-tl-scroll" ref={scrollRef}>
        <div className="vn-tl-content" ref={contentRef} style={{ width: `${LABEL_WIDTH + totalWidth}px` }}>
          <div className="vn-tl-ruler-row">
            <div className="vn-tl-label vn-tl-label--ruler">时间</div>
            <div
              className="vn-tl-ruler"
              style={{ width: `${totalWidth}px` }}
              onPointerDown={startScrub}
              title="点击/拖拽定位播放头"
            >
              {ticks.map((time) => (
                <div key={time} className="vn-tl-tick" style={{ left: `${time * pxPerMs}px` }}>
                  <span>{time >= 1000 ? `${(time / 1000).toFixed(time % 1000 === 0 ? 0 : 1)}s` : `${time}ms`}</span>
                </div>
              ))}
            </div>
          </div>

          {timeline.tracks.length === 0 ? (
            <div className="vn-tl-row">
              <div className="vn-tl-label">轨道</div>
              <div className="vn-tl-track vn-tl-track--empty" style={{ width: `${totalWidth}px` }}>
                还没有轨道，点击右上角「+ 轨道」添加；双击轨道空白处可直接加关键帧。
              </div>
            </div>
          ) : null}

          {timeline.tracks.map((track) => {
            const meta = PROPERTY_META[track.property] ?? { label: track.property, integer: false };
            const currentValue = evaluateTrack(track, playhead);
            return (
              <div className="vn-tl-row" key={track.id}>
                <div className="vn-tl-label">
                  <span className="vn-tl-label__name" title={trackExpandedLabel(project, sceneNode, track)}>
                    {trackExpandedLabel(project, sceneNode, track)}
                  </span>
                  <span className="vn-tl-label__meta">
                    静态 {staticText(sceneNode, track)} · 当前{' '}
                    {currentValue.toFixed(meta.integer ? 0 : 2)}
                  </span>
                  <button
                    type="button"
                    className="vn-tl-track-del"
                    title="删除轨道"
                    onClick={() => removeTrack(track)}
                  >
                    ×
                  </button>
                </div>
                <div
                  className="vn-tl-track"
                  style={{ width: `${totalWidth}px`, height: `${TRACK_HEIGHT}px` }}
                  onDoubleClick={(event) => onTrackDoubleClick(event, track)}
                  title="双击添加关键帧"
                >
                  <div className="vn-tl-track__line" />
                  {track.keys.map((key) => {
                    const isSelected = selected?.trackId === track.id && selected.time === key.time;
                    const isDragged =
                      dragPreview?.trackId === track.id && dragPreview.fromTime === key.time;
                    const displayTime = isDragged ? dragPreview.toTime : key.time;
                    return (
                      <button
                        key={`${track.id}-${key.time}`}
                        type="button"
                        className={`vn-tl-key${isSelected ? ' is-selected' : ''}${isDragged ? ' is-dragging' : ''}`}
                        style={{ left: `${displayTime * pxPerMs}px` }}
                        title={`${formatTime(key.time)} · ${key.value}`}
                        onPointerDown={(event) => startKeyDrag(event, track, key)}
                        onDoubleClick={(event) => event.stopPropagation()}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="vn-tl-playhead" style={{ left: `${playheadLeft}px` }}>
            <span className="vn-tl-playhead__handle" />
          </div>
        </div>
      </div>

      {selectedKey && selectedTrack ? (
        <KeyframeInspector
          track={selectedTrack}
          keyframe={selectedKey}
          durationMs={durationMs}
          onChange={updateSelectedKey}
          onDelete={deleteSelectedKey}
          notify={notify}
        />
      ) : (
        <div className="vn-tl-hint">
          Space 播放/暂停 · K 在播放头加关键帧 · ←/→ 跳关键帧 · Delete 删除关键帧 · Ctrl/Cmd+滚轮缩放 · 双击轨道加关键帧
        </div>
      )}
    </div>
  );
}
