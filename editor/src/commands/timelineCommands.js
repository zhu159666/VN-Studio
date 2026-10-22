// 时间轴类 command：关键帧新增 / 修改 / 删除，以及轨道删除。
// 输入输出只含 JSON 可序列化数据；project 以不可变方式返回。
import {
  DEFAULT_TIMELINE_DURATION,
  EASING_PRESET_KEYS,
  addKeyframeToTrack,
  clampTrackValue,
  createTimeline,
  createTrackDraft,
  getSceneTimeline,
  intensityToBezier,
  isTrackPropertyValid,
  removeKeyframeFromTrack,
  removeTrackFromTimeline,
  updateKeyframeInTrack,
} from '../features/timeline/timelineUtils.js';
import { fail, findNode, success } from './helpers.js';

const TIME_SCHEMA = { type: 'integer', minimum: 0, maximum: 600000 };
const EASING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['p1', 'p2'],
  properties: {
    p1: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'number', minimum: 0, maximum: 1 },
    },
    p2: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
};

function requireScene(project, sceneNodeId) {
  const node = findNode(project, sceneNodeId);
  if (!node) return { error: fail('E_NODE_NOT_FOUND', `节点不存在：${sceneNodeId}`) };
  if (node.type !== 'scene') return { error: fail('E_NOT_SCENE', `节点 ${sceneNodeId} 不是场景节点`) };
  return { sceneNode: node };
}

function withTimeline(project, sceneNodeId, timeline) {
  return { ...project, timelines: { ...(project.timelines ?? {}), [sceneNodeId]: timeline } };
}

function updateTrackInTimeline(timeline, track) {
  return {
    ...timeline,
    tracks: timeline.tracks.map((item) => (item.id === track.id ? track : item)),
  };
}

function resolveEasing(params, warnings) {
  if (params.easing !== undefined && params.preset !== undefined) {
    warnings.push('同时提供 easing 与 preset，已优先使用 easing');
  }
  if (params.easing !== undefined) {
    return {
      type: 'bezier',
      p1: [params.easing.p1[0], params.easing.p1[1]],
      p2: [params.easing.p2[0], params.easing.p2[1]],
    };
  }
  if (params.preset !== undefined) {
    return intensityToBezier(params.preset, params.intensity ?? 0);
  }
  return null;
}

export const addKeyframeCommand = {
  name: 'timeline.addKeyframe',
  category: 'timeline',
  title: '添加时间轴关键帧',
  description:
    '在场景时间轴的关键帧轨道上添加（或覆盖同一时间点）一个关键帧。轨道不存在时会自动创建；时间轴不存在时按默认 5000ms 创建。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sceneNodeId', 'time', 'value'],
    properties: {
      sceneNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      trackId: { type: 'string', minLength: 1, maxLength: 64 },
      kind: { enum: ['sprite', 'background', 'audio', 'textbox'] },
      property: { type: 'string', minLength: 1, maxLength: 40 },
      target: {
        oneOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }],
      },
      time: TIME_SCHEMA,
      value: { type: 'number' },
      easing: EASING_SCHEMA,
      preset: { enum: EASING_PRESET_KEYS },
      intensity: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
  run({ project }, params) {
    const { sceneNode, error } = requireScene(project, params.sceneNodeId);
    if (error) return error;

    let timeline = getSceneTimeline(project, sceneNode.id);
    const createdTimeline = !timeline;
    if (!timeline) timeline = createTimeline(sceneNode.id, DEFAULT_TIMELINE_DURATION);

    let track;
    if (params.trackId) {
      track = timeline.tracks.find((item) => item.id === params.trackId);
      if (!track) return fail('E_TRACK_NOT_FOUND', `轨道不存在：${params.trackId}`);
    } else {
      if (!params.kind || !params.property) {
        return fail('E_INVALID_PARAMS', '未提供 trackId 时必须同时提供 kind 与 property');
      }
      if (!isTrackPropertyValid(params.kind, params.property)) {
        return fail('E_INVALID_TRACK', `属性 ${params.property} 不能用于 ${params.kind} 轨道`);
      }
      const target = params.target ?? null;
      track =
        timeline.tracks.find(
          (item) =>
            item.kind === params.kind &&
            (item.target ?? null) === target &&
            item.property === params.property,
        ) ?? null;
      if (!track) {
        const draft = createTrackDraft({
          sceneNode,
          timeline,
          kind: params.kind,
          target,
          property: params.property,
        });
        if (draft.error) return fail('E_INVALID_TRACK', draft.error);
        track = draft.track;
        timeline = { ...timeline, tracks: [...timeline.tracks, track] };
      }
    }

    if (params.time > timeline.durationMs) {
      return fail(
        'E_TIME_OUT_OF_RANGE',
        `关键帧时间 ${params.time}ms 超出时间轴时长 ${timeline.durationMs}ms`,
      );
    }

    const warnings = [];
    const clamped = clampTrackValue(track.property, params.value);
    if (Math.abs(clamped - params.value) > 1e-9) {
      warnings.push(`value 已按属性范围收敛为 ${clamped}`);
    }
    const easing = resolveEasing(params, warnings) ?? undefined;
    const nextTrack = addKeyframeToTrack(track, params.time, params.value, easing);
    timeline = updateTrackInTimeline(timeline, nextTrack);

    const keyframe = nextTrack.keys.find((key) => key.time === params.time) ?? null;
    return success({
      project: withTimeline(project, sceneNode.id, timeline),
      affectedNodeIds: [sceneNode.id],
      affectedTrackIds: [nextTrack.id],
      data: {
        createdAt: createdTimeline,
        track: nextTrack,
        keyframe,
      },
      warnings,
    });
  },
};

