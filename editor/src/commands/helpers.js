// Command bus 公共工具：统一成功/失败结果、id 校验与节点查询。
// 所有命令都是纯函数（project in / project out），不依赖 React / DOM / Electron。

export const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const EXIT_LIMITS = {
  choice: { min: 2, max: 12, prefix: 'opt_' },
  minigame: { min: 1, max: 16, prefix: 'exit_' },
};

export function fail(code, message, details = null) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : null),
    },
  };
}

export function success({ project, affectedNodeIds = [], affectedTrackIds = [], data = null, warnings = [] }) {
  return {
    ok: true,
    project,
    affectedNodeIds: [...new Set(affectedNodeIds.filter(Boolean))],
    affectedTrackIds: [...new Set(affectedTrackIds.filter(Boolean))],
    data,
    warnings,
  };
}

export function findNode(project, nodeId) {
  return project.nodes.find((node) => node.id === nodeId) ?? null;
}

export function findEdge(project, edgeId) {
  return project.edges.find((edge) => edge.id === edgeId) ?? null;
}

/** 用于结果提示：把命令名转换为 MCP 工具名（MCP 工具名通常不允许点号）。 */
export function toMcpToolName(commandName) {
  return commandName.replace(/\./g, '_');
}
