// 场景类 command：背景 / 立绘 / BGM 的可编排配置（供 AI 通过 MCP 调用）。
import { uniqueInstanceId } from '../features/blueprint/blueprintUtils.js';
import { updateNodeInProject } from '../state/projectMutations.js';
import { ID_RE, fail, findNode, success } from './helpers.js';

const NORMALIZED = { type: 'number', minimum: 0, maximum: 1 };
const SCALE = { type: 'number', minimum: 0.05, maximum: 10 };
const OPACITY = { type: 'number', minimum: 0, maximum: 1 };

function requireScene(project, sceneNodeId) {
  const node = findNode(project, sceneNodeId);
  if (!node) return { error: fail('E_NODE_NOT_FOUND', `节点不存在：${sceneNodeId}`) };
  if (node.type !== 'scene') return { error: fail('E_NOT_SCENE', `节点 ${sceneNodeId} 不是场景节点`) };
  return { node };
}

function findImage(project, assetId) {
  return (project.assets?.images ?? []).find((item) => item.id === assetId) ?? null;
}

function findAudio(project, assetId) {
  return (project.assets?.audio ?? []).find((item) => item.id === assetId) ?? null;
}

export const setBackgroundCommand = {
  name: 'scene.setBackground',
  category: 'scene',
  title: '设置场景背景',
  description: '设置 / 清空场景背景图片（assetId=null 清空），可调 fit / 位置 / 缩放 / 透明度。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sceneNodeId', 'assetId'],
    properties: {
      sceneNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      assetId: {
        oneOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }],
      },
      fit: { enum: ['cover', 'contain', 'stretch'] },
      x: NORMALIZED,
      y: NORMALIZED,
      scale: SCALE,
      opacity: OPACITY,
    },
  },
  run({ project }, params) {
    const { node, error } = requireScene(project, params.sceneNodeId);
    if (error) return error;
    const warnings = [];
    let background = null;
    if (params.assetId !== null) {
      const asset = findImage(project, params.assetId);
      if (!asset) return fail('E_ASSET_NOT_FOUND', `图片素材不存在：${params.assetId}`);
      if (asset.role && asset.role !== 'background') {
        warnings.push(`素材 ${asset.id} 的 role 是 ${asset.role}，不是 background`);
      }
      const base = node.background ?? {
        assetId: asset.id,
        fit: 'cover',
        x: 0.5,
        y: 0.5,
        scale: 1,
        opacity: 1,
      };
      background = {
        ...base,
        assetId: asset.id,
        ...(params.fit !== undefined ? { fit: params.fit } : null),
        ...(params.x !== undefined ? { x: params.x } : null),
        ...(params.y !== undefined ? { y: params.y } : null),
        ...(params.scale !== undefined ? { scale: params.scale } : null),
        ...(params.opacity !== undefined ? { opacity: params.opacity } : null),
      };
    }
    return success({
      project: updateNodeInProject(project, node.id, { background }),
      affectedNodeIds: [node.id],
      data: { background },
      warnings,
    });
  },
};

export const addSpriteCommand = {
  name: 'scene.addSprite',
  category: 'scene',
  title: '添加场景立绘',
  description: '向场景添加一张立绘（自动分配 sp_N 实例 id），可指定位置 / 缩放 / 层级 / 透明度。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sceneNodeId', 'assetId'],
    properties: {
      sceneNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      assetId: { type: 'string', minLength: 1, maxLength: 64 },
      id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
      x: NORMALIZED,
      y: NORMALIZED,
      scale: SCALE,
      zIndex: { type: 'integer', minimum: 0, maximum: 1000 },
      opacity: OPACITY,
    },
  },
  run({ project }, params) {
    const { node, error } = requireScene(project, params.sceneNodeId);
    if (error) return error;
    const asset = findImage(project, params.assetId);
    if (!asset) return fail('E_ASSET_NOT_FOUND', `图片素材不存在：${params.assetId}`);
    if ((node.sprites ?? []).length >= 32) return fail('E_SPRITE_LIMIT', '场景最多 32 个立绘');
    const warnings = [];
    if (asset.role && asset.role !== 'sprite') warnings.push(`素材 ${asset.id} 的 role 是 ${asset.role}，不是 sprite`);

    const spriteId = params.id ?? uniqueInstanceId(node.sprites ?? [], 'sp');
    if (!ID_RE.test(spriteId)) return fail('E_INVALID_SPRITE_ID', `立绘 id 非法：${spriteId}`);
    if ((node.sprites ?? []).some((item) => item.id === spriteId)) {
      return fail('E_DUPLICATE_SPRITE_ID', `立绘 id 已存在：${spriteId}`);
    }
    const sprite = {
      id: spriteId,
      assetId: asset.id,
      x: params.x ?? 0.5,
      y: params.y ?? 0.85,
      scale: params.scale ?? 1,
      zIndex: params.zIndex ?? 0,
      opacity: params.opacity ?? 1,
    };
    return success({
      project: updateNodeInProject(project, node.id, { sprites: [...(node.sprites ?? []), sprite] }),
      affectedNodeIds: [node.id],
      data: { sprite },
      warnings,
    });
  },
};

