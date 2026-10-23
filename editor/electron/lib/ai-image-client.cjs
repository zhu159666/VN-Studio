'use strict';

// OpenAI 兼容的图片生成客户端：不在代码里绑定任何供应商/模型。
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function aiError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function imageEndpoint(baseUrl) {
  const normalized = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!normalized) throw aiError('E_AI_CONFIG', '未配置 Base URL');
  if (/\/images\/generations$/.test(normalized)) return normalized;
  return `${normalized}/images/generations`;
}

async function fetchBuffer(url, { headers = {}, timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw aiError('E_AI_HTTP', `图片下载失败 HTTP ${response.status}${text ? `：${text.slice(0, 200)}` : ''}`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) throw aiError('E_AI_IMAGE_LARGE', '生成的图片超过 20 MB 限制');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) throw aiError('E_AI_IMAGE_LARGE', '生成的图片超过 20 MB 限制');
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{baseUrl:string, apiKey:string, model:string, imageSize:string, timeoutMs:number}} config
 * @param {string} prompt
 */
async function generateImage(config, prompt) {
  if (!config?.apiKey) throw aiError('E_AI_NOT_CONFIGURED', '未配置 API Key');
  const body = {
    model: config.model,
    prompt,
    n: 1,
    size: config.imageSize,
    response_format: 'b64_json',
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 60000);
  let response;
  try {
    response = await fetch(imageEndpoint(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.code) throw error;
    throw aiError('E_AI_NETWORK', error.name === 'AbortError' ? '生图请求超时' : `生图请求失败：${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.message || parsed?.message || detail;
    } catch {
      /* ignore */
    }
    const code = response.status === 401 || response.status === 403 ? 'E_AI_AUTH' : response.status === 429 ? 'E_AI_RATE_LIMIT' : 'E_AI_HTTP';
    throw aiError(code, `生图服务返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw aiError('E_AI_RESPONSE', '生图服务返回的不是 JSON');
  }
  const item = Array.isArray(parsed?.data) ? parsed.data[0] : null;
  if (!item) throw aiError('E_AI_RESPONSE', '生图服务没有返回 data');
  if (typeof item.b64_json === 'string' && item.b64_json) {
    const buffer = Buffer.from(item.b64_json, 'base64');
    if (!buffer.length) throw aiError('E_AI_RESPONSE', '生图服务返回的 base64 为空');
    if (buffer.length > MAX_IMAGE_BYTES) throw aiError('E_AI_IMAGE_LARGE', '生成的图片超过 20 MB 限制');
    return { buffer, source: 'b64_json' };
  }
  if (typeof item.url === 'string' && item.url) {
    const buffer = await fetchBuffer(item.url, { timeoutMs: config.timeoutMs ?? 60000 });
    return { buffer, source: 'url' };
  }
  throw aiError('E_AI_RESPONSE', '生图响应既不包含 b64_json 也不包含 url');
}

module.exports = { generateImage, imageEndpoint, MAX_IMAGE_BYTES };
