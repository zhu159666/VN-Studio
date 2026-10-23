// 阶段八/九：MCP 语义工具、快照、素材导入与传输测试。
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
const VITE = path.join(EDITOR, 'node_modules', 'vite', 'bin', 'vite.js');

if (!fs.existsSync(BUNDLE)) {
  execFileSync(process.execPath, [VITE, 'build', '--config', path.join(EDITOR, 'vite.command-bus.config.mjs')], {
    cwd: EDITOR,
    stdio: 'ignore',
  });
}
if (!fs.existsSync(MCP_STDIO)) {
  execFileSync(process.execPath, [VITE, 'build', '--config', path.join(EDITOR, 'vite.mcp-stdio.config.mjs')], {
    cwd: EDITOR,
    stdio: 'ignore',
  });
}

const require = createRequire(import.meta.url);
const projectStore = require('../../editor/electron/lib/project.cjs');
const schema = require('../../editor/electron/lib/schema.cjs');
const media = require('../../editor/electron/lib/media.cjs');
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

async function callTool(context, name, args = {}) {
  return mcp.handleMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    context,
  );
}

function payload(response) {
  return response.result.structuredContent;
}

test('MCP 语义工具：默认 tools/list 只暴露高层工具', () => {
  const tools = mcp.buildTools();
  const names = tools.map((tool) => tool.name);
  assert.equal(tools.length, 14);
  assert.ok(names.includes('create_project'));
  assert.ok(names.includes('get_blueprint_summary'));
  assert.ok(names.includes('create_branch_node'));
  assert.ok(names.includes('create_dialogue_chain'));
  assert.ok(names.includes('create_choice_node'));
  assert.ok(names.includes('import_image_asset'));
  assert.ok(names.includes('execute_command'));
  assert.equal(names.includes('blueprint_createNode'), false);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.doesNotThrow(() => JSON.stringify(tools));
});

test('MCP：initialize 与 tools/list', async () => {
  const context = mcp.createContext({ version: 'test' });
  const init = await mcp.handleMessage(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    context,
  );
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'vn-studio');
  const list = await mcp.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, context);
  assert.equal(list.result.tools.length, 14);
  const unknown = await mcp.handleMessage({ jsonrpc: '2.0', id: 3, method: 'nope' }, context);
  assert.equal(unknown.error.code, -32601);
});

test('MCP：create_project + 语义建场景/对话/分支/选项 + 快照', async () => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'vns-create-'));
  const projectDir = path.join(parent, 'game');
  try {
    const noPath = await callTool(mcp.createContext({ version: 'test' }), 'create_project', {
      project_dir: projectDir,
      title: 'AI 的游戏',
      resolution: { width: 1280, height: 720 },
    });
    const created = payload(noPath);
    assert.equal(created.success, true);
    assert.equal(fs.existsSync(path.join(projectDir, 'project.json')), true);
    const projectPath = path.join(projectDir, 'project.json');
    const context = mcp.createContext({ defaultProjectPath: projectPath, version: 'test' });

    let response = await callTool(context, 'create_scene_node', {
      name: '码头',
      position: { x: 0, y: 0 },
    });
    let data = payload(response);
    assert.equal(data.success, true);
    const sceneId = data.data.scene_node_id;
    assert.equal(data.affected.nodes[0].id, sceneId);
    assert.equal(data.affected.nodes[0].position.x, 0);
    assert.ok(data.affected.dangling_ports.some((port) => port.node_id === sceneId));

    response = await callTool(context, 'create_dialogue_chain', {
      after_node: sceneId,
      lines: [{ text: '第一句' }, { text: '第二句', speaker: '我' }],
    });
    data = payload(response);
    assert.equal(data.success, true);
    const dialogueIds = data.data.created_node_ids;
    assert.equal(dialogueIds.length, 2);
    assert.ok(data.affected.edges.some((edge) => edge.from === sceneId && edge.to === dialogueIds[0]));
    assert.ok(data.affected.nodes.every((node) => node.position));

    response = await callTool(context, 'create_branch_node', {
      from_node: sceneId,
      condition: 'has_letter == true',
      to_node: dialogueIds[0],
      false_node: dialogueIds[1],
    });
    data = payload(response);
    assert.equal(data.success, true);
    const conditionId = data.data.condition_node_id;
    assert.ok(data.affected.nodes.some((node) => node.id === conditionId && node.type === 'condition'));
    assert.ok(data.affected.edges.some((edge) => edge.from === sceneId && edge.to === conditionId));
    assert.equal(data.data.replaced_edge_id !== null, true);

    response = await callTool(context, 'add_scene_keyframes', {
      scene_node: sceneId,
      duration_ms: 4000,
      track: { kind: 'background', property: 'opacity' },
      keyframes: [
        { time: 0, value: 1, preset: 'linear' },
        { time: 4000, value: 0.7, preset: 'easeInOut' },
      ],
    });
    data = payload(response);
    assert.equal(data.success, true);
    assert.ok(data.affected.timelines.some((timeline) => timeline.scene_node_id === sceneId));

    response = await callTool(context, 'update_project_settings', {
      title: '修订标题',
      start_node_id: sceneId,
    });
    data = payload(response);
    assert.equal(data.success, true);
    const project = readProject(projectPath);
    assert.equal(project.meta.title, '修订标题');
    assert.equal(project.settings.startNodeId, sceneId);
    assert.equal(schema.validateProject(project).ok, true);
  } finally {
    await fsp.rm(parent, { recursive: true, force: true });
  }
});

