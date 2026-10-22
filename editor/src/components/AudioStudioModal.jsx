/**
 * AudioStudioModal —— 「音频工坊」：用内置合成器生成 BGM / 音效。
 *
 * 不依赖第三方音频库：直接按预设合成 44.1kHz 单声道 PCM，编码为 WAV；
 * 保存时交给主进程（assets.saveGeneratedAudio）用 ffmpeg 转成 ogg 并登记为素材。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { assetsApi } from '../api';
import '../styles/audio-studio.css';

const SAMPLE_RATE = 44100;
const TAU = Math.PI * 2;

const PRESETS = [
  { key: 'chime', label: '提示音 · 叮咚', role: 'sfx', seconds: 1.5, bpm: 96 },
  { key: 'click', label: '按钮音 · 短促', role: 'sfx', seconds: 0.4, bpm: 96 },
  { key: 'victory', label: '胜利音效', role: 'sfx', seconds: 1.6, bpm: 96 },
  { key: 'failure', label: '失败音效', role: 'sfx', seconds: 1.8, bpm: 96 },
  { key: 'ambient', label: '氛围铺底 · 可循环', role: 'bgm', seconds: 8, bpm: 72 },
  { key: 'melody', label: '简单旋律 · 可循环', role: 'bgm', seconds: 8, bpm: 100 },
  { key: 'drums', label: '鼓点循环 · 可循环', role: 'bgm', seconds: 4, bpm: 110 },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function addNote(buffer, startSec, durSec, freq, options = {}) {
  const { type = 'sine', gain = 0.5, attack = 0.008, decay = 0.2 } = options;
  const start = Math.floor(startSec * SAMPLE_RATE);
  const length = Math.floor(durSec * SAMPLE_RATE);
  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    const index = start + i;
    if (index < 0 || index >= buffer.length) continue;
    const env = Math.min(1, t / attack) * Math.exp(-t / decay);
    const phase = TAU * freq * t;
    let sample = Math.sin(phase);
    if (type === 'square') sample = sample >= 0 ? 1 : -1;
    else if (type === 'triangle') sample = (2 / Math.PI) * Math.asin(sample);
    else if (type === 'saw') sample = 2 * (phase / TAU - Math.floor(phase / TAU + 0.5));
    buffer[index] += sample * env * gain;
  }
}

function addPad(buffer, startSec, durSec, freqs, gain = 0.12) {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const length = Math.floor(durSec * SAMPLE_RATE);
  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index < 0 || index >= buffer.length) continue;
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, t / 0.8) * Math.min(1, (durSec - t) / 0.8);
    let sample = 0;
    for (const freq of freqs) {
      sample += Math.sin(TAU * freq * t) + 0.35 * Math.sin(TAU * freq * 2 * t);
    }
    buffer[index] += (sample / (freqs.length * 1.35)) * Math.max(0, env) * gain;
  }
}

function addNoise(buffer, startSec, durSec, gain, decay = 0.06) {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const length = Math.floor(durSec * SAMPLE_RATE);
  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index < 0 || index >= buffer.length) continue;
    const t = i / SAMPLE_RATE;
    buffer[index] += (Math.random() * 2 - 1) * Math.exp(-t / decay) * gain;
  }
}

function addKick(buffer, startSec, gain = 0.55) {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const length = Math.floor(0.16 * SAMPLE_RATE);
  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index < 0 || index >= buffer.length) continue;
    const t = i / SAMPLE_RATE;
    const freq = 140 * Math.exp(-t * 22) + 42;
    buffer[index] += Math.sin(TAU * freq * t) * Math.exp(-t * 16) * gain;
  }
}

function renderPreset(preset, { bpm, seconds }) {
  const total = clamp(seconds, 0.2, 30);
  const buffer = new Float32Array(Math.ceil(total * SAMPLE_RATE));
  const beat = 60 / clamp(bpm, 40, 240);
  const step = beat / 2;

  switch (preset) {
    case 'click': {
      addNote(buffer, 0, 0.12, 900, { type: 'square', gain: 0.3, decay: 0.035 });
      addNoise(buffer, 0, 0.04, 0.12, 0.015);
      break;
    }
    case 'victory': {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
        addNote(buffer, index * 0.12, 0.6, freq, { type: 'square', gain: 0.2, decay: 0.22 });
        addNote(buffer, index * 0.12, 0.6, freq / 2, { gain: 0.12, decay: 0.25 });
      });
      break;
    }
    case 'failure': {
      [392, 329.63, 261.63].forEach((freq, index) => {
        addNote(buffer, index * 0.26, 0.7, freq, { type: 'triangle', gain: 0.3, decay: 0.34 });
      });
      break;
    }
    case 'ambient': {
      const chords = [
        [130.81, 196.0, 329.63],
        [110.0, 164.81, 261.63],
        [130.81, 196.0, 329.63],
        [98.0, 146.83, 246.94],
      ];
      for (let t = 0, index = 0; t < total; t += 4, index += 1) {
        addPad(buffer, t, Math.min(4, total - t), chords[index % chords.length], 0.16);
      }
      break;
    }
    case 'melody': {
      const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 783.99, 659.25, 587.33];
      let index = 0;
      for (let t = 0; t < total - 0.05; t += step) {
        const freq = scale[index % scale.length];
        addNote(buffer, t, Math.min(step * 0.9, 0.35), freq, { type: 'square', gain: 0.15, decay: 0.12 });
        if (index % 8 === 0) addNote(buffer, t, step * 4, 130.81, { gain: 0.16, decay: 0.9 });
        index += 1;
      }
      break;
    }
    case 'drums': {
      let index = 0;
      for (let t = 0; t < total - 0.02; t += step, index += 1) {
        if (index % 4 === 0) addKick(buffer, t);
        if (index % 4 === 2) addNoise(buffer, t, 0.16, 0.22, 0.05);
        if (index % 2 === 1) addNoise(buffer, t, 0.05, 0.07, 0.02);
        if (index % 8 === 0) addNote(buffer, t, step * 2, 98, { type: 'triangle', gain: 0.12, decay: 0.35 });
      }
      break;
    }
    case 'chime':
    default: {
      addNote(buffer, 0, 1.3, 1046.5, { gain: 0.42, decay: 0.4 });
      addNote(buffer, 0.12, 1.1, 1318.5, { gain: 0.3, decay: 0.45 });
      addNote(buffer, 0.12, 0.9, 2637, { gain: 0.08, decay: 0.3 });
      break;
    }
  }

  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) peak = Math.max(peak, Math.abs(buffer[i]));
  if (peak > 0.95) {
    const scale = 0.95 / peak;
    for (let i = 0; i < buffer.length; i += 1) buffer[i] *= scale;
  }
  return buffer;
}

function encodeWav(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const value = clamp(samples[i], -1, 1);
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return window.btoa(binary);
}

export default function AudioStudioModal({ projectDir, onClose, onCreated, notify }) {
  const firstPreset = PRESETS[0];
  const [preset, setPreset] = useState(firstPreset.key);
  const [name, setName] = useState(`合成 · ${firstPreset.label}`);
  const [role, setRole] = useState(firstPreset.role);
  const [bpm, setBpm] = useState(firstPreset.bpm);
  const [seconds, setSeconds] = useState(firstPreset.seconds);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const audioRef = useRef(null);
  const urlRef = useRef(null);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPreviewing(false);
  }, []);

  useEffect(() => () => stopPreview(), [stopPreview]);

  const current = useMemo(() => PRESETS.find((item) => item.key === preset) || firstPreset, [preset]);
  const wavBytes = useMemo(
    () => encodeWav(renderPreset(current.key, { bpm, seconds })),
    [current.key, bpm, seconds],
  );
  const durationMs = Math.round(clamp(seconds, 0.2, 30) * 1000);

  const handlePresetChange = (key) => {
    const next = PRESETS.find((item) => item.key === key) || firstPreset;
    setPreset(next.key);
    setRole(next.role);
    setBpm(next.bpm);
    setSeconds(next.seconds);
    setName(`合成 · ${next.label}`);
    setError('');
  };

  const handlePreview = () => {
    if (previewing) {
      stopPreview();
      return;
    }
    stopPreview();
    try {
      const blob = new Blob([wavBytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      urlRef.current = url;
      audioRef.current = audio;
      audio.addEventListener('ended', stopPreview, { once: true });
      audio.play().catch((err) => {
        setError(err?.message || '试听失败');
        stopPreview();
      });
      setPreviewing(true);
    } catch (err) {
      setError(err?.message || '试听失败');
    }
  };

  const handleSave = async () => {
    if (saving) return;
    const cleanName = name.trim() || `合成 · ${current.label}`;
    if (!projectDir) {
      setError('项目未保存到磁盘，无法写入音频');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await assetsApi.saveGeneratedAudio({
        projectDir,
        name: cleanName,
        role,
        wavBase64: bytesToBase64(wavBytes),
        durationMs,
      });
      stopPreview();
      onCreated?.(result.asset);
      notify?.(`已生成音频「${cleanName}」`, 'success');
      onClose?.();
    } catch (err) {
      setError(err?.message || '保存音频失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="vn-audio-studio-overlay" role="dialog" aria-modal="true" aria-label="音频工坊">
      <div className="vn-audio-studio">
        <header className="vn-audio-studio__head">
          <div>
            <h2>音频工坊</h2>
            <p>用内置合成器制作 BGM / 音效；保存时自动转成 ogg 素材。</p>
          </div>
          <button type="button" className="vn-audio-studio__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="vn-audio-studio__body">
          <label className="vn-audio-studio__field">
            <span>预设</span>
            <select value={preset} onChange={(event) => handlePresetChange(event.target.value)}>
              {PRESETS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="vn-audio-studio__field">
            <span>名称</span>
            <input
              type="text"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <div className="vn-audio-studio__row">
            <label className="vn-audio-studio__field">
              <span>用途</span>
              <select value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="bgm">背景音乐 BGM</option>
                <option value="sfx">音效 SFX</option>
              </select>
            </label>
            <label className="vn-audio-studio__field">
              <span>BPM</span>
              <input
                type="number"
                min={40}
                max={240}
                value={bpm}
                onChange={(event) => setBpm(clamp(Number(event.target.value) || 96, 40, 240))}
              />
            </label>
            <label className="vn-audio-studio__field">
              <span>时长（秒）</span>
              <input
                type="number"
                min={0.2}
                max={30}
                step={0.2}
                value={seconds}
                onChange={(event) => setSeconds(clamp(Number(event.target.value) || 1, 0.2, 30))}
              />
            </label>
          </div>

          <p className="vn-audio-studio__hint">
            生成 44.1kHz 单声道 WAV，保存后由 ffmpeg 转成 ogg；BGM 默认循环播放。
          </p>
          {error ? <p className="vn-audio-studio__error">{error}</p> : null}
        </div>

        <footer className="vn-audio-studio__foot">
          <button type="button" className="vn-btn vn-btn--ghost" onClick={handlePreview}>
            {previewing ? '停止试听' : '试听'}
          </button>
          <div className="vn-audio-studio__spacer" />
          <button type="button" className="vn-btn vn-btn--ghost" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="vn-btn" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '生成并保存'}
          </button>
        </footer>
      </div>
    </div>
  );
}
