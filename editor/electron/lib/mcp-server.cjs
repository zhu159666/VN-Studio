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
const { TOOL_DEFS: SEMANTIC_TOOL_DEFS, executeSemanticTool } = require('./mcp-semantic-tools.cjs');
const { buildAffectedSnapshot, buildBlueprintSummary, revisionOf } = require('./blueprint-snapshot.cjs');
const assets = require('./assets.cjs');
const projectStore = require('./project.cjs');

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

const IMAGE_TOOL = {
  name: 'import_image_asset',
  description:
    '接收 Base64 图片并按 character/background 预设处理（可选纯色背景抠像、裁剪缩放），保存到项目 assets 并更新 project.json；返回 asset_id/path/width/height。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['base64_data', 'asset_type'],
    properties: {
      base64_data: { type: 'string', minLength: 1 },
      asset_type: { enum: ['character', 'background'] },
      auto_remove_bg: { type: 'boolean', default: true },
      name: { type: 'string', maxLength: 200 },
      projectPath: { type: 'string' },
    },
  },
};

const CREATE_PROJECT_TOOL = {
  name: 'create_project',
  description:
    '从零创建 VN Studio 项目（project.json + assets 目录），返回 project_path 与初始蓝图概况；后续工具的 projectPath 使用该路径。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['project_dir', 'title'],
    properties: {
      project_dir: { type: 'string', minLength: 1, description: '绝对路径；不存在时会创建' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      resolution: {
        type: 'object',
        additionalProperties: false,
        required: ['width', 'height'],
        properties: {
          width: { type: 'integer', minimum: 320, maximum: 7680 },
          height: { type: 'integer', minimum: 240, maximum: 4320 },
        },
      },
    },
  },
};

function projectPathProperty() {
  return {
    type: 'string',
    description: '项目目录或 project.json 的绝对路径；省略时使用 --project / VN_STUDIO_PROJECT',
  };
}

function buildTools() {
  const bus = getBus();
  const commands = bus.listCommands();
  const projectPath = projectPathProperty();
  const tools = [
    {
      name: 'list_commands',
      description: '列出底层 command bus（高级逃生口 execute_command 使用）。通常不需要调用。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    CREATE_PROJECT_TOOL,
    ...SEMANTIC_TOOL_DEFS.map((tool) => ({
      ...tool,
      inputSchema: {
        ...tool.inputSchema,
        properties: { ...(tool.inputSchema.properties ?? {}), projectPath },
      },
    })),
    IMAGE_TOOL,
    {
      name: 'execute_command',
      description:
        '高级逃生口：执行任意底层 command。优先使用语义工具；只有语义工具覆盖不到的操作才用它。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['command'],
        properties: {
          command: { enum: commands.map((command) => command.mcpName) },
          params: { type: 'object' },
          projectPath,
        },
      },
    },
  ];

  if (process.env.VN_MCP_TOOLSET === 'all') {
    for (const command of commands) {
      tools.push({
        name: command.mcpName,
        description: `${command.title}。${command.description}`,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...(command.inputSchema.properties ?? {}),
            projectPath,
          },
          required: [...(command.inputSchema.required ?? [])],
        },
        _commandName: command.name,
      });
    }
  }
  return tools;
}

function mutationPayload({ tool, file, project, result, extra = {} }) {
  const snapshot = buildAffectedSnapshot(project, {
    nodeIds: result?.affectedNodeIds ?? [],
    trackIds: result?.affectedTrackIds ?? [],
  });
  return {
    success: true,
    tool,
    revision: revisionOf(project),
    project_path: file,
    affected: snapshot,
    dangling_ports: snapshot.dangling_ports,
    data: result?.data ?? null,
    warnings: result?.warnings ?? [],
    ...extra,
  };
}

