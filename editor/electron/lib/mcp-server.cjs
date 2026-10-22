'use strict';

// VN Studio MCP server（stdio transport，最小 JSON-RPC 实现，不依赖第三方 SDK）。
//
// 启动方式（由 main.cjs 检测 --mcp）：
//   "VN Studio.exe" --mcp --project "D:\path\project.json"
// 或：
//   "VN Studio.exe" --mcp
// 每个 command bus command 都会暴露成一个 MCP tool；另外提供 list_commands /
// get_project_summary / execute_command 三个辅助 tool。
//
// 协议：newline-delimited JSON-RPC 2.0（MCP stdio transport），stdout 只写协议消息。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const schema = (() => {
  try {
    return require('./schema.cjs');
  } catch {
    return null;
  }
})();

function validateProjectSafe(project) {
  if (!schema || typeof schema.validateProject !== 'function') return { ok: true, errors: [] };
  try {
    return schema.validateProject(project);
  } catch {
    // 独立 MCP bundle 在极少数环境下读不到 schema.json：不阻塞编辑操作。
    return { ok: true, errors: [] };
  }
}
const SERVER_NAME = 'vn-studio';
const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const LATEST_PROTOCOL = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1];

let busCache = null;
function getBus() {
  if (!busCache) {
    // 构建产物：editor/electron/generated/command-bus.cjs（vite.command-bus.config.mjs）
    busCache = require('../generated/command-bus.cjs');
  }
  return busCache;
}

function makeError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function normalizeProjectFile(target) {
  const resolved = path.resolve(String(target));
  let stat = null;
  try {
    stat = fs.statSync(resolved);
  } catch {
    stat = null;
  }
  if (stat && stat.isDirectory()) return path.join(resolved, 'project.json');
  return resolved;
}

function resolveProjectFile(args, defaultProjectPath) {
  const candidate =
    (args && typeof args.projectPath === 'string' && args.projectPath.trim()) ||
    defaultProjectPath ||
    process.env.VN_STUDIO_PROJECT ||
    '';
  if (!candidate) {
    throw makeError(
      '缺少 projectPath：调用时传 projectPath，或启动 MCP server 时加 --project <项目目录或 project.json>，或设置 VN_STUDIO_PROJECT',
      'E_PROJECT_PATH_REQUIRED',
    );
  }
  const file = normalizeProjectFile(candidate);
  if (!fs.existsSync(file)) throw makeError(`项目文件不存在：${file}`, 'E_PROJECT_NOT_FOUND');
  return file;
}

function readProjectFile(file) {
  let project;
  try {
    project = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw makeError(`读取项目失败：${error.message}`, 'E_PROJECT_READ_FAILED');
  }
  const checked = validateProjectSafe(project);
  if (!checked.ok) {
    throw makeError(`项目 schema 校验失败：${JSON.stringify(checked.errors.slice(0, 3))}`, 'E_PROJECT_INVALID');
  }
  return project;
}

async function writeProjectFile(file, project) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, file);
}

function toolResult(payload, { isError = false } = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : null),
  };
}

function summarizeProject(project) {
  return {
    title: project.meta && project.meta.title ? project.meta.title : null,
    meta: project.meta ?? null,
    settings: project.settings ?? null,
    counts: {
      nodes: (project.nodes ?? []).length,
      edges: (project.edges ?? []).length,
      images: (project.assets?.images ?? []).length,
      audio: (project.assets?.audio ?? []).length,
      videos: (project.assets?.videos ?? []).length,
      minigames: (project.assets?.minigames ?? []).length,
      timelines: Object.keys(project.timelines ?? {}).length,
      variables: Object.keys(project.variables ?? {}).length,
    },
    nodes: (project.nodes ?? []).map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      position: node.position ?? null,
      exits: (node.exits ?? []).map((exit) => ({ id: exit.id, name: exit.name })),
      ...(node.type === 'jump' ? { targetNodeId: node.targetNodeId ?? null } : null),
    })),
    edges: (project.edges ?? []).map((edge) => ({
      id: edge.id,
      from: edge.from,
      port: edge.port,
      to: edge.to,
      kind: edge.kind,
    })),
    timelines: Object.entries(project.timelines ?? {}).map(([sceneNodeId, timeline]) => ({
      sceneNodeId,
      durationMs: timeline.durationMs,
      loop: Boolean(timeline.loop),
      tracks: (timeline.tracks ?? []).map((track) => ({
        id: track.id,
        kind: track.kind,
        property: track.property,
        target: track.target ?? null,
        keyframes: (track.keys ?? []).length,
      })),
    })),
    variables: project.variables ?? {},
  };
}

function buildTools() {
  const bus = getBus();
  const commands = bus.listCommands();
  const projectPathProperty = {
    type: 'string',
    description: '项目目录或 project.json 的绝对路径；省略时使用 --project / VN_STUDIO_PROJECT',
  };
  const tools = [
    {
      name: 'list_commands',
      description: '列出 VN Studio 编辑器 command bus 支持的全部操作（名称、说明、inputSchema）。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    {
      name: 'get_project_summary',
      description: '读取项目摘要：节点/连线/时间轴/素材/变量，便于 AI 获知节点 id 后再调用编辑命令。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { projectPath: projectPathProperty },
      },
    },
    {
      name: 'execute_command',
      description:
        '通用入口：按 command 名执行任意一个 command bus 操作。参数放在 params 中，会被对应 command 的 inputSchema 校验。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['command'],
        properties: {
          command: { enum: commands.map((item) => item.mcpName) },
          params: { type: 'object' },
          projectPath: projectPathProperty,
        },
      },
    },
  ];

  for (const command of commands) {
    tools.push({
      name: command.mcpName,
      description: `${command.title}。${command.description}`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...(command.inputSchema.properties ?? {}),
          projectPath: projectPathProperty,
        },
        required: [...(command.inputSchema.required ?? [])],
      },
      _commandName: command.name,
    });
  }
  return tools;
}

