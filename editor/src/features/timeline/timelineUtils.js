// 阶段四：场景时间轴纯逻辑（不依赖 React / DOM），编辑器与单元测试共用。
// 数据形状严格对应 schema/schema.json 的 timeline / track / keyframe / easing。

export const TRACK_KINDS = {
  sprite: { label: '立绘', short: '立' },
  background: { label: '背景', short: '背' },
  audio: { label: '音频', short: '音' },
  textbox: { label: '文本框', short: '文' },
  camera: { label: '镜头', short: '摄' },
};

export const PROPERTY_META = {
  x: { label: 'X 位置', min: -1, max: 2, step: 0.01 },
  y: { label: 'Y 位置', min: -1, max: 2, step: 0.01 },
  width: { label: '宽度', min: 0.05, max: 1, step: 0.01 },
  height: { label: '高度', min: 0.05, max: 1, step: 0.01 },
  scale: { label: '缩放', min: 0.05, max: 10, step: 0.01 },
  opacity: { label: '透明度', min: 0, max: 1, step: 0.01 },
  backgroundOpacity: { label: '底框透明度', min: 0, max: 1, step: 0.01 },
  volume: { label: '音量', min: 0, max: 1, step: 0.01 },
  fontSizePx: { label: '字号', min: 8, max: 200, step: 1, integer: true },
  zoom: { label: '镜头缩放', min: 0.5, max: 3, step: 0.01 },
  rotation: { label: '镜头旋转', min: -30, max: 30, step: 0.1 },
  shake: { label: '镜头抖动', min: 0, max: 1, step: 0.01 },
};

export const PROPERTY_ALLOWED = {
  sprite: ['x', 'y', 'scale', 'opacity'],
  background: ['x', 'y', 'scale', 'opacity'],
  audio: ['volume'],
  textbox: ['x', 'y', 'width', 'height', 'opacity', 'fontSizePx', 'backgroundOpacity'],
  camera: ['x', 'y', 'zoom', 'rotation', 'shake'],
};

export const EASING_PRESETS = {
  linear: {
    key: 'linear',
    label: '线性',
    p1: [0, 0],
    p2: [1, 1],
  },
  easeIn: {
    key: 'easeIn',
    label: '缓入',
    p1: [0.42, 0],
    p2: [1, 1],
  },
  easeOut: {
    key: 'easeOut',
    label: '缓出',
    p1: [0, 0],
    p2: [0.58, 1],
  },
  easeInOut: {
    key: 'easeInOut',
    label: '缓入缓出',
    p1: [0.42, 0],
    p2: [0.58, 1],
  },
};

export const EASING_PRESET_KEYS = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