async function callTool(name, args, defaultProjectPath) {
  const bus = getBus();
  const safeArgs = args && typeof args === 'object' ? args : {};
  if (name === 'list_commands') {
    return toolResult({ success: true, commands: bus.listCommands() });
  }

  if (name === 'create_project') {
    if (typeof safeArgs.project_dir !== 'string' || !path.isAbsolute(safeArgs.project_dir)) {
      throw makeError('project_dir 必须是绝对路径', 'E_PROJECT_DIR');
    }
    const projectDir = path.resolve(safeArgs.project_dir);
    const projectFile = path.join(projectDir, 'project.json');
    if (fs.existsSync(projectFile)) throw makeError(`项目已存在：${projectFile}`, 'E_PROJECT_EXISTS');
    fs.mkdirSync(projectDir, { recursive: true });
    for (const dir of [
      'assets/images',
      'assets/audio',
      'assets/videos',
      'assets/minigames',
      'assets/.source/images',
      'assets/.source/audio',
      'saves',
    ]) {
      fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
    }
    const project = projectStore.defaultProject({ title: safeArgs.title });
    if (safeArgs.resolution) {
      project.settings = { ...project.settings, resolution: safeArgs.resolution };
    }
    const checked = validateProjectSafe(project);
    if (!checked.ok) throw makeError(`项目校验失败：${JSON.stringify(checked.errors.slice(0, 3))}`, 'E_PROJECT_INVALID');
    await writeProjectFile(projectFile, project);
    return toolResult({
      success: true,
      tool: 'create_project',
      project_path: projectFile,
      revision: revisionOf(project),
      summary: buildBlueprintSummary(project),
    });
  }

  if (name === 'get_blueprint_summary' || name === 'get_project_summary') {
    const file = resolveProjectFile(safeArgs, defaultProjectPath);
    const project = readProjectFile(file);
    return toolResult({
      success: true,
      tool: 'get_blueprint_summary',
      project_path: file,
      revision: revisionOf(project),
      summary: buildBlueprintSummary(project, { includeEdges: Boolean(safeArgs.include_edges) }),
    });
  }

  if (name === 'import_image_asset') {
    const file = resolveProjectFile(safeArgs, defaultProjectPath);
    const project = readProjectFile(file);
    let saved = null;
    try {
      saved = await assets.saveImportedImage({
        projectDir: path.dirname(file),
        base64Data: safeArgs.base64_data,
        assetType: safeArgs.asset_type,
        autoRemoveBg: safeArgs.auto_remove_bg !== false,
        name: safeArgs.name,
      });
      const next = {
        ...project,
        assets: {
          ...project.assets,
          images: [...(project.assets?.images ?? []), saved.asset],
        },
      };
      const checked = validateProjectSafe(next);
      if (!checked.ok) {
        throw makeError(`项目校验失败：${JSON.stringify(checked.errors.slice(0, 3))}`, 'E_PROJECT_INVALID');
      }
      await writeProjectFile(file, next);
      return toolResult({
        success: true,
        tool: 'import_image_asset',
        asset_id: saved.asset.id,
        path: saved.asset.path,
        width: saved.asset.width,
        height: saved.asset.height,
        role: saved.asset.role,
        format: saved.asset.format,
        size_bytes: saved.asset.sizeBytes,
        source_path: saved.asset.source?.path ?? null,
        removed_background: saved.removedBackground,
        project_path: file,
        revision: revisionOf(next),
        asset: saved.asset,
      });
    } catch (error) {
      if (saved?.createdFiles) await assets.cleanupFiles(saved.createdFiles);
      return toolResult(
        {
          success: false,
          tool: 'import_image_asset',
          error: { code: error.code ?? 'E_IMAGE_IMPORT_FAILED', message: error.message },
        },
        { isError: true },
      );
    }
  }

  if (name === 'execute_command') {
    const command = safeArgs.command;
    const params = safeArgs.params && typeof safeArgs.params === 'object' ? safeArgs.params : {};
    const file = resolveProjectFile(safeArgs, defaultProjectPath);
    const project = readProjectFile(file);
    const result = bus.executeCommand(project, command, params);
    if (!result.ok) return toolResult({ success: false, tool: name, error: result.error }, { isError: true });
    await writeProjectFile(file, result.project);
    return toolResult(
      mutationPayload({ tool: name, file, project: result.project, result, extra: { command: result.command } }),
    );
  }

  const semantic = SEMANTIC_TOOL_DEFS.find((tool) => tool.name === name);
  if (semantic) {
    const file = resolveProjectFile(safeArgs, defaultProjectPath);
    const project = readProjectFile(file);
    const params = { ...safeArgs };
    delete params.projectPath;
    delete params.include_edges;
    try {
      const result = executeSemanticTool(name, project, params, bus, (current, command, commandParams) =>
        bus.executeCommand(current, command, commandParams),
      );
      if (result.readOnly) {
        return toolResult({
          success: true,
          tool: name,
          project_path: file,
          revision: revisionOf(project),
          summary: result.data,
          warnings: result.warnings ?? [],
        });
      }
      await writeProjectFile(file, result.project);
      return toolResult(mutationPayload({ tool: name, file, project: result.project, result }));
    } catch (error) {
      return toolResult(
        { success: false, tool: name, error: { code: error.code ?? 'E_TOOL_FAILED', message: error.message } },
        { isError: true },
      );
    }
  }

  const advanced = buildTools().find((item) => item.name === name && item._commandName);
  if (!advanced) throw makeError(`未知 MCP tool：${name}`, 'E_UNKNOWN_TOOL');
  const file = resolveProjectFile(safeArgs, defaultProjectPath);
  const project = readProjectFile(file);
  const params = { ...safeArgs };
  delete params.projectPath;
  const result = bus.executeCommand(project, advanced._commandName, params);
  if (!result.ok) return toolResult({ success: false, tool: name, error: result.error }, { isError: true });
  await writeProjectFile(file, result.project);
  return toolResult(mutationPayload({ tool: name, file, project: result.project, result }));
}