function stripProject(result) {
  if (!result || typeof result !== 'object') return result;
  const { project, ...rest } = result;
  void project;
  return rest;
}

async function callTool(name, args, defaultProjectPath) {
  const bus = getBus();
  const safeArgs = args && typeof args === 'object' ? args : {};
  if (name === 'list_commands') {
    return toolResult({ ok: true, commands: bus.listCommands() });
  }

  if (name === 'get_project_summary') {
    const file = resolveProjectFile(safeArgs, defaultProjectPath);
    const project = readProjectFile(file);
    return toolResult({ ok: true, projectPath: file, summary: summarizeProject(project) });
  }

  if (name === 'execute_command') {
    const command = safeArgs.command;
    const params = safeArgs.params && typeof safeArgs.params === 'object' ? safeArgs.params : {};
    const file = resolveProjectFile(safeArgs, defaultProjectPath);
    const project = readProjectFile(file);
    const result = bus.executeCommand(project, command, params);
    if (!result.ok) return toolResult(result, { isError: true });
    await writeProjectFile(file, result.project);
    return toolResult({ ...stripProject(result), projectPath: file, saved: true });
  }

  const tool = buildTools().find((item) => item.name === name && item._commandName);
  if (!tool) throw makeError(`未知 MCP tool：${name}`, 'E_UNKNOWN_TOOL');
  const file = resolveProjectFile(safeArgs, defaultProjectPath);
  const project = readProjectFile(file);
  const params = { ...safeArgs };
  delete params.projectPath;
  const result = bus.executeCommand(project, tool._commandName, params);
  if (!result.ok) return toolResult(result, { isError: true });
  await writeProjectFile(file, result.project);
  return toolResult({ ...stripProject(result), projectPath: file, saved: true });
}

function createContext({ defaultProjectPath = null, version = '0.0.0' } = {}) {
  return {
    defaultProjectPath,
    version,
    tools: buildTools(),
  };
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : null) },
  };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

async function handleMessage(message, context) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return jsonRpcError(message && message.id, -32600, 'Invalid Request');
  }
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    const requested = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
    const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL;
    return jsonRpcResult(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, title: 'VN Studio', version: context.version },
      instructions:
        'VN Studio 本地编辑器 MCP。先用 get_project_summary 获取节点 id，再调用 blueprint_* / timeline_* 工具；每个工具都会直接读写 project.json 并返回结构化结果。',
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return null;
  if (method === 'ping') return jsonRpcResult(id, {});
  if (method === 'tools/list') return jsonRpcResult(id, { tools: context.tools });
  if (method === 'tools/call') {
    const name = params && typeof params.name === 'string' ? params.name : '';
    const args = params && params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    try {
      const result = await callTool(name, args, context.defaultProjectPath);
      return jsonRpcResult(id, result);
    } catch (error) {
      return jsonRpcResult(
        id,
        toolResult(
          {
            ok: false,
            command: name,
            error: { code: error.code ?? 'E_MCP_TOOL_FAILED', message: error.message },
          },
          { isError: true },
        ),
      );
    }
  }
  if (method === 'resources/list') return jsonRpcResult(id, { resources: [] });
  if (method === 'prompts/list') return jsonRpcResult(id, { prompts: [] });
  if (isNotification) return null;
  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

function startMcpServer({
  defaultProjectPath = null,
  version = '0.0.0',
  input = process.stdin,
  output = process.stdout,
  log = (line) => process.stderr.write(`${line}\n`),
  onClose = null,
} = {}) {
  const context = createContext({ defaultProjectPath, version });
  let buffer = '';
  let chain = Promise.resolve();
  let closed = false;

  const write = (payload) => {
    output.write(`${JSON.stringify(payload)}\n`);
  };

  const handleLine = (line) => {
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      write(jsonRpcError(null, -32700, 'Parse error'));
      return;
    }
    chain = chain
      .then(async () => {
        const response = await handleMessage(message, context);
        if (response) write(response);
      })
      .catch((error) => {
        log(`[mcp] handler error: ${error && error.stack ? error.stack : error}`);
      });
  };

  const onData = (chunk) => {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      handleLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
    }
  };

  const onEnd = () => {
    if (buffer.trim()) handleLine(buffer);
    closed = true;
    log('[mcp] stdin closed');
    // 等所有已排队的请求处理完再关闭进程，避免丢掉最后一条响应。
    chain.finally(() => {
      if (typeof onClose === 'function') onClose();
    });
  };

  input.setEncoding?.('utf8');
  input.on('data', onData);
  input.on('end', onEnd);
  input.on('error', (error) => log(`[mcp] stdin error: ${error.message}`));

  log(`[mcp] VN Studio MCP server ready (stdio, ${context.tools.length} tools)`);
  return {
    context,
    stop() {
      if (closed) return;
      closed = true;
      input.off('data', onData);
      input.off('end', onEnd);
      input.destroy?.();
    },
  };
}

module.exports = {
  SERVER_NAME,
  PROTOCOL_VERSIONS,
  LATEST_PROTOCOL,
  getBus,
  buildTools,
  createContext,
  handleMessage,
  startMcpServer,
  summarizeProject,
  resolveProjectFile,
  readProjectFile,
};