export const updateSpriteCommand = {
  name: 'scene.updateSprite',
  category: 'scene',
  title: '修改场景立绘',
  description: '修改场景内某个立绘的位置 / 缩放 / 层级 / 透明度 / 素材。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sceneNodeId', 'spriteId'],
    properties: {
      sceneNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      spriteId: { type: 'string', minLength: 1, maxLength: 64 },
      assetId: { type: 'string', minLength: 1, maxLength: 64 },
      x: NORMALIZED,
      y: NORMALIZED,
      scale: SCALE,
      zIndex: { type: 'integer', minimum: 0, maximum: 1000 },
      opacity: OPACITY,
    },
  },
  run({ project }, params) {
    const { node, error } = requireScene(project, params.sceneNodeId);
    if (error) return error;
    const sprite = (node.sprites ?? []).find((item) => item.id === params.spriteId);
    if (!sprite) return fail('E_SPRITE_NOT_FOUND', `立绘不存在：${params.spriteId}`);
    const patch = {};
    for (const key of ['assetId', 'x', 'y', 'scale', 'zIndex', 'opacity']) {
      if (params[key] !== undefined) patch[key] = params[key];
    }
    if (Object.keys(patch).length === 0) {
      return fail('E_INVALID_PARAMS', '至少提供 assetId / x / y / scale / zIndex / opacity 之一');
    }
    if (patch.assetId !== undefined && !findImage(project, patch.assetId)) {
      return fail('E_ASSET_NOT_FOUND', `图片素材不存在：${patch.assetId}`);
    }
    const next = { ...sprite, ...patch };
    const sprites = (node.sprites ?? []).map((item) => (item.id === sprite.id ? next : item));
    return success({
      project: updateNodeInProject(project, node.id, { sprites }),
      affectedNodeIds: [node.id],
      data: { sprite: next },
    });
  },
};

export const removeSpriteCommand = {
  name: 'scene.removeSprite',
  category: 'scene',
  title: '删除场景立绘',
  description: '删除场景中的立绘，并级联删除时间轴里以它为 target 的 sprite 轨道。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sceneNodeId', 'spriteId'],
    properties: {
      sceneNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      spriteId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  run({ project }, params) {
    const { node, error } = requireScene(project, params.sceneNodeId);
    if (error) return error;
    const sprite = (node.sprites ?? []).find((item) => item.id === params.spriteId);
    if (!sprite) return fail('E_SPRITE_NOT_FOUND', `立绘不存在：${params.spriteId}`);
    const sprites = (node.sprites ?? []).filter((item) => item.id !== sprite.id);

    let nextProject = updateNodeInProject(project, node.id, { sprites });
    const timeline = project.timelines?.[node.id] ?? null;
    const removedTracks = [];
    if (timeline) {
      const keep = [];
      for (const track of timeline.tracks ?? []) {
        if (track.kind === 'sprite' && track.target === sprite.id) removedTracks.push(track);
        else keep.push(track);
      }
      if (removedTracks.length > 0) {
        nextProject = {
          ...nextProject,
          timelines: { ...(nextProject.timelines ?? {}), [node.id]: { ...timeline, tracks: keep } },
        };
      }
    }
    return success({
      project: nextProject,
      affectedNodeIds: [node.id],
      affectedTrackIds: removedTracks.map((track) => track.id),
      data: {
        removedSprite: sprite,
        removedTrackIds: removedTracks.map((track) => track.id),
      },
    });
  },
};

export const setBgmCommand = {
  name: 'scene.setBgm',
  category: 'scene',
  title: '设置场景 BGM',
  description: '设置 / 清空场景背景音乐（assetId=null 清空），可调音量 / 循环 / 淡入时长。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sceneNodeId', 'assetId'],
    properties: {
      sceneNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      assetId: {
        oneOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }],
      },
      volume: OPACITY,
      loop: { type: 'boolean' },
      fadeInMs: { type: 'integer', minimum: 0, maximum: 60000 },
    },
  },
  run({ project }, params) {
    const { node, error } = requireScene(project, params.sceneNodeId);
    if (error) return error;
    const warnings = [];
    const base = node.audio ?? { bgmAssetId: null, volume: 1, loop: true, sfx: [] };
    let bgmAssetId = null;
    if (params.assetId !== null) {
      const asset = findAudio(project, params.assetId);
      if (!asset) return fail('E_ASSET_NOT_FOUND', `音频素材不存在：${params.assetId}`);
      if (asset.role && asset.role !== 'bgm') warnings.push(`素材 ${asset.id} 的 role 是 ${asset.role}，不是 bgm`);
      bgmAssetId = asset.id;
    }
    const audio = {
      ...base,
      bgmAssetId,
      ...(params.volume !== undefined ? { volume: params.volume } : null),
      ...(params.loop !== undefined ? { loop: params.loop } : null),
      ...(params.fadeInMs !== undefined ? { fadeInMs: params.fadeInMs } : null),
    };
    return success({
      project: updateNodeInProject(project, node.id, { audio }),
      affectedNodeIds: [node.id],
      data: { audio },
      warnings,
    });
  },
};

export const SCENE_COMMANDS = [
  setBackgroundCommand,
  addSpriteCommand,
  updateSpriteCommand,
  removeSpriteCommand,
  setBgmCommand,
];
