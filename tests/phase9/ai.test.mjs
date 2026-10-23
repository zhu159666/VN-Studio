// 外部 AI 配置与 OpenAI 兼容生图客户端测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const aiConfig = require('../../editor/electron/lib/ai-config.cjs');
const aiImage = require('../../editor/electron/lib/ai-image-client.cjs');

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==';

test('AI 配置：保存/读取/mask key，且 key 不出现在 public config', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vns-ai-config-'));
  const file = path.join(dir, 'ai-service.json');
  try {
    const store = aiConfig.createAiConfigStore({ filePath: file });
    const saved = store.saveConfig({
      baseUrl: 'http://127.0.0.1:1234/v1/',
      model: 'custom-model',
      imageSize: '1024x1024',
      timeoutMs: 45000,
      apiKey: 'sk-test-1234567890',
    });
    assert.equal(saved.baseUrl, 'http://127.0.0.1:1234/v1');
    assert.equal(saved.hasApiKey, true);
    assert.equal(saved.keyPreview.includes('1234567890'), false);
    assert.equal(saved.apiKey, undefined);
    assert.equal(store.getApiKey(), 'sk-test-1234567890');
    const rawText = fs.readFileSync(file, 'utf8');
    assert.ok(rawText.includes('apiKey') || rawText.includes('encryptedApiKey'));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('AI 配置：非法 Base URL 被拒绝', () => {
  assert.throws(
    () => aiConfig.normalizeBaseUrl('ftp://example.com'),
    (error) => error.code === 'E_AI_CONFIG',
  );
});

test('AI 生图客户端：解析 b64_json 响应（本地模拟服务）', async () => {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.model, 'mock-model');
        assert.equal(parsed.prompt, 'a test prompt');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const result = await aiImage.generateImage(
      {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'sk-mock',
        model: 'mock-model',
        imageSize: '1024x1024',
        timeoutMs: 10000,
      },
      'a test prompt',
    );
    assert.ok(Buffer.isBuffer(result.buffer));
    assert.equal(result.buffer.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(result.source, 'b64_json');
  } finally {
    server.close();
  }
});

test('AI 生图客户端：401 映射为 E_AI_AUTH', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'invalid key' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    await assert.rejects(
      aiImage.generateImage(
        {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: 'sk-bad',
          model: 'm',
          imageSize: '1024x1024',
          timeoutMs: 5000,
        },
        'x',
      ),
      (error) => error.code === 'E_AI_AUTH',
    );
  } finally {
    server.close();
  }
});
