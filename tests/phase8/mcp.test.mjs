// 阶段八：MCP server（stdio）集成测试。
// 覆盖 tools/list、initialize、get_project_summary、单 command tool、execute_command、错误与换行 JSON-RPC。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const EDITOR = path.join(ROOT, 'editor');
const BUNDLE = path.join(EDITOR, 'electron', 'generated', 'command-bus.cjs');
const MCP_STDIO = path.join(EDITOR, 'electron', 'resources', 'mcp', 'mcp-stdio.cjs');

// 测试前重新构建 command bus / MCP stdio bundle，避免 bundle 与源码不同步。
execFileSync(
  process.execPath,
  [
    path.join(EDITOR, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build',
    '--config',
    path.join(EDITOR, 'vite.command-bus.config.mjs'),
  ],
  { cwd: EDITOR, stdio: 'ignore' },
);
execFileSync(
  process.execPath,
  [
    path.join(EDITOR, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build',
    '--config',
    path.join(EDITOR, 'vite.mcp-stdio.config.mjs'),
  ],
  { cwd: EDITOR, stdio: 'ignore' },
);

const require = createRequire(import.meta.url);
const projectStore = require('../../editor/electron/lib/project.cjs');
const schema = require('../../editor/electron/lib/schema.cjs');
const mcp = require('../../editor/electron/lib/mcp-server.cjs');

async function makeProject() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vns-mcp-'));
  const project = projectStore.defaultProject({ title: 'MCP 测试项目' });
  const file = path.join(dir, 'project.json');
  await fsp.writeFile(file, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  return { dir, file, project };
}

function readProject(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function callTool(context, name, args) {
  return mcp.handleMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    context,
  );
}

test('MCP：tools/list 暴露 21 个 command + 3 个辅助 tool', () => {
  const tools = mcp.buildTools();
  assert.equal(tools.length, 24);
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes('list_commands'));
  assert.ok(names.includes('get_project_summary'));
  assert.ok(names.includes('execute_command'));
  assert.ok(names.includes('blueprint_createNode'));
  assert.ok(names.includes('timeline_addKeyframe'));
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  // projectPath 是可选的（启动参数/环境变量可提供默认值）
  assert.equal(tools.find((tool) => tool.name === 'blueprint_createNode').inputSchema.required.includes('projectPath'), false);
  assert.doesNotThrow(() => JSON.stringify(tools));
});

test('MCP：initialize 协商协议版本，tools/list 返回 tools', async () => {
  const context = mcp.createContext({ version: 'test' });
  const init = await mcp.handleMessage(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } },
    },
    context,
  );
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'vn-studio');
  assert.ok(init.result.capabilities.tools);

  const newer = await mcp.handleMessage(
    { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } },
    context,
  );
  assert.equal(newer.result.protocolVersion, mcp.LATEST_PROTOCOL);

  const list = await mcp.handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, context);
  assert.equal(list.result.tools.length, 24);

  const unknown = await mcp.handleMessage({ jsonrpc: '2.0', id: 4, method: 'nope' }, context);
  assert.equal(unknown.error.code, -32601);
});

