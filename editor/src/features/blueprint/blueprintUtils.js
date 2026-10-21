// 蓝图纯逻辑：节点草稿、出口/端口、拖拽生成、连线校验、React Flow 数据映射。
// 不依赖 React / DOM，可被单元测试直接导入。

import { nowId } from '../../state/projectMutations.js';

export const NODE_TYPE_META = {
  dialogue: { label: '对话', short: '话', color: '#5aa9ff' },
  scene: { label: '场景', short: '景', color: '#7be0c0' },
  choice: { label: '选项', short: '选', color: '#ffc857' },
  minigame: { label: '小游戏', short: '游', color: '#ff9f7a' },
  video: { label: '视频', short: '视', color: '#c49bff' },
  jump: { label: '跳转', short: '跳', color: '#9aa8b5' },
  condition: { label: '条件', short: '条', color: '#ffb86b' },
  variable: { label: '变量操作', short: '变', color: '#86d3ff' },
};

export const NODE_TYPE_ORDER = [
  'dialogue',
  'scene',
  'choice',
  'minigame',
  'video',
  'jump',
  'condition',
  'variable',
];

export const DEFAULT_SCENE_TEXTBOX = {
  x: 0.5,
  y: 0.84,
  width: 0.92,
  height: 0.22,
  fontSizePx: 28,
  color: '#ffffff',
  background: '#000000',
  backgroundOpacity: 0.55,
  opacity: 1,
};

export const DEFAULT_SCENE_AUDIO = {
  bgmAssetId: null,
  volume: 0.8,
  loop: true,
  fadeInMs: 0,
  sfx: [],
};

export function assetName(project, assetId) {
  if (!assetId) return null;
  const all = [
    ...(project.assets?.images ?? []),
    ...(project.assets?.audio ?? []),
    ...(project.assets?.videos ?? []),
    ...(project.assets?.minigames ?? []),
  ];
  return all.find((asset) => asset.id === assetId)?.name ?? assetId;
}

export function nodeWidth(exitCount) {
  return Math.round(236 + Math.min(Math.max(exitCount, 0), 10) * 16);
}

export function edgeKindForNode(node) {
  return node?.type === 'condition' ? 'conditional' : 'sequence';
}

export function makeNodeId(project, type) {
  return nowId(`n_${type}`, new Set(project.nodes.map((node) => node.id)));
}

export function makeEdgeId(project) {
  return nowId('e', new Set(project.edges.map((edge) => edge.id)));
}

export function makeScene(project, { id, name = '场景', position = { x: 0, y: 0 } }) {
  return {
    id,
    type: 'scene',
    name,
    position,
    exits: [{ id: 'next', name: 'next' }],
    background: null,
    sprites: [],
    uiImages: [],
    textbox: { ...DEFAULT_SCENE_TEXTBOX },
    audio: { ...DEFAULT_SCENE_AUDIO, sfx: [] },
    variables: [],
  };
}

