// 阶段五：场景时间轴求值（纯 ESM，无 DOM）。
// 与阶段四编辑器 timelineUtils.js 的缓动/轨道求值语义一致，但本文件独立实现，
// runtime 不 import editor（见 runtime/CONTRACT-PHASE5.md）。
// 数据形状严格对应 schema/schema.json 的 timeline / track / keyframe / easing：
//   - 关键帧 time 为场景内绝对毫秒，value 为数值，easing 只认 cubic-bezier 控制点；
//   - 首帧前取首帧值，末帧后取末帧值；段内按目标帧 easing 从上一帧插值到本帧；
//   - 时间轴覆盖蓝图静态值，未覆盖属性沿用蓝图。

/** 无场景（或场景缺文本框配置）时使用的默认文本框，与编辑器默认值一致。 */
export const DEFAULT_TEXTBOX = Object.freeze({
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

/** 无音频配置时的默认 BGM 状态（不播放）。 */
export const DEFAULT_AUDIO = Object.freeze({
  bgmAssetId: null,
  volume: 0.8,
  loop: false,
  fadeInMs: 0,
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * cubic-bezier(p1, p2) 的 y 分量求值：输入进度 t（0–1），返回缓动后的进度。
 * x 分量控制点限制在 0–1（保证是时间函数），用二分法反解参数 u。
 */
export function cubicBezierY(p1, p2, t) {
  const progress = clamp(toFiniteNumber(t, 0), 0, 1);
  // 端点精确返回（二进制反解只能逼近 0 / 1）。
  if (progress === 0) return 0;
  if (progress === 1) return 1;
  const x1 = clamp(toFiniteNumber(p1?.[0], 0), 0, 1);
  const y1 = toFiniteNumber(p1?.[1], 0);
  const x2 = clamp(toFiniteNumber(p2?.[0], 1), 0, 1);
  const y2 = toFiniteNumber(p2?.[1], 1);
  const bezier = (a, b, time) => {
    const inverse = 1 - time;
    return 3 * inverse * inverse * time * a + 3 * inverse * time * time * b + time * time * time;
  };
  let low = 0;
  let high = 1;
  let u = progress;
  for (let step = 0; step < 32; step += 1) {
    u = (low + high) / 2;
    if (bezier(x1, x2, u) < progress) low = u;
    else high = u;
  }
  return bezier(y1, y2, u);
}

/**
 * 求某条轨道在给定时间点的数值。
 * 播放位置早于首帧取首帧值，晚于末帧取末帧值；段内用目标帧 easing 插值。
 * 空轨道返回 0（不应出现，schema 要求至少 1 个关键帧）。
 */
export function evaluateTrack(track, timeMs) {
  const keys = Array.isArray(track?.keys) ? track.keys : [];
  if (keys.length === 0) return 0;
  const time = toFiniteNumber(timeMs, 0);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (time <= toFiniteNumber(first?.time, 0)) return toFiniteNumber(first?.value, 0);
  if (time >= toFiniteNumber(last?.time, 0)) return toFiniteNumber(last?.value, 0);
  for (let index = 1; index < keys.length; index += 1) {
    const previous = keys[index - 1];
    const next = keys[index];
    const nextTime = toFiniteNumber(next?.time, 0);
    if (time <= nextTime) {
      const previousTime = toFiniteNumber(previous?.time, 0);
      const span = nextTime - previousTime;
      if (!(span > 0)) return toFiniteNumber(next?.value, 0);
      const localT = (time - previousTime) / span;
      const eased = cubicBezierY(next?.easing?.p1, next?.easing?.p2, localT);
      const from = toFiniteNumber(previous?.value, 0);
      const to = toFiniteNumber(next?.value, 0);
      return from + (to - from) * eased;
    }
  }
  return toFiniteNumber(last?.value, 0);
}

/** 读取场景节点的时间轴；不存在返回 null。 */
export function getTimeline(project, sceneNodeId) {
  if (!project || typeof sceneNodeId !== 'string' || !sceneNodeId) return null;
  const timeline = project.timelines?.[sceneNodeId];
  return timeline && typeof timeline === 'object' ? timeline : null;
}

/* ------------------------------------------------------------------ */
/* 蓝图静态值                                                          */
/* ------------------------------------------------------------------ */

function baseSprite(sprite) {
  return {
    id: sprite?.id ?? '',
    assetId: sprite?.assetId ?? null,
    x: toFiniteNumber(sprite?.x, 0.5),
    y: toFiniteNumber(sprite?.y, 0.5),
    scale: toFiniteNumber(sprite?.scale, 1),
    zIndex: Math.round(toFiniteNumber(sprite?.zIndex, 0)),
    opacity: toFiniteNumber(sprite?.opacity, 1),
  };
}

function baseBackground(background) {
  if (!background) return null;
  return {
    assetId: background.assetId ?? null,
    fit: background.fit ?? 'cover',
    x: toFiniteNumber(background.x, 0.5),
    y: toFiniteNumber(background.y, 0.5),
    scale: toFiniteNumber(background.scale, 1),
    opacity: toFiniteNumber(background.opacity, 1),
  };
}

function baseTextbox(textbox) {
  return {
    ...DEFAULT_TEXTBOX,
    ...(textbox && typeof textbox === 'object' ? textbox : {}),
  };
}

function baseAudio(audio) {
  const source = audio && typeof audio === 'object' ? audio : {};
  return {
    ...DEFAULT_AUDIO,
    ...source,
    bgmAssetId: source.bgmAssetId ?? null,
    volume: toFiniteNumber(source.volume, DEFAULT_AUDIO.volume),
    loop: source.loop === true,
    sfx: Array.isArray(source.sfx) ? source.sfx : [],
  };
}

/* 同一轨道缺 target 立绘 / 场景缺背景时，FIELDS 9.6 要求 console.warn 一次即可，
   运行时会每帧调用 resolveSceneValues，因此用模块级集合去重，避免逐帧刷屏。 */
const warnedTrackKeys = new Set();

function warnOnce(key, message) {
  if (warnedTrackKeys.has(key)) return;
  warnedTrackKeys.add(key);
  try {
    console.warn(message);
  } catch {
    /* 无 console 环境（例如打包后的极简宿主）忽略 */
  }
}

/**
 * 合并蓝图静态值与时间轴关键帧：时间轴覆盖蓝图，未覆盖属性沿用蓝图。
 * @returns {{
 *   background: null | object,
 *   sprites: object[],
 *   uiImages: object[],
 *   textbox: object,
 *   audio: object,
 *   overridden: Array<{trackId:string, kind:string, target:string|null, property:string, value:number}>,
 * }}
 */
export function resolveSceneValues(project, sceneNode, timeMs) {
  const node = sceneNode && typeof sceneNode === 'object' ? sceneNode : {};
  const result = {
    background: baseBackground(node.background),
    sprites: Array.isArray(node.sprites) ? node.sprites.map(baseSprite) : [],
    uiImages: Array.isArray(node.uiImages) ? node.uiImages.map(baseSprite) : [],
    textbox: baseTextbox(node.textbox),
    audio: baseAudio(node.audio),
    camera: { x: 0, y: 0, zoom: 1, rotation: 0, shake: 0 },
    overridden: [],
  };
  const timeline = getTimeline(project, node.id);
  if (!timeline || !Array.isArray(timeline.tracks)) return result;
  const time = toFiniteNumber(timeMs, 0);
  for (const track of timeline.tracks) {
    if (!track || typeof track.property !== 'string') continue;
    const value = evaluateTrack(track, time);
    let applied = false;
    if (track.kind === 'background') {
      if (result.background) {
        result.background[track.property] = value;
        applied = true;
      } else {
        warnOnce(
          `${node.id}:background:${track.property}`,
          `[timeline] 场景 ${node.id} 没有 background，背景轨道 ${track.id} 不生效`,
        );
      }
    } else if (track.kind === 'sprite') {
      const sprite = result.sprites.find((item) => item.id === track.target);
      if (sprite) {
        sprite[track.property] = value;
        applied = true;
      } else {
        warnOnce(
          `${node.id}:sprite:${track.target}:${track.property}`,
          `[timeline] 场景 ${node.id} 的立绘轨道 ${track.id} 目标 ${track.target} 不存在，已忽略`,
        );
      }
    } else if (track.kind === 'audio') {
      result.audio[track.property] = value;
      applied = true;
    } else if (track.kind === 'textbox') {
      result.textbox[track.property] = value;
      applied = true;
    } else if (track.kind === 'camera') {
      result.camera[track.property] = value;
      applied = true;
    }
    if (applied) {
      result.overridden.push({
        trackId: track.id ?? null,
        kind: track.kind ?? null,
        target: track.target ?? null,
        property: track.property,
        value,
      });
    }
  }
  return result;
}

/**
 * 便捷函数：按场景节点 id 求值该场景在 timeMs 的画面值；节点不存在/不是场景返回 null。
 */
export function sampleTimeline(project, sceneNodeId, timeMs) {
  const nodes = Array.isArray(project?.nodes) ? project.nodes : [];
  const sceneNode = nodes.find((node) => node && node.id === sceneNodeId);
  if (!sceneNode || sceneNode.type !== 'scene') return null;
  return resolveSceneValues(project, sceneNode, timeMs);
}