test('MCP：get_blueprint_summary 返回悬空端口与素材', async () => {
  const { dir, file } = await makeProject();
  try {
    const context = mcp.createContext({ defaultProjectPath: file, version: 'test' });
    const response = await callTool(context, 'get_blueprint_summary', {});
    const data = payload(response);
    assert.equal(data.success, true);
    assert.equal(data.summary.counts.nodes, 1);
    assert.equal(data.summary.nodes[0].id, 'n_opening');
    assert.equal(data.summary.dangling_ports.length, 1);
    assert.ok(data.summary.assets && Array.isArray(data.summary.assets.images));
    assert.match(data.revision, /^sha1:/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('MCP：execute_command 是高级逃生口，仍返回受影响快照', async () => {
  const { dir, file } = await makeProject();
  try {
    const context = mcp.createContext({ defaultProjectPath: file, version: 'test' });
    const response = await callTool(context, 'execute_command', {
      command: 'blueprint_createNode',
      params: { type: 'scene', name: '逃生口场景' },
    });
    const data = payload(response);
    assert.equal(data.success, true);
    assert.equal(data.affected.nodes[0].type, 'scene');
    assert.ok(Array.isArray(data.dangling_ports));
    assert.equal(schema.validateProject(readProject(file)).ok, true);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('MCP：import_image_asset 处理图片并写回项目', { skip: !media.isFfmpegAvailable() }, async () => {
  const { dir, file } = await makeProject();
  const sourcePath = path.join(dir, 'source.png');
  try {
    execFileSync(media.FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=64x128', '-frames:v', '1', sourcePath], {
      stdio: 'ignore',
      timeout: 60000,
    });
    const base64 = fs.readFileSync(sourcePath).toString('base64');
    const context = mcp.createContext({ defaultProjectPath: file, version: 'test' });
    const response = await callTool(context, 'import_image_asset', {
      base64_data: base64,
      asset_type: 'character',
      auto_remove_bg: true,
    });
    const data = payload(response);
    assert.equal(data.success, true);
    assert.equal(data.width, 512);
    assert.equal(data.height, 1024);
    assert.match(data.asset_id, /^img_/);
    assert.ok(fs.existsSync(path.join(dir, data.path)));
    const project = readProject(file);
    assert.equal(project.assets.images.length, 1);
    assert.equal(project.assets.images[0].id, data.asset_id);
    assert.equal(schema.validateProject(project).ok, true);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('MCP：import_audio_asset 转 ogg 并写回项目', { skip: !media.isFfmpegAvailable() }, async () => {
  const { dir, file } = await makeProject();
  const sourcePath = path.join(dir, 'source.wav');
  try {
    execFileSync(
      media.FFMPEG,
      ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', sourcePath],
      { stdio: 'ignore', timeout: 60000 },
    );
    const base64 = fs.readFileSync(sourcePath).toString('base64');
    const context = mcp.createContext({ defaultProjectPath: file, version: 'test' });
    const response = await callTool(context, 'import_audio_asset', {
      base64_data: base64,
      role: 'bgm',
      name: 'MCP BGM',
    });
    const data = payload(response);
    assert.equal(data.success, true);
    assert.match(data.asset_id, /^aud_/);
    assert.equal(data.role, 'bgm');
    assert.ok(data.duration_ms > 0);
    assert.ok(fs.existsSync(path.join(dir, data.path)));
    const project = readProject(file);
    assert.equal(project.assets.audio.length, 1);
    assert.equal(project.assets.audio[0].id, data.asset_id);
    assert.equal(schema.validateProject(project).ok, true);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('MCP：空/错误参数返回结构化错误', async () => {
  const { dir, file } = await makeProject();
  try {
    const context = mcp.createContext({ defaultProjectPath: file, version: 'test' });
    const bad = await callTool(context, 'create_branch_node', {
      from_node: 'n_missing',
      condition: 'true',
      to_node: 'n_missing',
    });
    assert.equal(payload(bad).success, false);
    assert.equal(payload(bad).error.code, 'E_NODE_NOT_FOUND');

    const badImage = await callTool(context, 'import_image_asset', {
      base64_data: 'not-an-image',
      asset_type: 'character',
    });
    assert.equal(payload(badImage).success, false);
    assert.ok(['E_IMAGE_FORMAT', 'E_IMAGE_INVALID'].includes(payload(badImage).error.code));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('MCP HTTP：语义 tools/list 与 initialize', async () => {
  const server = await mcp.startHttpMcpServer({ port: 0, version: 'test', log: () => {} });
  try {
    const init = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      }),
    });
    assert.equal(init.status, 200);
    assert.ok(init.headers.get('mcp-session-id'));
    const initJson = await init.json();
    assert.equal(initJson.result.protocolVersion, '2025-06-18');

    const tools = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    const toolsJson = await tools.json();
    assert.equal(toolsJson.result.tools.length, 14);
  } finally {
    await server.close();
  }
});

test('MCP：stdio 换行 JSON-RPC + 独立 bundle', async () => {
  const { dir, file } = await makeProject();
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = [];
  const waitForLines = (count) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`只收到 ${lines.length}/${count} 行`)), 5000);
      const onData = (chunk) => {
        for (const line of chunk.toString('utf8').split('\n')) if (line.trim()) lines.push(JSON.parse(line));
        if (lines.length >= count) {
          clearTimeout(timer);
          output.off('data', onData);
          resolve();
        }
      };
      output.on('data', onData);
    });
  try {
    const server = mcp.startMcpServer({ defaultProjectPath: file, version: 'test', input, output, log: () => {} });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    await waitForLines(2);
    assert.equal(lines[1].result.tools.length, 14);
    server.stop();
  } finally {
    input.destroy();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