export function uniqueInstanceId(items, prefix = 'sp') {
  const used = new Set((items ?? []).map((item) => item.id));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${prefix}_${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${prefix}_${Date.now().toString(36)}`;
}

// 创建节点草稿。返回 { node } 或 { error }。
export function createNodeDraft(project, type, { position = { x: 0, y: 0 } } = {}) {
  const meta = NODE_TYPE_META[type];
  if (!meta) return { error: `未知节点类型：${type}` };
  const base = nodeWidth(1);
  void base;
  const id = makeNodeId(project, type);
  const name = `${meta.label}`;

  if (type === 'dialogue') {
    return {
      node: {
        id,
        type,
        name,
        position,
        exits: [{ id: 'next', name: 'next' }],
        text: '在这里输入台词。',
        speaker: null,
        portrait: null,
        voice: null,
        speedCps: null,
        autoAdvanceMs: null,
      },
    };
  }
  if (type === 'scene') {
    return { node: makeScene(project, { id, name, position }) };
  }
  if (type === 'choice') {
    return {
      node: {
        id,
        type,
        name,
        position,
        prompt: '',
        exits: [
          { id: 'opt_1', name: '选项 1' },
          { id: 'opt_2', name: '选项 2' },
        ],
      },
    };
  }
  if (type === 'minigame') {
    const asset = project.assets?.minigames?.[0];
    if (!asset) return { error: '请先在素材库导入小游戏，再创建小游戏节点' };
    const exits = (asset.declaredExits ?? []).map((exitName, index) => ({
      id: `exit_${index + 1}`,
      name: exitName,
    }));
    const finalExits = exits.length > 0 ? exits : [
      { id: 'exit_1', name: 'win' },
      { id: 'exit_2', name: 'lose' },
    ];
    return {
      node: {
        id,
        type,
        name: asset.name || name,
        position,
        minigameAssetId: asset.id,
        exits: finalExits,
        defaultExitId: null,
        timeoutMs: null,
        instructions: '',
      },
    };
  }
  if (type === 'video') {
    const asset = project.assets?.videos?.[0];
    if (!asset) return { error: '请先在素材库导入视频，再创建视频节点' };
    return {
      node: {
        id,
        type,
        name: asset.name || name,
        position,
        videoAssetId: asset.id,
        exits: [
          { id: 'completed', name: 'completed' },
          { id: 'skipped', name: 'skipped' },
        ],
        volume: 1,
        loop: false,
        showSkipButton: true,
        skipAfterMs: null,
      },
    };
  }
  if (type === 'jump') {
    const target = project.nodes[0]?.id;
    if (!target) return { error: '项目中还没有可跳转的节点' };
    return {
      node: { id, type, name, position, exits: [], targetNodeId: target },
    };
  }
  if (type === 'condition') {
    return {
      node: {
        id,
        type,
        name,
        position,
        expression: 'true',
        exits: [
          { id: 'true', name: 'true' },
          { id: 'false', name: 'false' },
        ],
      },
    };
  }
  // variable
  return {
    node: {
      id,
      type,
      name,
      position,
      exits: [{ id: 'next', name: 'next' }],
      assignments: [{ key: 'new_var', op: 'set', value: { type: 'number', value: 0 } }],
    },
  };
}

function sceneBackgroundFor(asset) {
  return { assetId: asset.id, fit: 'cover', x: 0.5, y: 0.5, scale: 1, opacity: 1 };
}

function spriteEntry(project, entry) {
  const base = {
    id: entry.id ?? uniqueInstanceId([], 'sp'),
    assetId: entry.assetId,
    x: entry.x,
    y: entry.y,
    scale: entry.scale,
    zIndex: entry.zIndex,
    opacity: entry.opacity,
  };
  return base;
}

// 拖拽素材到蓝图/节点后的纯函数。
// 返回 { project, selectedNodeId?, needsSpriteOptions?, error? }
export function applyAssetDrop(
  project,
  { asset, flowPosition = { x: 0, y: 0 }, targetNodeId = null, spriteOptions = null },
) {
  if (!asset) return { project, error: '缺少素材信息' };
  const targetNode = targetNodeId
    ? project.nodes.find((node) => node.id === targetNodeId)
    : null;
  if (targetNodeId && !targetNode) return { project, error: '目标节点不存在' };

  if (asset.kind === 'image') {
    if (asset.role === 'background') {
      if (targetNode) {
        if (targetNode.type !== 'scene') return { project, error: '背景只能拖到场景节点上' };
        return {
          project: {
            ...project,
            nodes: project.nodes.map((node) =>
              node.id === targetNode.id
                ? { ...node, background: sceneBackgroundFor(asset) }
                : node,
            ),
          },
          selectedNodeId: targetNode.id,
        };
      }
      const draft = createNodeDraft(project, 'scene', { position: flowPosition });
      if (draft.error) return { project, error: draft.error };
      draft.node.background = sceneBackgroundFor(asset);
      draft.node.name = asset.name || '场景';
      return {
        project: { ...project, nodes: [...project.nodes, draft.node] },
        selectedNodeId: draft.node.id,
      };
    }

    // 立绘 / UI / 其他图片：需要位置与表情（立绘素材）选择。
    if (!spriteOptions) {
      return { project, needsSpriteOptions: true, asset, targetNodeId };
    }
    const entry = spriteEntry(project, {
      ...spriteOptions,
      assetId: spriteOptions.assetId ?? asset.id,
    });
    if (!entry.assetId) return { project, error: '缺少立绘素材' };
    if (targetNode) {
      if (targetNode.type !== 'scene') return { project, error: '图片只能拖到场景节点上' };
      const key = asset.role === 'ui' ? 'uiImages' : 'sprites';
      const list = [...(targetNode[key] ?? [])];
      entry.id = uniqueInstanceId(list, asset.role === 'ui' ? 'ui' : 'sp');
      return {
        project: {
          ...project,
          nodes: project.nodes.map((node) =>
            node.id === targetNode.id ? { ...node, [key]: [...list, entry] } : node,
          ),
        },
        selectedNodeId: targetNode.id,
      };
    }
    const draft = createNodeDraft(project, 'scene', { position: flowPosition });
    if (draft.error) return { project, error: draft.error };
    draft.node.name = asset.name || '场景';
    const key = asset.role === 'ui' ? 'uiImages' : 'sprites';
    entry.id = uniqueInstanceId([], asset.role === 'ui' ? 'ui' : 'sp');
    draft.node[key] = [entry];
    return {
      project: { ...project, nodes: [...project.nodes, draft.node] },
      selectedNodeId: draft.node.id,
    };
  }

  if (asset.kind === 'audio') {
    if (!targetNode) return { project, error: '音频请拖到场景节点上设置 BGM/音效' };
    if (targetNode.type !== 'scene') return { project, error: '音频只能拖到场景节点上' };
    if (asset.role !== 'bgm') {
      return { project, error: '只有 BGM 素材可以直接拖到场景上（音效请用属性面板添加）' };
    }
    return {
      project: {
        ...project,
        nodes: project.nodes.map((node) =>
          node.id === targetNode.id
            ? { ...node, audio: { ...node.audio, bgmAssetId: asset.id } }
            : node,
        ),
      },
      selectedNodeId: targetNode.id,
    };
  }

  if (asset.kind === 'video') {
    if (targetNode) return { project, error: '视频素材请拖到空白处创建视频节点' };
    const draft = createNodeDraft(project, 'video', { position: flowPosition });
    if (draft.error) return { project, error: draft.error };
    draft.node.videoAssetId = asset.id;
    draft.node.name = asset.name || '视频';
    return {
      project: { ...project, nodes: [...project.nodes, draft.node] },
      selectedNodeId: draft.node.id,
    };
  }

  if (asset.kind === 'minigame') {
    if (targetNode) return { project, error: '小游戏素材请拖到空白处创建小游戏节点' };
    const draft = createNodeDraft(project, 'minigame', { position: flowPosition });
    if (draft.error) return { project, error: draft.error };
    draft.node.minigameAssetId = asset.id;
    draft.node.name = asset.name || '小游戏';
    draft.node.exits = (asset.declaredExits ?? []).map((exitName, index) => ({
      id: `exit_${index + 1}`,
      name: exitName,
    }));
    return {
      project: { ...project, nodes: [...project.nodes, draft.node] },
      selectedNodeId: draft.node.id,
    };
  }

  return { project, error: '不支持的素材类型' };
}

// 连线校验：返回 { ok } 或 { ok:false, error }
export function validateConnection(project, connection) {
  const { source, sourceHandle, target } = connection ?? {};
  if (!source || !sourceHandle || !target) return { ok: false, error: '连线信息不完整' };
  const sourceNode = project.nodes.find((node) => node.id === source);
  const targetNode = project.nodes.find((node) => node.id === target);
  if (!sourceNode) return { ok: false, error: '源节点不存在' };
  if (!targetNode) return { ok: false, error: '目标节点不存在' };
  if (!sourceNode.exits.some((exit) => exit.id === sourceHandle)) {
    return { ok: false, error: '源出口不存在' };
  }
  if (sourceNode.type === 'jump') return { ok: false, error: '跳转节点没有出口' };
  return { ok: true, sourceNode, targetNode };
}

export function makeEdgeFromConnection(project, connection) {
  const result = validateConnection(project, connection);
  if (!result.ok) return { error: result.error };
  const edges = [...project.edges];
  let existing = null;
  if (result.sourceNode.type === 'condition') {
    existing = edges.find((edge) => edge.from === connection.source && edge.port === connection.sourceHandle);
  } else {
    existing = edges.find((edge) => edge.from === connection.source && edge.port === connection.sourceHandle);
  }
  return {
    edge: {
      id: makeEdgeId(project),
      from: connection.source,
      port: connection.sourceHandle,
      to: connection.target,
      kind: edgeKindForNode(result.sourceNode),
    },
    existing: existing ?? null,
  };
}

export function summarizeNode(project, node) {
  if (!node) return [];
  switch (node.type) {
    case 'dialogue':
      return [
        node.speaker ? `说话人：${node.speaker}` : '旁白',
        node.text ? `「${node.text.slice(0, 36)}${node.text.length > 36 ? '…' : ''}」` : '（空台词）',
      ];
    case 'scene': {
      const lines = [];
      lines.push(node.background ? `背景：${assetName(project, node.background.assetId) ?? '未命名'}` : '无背景');
      lines.push(`立绘：${(node.sprites ?? []).length} 张${(node.uiImages ?? []).length ? ` · UI ${(node.uiImages ?? []).length}` : ''}`);
      lines.push(node.audio?.bgmAssetId ? `BGM：${assetName(project, node.audio.bgmAssetId)}` : '无 BGM');
      return lines;
    }
    case 'choice':
      return [`${node.exits.length} 个选项`, node.exits.map((exit) => exit.name).join(' / ')];
    case 'minigame': {
      const asset = project.assets?.minigames?.find((item) => item.id === node.minigameAssetId);
      return [
        `出口：${node.exits.map((exit) => exit.name).join(' / ')}`,
        asset ? `素材：${asset.name}` : '未绑定小游戏',
      ];
    }
    case 'video': {
      const asset = project.assets?.videos?.find((item) => item.id === node.videoAssetId);
      return [asset ? asset.name : '未绑定视频', asset?.durationMs ? `${(asset.durationMs / 1000).toFixed(1)}s` : ''].filter(Boolean);
    }
    case 'jump': {
      const target = project.nodes.find((item) => item.id === node.targetNodeId);
      return [`跳转到：${target ? target.name : '未设置'}`];
    }
    case 'condition':
      return [node.expression || '（空表达式）'];
    case 'variable':
      return [`${node.assignments.length} 条赋值`, node.assignments.map((item) => item.key).join(', ')];
    default:
      return [];
  }
}

export function buildFlowNodes(project) {
  return project.nodes.map((node) => ({
    id: node.id,
    type: 'blueprint',
    position: node.position ?? { x: 0, y: 0 },
    data: {
      node,
      meta: NODE_TYPE_META[node.type] ?? { label: node.type, short: '?', color: '#9aa8b5' },
      summary: summarizeNode(project, node),
      ports: node.exits.map((exit) => ({ id: exit.id, name: exit.name, label: exit.label ?? null })),
      width: nodeWidth(node.exits.length),
    },
  }));
}

export function buildFlowEdges(project) {
  return project.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    sourceHandle: edge.port,
    targetHandle: 'in',
    type: 'default',
    data: { edge },
  }));
}

export function nextDefaultPosition(project) {
  const xs = project.nodes.map((node) => Number(node.position?.x ?? 0));
  const ys = project.nodes.map((node) => Number(node.position?.y ?? 0));
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  return { x: maxX + 320, y: minY + 40 };
}