function createContext({ defaultProjectPath = null, getDefaultProjectPath = null, version = '0.0.0' } = {}) {
  return {
    defaultProjectPath,
    getDefaultProjectPath,
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
      const defaultProjectPath =
        typeof context.getDefaultProjectPath === 'function'
          ? context.getDefaultProjectPath()
          : context.defaultProjectPath;
      const result = await callTool(name, args, defaultProjectPath);
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

/**
 * Streamable HTTP 传输（MCP 2025-03-26+）：POST /mcp + SSE 兼容的 JSON 响应。
 * 便于支持 url 的 MCP 客户端直接连接，不需要配置 command/env。
 */
function startHttpMcpServer({
  port = 38123,
  host = '127.0.0.1',
  defaultProjectPath = null,
  getDefaultProjectPath = null,
  version = '0.0.0',
  log = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  const http = require('node:http');
  const crypto = require('node:crypto');
  const context = createContext({ defaultProjectPath, getDefaultProjectPath, version });
  const sessions = new Map();
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  };

  const sendJson = (res, status, payload, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra });
    res.end(JSON.stringify(payload));
  };
  const sendEmpty = (res, status, extra = {}) => {
    res.writeHead(status, { ...CORS, ...extra });
    res.end();
  };

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url || '/', `http://${host}`);
    } catch {
      sendJson(res, 400, { error: 'bad url' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        name: SERVER_NAME,
        version,
        protocolVersions: PROTOCOL_VERSIONS,
        tools: context.tools.length,
      });
      return;
    }
    if (url.pathname !== '/mcp') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (req.method === 'OPTIONS') {
      sendEmpty(res, 204);
      return;
    }
    if (req.method === 'GET') {
      res.setHeader('Allow', 'POST, DELETE, OPTIONS');
      sendEmpty(res, 405);
      return;
    }
    if (req.method === 'DELETE') {
      // 终止会话：无状态实现直接返回 200
      sendEmpty(res, 200);
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, DELETE, OPTIONS');
      sendEmpty(res, 405);
      return;
    }

    const chunks = [];
    let total = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 32 * 1024 * 1024) {
        aborted = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => {
      if (!res.headersSent) sendJson(res, 400, { error: 'request error' });
    });
    req.on('end', async () => {
      if (aborted) {
        if (!res.headersSent) sendJson(res, 413, { error: 'body too large' });
        return;
      }
      let message;
      try {
        message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        sendJson(res, 400, jsonRpcError(null, -32700, 'Parse error'));
        return;
      }

      const sessionHeader = req.headers['mcp-session-id'];
      let sessionId = typeof sessionHeader === 'string' && sessionHeader ? sessionHeader : null;
      const messages = Array.isArray(message) ? message : [message];
      const responses = [];
      try {
        for (const item of messages) {
          if (item && item.method === 'initialize' && !sessionId) {
            sessionId = crypto.randomUUID();
            sessions.set(sessionId, { createdAt: Date.now() });
          }
          const response = await handleMessage(item, context);
          if (response) responses.push(response);
        }
      } catch (error) {
        log(`[mcp-http] handler error: ${error && error.message ? error.message : error}`);
        sendJson(res, 500, jsonRpcError(null, -32603, 'Internal error'));
        return;
      }

      const headers = sessionId ? { 'Mcp-Session-Id': sessionId } : {};
      if (responses.length === 0) {
        sendEmpty(res, 202, headers);
        return;
      }
      if (Array.isArray(message)) sendJson(res, 200, responses, headers);
      else sendJson(res, 200, responses[0], headers);
    });
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const actualPort = server.address().port;
      const url = `http://${host}:${actualPort}/mcp`;
      log(`[mcp-http] listening ${url} (${context.tools.length} tools)`);
      resolve({
        url,
        port: actualPort,
        host,
        server,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
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
  startHttpMcpServer,
  summarizeProject,
  resolveProjectFile,
  readProjectFile,
};