test('MCP：get_project_summary 返回节点 id / 出口 / 时间轴', async () => {
  const { dir, file } = await makeProject();
  try {
    const context = mcp.createContext({ defaultProjectPath: file, version: 'test' });
    const response = await callTool(context, 'get_project_summary', {});
    assert.equal(response.result.isError, undefined);
    const summary = response.result.structuredContent.summary;
    assert.equal(summary.title, 'MCP 测试项目');
    assert.equal(summary.nodes.length, 1);
    assert.equal(summary.nodes[0].id, 'n_opening');
    assert.equal(summary.nodes[0].type, 'dialogue');
    assert.ok(summary.nodes[0].exits.some((exit) => exit.id === 'next'));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('MCP：单 command tool 直接读写 project.json 并返回结构化结果', async () => {
  const { dir, file } = await makeProject();
  try {
    const context = mcp.createContext({ defaultProjectPath: file, version: 'test' });
    const created = await callTool(context, 'blueprint_createNode', {
      type: 'dialogue',
      name: 'AI 写的第一句',
      projectPath: file,
    });
    assert.equal(created.result.isError, undefined);
    const payload = created.result.structuredContent;
    assert.equal(payload.ok, true);
    assert.equal(payload.saved, true);
    assert.equal(payload.project, undefined);
    assert.equal(payload.affectedNodeIds.length, 1);
    assert.equal(payload.projectPath, file);
    const nodeId = payload.affectedNodeIds[0];

    const updated = await callTool(context, 'blueprint_updateDialogue', {
      nodeId,
      text: '这是通过 MCP 写入的台词。',
      speaker: '旁白',
    });
    assert.equal(updated.result.structuredContent.ok, true);

    const project = readProject(file);
    const node = project.nodes.find((item) => item.id === nodeId);
    assert.equal(node.text, '这是通过 MCP 写入的台词。');
    assert.equal(node.speaker, '旁白');
    assert.equal(schema.validateProject(project).ok, true);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('MCP：execute_command 通用入口可串联建节点/连线', async () => {
  const { dir, file } = await makeProject();
  try {
    const context = mcp.createContext({ defaultProjectPath: file, version: 'test' });
    const created = await callTool(context, 'execute_command', {
      command: 'blueprint_createNode',
      params: { type: 'scene', name: 'MCP 场景' },
    });
    const sceneId = created.result.structuredContent.affectedNodeIds[0];
    const connected = await callTool(context, 'execute_command', {
      command: 'blueprint_connect',
      params: { fromNodeId: 'n_opening', fromExitId: 'next', toNodeId: sceneId },
    });
    assert.equal(connected.result.structuredContent.ok, true);
    assert.ok(connected.result.structuredContent.affectedNodeIds.includes(sceneId));

    const project = readProject(file);
    assert.equal(project.edges.length, 1);
    assert.equal(project.edges[0].to, sceneId);
    assert.equal(schema.validateProject(project).ok, true);

    const failed = await callTool(context, 'execute_command', {
      command: 'blueprint_connect',
      params: { fromNodeId: 'n_missing', fromExitId: 'next', toNodeId: sceneId },
    });
    assert.equal(failed.result.isError, true);
    assert.equal(failed.result.structuredContent.error.code, 'E_CONNECTION_INVALID');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('MCP：缺少/错误 projectPath 返回可读错误', async () => {
  const context = mcp.createContext({ version: 'test' });
  const missing = await callTool(context, 'get_project_summary', {});
  assert.equal(missing.result.isError, true);
  assert.equal(missing.result.structuredContent.error.code, 'E_PROJECT_PATH_REQUIRED');

  const notFound = await callTool(context, 'get_project_summary', {
    projectPath: path.join(os.tmpdir(), 'definitely-missing-vns-project.json'),
  });
  assert.equal(notFound.result.isError, true);
  assert.equal(notFound.result.structuredContent.error.code, 'E_PROJECT_NOT_FOUND');

  const project = projectStore.defaultProject({ title: 'x' });
  project.nodes = [];
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vns-mcp-bad-'));
  const file = path.join(dir, 'project.json');
  await fsp.writeFile(file, JSON.stringify(project), 'utf8');
  try {
    const invalid = await callTool(context, 'get_project_summary', { projectPath: file });
    assert.equal(invalid.result.isError, true);
    assert.equal(invalid.result.structuredContent.error.code, 'E_PROJECT_INVALID');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('MCP：独立 mcp-stdio.cjs 可启动、握手并写回项目', async () => {
  const { dir, file } = await makeProject();
  const child = spawn(process.execPath, [MCP_STDIO, '--project', file], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } },
    })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'blueprint_createNode', arguments: { type: 'scene', name: 'stdio 场景' } },
    })}\n`,
  );
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`mcp-stdio 超时：${stderr.slice(-300)}`));
    }, 10000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    setTimeout(() => child.stdin.end(), 600);
  });
  try {
    assert.equal(exitCode, 0, `stderr: ${stderr.slice(-400)}`);
    const responses = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(responses[0].id, 1);
    assert.equal(responses[0].result.protocolVersion, '2025-06-18');
    const created = responses.find((item) => item.id === 2);
    assert.equal(created.result.isError, undefined);
    assert.equal(created.result.structuredContent.ok, true);
    assert.equal(created.result.structuredContent.saved, true);
    const project = readProject(file);
    assert.equal(project.nodes.length, 2);
    assert.equal(schema.validateProject(project).ok, true);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('MCP HTTP：initialize / tools/call / 写回项目', async () => {
  const { dir, file } = await makeProject();
  const server = await mcp.startHttpMcpServer({ port: 0, defaultProjectPath: file, version: 'test', log: () => {} });
  try {
    const health = await fetch(`${server.url.replace(/\/mcp$/, '/health')}`);
    assert.equal(health.status, 200);
    const healthJson = await health.json();
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.tools, 24);

    const initResponse = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } },
      }),
    });
    assert.equal(initResponse.status, 200);
    const sessionId = initResponse.headers.get('mcp-session-id');
    assert.ok(sessionId);
    const initJson = await initResponse.json();
    assert.equal(initJson.result.protocolVersion, '2025-06-18');

    const callResponse = await fetch(server.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'blueprint_createNode', arguments: { type: 'scene', name: 'HTTP 场景' } },
      }),
    });
    assert.equal(callResponse.status, 200);
    const callJson = await callResponse.json();
    assert.equal(callJson.result.structuredContent.ok, true);
    assert.equal(callJson.result.structuredContent.saved, true);
    const project = readProject(file);
    assert.equal(project.nodes.length, 2);
    assert.equal(schema.validateProject(project).ok, true);

    const notification = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.equal(notification.status, 202);

    const getResponse = await fetch(server.url, { headers: { accept: 'text/event-stream' } });
    assert.equal(getResponse.status, 405);
    const deleteResponse = await fetch(server.url, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 200);
  } finally {
    await server.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('MCP：stdio 换行 JSON-RPC 收发正常', async () => {
  const { dir, file } = await makeProject();
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = [];
  const waitForLines = (count) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`只收到 ${lines.length}/${count} 行`)), 5000);
      const onData = (chunk) => {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (line.trim()) lines.push(JSON.parse(line));
        }
        if (lines.length >= count) {
          clearTimeout(timer);
          output.off('data', onData);
          resolve();
        }
      };
      output.on('data', onData);
    });
  try {
    const server = mcp.startMcpServer({
      defaultProjectPath: file,
      version: 'test',
      input,
      output,
      log: () => {},
    });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    await waitForLines(2);
    assert.equal(lines[0].id, 1);
    assert.equal(lines[1].result.tools.length, 24);
    assert.equal(server.context.tools.length, 24);
    server.stop();
  } finally {
    input.destroy();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
