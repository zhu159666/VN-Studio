// 蓝图类 command：节点创建 / 连线 / 出口配置。
// 每个命令的 inputSchema 就是未来 MCP tool 的 inputSchema；只接受可 JSON 序列化的参数。
import {
  NODE_TYPE_ORDER,
  createNodeDraft,
  edgeKindForNode,
  makeEdgeId,
  nextDefaultPosition,
  validateConnection,
} from '../features/blueprint/blueprintUtils.js';
import {
  addEdgeToProject,
  addNodeExitToProject,
  addNodeToProject,
  removeEdgeFromProject,
  removeNodeExitFromProject,
  removeNodeFromProject,
  updateNodeInProject,
} from '../state/projectMutations.js';
import { EXIT_LIMITS, ID_RE, fail, findEdge, findNode, success } from './helpers.js';

const POSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
  },
};

function nextExitId(node, prefix) {
  const used = new Set(node.exits.map((exit) => exit.id));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${prefix}${Date.now().toString(36)}`;
}

function fixedExitMessage(node) {
  return `节点 ${node.id}（${node.type}）使用固定出口，不能新增/删除`;
}

export const createNodeCommand = {
  name: 'blueprint.createNode',
  category: 'blueprint',
  title: '创建蓝图节点',
  description:
    '在项目中创建一个指定类型的蓝图节点（dialogue / scene / choice / minigame / video / jump / condition / variable），返回节点与受影响节点 id。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['type'],
    properties: {
      type: { enum: NODE_TYPE_ORDER },
      name: { type: 'string', minLength: 1, maxLength: 80 },
      position: POSITION_SCHEMA,
      nodeId: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
      assetId: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
        description: 'minigame / video 节点要绑定的素材 id（不传则使用素材库中的第一条同类素材）',
      },
    },
  },
  run({ project }, params) {
    const type = params.type;
    if (!NODE_TYPE_ORDER.includes(type)) {
      return fail('E_UNKNOWN_NODE_TYPE', `未知节点类型：${type}`);
    }
    if (params.assetId && type !== 'minigame' && type !== 'video') {
      return fail('E_INVALID_PARAMS', 'assetId 只适用于 minigame / video 节点');
    }
    if (params.nodeId && findNode(project, params.nodeId)) {
      return fail('E_DUPLICATE_NODE_ID', `节点 id 已存在：${params.nodeId}`);
    }

    const position = params.position ?? nextDefaultPosition(project);
    const draft = createNodeDraft(project, type, { position });
    if (draft.error) {
      const code = type === 'minigame' || type === 'video' ? 'E_ASSET_REQUIRED' : 'E_NODE_DRAFT';
      return fail(code, draft.error);
    }

    let node = draft.node;
    if (params.name !== undefined) node = { ...node, name: params.name };
    if (params.nodeId !== undefined) node = { ...node, id: params.nodeId };
    if (params.assetId) {
      if (type === 'minigame') {
        const asset = project.assets?.minigames?.find((item) => item.id === params.assetId);
        if (!asset) return fail('E_ASSET_NOT_FOUND', `小游戏素材不存在：${params.assetId}`);
        node = { ...node, minigameAssetId: asset.id };
      } else {
        const asset = project.assets?.videos?.find((item) => item.id === params.assetId);
        if (!asset) return fail('E_ASSET_NOT_FOUND', `视频素材不存在：${params.assetId}`);
        node = { ...node, videoAssetId: asset.id };
      }
    }

    return success({
      project: addNodeToProject(project, node),
      affectedNodeIds: [node.id],
      data: { node },
    });
  },
};

export const connectCommand = {
  name: 'blueprint.connect',
  category: 'blueprint',
  title: '连接蓝图出口',
  description:
    '把源节点的一个出口连接到目标节点；同一出口已有连线时会被替换（返回 replacedEdgeId）。返回受影响节点 id 与新连线。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['fromNodeId', 'fromExitId', 'toNodeId'],
    properties: {
      fromNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      fromExitId: { type: 'string', minLength: 1, maxLength: 64 },
      toNodeId: { type: 'string', minLength: 1, maxLength: 64 },
      kind: { enum: ['sequence', 'conditional'] },
      edgeId: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
    },
  },
  run({ project }, params) {
    const connection = {
      source: params.fromNodeId,
      sourceHandle: params.fromExitId,
      target: params.toNodeId,
    };
    const validated = validateConnection(project, connection);
    if (!validated.ok) return fail('E_CONNECTION_INVALID', validated.error);

    const warnings = [];
    const expectedKind = edgeKindForNode(validated.sourceNode);
    if (params.kind && params.kind !== expectedKind) {
      warnings.push(`kind 已按源节点类型调整为 ${expectedKind}`);
    }
    const edgeId = params.edgeId ?? makeEdgeId(project);
    if (findEdge(project, edgeId)) {
      return fail('E_DUPLICATE_EDGE_ID', `连线 id 已存在：${edgeId}`);
    }
    const existing =
      project.edges.find(
        (edge) => edge.from === params.fromNodeId && edge.port === params.fromExitId && edge.kind !== 'data',
      ) ?? null;
    if (existing) warnings.push(`已替换出口 ${params.fromExitId} 上已有的连线 ${existing.id}`);

    const edge = {
      id: edgeId,
      from: params.fromNodeId,
      port: params.fromExitId,
      to: params.toNodeId,
      kind: expectedKind,
    };
    return success({
      project: addEdgeToProject(project, edge),
      affectedNodeIds: [params.fromNodeId, params.toNodeId],
      data: { edge, replacedEdgeId: existing ? existing.id : null },
      warnings,
    });
  },
};

export const addExitCommand = {
  name: 'blueprint.addExit',
  category: 'blueprint',
  title: '新增节点出口',
  description:
    '为 choice 节点新增选项出口，或为 minigame 节点新增结果出口；固定出口的节点类型会被拒绝。返回新出口。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['nodeId', 'name'],
    properties: {
      nodeId: { type: 'string', minLength: 1, maxLength: 64 },
      name: { type: 'string', minLength: 1, maxLength: 120 },
      id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
      label: { type: 'string', maxLength: 120 },
      description: { type: 'string', maxLength: 500 },
    },
  },
  run({ project }, params) {
    const node = findNode(project, params.nodeId);
    if (!node) return fail('E_NODE_NOT_FOUND', `节点不存在：${params.nodeId}`);
    const limits = EXIT_LIMITS[node.type];
    if (!limits) return fail('E_FIXED_EXITS', fixedExitMessage(node));
    if (node.exits.length >= limits.max) {
      return fail('E_EXIT_LIMIT', `${node.type} 节点最多 ${limits.max} 个出口`);
    }

    const exitId = params.id ?? nextExitId(node, limits.prefix);
    if (!ID_RE.test(exitId)) return fail('E_INVALID_EXIT_ID', `出口 id 非法：${exitId}`);
    if (node.exits.some((exit) => exit.id === exitId)) {
      return fail('E_DUPLICATE_EXIT_ID', `出口 id 已存在：${exitId}`);
    }
    const name = params.name.trim();
    if (!name) return fail('E_INVALID_PARAMS', '出口 name 不能为空');

    const warnings = [];
    if (node.exits.some((exit) => exit.name === name)) warnings.push(`出口 name 重复：${name}`);
    const exit = { id: exitId, name };
    if (params.label !== undefined) exit.label = params.label;
    if (params.description !== undefined) exit.description = params.description;

    return success({
      project: addNodeExitToProject(project, node.id, exit),
      affectedNodeIds: [node.id],
      data: { exit },
      warnings,
    });
  },
};

export const updateExitCommand = {
  name: 'blueprint.updateExit',
  category: 'blueprint',
  title: '修改节点出口',
  description:
    '修改出口显示名（fixed 出口不允许改 name）或 label / description。choice / minigame 的出口 name 可改；固定出口只能改 label / description。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['nodeId', 'exitId'],
    properties: {
      nodeId: { type: 'string', minLength: 1, maxLength: 64 },
      exitId: { type: 'string', minLength: 1, maxLength: 64 },
      name: { type: 'string', minLength: 1, maxLength: 120 },
      label: { type: 'string', maxLength: 120 },
      description: { type: 'string', maxLength: 500 },
    },
  },
  run({ project }, params) {
    const node = findNode(project, params.nodeId);
    if (!node) return fail('E_NODE_NOT_FOUND', `节点不存在：${params.nodeId}`);
    if (!Array.isArray(node.exits) || node.exits.length === 0) {
      return fail('E_FIXED_EXITS', `节点 ${node.id} 没有可配置的出口`);
    }
    const exit = node.exits.find((item) => item.id === params.exitId);
    if (!exit) return fail('E_EXIT_NOT_FOUND', `出口不存在：${params.exitId}`);

    const limits = EXIT_LIMITS[node.type];
    const warnings = [];
    if (!limits && params.name !== undefined && params.name !== exit.name) {
      return fail('E_FIXED_EXITS', `节点 ${node.id}（${node.type}）的出口 name 是固定的，不能修改`);
    }
    if (params.name === undefined && params.label === undefined && params.description === undefined) {
      return fail('E_INVALID_PARAMS', '至少提供 name / label / description 之一');
    }

    const nextExit = { ...exit };
    if (params.name !== undefined) nextExit.name = params.name.trim();
    if (params.label !== undefined) {
      if (params.label === '') delete nextExit.label;
      else nextExit.label = params.label;
    }
    if (params.description !== undefined) {
      if (params.description === '') delete nextExit.description;
      else nextExit.description = params.description;
    }
    if (limits && node.exits.some((item) => item.id !== exit.id && item.name === nextExit.name)) {
      warnings.push(`出口 name 重复：${nextExit.name}`);
    }
    const exits = node.exits.map((item) => (item.id === exit.id ? nextExit : item));
    return success({
      project: updateNodeInProject(project, node.id, { exits }),
      affectedNodeIds: [node.id],
      data: { exit: nextExit },
      warnings,
    });
  },
};

export const removeExitCommand = {
  name: 'blueprint.removeExit',
  category: 'blueprint',
  title: '删除节点出口',
  description:
    '删除 choice / minigame 节点的出口，并级联删除该出口上的连线；低于最少出口数会被拒绝。返回受影响节点 id 与被删除的连线 id。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['nodeId', 'exitId'],
    properties: {
      nodeId: { type: 'string', minLength: 1, maxLength: 64 },
      exitId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  run({ project }, params) {
    const node = findNode(project, params.nodeId);
    if (!node) return fail('E_NODE_NOT_FOUND', `节点不存在：${params.nodeId}`);
    const limits = EXIT_LIMITS[node.type];
    if (!limits) return fail('E_FIXED_EXITS', fixedExitMessage(node));
    const exit = node.exits.find((item) => item.id === params.exitId);
    if (!exit) return fail('E_EXIT_NOT_FOUND', `出口不存在：${params.exitId}`);
    if (node.exits.length - 1 < limits.min) {
      return fail('E_EXIT_MIN', `${node.type} 节点至少保留 ${limits.min} 个出口`);
    }

    const removedEdges = project.edges.filter(
      (edge) => edge.from === node.id && edge.port === params.exitId,
    );
    return success({
      project: removeNodeExitFromProject(project, node.id, params.exitId),
      affectedNodeIds: [node.id, ...removedEdges.map((edge) => edge.to)],
      data: { removedExit: exit, removedEdgeIds: removedEdges.map((edge) => edge.id) },
    });
  },
};

export const setDefaultExitCommand = {
  name: 'blueprint.setDefaultExit',
  category: 'blueprint',
  title: '设置小游戏默认出口',
  description: '设置 minigame 节点在结果无匹配时使用的默认出口；exitId=null 表示清空。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['nodeId'],
    properties: {
      nodeId: { type: 'string', minLength: 1, maxLength: 64 },
      exitId: {
        oneOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }],
      },
    },
  },
  run({ project }, params) {
    const node = findNode(project, params.nodeId);
    if (!node) return fail('E_NODE_NOT_FOUND', `节点不存在：${params.nodeId}`);
    if (node.type !== 'minigame') {
      return fail('E_INVALID_NODE_TYPE', '只有 minigame 节点可以设置默认出口');
    }
    const exitId = params.exitId ?? null;
    if (exitId !== null && !node.exits.some((exit) => exit.id === exitId)) {
      return fail('E_EXIT_NOT_FOUND', `出口不存在：${exitId}`);
    }
    return success({
      project: updateNodeInProject(project, node.id, { defaultExitId: exitId }),
      affectedNodeIds: [node.id],
      data: { defaultExitId: exitId },
    });
  },
};

export const deleteNodeCommand = {
  name: 'blueprint.deleteNode',
  category: 'blueprint',
  title: '删除蓝图节点',
  description:
    '删除节点并级联删除与之相连的所有连线；如删的是开始节点会清空 startNodeId。项目至少保留一个节点。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['nodeId'],
    properties: {
      nodeId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  run({ project }, params) {
    const node = findNode(project, params.nodeId);
    if (!node) return fail('E_NODE_NOT_FOUND', `节点不存在：${params.nodeId}`);
    if (project.nodes.length <= 1) return fail('E_LAST_NODE', '项目至少需要保留一个节点');
    const removedEdges = project.edges.filter(
      (edge) => edge.from === node.id || edge.to === node.id,
    );
    const affectedTargets = removedEdges
      .map((edge) => (edge.from === node.id ? edge.to : edge.from))
      .filter((id) => id !== node.id);
    return success({
      project: removeNodeFromProject(project, node.id),
      affectedNodeIds: [node.id, ...affectedTargets],
      data: {
        removedNode: node,
        removedEdgeIds: removedEdges.map((edge) => edge.id),
      },
    });
  },
};

export const removeEdgeCommand = {
  name: 'blueprint.removeEdge',
  category: 'blueprint',
  title: '删除蓝图连线',
  description: '删除一条连线（不影响节点与出口本身），返回两端节点 id。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['edgeId'],
    properties: {
      edgeId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  run({ project }, params) {
    const edge = findEdge(project, params.edgeId);
    if (!edge) return fail('E_EDGE_NOT_FOUND', `连线不存在：${params.edgeId}`);
    return success({
      project: removeEdgeFromProject(project, edge.id),
      affectedNodeIds: [edge.from, edge.to],
      data: { removedEdge: edge },
    });
  },
};

export const setStartNodeCommand = {
  name: 'blueprint.setStartNode',
  category: 'blueprint',
  title: '设置开始节点',
  description: '设置项目的起始节点（settings.startNodeId）；nodeId=null 表示清空。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['nodeId'],
    properties: {
      nodeId: {
        oneOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }],
      },
    },
  },
  run({ project }, params) {
    const nodeId = params.nodeId ?? null;
    if (nodeId !== null && !findNode(project, nodeId)) {
      return fail('E_NODE_NOT_FOUND', `节点不存在：${nodeId}`);
    }
    return success({
      project: {
        ...project,
        settings: { ...(project.settings ?? {}), startNodeId: nodeId },
      },
      affectedNodeIds: nodeId ? [nodeId] : [],
      data: { startNodeId: nodeId },
    });
  },
};

export const updateDialogueCommand = {
  name: 'blueprint.updateDialogue',
  category: 'blueprint',
  title: '修改对话节点',
  description:
    '修改 dialogue 节点的台词 / 说话人 / 立绘引用 / 语音 / 文字速度 / 自动前进；传 null 可清空可空字段。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['nodeId'],
    properties: {
      nodeId: { type: 'string', minLength: 1, maxLength: 64 },
      text: { type: 'string', maxLength: 20000 },
      speaker: {
        oneOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }],
      },
      portraitAssetId: {
        oneOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }],
      },
      voiceAssetId: {
        oneOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }],
      },
      speedCps: {
        oneOf: [{ type: 'number', minimum: 0, maximum: 1000 }, { type: 'null' }],
      },
      autoAdvanceMs: {
        oneOf: [{ type: 'integer', minimum: 0, maximum: 600000 }, { type: 'null' }],
      },
    },
  },
  run({ project }, params) {
    const node = findNode(project, params.nodeId);
    if (!node) return fail('E_NODE_NOT_FOUND', `节点不存在：${params.nodeId}`);
    if (node.type !== 'dialogue') {
      return fail('E_INVALID_NODE_TYPE', `节点 ${node.id} 不是对话节点`);
    }
    const patch = {};
    if (params.text !== undefined) patch.text = params.text;
    if (params.speaker !== undefined) patch.speaker = params.speaker;
    if (params.speedCps !== undefined) patch.speedCps = params.speedCps;
    if (params.autoAdvanceMs !== undefined) patch.autoAdvanceMs = params.autoAdvanceMs;
    if (params.portraitAssetId !== undefined) {
      if (params.portraitAssetId === null) {
        patch.portrait = null;
      } else {
        const asset = project.assets?.images?.find((item) => item.id === params.portraitAssetId);
        if (!asset) return fail('E_ASSET_NOT_FOUND', `图片素材不存在：${params.portraitAssetId}`);
        patch.portrait = { assetId: asset.id };
      }
    }
    if (params.voiceAssetId !== undefined) {
      if (params.voiceAssetId === null) {
        patch.voice = null;
      } else {
        const asset = project.assets?.audio?.find((item) => item.id === params.voiceAssetId);
        if (!asset) return fail('E_ASSET_NOT_FOUND', `音频素材不存在：${params.voiceAssetId}`);
        patch.voice = { assetId: asset.id };
      }
    }
    if (Object.keys(patch).length === 0) {
      return fail('E_INVALID_PARAMS', '至少提供 text / speaker / portraitAssetId / voiceAssetId / speedCps / autoAdvanceMs 之一');
    }
    return success({
      project: updateNodeInProject(project, node.id, patch),
      affectedNodeIds: [node.id],
      data: { node: { ...node, ...patch } },
    });
  },
};

export const BLUEPRINT_COMMANDS = [
  createNodeCommand,
  connectCommand,
  addExitCommand,
  updateExitCommand,
  removeExitCommand,
  setDefaultExitCommand,
  deleteNodeCommand,
  removeEdgeCommand,
  setStartNodeCommand,
  updateDialogueCommand,
];
