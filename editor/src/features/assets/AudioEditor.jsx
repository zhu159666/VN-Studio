import React, { useCallback, useEffect, useRef, useState } from 'react';
import { assetsApi } from '../../api.js';
import {
  clampTrim,
  computePeaks,
  dbToGain,
  formatBytes,
  formatTime,
} from './lib/audioUtils.js';
import '../../styles/asset-editor.css';

/** 波形画布 CSS 高度（px）。 */
const WAVE_HEIGHT = 128;
/** 峰值桶数量（契约要求 ≤2000）。 */
const PEAK_BUCKETS = 1600;
/** 手柄命中半径（px）。 */
const HANDLE_HIT_PX = 12;
/** 拖拽 / 数字输入的时间步进（ms）。 */
const TIME_STEP_MS = 10;

function createAudioContext() {
  const Ctor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  if (!Ctor) throw new Error('当前环境不支持 Web Audio，无法解码音频');
  return new Ctor();
}

function emptyPlayback() {
  return { source: null, gain: null, raf: 0, startedAt: 0, startMs: 0, endMs: 0 };
}

/**
 * 音频素材编辑器：波形裁剪（拖拽手柄 / 数字输入）、增益、试听、ogg/mp3 导出。
 *
 * @param {object} props
 * @param {object} props.asset audioAsset
 * @param {string} props.projectDir 项目绝对目录
 * @param {(asset:object)=>void} [props.onAssetUpdated] 导出成功后的新资产
 * @param {(message:string, kind?:string)=>void} [props.notify]
 */
