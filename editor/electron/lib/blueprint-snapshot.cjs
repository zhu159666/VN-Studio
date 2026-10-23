'use strict';

// 蓝图快照 / 全局概况：给 MCP 的 AI 客户端提供结构化空间信息。
const crypto = require('node:crypto');

function revisionOf(project) {
  return `sha1:${crypto.createHash('sha1').update(JSON.stringify(project)).digest('hex').slice(0, 16)}`;
}

function nodePorts(project, node) {
  const edges = project.edges.filter((edge) => edge.from === node.id && edge.kind !== 'data');
  return (node.exits ?? []).map((exit) => {
    const edge = edges.find((item) => item.port === exit.id) ?? null;
    return {
      id: exit.id,
      name: exit.name,
      connected_to: edge ? edge.to : null,
      edge_id: edge ? edge.id : null,
    };
  });
}

function nodeBrief(project, node) {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    position: node.position ?? null,
    exits: nodePorts(project, node),
  };
}

function danglingPorts(project, nodeIds = null) {
  const nodes = nodeIds ? project.nodes.filter((node) => nodeIds.has(node.id)) : project.nodes;
  const result = [];
  for (const node of nodes) {
    for (const port of nodePorts(project, node)) {
      if (!port.connected_to) {
        result.push({ node_id: node.id, node_name: node.name, exit_id: port.id, exit_name: port.name });
      }
    }
  }
  return result;
}

function timelineSnapshot(project, sceneNodeIds, trackIds = null) {
  const tracks = new Set(trackIds ?? []);
  const result = [];
  for (const sceneNodeId of sceneNodeIds) {
    const timeline = project.timelines?.[sceneNodeId];
    if (!timeline) continue;
    const selected = (timeline.tracks ?? []).filter((track) => !tracks.size || tracks.has(track.id));
    result.push({
      scene_node_id: sceneNodeId,
      duration_ms: timeline.durationMs,
      loop: Boolean(timeline.loop),
      tracks: selected.map((track) => ({
        id: track.id,
        kind: track.kind,
        property: track.property,
        target: track.target ?? null,
        keyframes: (track.keys ?? []).map((key) => ({
          time: key.time,
          value: key.value,
          easing: key.easing ?? null,
        })),
      })),
    });
  }
  return result;
}

/**
 * 受影响区域快照：
 * - 改动节点完整信息（坐标/出口/连接目标）
 * - 与改动节点直接相连的边
 * - 相邻节点 brief（让 AI 知道对面是谁）
 * - 受影响节点上的悬空端口
 */
function buildAffectedSnapshot(project, { nodeIds = [], trackIds = [], includeTimelines = true } = {}) {
  const ids = new Set(nodeIds.filter(Boolean));
  const nodes = project.nodes.filter((node) => ids.has(node.id));
  const edges = project.edges.filter((edge) => ids.has(edge.from) || ids.has(edge.to));
  const neighborIds = new Set();
  for (const edge of edges) {
    if (!ids.has(edge.from)) neighborIds.add(edge.from);
    if (!ids.has(edge.to)) neighborIds.add(edge.to);
  }
  const neighbors = project.nodes
    .filter((node) => neighborIds.has(node.id))
    .map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      position: node.position ?? null,
      exits: nodePorts(project, node).map((port) => ({
        id: port.id,
        name: port.name,
        connected_to: port.connected_to,
      })),
    }));

  const sceneIds = nodes.filter((node) => node.type === 'scene').map((node) => node.id);
  return {
    nodes: nodes.map((node) => nodeBrief(project, node)),
    edges: edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      port: edge.port,
      to: edge.to,
      kind: edge.kind,
    })),
    neighbors,
    dangling_ports: danglingPorts(project, ids),
    ...(includeTimelines && sceneIds.length ? { timelines: timelineSnapshot(project, sceneIds, trackIds) } : null),
  };
}

