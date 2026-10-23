// 立绘默认动画模板：把模板转换为场景时间轴上的可编辑关键帧。
import { createTimeline, intensityToBezier, uniqueTrackId } from './timelineUtils.js';

export const SPRITE_ANIMATIONS = [
  { key: 'fadeIn', label: '淡入（0.8s）', duration: 800 },
  { key: 'slideInLeft', label: '从左滑入（0.9s）', duration: 900 },
  { key: 'slideInRight', label: '从右滑入（0.9s）', duration: 900 },
  { key: 'pop', label: '弹出强调（0.7s）', duration: 700 },
  { key: 'float', label: '轻微浮动（4s）', duration: 4000 },
  { key: 'breathe', label: '呼吸缩放（4s）', duration: 4000 },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function buildSpriteAnimationTracks(presetKey, item) {
  const baseX = Number(item?.x ?? 0.5);
  const baseY = Number(item?.y ?? 0.6);
  const baseScale = Number(item?.scale ?? 1);
  const ease = intensityToBezier('easeInOut', 0.65);
  const frame = (time, value) => ({ time, value, easing: ease });
  switch (presetKey) {
    case 'fadeIn':
      return [{ property: 'opacity', keys: [frame(0, 0), frame(800, 1)] }];
    case 'slideInLeft':
      return [
        { property: 'opacity', keys: [frame(0, 0), frame(500, 1)] },
        { property: 'x', keys: [frame(0, clamp(baseX - 0.25, 0, 1)), frame(900, baseX)] },
      ];
    case 'slideInRight':
      return [
        { property: 'opacity', keys: [frame(0, 0), frame(500, 1)] },
        { property: 'x', keys: [frame(0, clamp(baseX + 0.25, 0, 1)), frame(900, baseX)] },
      ];
    case 'pop':
      return [
        { property: 'opacity', keys: [frame(0, 0), frame(200, 1)] },
        {
          property: 'scale',
          keys: [
            frame(0, clamp(baseScale * 0.88, 0.05, 10)),
            frame(420, baseScale * 1.06),
            frame(700, baseScale),
          ],
        },
      ];
    case 'float':
      return [
        {
          property: 'y',
          keys: [frame(0, baseY), frame(2000, clamp(baseY - 0.02, 0, 1)), frame(4000, baseY)],
        },
      ];
    case 'breathe':
      return [
        {
          property: 'scale',
          keys: [
            frame(0, baseScale),
            frame(2000, clamp(baseScale * 1.03, 0.05, 10)),
            frame(4000, baseScale),
          ],
        },
      ];
    default:
      return [];
  }
}

function upsertSpriteTrack(timeline, item, property, keys) {
  const existingIndex = timeline.tracks.findIndex(
    (track) => track.kind === 'sprite' && track.target === item.id && track.property === property,
  );
  const track = {
    id: existingIndex >= 0 ? timeline.tracks[existingIndex].id : uniqueTrackId(timeline, 'trk_sprite'),
    kind: 'sprite',
    target: item.id,
    property,
    keys,
  };
  const tracks = [...timeline.tracks];
  if (existingIndex >= 0) tracks[existingIndex] = track;
  else tracks.push(track);
  return { ...timeline, tracks };
}

/**
 * 把模板应用到场景时间轴（不存在则创建）。返回新的 timeline。
 */
export function applySpriteAnimationToTimeline(timeline, item, presetKey) {
  const preset = SPRITE_ANIMATIONS.find((animation) => animation.key === presetKey);
  if (!preset) return timeline;
  const trackDefs = buildSpriteAnimationTracks(preset.key, item);
  if (trackDefs.length === 0) return timeline;
  let next = timeline
    ? { ...timeline, tracks: [...(timeline.tracks ?? [])] }
    : createTimeline(item?.sceneNodeId, 5000);
  next = { ...next, durationMs: Math.max(next.durationMs ?? 5000, preset.duration) };
  for (const definition of trackDefs) {
    next = upsertSpriteTrack(next, item, definition.property, definition.keys);
  }
  return next;
}