export default function AudioEditor({ asset, projectDir, onAssetUpdated, notify }) {
  const safeNotify = typeof notify === 'function' ? notify : () => {};

  const [load, setLoad] = useState({ status: 'loading' });
  const [peaks, setPeaks] = useState(null);
  const [durationMs, setDurationMs] = useState(() => Math.max(1, Number(asset?.durationMs) || 1000));
  const [trim, setTrim] = useState(() =>
    clampTrim(asset?.trim, Math.max(1, Number(asset?.durationMs) || 1000)),
  );
  const [gainDb, setGainDb] = useState(() =>
    typeof asset?.gainDb === 'number' ? asset.gainDb : 0,
  );
  const [format, setFormat] = useState(asset?.format === 'mp3' ? 'mp3' : 'ogg');
  const [channelCount, setChannelCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [startInput, setStartInput] = useState(String(trim.startMs));
  const [endInput, setEndInput] = useState(String(trim.endMs));
  const [inputError, setInputError] = useState('');

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const audioBufferRef = useRef(null);
  const peaksRef = useRef(null);
  const durationRef = useRef(durationMs);
  const trimRef = useRef(trim);
  const playheadRef = useRef(trim.startMs);
  const playbackRef = useRef(emptyPlayback());
  const dragRef = useRef(null);

  // ── 波形绘制（读取 ref 中的最新值，回调用稳定引用）──────────────────────
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bounds = canvas.getBoundingClientRect();
    const cssWidth = Math.max(240, Math.round(bounds.width || 640));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const targetWidth = Math.round(cssWidth * dpr);
    const targetHeight = Math.round(WAVE_HEIGHT * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, WAVE_HEIGHT);
    ctx.fillStyle = '#0d1116';
    ctx.fillRect(0, 0, cssWidth, WAVE_HEIGHT);

    const total = Math.max(1, durationRef.current);
    const range = trimRef.current;
    const xStart = (range.startMs / total) * cssWidth;
    const xEnd = (range.endMs / total) * cssWidth;
    const mid = WAVE_HEIGHT / 2;

    // 中线
    ctx.strokeStyle = 'rgba(154, 168, 181, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(cssWidth, mid + 0.5);
    ctx.stroke();

    // 峰值（裁剪区内高亮，区外压暗）
    const currentPeaks = peaksRef.current;
    if (currentPeaks && currentPeaks.length > 0) {
      const step = cssWidth / currentPeaks.length;
      const barWidth = Math.max(1, step * 0.82);
      for (let i = 0; i < currentPeaks.length; i += 1) {
        const x = i * step;
        const height = Math.max(1, currentPeaks[i] * (WAVE_HEIGHT - 18) * 0.5);
        const inRange = x >= xStart && x <= xEnd;
        ctx.fillStyle = inRange ? '#5aa9ff' : 'rgba(90, 169, 255, 0.3)';
        ctx.fillRect(x, mid - height, barWidth, height * 2);
      }
    }

    // 裁剪区外遮罩
    ctx.fillStyle = 'rgba(8, 11, 14, 0.6)';
    ctx.fillRect(0, 0, xStart, WAVE_HEIGHT);
    ctx.fillRect(xEnd, 0, cssWidth - xEnd, WAVE_HEIGHT);

    // 选区边框
    ctx.strokeStyle = '#7be0c0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xStart, 0);
    ctx.lineTo(xStart, WAVE_HEIGHT);
    ctx.moveTo(xEnd, 0);
    ctx.lineTo(xEnd, WAVE_HEIGHT);
    ctx.stroke();

    // 两个可拖拽手柄（上下短条）
    ctx.fillStyle = '#7be0c0';
    ctx.fillRect(xStart - 2.5, 0, 5, 14);
    ctx.fillRect(xStart - 2.5, WAVE_HEIGHT - 14, 5, 14);
    ctx.fillRect(xEnd - 2.5, 0, 5, 14);
    ctx.fillRect(xEnd - 2.5, WAVE_HEIGHT - 14, 5, 14);

    // 播放头
    const playheadX = Math.min(cssWidth, Math.max(0, (playheadRef.current / total) * cssWidth));
    ctx.strokeStyle = '#ffc857';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, WAVE_HEIGHT);
    ctx.stroke();
  }, []);

  // ── 停止试听 ──────────────────────────────────────────────────────────
  const stopPlayback = useCallback(
    ({ settle = true } = {}) => {
      const playback = playbackRef.current;
      if (playback.raf) cancelAnimationFrame(playback.raf);
      if (playback.source) {
        try {
          playback.source.onended = null;
        } catch (error) {
          /* 忽略 */
        }
        try {
          playback.source.stop();
        } catch (error) {
          /* 已结束的 source 会抛 InvalidStateError，忽略 */
        }
        try {
          playback.source.disconnect();
        } catch (error) {
          /* 忽略 */
        }
      }
      if (playback.gain) {
        try {
          playback.gain.disconnect();
        } catch (error) {
          /* 忽略 */
        }
      }
      playbackRef.current = emptyPlayback();
      setPlaying(false);
      if (settle) {
        playheadRef.current = trimRef.current.startMs;
        drawWaveform();
      }
    },
    [drawWaveform],
  );

  // ── 统一的 trim 更新入口（同步 ref/state/数字输入框）─────────────────────
  const applyTrim = useCallback(
    (next) => {
      const clamped = clampTrim(next, durationRef.current);
      trimRef.current = clamped;
      setTrim(clamped);
      setStartInput(String(clamped.startMs));
      setEndInput(String(clamped.endMs));
      setInputError('');
      if (playbackRef.current.source) stopPlayback({ settle: false });
      if (playheadRef.current < clamped.startMs || playheadRef.current > clamped.endMs) {
        playheadRef.current = clamped.startMs;
      }
      drawWaveform();
    },
    [drawWaveform, stopPlayback],
  );

  // ── 加载音频（source 优先，缺失回退 path）──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const relativePath = asset?.source?.path ?? asset?.path;
    audioBufferRef.current = null;
    peaksRef.current = null;
    setPeaks(null);
    setLoad({ status: 'loading' });
    stopPlayback({ settle: false });

    if (!projectDir || !relativePath) {
      setLoad({ status: 'error', message: '缺少项目目录或素材路径' });
      return () => {
        cancelled = true;
      };
    }

    const context = (() => {
      try {
        return createAudioContext();
      } catch (error) {
        setLoad({ status: 'error', message: error?.message || '当前环境不支持 Web Audio' });
        return null;
      }
    })();
    if (!context) {
      return () => {
        cancelled = true;
      };
    }
    ctxRef.current = context;

    (async () => {
      try {
        const { url } = await assetsApi.assetUrl({ projectDir, relativePath });
        if (cancelled) return;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`读取音频文件失败（HTTP ${response.status}）`);
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;
        const buffer = await context.decodeAudioData(arrayBuffer);
        if (cancelled) return;
        audioBufferRef.current = buffer;
        const totalMs = Math.max(1, Math.round(buffer.duration * 1000));
        durationRef.current = totalMs;
        setDurationMs(totalMs);
        setChannelCount(buffer.numberOfChannels);
        const channelData = buffer.getChannelData(0);
        const nextPeaks = computePeaks(channelData, PEAK_BUCKETS);
        peaksRef.current = nextPeaks;
        setPeaks(nextPeaks);
        applyTrim(clampTrim(asset?.trim, totalMs));
        setGainDb(typeof asset?.gainDb === 'number' ? asset.gainDb : 0);
        setFormat(asset?.format === 'mp3' ? 'mp3' : 'ogg');
        setLoad({ status: 'ready' });
      } catch (error) {
        if (cancelled) return;
        setLoad({
          status: 'error',
          message:
            error?.message ||
            '音频解码失败：浏览器不支持该编码，或文件已损坏。可尝试重新导入为 ogg / mp3。',
        });
      }
    })();

    return () => {
      cancelled = true;
      stopPlayback({ settle: false });
      const current = ctxRef.current;
      ctxRef.current = null;
      if (current && current.state !== 'closed') {
        current.close().catch(() => {});
      }
    };
  }, [asset?.id, asset?.path, asset?.source?.path, projectDir, applyTrim, stopPlayback]);

  // ── 尺寸变化时重绘波形 ────────────────────────────────────────────────
  useEffect(() => {
    if (load.status !== 'ready') return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(() => drawWaveform());
    observer.observe(canvas);
    drawWaveform();
    return () => observer.disconnect();
  }, [load.status, drawWaveform]);

  // peaks / trim / 时长变化时重绘
  useEffect(() => {
    drawWaveform();
  }, [drawWaveform, peaks, trim.startMs, trim.endMs, durationMs]);

  // ── 拖拽手柄（window 监听在拖动期间挂载，卸载/抬起即清理）────────────────
  const timeAtEvent = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)),
    );
    return Math.min(
      durationRef.current,
      Math.max(0, Math.round((ratio * durationRef.current) / TIME_STEP_MS) * TIME_STEP_MS),
    );
  }, []);

  const handlePointerDown = useCallback(
    (event) => {
      if (load.status !== 'ready' || !peaksRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const x = Math.min(width, Math.max(0, event.clientX - bounds.left));
      const total = Math.max(1, durationRef.current);
      const xStart = (trimRef.current.startMs / total) * width;
      const xEnd = (trimRef.current.endMs / total) * width;
      const distanceStart = Math.abs(x - xStart);
      const distanceEnd = Math.abs(x - xEnd);
      let kind = null;
      if (distanceStart <= HANDLE_HIT_PX && distanceStart <= distanceEnd) kind = 'start';
      else if (distanceEnd <= HANDLE_HIT_PX) kind = 'end';

      if (!kind) {
        // 未命中手柄：点击区间内移动播放头
        if (x > xStart && x < xEnd) {
          playheadRef.current = timeAtEvent(event);
          drawWaveform();
        }
        return;
      }
      event.preventDefault();
      dragRef.current = kind;
      setDragging(true);
    },
    [load.status, timeAtEvent, drawWaveform],
  );

  const handlePointerMove = useCallback(
    (event) => {
      const kind = dragRef.current;
      if (!kind) return;
      const time = timeAtEvent(event);
      const current = trimRef.current;
      if (kind === 'start') {
        applyTrim({ startMs: Math.min(time, current.endMs - TIME_STEP_MS), endMs: current.endMs });
      } else {
        applyTrim({ startMs: current.startMs, endMs: Math.max(time, current.startMs + TIME_STEP_MS) });
      }
    },
    [applyTrim, timeAtEvent],
  );

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (event) => handlePointerMove(event);
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, handlePointerMove]);

  // ── 数字输入 ──────────────────────────────────────────────────────────
  const commitTrimInputs = useCallback(() => {
    const total = durationRef.current;
    const start = Number(startInput);
    const end = Number(endInput);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      setInputError('请输入有效的毫秒数');
      return;
    }
    if (start < 0 || end > total) {
      setInputError(`时间范围需在 0–${total} ms 内`);
      return;
    }
    if (end <= start) {
      setInputError('结束时间必须大于起始时间');
      return;
    }
    setInputError('');
    applyTrim({ startMs: Math.round(start), endMs: Math.round(end) });
  }, [applyTrim, startInput, endInput]);

  // ── 试听 ──────────────────────────────────────────────────────────────
  const handleTogglePlay = useCallback(async () => {
    if (playing) {
      stopPlayback();
      return;
    }
    const buffer = audioBufferRef.current;
    if (!buffer) {
      safeNotify('音频尚未加载完成', 'error');
      return;
    }
    let context = ctxRef.current;
    try {
      if (!context || context.state === 'closed') {
        context = createAudioContext();
        ctxRef.current = context;
      }
      if (context.state === 'suspended') await context.resume();
      const current = trimRef.current;
      if (current.endMs <= current.startMs) {
        safeNotify('裁剪区间无效', 'error');
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gainNode = context.createGain();
      gainNode.gain.value = dbToGain(gainDb);
      source.connect(gainNode);
      gainNode.connect(context.destination);

      const startedAt = context.currentTime + 0.03;
      source.start(
        startedAt,
        current.startMs / 1000,
        Math.max(0.01, (current.endMs - current.startMs) / 1000),
      );
      playbackRef.current = {
        source,
        gain: gainNode,
        raf: 0,
        startedAt,
        startMs: current.startMs,
        endMs: current.endMs,
      };
      source.onended = () => {
        if (playbackRef.current.source === source) stopPlayback();
      };
      playheadRef.current = current.startMs;
      setPlaying(true);
      const tick = () => {
        const playback = playbackRef.current;
        if (!playback.source || playback.source !== source) return;
        const elapsed = Math.max(0, context.currentTime - playback.startedAt);
        const position = Math.min(playback.endMs, playback.startMs + elapsed * 1000);
        playheadRef.current = position;
        drawWaveform();
        if (position >= playback.endMs - 2) stopPlayback();
        else playback.raf = requestAnimationFrame(tick);
      };
      playbackRef.current.raf = requestAnimationFrame(tick);
    } catch (error) {
      stopPlayback({ settle: false });
      safeNotify(error?.message || '试听失败', 'error');
    }
  }, [playing, gainDb, drawWaveform, stopPlayback, safeNotify]);

  // 组件卸载：停播 + 关闭 AudioContext
  useEffect(
    () => () => {
      stopPlayback({ settle: false });
      const current = ctxRef.current;
      ctxRef.current = null;
      if (current && current.state !== 'closed') current.close().catch(() => {});
    },
    [stopPlayback],
  );

  // ── 导出 ──────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (saving) return;
    const current = trimRef.current;
    if (current.endMs <= current.startMs) {
      safeNotify('裁剪区间无效，请先调整起止时间', 'error');
      return;
    }
    setSaving(true);
    try {
      const response = await assetsApi.exportAudio({
        projectDir,
        asset,
        trim: { startMs: current.startMs, endMs: current.endMs },
        gainDb,
        format,
      });
      if (response?.asset) onAssetUpdated?.(response.asset);
      safeNotify('音频已导出', 'success');
    } catch (error) {
      safeNotify(error?.message || '导出音频失败', 'error');
    } finally {
      setSaving(false);
    }
  }, [saving, projectDir, asset, gainDb, format, onAssetUpdated, safeNotify]);

  const handleResetTrim = useCallback(() => {
    applyTrim({ startMs: 0, endMs: durationRef.current });
  }, [applyTrim]);

  // ── 渲染 ──────────────────────────────────────────────────────────────
  const sourcePath = asset?.source?.path;
  const hasSource = Boolean(sourcePath && sourcePath !== asset?.path);
  const trimmedMs = Math.max(0, trim.endMs - trim.startMs);
  const ready = load.status === 'ready';

  return (
    <section className="vn-ed vn-ed-audio">
      <header className="vn-ed-head">
        <h3 className="vn-ed-title">音频编辑</h3>
        <span className="vn-ed-meta">
          {asset?.name || asset?.id} · {asset?.format?.toUpperCase?.() || '音频'}
        </span>
      </header>

      {!hasSource && (
        <div className="vn-ed-notice">无原始文件，编辑将基于当前文件（可能已包含上次裁剪/增益）。</div>
      )}

      {load.status === 'loading' && <div className="vn-ed-state">正在解码音频…</div>}
      {load.status === 'error' && (
        <div className="vn-ed-state vn-ed-state-error">音频加载失败：{load.message}</div>
      )}

      {ready && (
        <>
          <div className={`vn-ed-audio-wave-wrap${dragging ? ' is-dragging' : ''}`}>
            <canvas
              ref={canvasRef}
              className="vn-ed-audio-canvas"
              onPointerDown={handlePointerDown}
            />
            <div className="vn-ed-audio-wave-hint">拖动两侧手柄截取片段；区间内点击可移动播放头</div>
          </div>

          <div className="vn-ed-audio-meta">
            <span>原始时长 {formatTime(durationMs)}</span>
            <span>裁剪后 {formatTime(trimmedMs)}</span>
            <span>声道 {channelCount}</span>
            <span>文件大小 {formatBytes(asset?.sizeBytes)}</span>
          </div>

          <div className="vn-ed-audio-tools">
            <div className="vn-ed-panel">
              <div className="vn-ed-panel-title">截取区间</div>
              <div className="vn-ed-input-row">
                <label className="vn-ed-label" htmlFor="vn-ed-audio-start">
                  起始 (ms)
                </label>
                <input
                  id="vn-ed-audio-start"
                  className="vn-ed-input"
                  type="number"
                  min="0"
                  max={Math.max(0, trim.endMs - TIME_STEP_MS)}
                  step={TIME_STEP_MS}
                  value={startInput}
                  onChange={(event) => {
                    setStartInput(event.target.value);
                    setInputError('');
                  }}
                  onBlur={commitTrimInputs}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitTrimInputs();
                    if (event.key === 'Escape') setStartInput(String(trim.startMs));
                  }}
                />
                <label className="vn-ed-label" htmlFor="vn-ed-audio-end">
                  结束 (ms)
                </label>
                <input
                  id="vn-ed-audio-end"
                  className="vn-ed-input"
                  type="number"
                  min={trim.startMs + TIME_STEP_MS}
                  max={durationMs}
                  step={TIME_STEP_MS}
                  value={endInput}
                  onChange={(event) => {
                    setEndInput(event.target.value);
                    setInputError('');
                  }}
                  onBlur={commitTrimInputs}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitTrimInputs();
                    if (event.key === 'Escape') setEndInput(String(trim.endMs));
                  }}
                />
              </div>
              {inputError && <div className="vn-ed-inline-error">{inputError}</div>}
              <div className="vn-ed-row">
                <button type="button" className="vn-ed-btn" onClick={handleResetTrim}>
                  重置区间
                </button>
                <span className="vn-ed-hint">
                  {formatTime(trim.startMs)} → {formatTime(trim.endMs)}
                </span>
              </div>
            </div>

            <div className="vn-ed-panel">
              <div className="vn-ed-panel-title">增益 / 试听</div>
              <div className="vn-ed-slider-row">
                <span className="vn-ed-label">增益</span>
                <input
                  type="range"
                  min="-60"
                  max="24"
                  step="1"
                  value={gainDb}
                  onChange={(event) => setGainDb(Number(event.target.value))}
                />
                <span className="vn-ed-value">
                  {gainDb > 0 ? `+${gainDb}` : gainDb} dB
                </span>
              </div>
              <div className="vn-ed-row">
                <button
                  type="button"
                  className={`vn-ed-btn${playing ? ' is-active' : ''}`}
                  onClick={handleTogglePlay}
                >
                  {playing ? '停止试听' : '试听片段'}
                </button>
                <button
                  type="button"
                  className="vn-ed-btn"
                  onClick={() => setGainDb(0)}
                  disabled={gainDb === 0}
                >
                  重置增益
                </button>
              </div>
              <div className="vn-ed-hint">试听会应用当前增益；播放头随音频移动。</div>
            </div>

            <div className="vn-ed-panel">
              <div className="vn-ed-panel-title">输出</div>
              <div className="vn-ed-row">
                <label className="vn-ed-radio">
                  <input
                    type="radio"
                    name="vn-ed-audio-format"
                    checked={format === 'ogg'}
                    onChange={() => setFormat('ogg')}
                  />
                  OGG (Vorbis)
                </label>
                <label className="vn-ed-radio">
                  <input
                    type="radio"
                    name="vn-ed-audio-format"
                    checked={format === 'mp3'}
                    onChange={() => setFormat('mp3')}
                  />
                  MP3 (192k)
                </label>
              </div>
              <div className="vn-ed-hint">
                导出为新的最终文件；原始文件保留在 assets/.source 下，可反复裁剪。
              </div>
              <button
                type="button"
                className="vn-ed-btn vn-ed-btn-primary"
                disabled={!ready || saving}
                onClick={handleExport}
              >
                {saving ? '正在导出…' : '导出音频'}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