export const updateKeyframeCommand = {
  name: 'timeline.updateKeyframe',
  category: 'timeline',
  title: '修改时间轴关键帧',
  description:
    '修改已有轨道上某个时间点的关键帧（可改时间 / 数值 / 缓动）；time 必须是现有 keyframe 的时间。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sceneNodeId', 'trackId', 'time'],
    properties: {
      sceneNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      trackId: { type: 'string', minLength: 1, maxLength: 64 },
      time: TIME_SCHEMA,
      newTime: TIME_SCHEMA,
      value: { type: 'number' },
      easing: EASING_SCHEMA,
      preset: { enum: EASING_PRESET_KEYS },
      intensity: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
  run({ project }, params) {
    const { sceneNode, error } = requireScene(project, params.sceneNodeId);
    if (error) return error;
    const timeline = getSceneTimeline(project, sceneNode.id);
    if (!timeline) return fail('E_TIMELINE_NOT_FOUND', `场景 ${sceneNode.id} 没有时间轴`);
    const track = timeline.tracks.find((item) => item.id === params.trackId);
    if (!track) return fail('E_TRACK_NOT_FOUND', `轨道不存在：${params.trackId}`);
    if (!track.keys.some((key) => key.time === params.time)) {
      return fail('E_KEYFRAME_NOT_FOUND', `关键帧不存在：${params.time}ms`);
    }

    const patch = {};
    const warnings = [];
    if (params.newTime !== undefined) {
      if (params.newTime > timeline.durationMs) {
        return fail(
          'E_TIME_OUT_OF_RANGE',
          `关键帧时间 ${params.newTime}ms 超出时间轴时长 ${timeline.durationMs}ms`,
        );
      }
      if (track.keys.some((key) => key.time === params.newTime && key.time !== params.time)) {
        return fail('E_DUPLICATE_TIME', `目标时间已有关键帧：${params.newTime}ms`);
      }
      patch.time = params.newTime;
    }
    if (params.value !== undefined) {
      const clamped = clampTrackValue(track.property, params.value);
      if (Math.abs(clamped - params.value) > 1e-9) {
        warnings.push(`value 已按属性范围收敛为 ${clamped}`);
      }
      patch.value = params.value;
    }
    const easing = resolveEasing(params, warnings);
    if (easing) patch.easing = easing;
    if (Object.keys(patch).length === 0) {
      return fail('E_INVALID_PARAMS', '至少提供 newTime / value / easing / preset 之一');
    }

    const nextTrack = updateKeyframeInTrack(track, params.time, patch);
    const nextTimeline = updateTrackInTimeline(timeline, nextTrack);
    const nextTime = patch.time ?? params.time;
    return success({
      project: withTimeline(project, sceneNode.id, nextTimeline),
      affectedNodeIds: [sceneNode.id],
      affectedTrackIds: [track.id],
      data: {
        track: nextTrack,
        keyframe: nextTrack.keys.find((key) => key.time === nextTime) ?? null,
      },
      warnings,
    });
  },
};