function unionFindComponents(project) {
  const parent = new Map(project.nodes.map((node) => [node.id, node.id]));
  const find = (id) => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current);
    while (parent.get(id) !== id) {
      const next = parent.get(id);
      parent.set(id, current);
      id = next;
    }
    return current;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const edge of project.edges) {
    if (parent.has(edge.from) && parent.has(edge.to)) union(edge.from, edge.to);
  }
  const groups = new Map();
  for (const node of project.nodes) {
    const root = find(node.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node.id);
  }
  return [...groups.values()];
}

/** 全局概况：给 AI 用来决定下一步，不返回巨量文本。 */
function buildBlueprintSummary(project, { includeEdges = false } = {}) {
  const byType = {};
  for (const node of project.nodes) byType[node.type] = (byType[node.type] ?? 0) + 1;
  const components = unionFindComponents(project);
  const connectedIds = new Set();
  for (const edge of project.edges) {
    connectedIds.add(edge.from);
    connectedIds.add(edge.to);
  }
  const nodeIds = new Set(project.nodes.map((node) => node.id));
  return {
    project: {
      title: project.meta?.title ?? null,
      resolution: project.settings?.resolution ?? null,
      start_node_id: project.settings?.startNodeId ?? null,
    },
    counts: {
      nodes: project.nodes.length,
      edges: project.edges.length,
      by_type: byType,
      timelines: Object.keys(project.timelines ?? {}).length,
      variables: Object.keys(project.variables ?? {}).length,
    },
    nodes: project.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      position: node.position ?? null,
      exit_count: (node.exits ?? []).length,
      connected_exit_count: nodePorts(project, node).filter((port) => port.connected_to).length,
      dangling_exit_ids: nodePorts(project, node)
        .filter((port) => !port.connected_to)
        .map((port) => port.id),
    })),
    ...(includeEdges
      ? {
          edges: project.edges.map((edge) => ({
            id: edge.id,
            from: edge.from,
            port: edge.port,
            to: edge.to,
            kind: edge.kind,
          })),
        }
      : null),
    dangling_ports: danglingPorts(project),
    orphan_nodes: project.nodes
      .filter((node) => !connectedIds.has(node.id) && node.id !== project.settings?.startNodeId)
      .map((node) => node.id),
    disconnected_components: components.filter((component) => component.length > 1),
    broken_jumps: project.nodes
      .filter((node) => node.type === 'jump' && (!node.targetNodeId || !nodeIds.has(node.targetNodeId)))
      .map((node) => ({ id: node.id, target_node_id: node.targetNodeId ?? null })),
    timelines: Object.entries(project.timelines ?? {}).map(([sceneNodeId, timeline]) => ({
      scene_node_id: sceneNodeId,
      duration_ms: timeline.durationMs,
      loop: Boolean(timeline.loop),
      tracks: (timeline.tracks ?? []).length,
      keyframes: (timeline.tracks ?? []).reduce((sum, track) => sum + (track.keys ?? []).length, 0),
    })),
    assets: {
      images: (project.assets?.images ?? []).map((asset) => ({
        id: asset.id,
        name: asset.name,
        role: asset.role,
        width: asset.width,
        height: asset.height,
        path: asset.path,
      })),
      audio: (project.assets?.audio ?? []).map((asset) => ({
        id: asset.id,
        name: asset.name,
        role: asset.role,
        duration_ms: asset.durationMs,
        path: asset.path,
      })),
      videos: (project.assets?.videos ?? []).map((asset) => ({
        id: asset.id,
        name: asset.name,
        duration_ms: asset.durationMs,
        path: asset.path,
      })),
      minigames: (project.assets?.minigames ?? []).map((asset) => ({
        id: asset.id,
        name: asset.name,
        path: asset.path,
      })),
    },
    warnings: [
      ...(project.settings?.startNodeId && !nodeIds.has(project.settings.startNodeId)
        ? [`startNodeId 指向不存在的节点：${project.settings.startNodeId}`]
        : []),
      ...(project.nodes.length === 0 ? ['项目没有节点'] : []),
    ],
  };
}

module.exports = {
  revisionOf,
  buildAffectedSnapshot,
  buildBlueprintSummary,
  danglingPorts,
  timelineSnapshot,
  unionFindComponents,
};
