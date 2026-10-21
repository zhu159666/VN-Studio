// 蓝图相关的纯函数项目变更。编辑器与单元测试共用（不依赖 React / DOM / electron）。

export function nowId(prefix, existingIds, randomPart = Math.random) {
  const existing = existingIds instanceof Set ? existingIds : new Set(existingIds ?? []);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = randomPart().toString(36).slice(2, 8) || 'x1y2z3';
    const candidate = `${prefix}_${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${prefix}_${Date.now().toString(36)}`;
}

export function addNodeToProject(project, node) {
  if (!node?.id) return project;
  if (project.nodes.some((item) => item.id === node.id)) return project;
  return { ...project, nodes: [...project.nodes, node] };
}

export function updateNodeInProject(project, nodeId, patch) {
  const index = project.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return project;
  const nodes = [...project.nodes];
  nodes[index] = { ...nodes[index], ...patch };
  return { ...project, nodes };
}

export function setNodePositionsInProject(project, patches) {
  const map = new Map(patches.map((patch) => [patch.id, patch]));
  let changed = false;
  const nodes = project.nodes.map((node) => {
    const patch = map.get(node.id);
    if (!patch) return node;
    if (node.position?.x === patch.x && node.position?.y === patch.y) return node;
    changed = true;
    return { ...node, position: { x: patch.x, y: patch.y } };
  });
  return changed ? { ...project, nodes } : project;
}

export function removeNodeFromProject(project, nodeId) {
  if (!project.nodes.some((node) => node.id === nodeId)) return project;
  const nodes = project.nodes.filter((node) => node.id !== nodeId);
  const edges = project.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  const startNodeId = project.settings?.startNodeId === nodeId ? null : project.settings?.startNodeId;
  const editor = project.editor
    ? {
        ...project.editor,
        selectedNodeIds: (project.editor.selectedNodeIds ?? []).filter((id) => id !== nodeId),
      }
    : project.editor;
  return {
    ...project,
    nodes,
    edges,
    settings: project.settings ? { ...project.settings, startNodeId } : project.settings,
    editor,
  };
}

export function addEdgeToProject(project, edge) {
  if (!edge?.id || !edge.from || !edge.to || !edge.port) return project;
  // 普通出口同一时间只允许一条 sequence/conditional 出边：先移除冲突边。
  const edges = project.edges.filter(
    (item) =>
      !(
        item.from === edge.from &&
        item.port === edge.port &&
        (edge.kind === 'sequence' || edge.kind === 'conditional') &&
        item.kind !== 'data'
      ),
  );
  if (edges.some((item) => item.id === edge.id)) return project;
  return { ...project, edges: [...edges, edge] };
}

export function updateEdgeInProject(project, edgeId, patch) {
  const index = project.edges.findIndex((edge) => edge.id === edgeId);
  if (index < 0) return project;
  const edges = [...project.edges];
  edges[index] = { ...edges[index], ...patch };
  return { ...project, edges };
}

export function removeEdgeFromProject(project, edgeId) {
  if (!project.edges.some((edge) => edge.id === edgeId)) return project;
  const edges = project.edges.filter((edge) => edge.id !== edgeId);
  const editor = project.editor
    ? {
        ...project.editor,
        selectedEdgeId: project.editor.selectedEdgeId === edgeId ? null : project.editor.selectedEdgeId,
      }
    : project.editor;
  return { ...project, edges, editor };
}

export function addNodeExitToProject(project, nodeId, exit) {
  const node = project.nodes.find((item) => item.id === nodeId);
  if (!node || !exit?.id) return project;
  if (node.exits.some((item) => item.id === exit.id)) return project;
  return updateNodeInProject(project, nodeId, { exits: [...node.exits, exit] });
}

export function updateNodeExitInProject(project, nodeId, exitId, patch) {
  const node = project.nodes.find((item) => item.id === nodeId);
  if (!node || !node.exits.some((exit) => exit.id === exitId)) return project;
  const exits = node.exits.map((exit) => (exit.id === exitId ? { ...exit, ...patch } : exit));
  return updateNodeInProject(project, nodeId, { exits });
}

export function removeNodeExitFromProject(project, nodeId, exitId) {
  const node = project.nodes.find((item) => item.id === nodeId);
  if (!node || !node.exits.some((exit) => exit.id === exitId)) return project;
  const exits = node.exits.filter((exit) => exit.id !== exitId);
  const edges = project.edges.filter((edge) => !(edge.from === nodeId && edge.port === exitId));
  const patch = { exits };
  if (node.type === 'minigame' && node.defaultExitId === exitId) patch.defaultExitId = null;
  const next = updateNodeInProject(project, nodeId, patch);
  return { ...next, edges };
}