export const removeKeyframeCommand = {
  name: 'timeline.removeKeyframe',
  category: 'timeline',
  title: '删除时间轴关键帧',
  description: '删除轨道上指定时间的关键帧；轨道至少保留 1 个关键帧，否则请删除整条轨道。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sceneNodeId', 'trackId', 'time'],
    properties: {
      sceneNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      trackId: { type: 'string', minLength: 1, maxLength: 64 },
      time: TIME_SCHEMA,
    },
  },
  run({ project }, params) {
    const { sceneNode, error } = requireScene(project, params.sceneNodeId);
    if (error) return error;
    const timeline = getSceneTimeline(project, sceneNode.id);
    if (!timeline) return fail('E_TIMELINE_NOT_FOUND', `场景 ${sceneNode.id} 没有时间轴`);
    const track = timeline.tracks.find((item) => item.id === params.trackId);
    if (!track) return fail('E_TRACK_NOT_FOUND', `轨道不存在：${params.trackId}`);
    const keyframe = track.keys.find((key) => key.time === params.time);
    if (!keyframe) return fail('E_KEYFRAME_NOT_FOUND', `关键帧不存在：${params.time}ms`);
    if (track.keys.length <= 1) {
      return fail('E_LAST_KEYFRAME', '轨道至少保留一个关键帧；如需清空请使用 timeline.removeTrack');
    }

    const nextTrack = removeKeyframeFromTrack(track, params.time);
    const nextTimeline = updateTrackInTimeline(timeline, nextTrack);
    return success({
      project: withTimeline(project, sceneNode.id, nextTimeline),
      affectedNodeIds: [sceneNode.id],
      affectedTrackIds: [track.id],
      data: { track: nextTrack, removedKeyframe: keyframe },
    });
  },
};

export const removeTrackCommand = {
  name: 'timeline.removeTrack',
  category: 'timeline',
  title: '删除时间轴轨道',
  description: '删除场景时间轴中的整条轨道（含其全部关键帧）。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sceneNodeId', 'trackId'],
    properties: {
      sceneNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      trackId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  run({ project }, params) {
    const { sceneNode, error } = requireScene(project, params.sceneNodeId);
    if (error) return error;
    const timeline = getSceneTimeline(project, sceneNode.id);
    if (!timeline) return fail('E_TIMELINE_NOT_FOUND', `场景 ${sceneNode.id} 没有时间轴`);
    const track = timeline.tracks.find((item) => item.id === params.trackId);
    if (!track) return fail('E_TRACK_NOT_FOUND', `轨道不存在：${params.trackId}`);
    const nextTimeline = removeTrackFromTimeline(timeline, track.id);
    return success({
      project: withTimeline(project, sceneNode.id, nextTimeline),
      affectedNodeIds: [sceneNode.id],
      affectedTrackIds: [track.id],
      data: { removedTrack: track },
    });
  },
};

export const setDurationCommand = {
  name: 'timeline.setDuration',
  category: 'timeline',
  title: '设置时间轴时长',
  description: '设置场景时间轴总时长（ms）；缩短时会拒绝，除非没有关键帧超出新时长。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sceneNodeId', 'durationMs'],
    properties: {
      sceneNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      durationMs: { type: 'integer', minimum: 100, maximum: 600000 },
    },
  },
  run({ project }, params) {
    const { sceneNode, error } = requireScene(project, params.sceneNodeId);
    if (error) return error;
    let timeline = getSceneTimeline(project, sceneNode.id);
    if (!timeline) timeline = createTimeline(sceneNode.id, params.durationMs);
    const overflow = timeline.tracks
      .flatMap((track) => track.keys.map((key) => ({ trackId: track.id, time: key.time })))
      .find((item) => item.time > params.durationMs);
    if (overflow) {
      return fail(
        'E_DURATION_TOO_SMALL',
        `轨道 ${overflow.trackId} 在 ${overflow.time}ms 仍有关键帧，不能把时长缩短到 ${params.durationMs}ms`,
      );
    }
    return success({
      project: withTimeline(project, sceneNode.id, { ...timeline, durationMs: params.durationMs }),
      affectedNodeIds: [sceneNode.id],
      data: { durationMs: params.durationMs },
    });
  },
};

export const setLoopCommand = {
  name: 'timeline.setLoop',
  category: 'timeline',
  title: '设置时间轴循环',
  description: '设置场景时间轴是否循环播放（timeline.loop）。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sceneNodeId', 'loop'],
    properties: {
      sceneNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      loop: { type: 'boolean' },
    },
  },
  run({ project }, params) {
    const { sceneNode, error } = requireScene(project, params.sceneNodeId);
    if (error) return error;
    const timeline = getSceneTimeline(project, sceneNode.id) ?? createTimeline(sceneNode.id);
    return success({
      project: withTimeline(project, sceneNode.id, { ...timeline, loop: params.loop }),
      affectedNodeIds: [sceneNode.id],
      data: { loop: params.loop },
    });
  },
};

export const TIMELINE_COMMANDS = [
  addKeyframeCommand,
  updateKeyframeCommand,
  removeKeyframeCommand,
  removeTrackCommand,
  setDurationCommand,
  setLoopCommand,
];