export const DEFAULT_TIMELINE_DURATION = 5000;

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatTime(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const seconds = Math.floor(total / 1000);
  const millis = total % 1000;
  const minutes = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

// 强度滑块 0–1 → 贝塞尔控制点。s=0 退化为 linear，s=1 等于预设。
export function intensityToBezier(presetKey, intensity) {
  const preset = EASING_PRESETS[presetKey] ?? EASING_PRESETS.linear;
  const s = clamp(Number(intensity) || 0, 0, 1);
  const [p1x, p1y] = preset.p1;
  const [p2x, p2y] = preset.p2;
  return {
    type: 'bezier',
    p1: [round(s * p1x), round(s * p1y)],
    p2: [round(1 + s * (p2x - 1)), round(1 + s * (p2y - 1))],
  };
}

export function easingToPreset(easing) {
  if (!easing || easing.type !== 'bezier') {
    return { presetKey: 'linear', intensity: 0 };
  }
  const p1 = easing.p1 ?? [0, 0];
  const p2 = easing.p2 ?? [1, 1];
  // 反推最近的预设 + 强度（仅用于 UI 回显，不要求精确可逆）。
  let best = { presetKey: 'linear', intensity: 0, distance: Infinity };
  for (const key of EASING_PRESET_KEYS) {
    const preset = EASING_PRESETS[key];
    if (preset.p1[0] === 0 && preset.p2[0] === 1) {
      const distance = Math.abs(p1[0] - 0) + Math.abs(p1[1] - 0) + Math.abs(p2[0] - 1) + Math.abs(p2[1] - 1);
      if (distance < best.distance) best = { presetKey: 'linear', intensity: 0, distance };
    }
    for (let step = 0; step <= 20; step += 1) {
      const intensity = step / 20;
      const candidate = intensityToBezier(key, intensity);
      const distance =
        Math.abs(candidate.p1[0] - p1[0]) +
        Math.abs(candidate.p1[1] - p1[1]) +
        Math.abs(candidate.p2[0] - p2[0]) +
        Math.abs(candidate.p2[1] - p2[1]);
      if (distance < best.distance) best = { presetKey: key, intensity, distance };
    }
  }
  return { presetKey: best.presetKey, intensity: best.intensity };
}

export function cubicBezierY(p1, p2, t) {
  const x = clamp(Number(t) || 0, 0, 1);
  const x1 = clamp(p1?.[0] ?? 0, 0, 1);
  const y1 = Number(p1?.[1] ?? 0);
  const x2 = clamp(p2?.[0] ?? 1, 0, 1);
  const y2 = Number(p2?.[1] ?? 1);
  const bezier = (a, b, time) => {
    const mt = 1 - time;
    return 3 * mt * mt * time * a + 3 * mt * time * time * b + time * time * time;
  };
  // 二分求解参数 u（x 单调，控制点 x 已限制在 0–1）
  let low = 0;
  let high = 1;
  let u = x;
  for (let i = 0; i < 24; i += 1) {
    u = (low + high) / 2;
    const currentX = bezier(x1, x2, u);
    if (currentX < x) low = u;
    else high = u;
  }
  return bezier(y1, y2, u);
}

export function evaluateTrack(track, timeMs) {
  const keys = Array.isArray(track?.keys) ? track.keys : [];
  if (keys.length === 0) return 0;
  const time = Number(timeMs) || 0;
  if (time <= keys[0].time) return keys[0].value;
  if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value;
  for (let index = 1; index < keys.length; index += 1) {
    const previous = keys[index - 1];
    const next = keys[index];
    if (time <= next.time) {
      const span = next.time - previous.time;
      if (span <= 0) return next.value;
      const localT = (time - previous.time) / span;
      const eased = cubicBezierY(next.easing?.p1, next.easing?.p2, localT);
      return previous.value + (next.value - previous.value) * eased;
    }
  }
  return keys[keys.length - 1].value;
}

export function isTrackPropertyValid(kind, property) {
  return (PROPERTY_ALLOWED[kind] ?? []).includes(property);
}

export function propertyMeta(kind, property) {
  return PROPERTY_META[property] ?? { label: property, min: -9999, max: 9999, step: 0.01 };
}

export function clampTrackValue(property, value) {
  const meta = PROPERTY_META[property];
  if (!meta) return Number(value) || 0;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return meta.min;
  const clamped = clamp(raw, meta.min, meta.max);
  return meta.integer ? Math.round(clamped) : round(clamped, 3);
}

export function staticValueForTrack(sceneNode, track) {
  if (!sceneNode) return 0;
  switch (track.kind) {
    case 'sprite': {
      const sprite = (sceneNode.sprites ?? []).find((item) => item.id === track.target);
      return Number(sprite?.[track.property] ?? 0);
    }
    case 'background':
      return Number(sceneNode.background?.[track.property] ?? (track.property === 'opacity' ? 1 : track.property === 'scale' ? 1 : 0.5));
    case 'audio':
      return Number(sceneNode.audio?.volume ?? 0.8);
    case 'textbox':
      return Number(sceneNode.textbox?.[track.property] ?? 0);
    default:
      return 0;
  }
}

export function getSceneTimeline(project, sceneNodeId) {
  return project?.timelines?.[sceneNodeId] ?? null;
}

export function createTimeline(sceneNodeId, durationMs = DEFAULT_TIMELINE_DURATION) {
  void sceneNodeId;
  return {
    durationMs: Math.max(100, Math.round(Number(durationMs) || DEFAULT_TIMELINE_DURATION)),
    loop: false,
    tracks: [],
  };
}

export function uniqueTrackId(timeline, prefix = 'trk') {
  const used = new Set((timeline?.tracks ?? []).map((track) => track.id));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${prefix}_${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${prefix}_${Date.now().toString(36)}`;
}

export function hasTrackFor(timeline, kind, target, property) {
  return (timeline?.tracks ?? []).some(
    (track) => track.kind === kind && (track.target ?? null) === (target ?? null) && track.property === property,
  );
}

// 返回 { track } 或 { error }
export function createTrackDraft({ sceneNode, timeline, kind, target = null, property }) {
  if (!isTrackPropertyValid(kind, property)) {
    return { error: `属性 ${property} 不能用于 ${kind} 轨道` };
  }
  if (kind === 'sprite') {
    const sprite = (sceneNode?.sprites ?? []).find((item) => item.id === target);
    if (!sprite) return { error: '请选择一个立绘实例' };
  }
  if (hasTrackFor(timeline, kind, target, property)) {
    return { error: '该目标属性已经有轨道了' };
  }
  const track = {
    id: uniqueTrackId(timeline, `trk_${kind}`),
    kind,
    property,
    keys: [
      {
        time: 0,
        value: clampTrackValue(property, staticValueForTrack(sceneNode, { kind, target, property })),
        easing: intensityToBezier('linear', 0),
      },
    ],
  };
  if (kind === 'sprite') track.target = target;
  return { track };
}

export function removeTrackFromTimeline(timeline, trackId) {
  return { ...timeline, tracks: (timeline?.tracks ?? []).filter((track) => track.id !== trackId) };
}

export function addKeyframeToTrack(track, time, value, easing = intensityToBezier('linear', 0)) {
  const safeTime = Math.max(0, Math.round(Number(time) || 0));
  const safeValue = clampTrackValue(track.property, value);
  const keyframe = {
    time: safeTime,
    value: safeValue,
    easing: easing ?? intensityToBezier('linear', 0),
  };
  const keys = (track.keys ?? []).filter((key) => key.time !== safeTime);
  keys.push(keyframe);
  keys.sort((a, b) => a.time - b.time);
  return { ...track, keys };
}

export function updateKeyframeInTrack(track, keyframeTime, patch) {
  const keys = [...(track.keys ?? [])];
  const index = keys.findIndex((key) => key.time === keyframeTime);
  if (index < 0) return track;
  const current = keys[index];
  const next = { ...current };
  if (patch.time !== undefined) {
    next.time = Math.max(0, Math.round(Number(patch.time) || 0));
  }
  if (patch.value !== undefined) {
    next.value = clampTrackValue(track.property, patch.value);
  }
  if (patch.easing !== undefined) {
    next.easing = {
      type: 'bezier',
      p1: [clamp(Number(patch.easing.p1?.[0]) || 0, 0, 1), Number(patch.easing.p1?.[1] ?? 0)],
      p2: [clamp(Number(patch.easing.p2?.[0]) || 1, 0, 1), Number(patch.easing.p2?.[1] ?? 1)],
    };
  }
  keys[index] = next;
  keys.sort((a, b) => a.time - b.time);
  return { ...track, keys };
}

export function removeKeyframeFromTrack(track, keyframeTime) {
  return { ...track, keys: (track.keys ?? []).filter((key) => key.time !== keyframeTime) };
}

export function prevKeyframeTime(track, timeMs) {
  const keys = track?.keys ?? [];
  const previous = [...keys].reverse().find((key) => key.time < timeMs);
  return previous ? previous.time : null;
}

export function nextKeyframeTime(track, timeMs) {
  const key = (track?.keys ?? []).find((item) => item.time > timeMs);
  return key ? key.time : null;
}

export function trackLabel(project, sceneNode, track) {
  if (track.kind === 'sprite') {
    const sprite = (sceneNode?.sprites ?? []).find((item) => item.id === track.target);
    const image = (project?.assets?.images ?? []).find((item) => item.id === sprite?.assetId);
    return `${TRACK_KINDS.sprite.label} · ${image?.name ?? track.target} · ${PROPERTY_META[track.property]?.label ?? track.property}`;
  }
  return `${TRACK_KINDS[track.kind]?.label ?? track.kind} · ${PROPERTY_META[track.property]?.label ?? track.property}`;
}

export function trackExpandedLabel(project, sceneNode, track) {
  if (track.kind === 'sprite') {
    const sprite = (sceneNode?.sprites ?? []).find((item) => item.id === track.target);
    const image = (project?.assets?.images ?? []).find((item) => item.id === sprite?.assetId);
    return `${TRACK_KINDS.sprite.label}：${image?.name ?? track.target} / ${PROPERTY_META[track.property]?.label ?? track.property}`;
  }
  return `${TRACK_KINDS[track.kind]?.label ?? track.kind} / ${PROPERTY_META[track.property]?.label ?? track.property}`;
}

export function listTrackCandidates(sceneNode) {
  const candidates = [];
  for (const sprite of sceneNode?.sprites ?? []) {
    for (const property of PROPERTY_ALLOWED.sprite) {
      candidates.push({ kind: 'sprite', target: sprite.id, property });
    }
  }
  for (const property of PROPERTY_ALLOWED.background) candidates.push({ kind: 'background', property });
  for (const property of PROPERTY_ALLOWED.audio) candidates.push({ kind: 'audio', property });
  for (const property of PROPERTY_ALLOWED.textbox) candidates.push({ kind: 'textbox', property });
  for (const property of PROPERTY_ALLOWED.camera) candidates.push({ kind: 'camera', property });
  return candidates;
}

// 合并蓝图静态值与时间轴关键帧（时间轴覆盖蓝图静态值，未覆盖属性沿用蓝图）。
// 返回可直接渲染的数值集合，供时间轴预览与阶段五运行时复用。
export function resolveSceneValues(project, sceneNode, timeMs) {
  const result = {
    background: sceneNode.background
      ? {
          assetId: sceneNode.background.assetId,
          fit: sceneNode.background.fit,
          x: sceneNode.background.x,
          y: sceneNode.background.y,
          scale: sceneNode.background.scale,
          opacity: sceneNode.background.opacity,
        }
      : null,
    sprites: (sceneNode.sprites ?? []).map((sprite) => ({
      id: sprite.id,
      assetId: sprite.assetId,
      x: sprite.x,
      y: sprite.y,
      scale: sprite.scale,
      zIndex: sprite.zIndex,
      opacity: sprite.opacity,
    })),
    textbox: { ...(sceneNode.textbox ?? {}) },
    audio: { ...(sceneNode.audio ?? {}) },
    camera: { x: 0, y: 0, zoom: 1, rotation: 0, shake: 0 },
    overridden: [],
  };
  const timeline = getSceneTimeline(project, sceneNode.id);
  if (!timeline) return result;
  for (const track of timeline.tracks) {
    const value = evaluateTrack(track, timeMs);
    result.overridden.push({ trackId: track.id, kind: track.kind, target: track.target ?? null, property: track.property, value });
    if (track.kind === 'background' && result.background) {
      result.background[track.property] = value;
    } else if (track.kind === 'sprite') {
      const sprite = result.sprites.find((item) => item.id === track.target);
      if (sprite) sprite[track.property] = value;
    } else if (track.kind === 'audio') {
      result.audio[track.property] = value;
    } else if (track.kind === 'textbox') {
      result.textbox[track.property] = value;
    } else if (track.kind === 'camera') {
      result.camera[track.property] = value;
    }
  }
  return result;
}
