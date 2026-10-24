'use strict';

// 外部 AI 服务配置：只保存在 userData，不写入项目；API Key 用 safeStorage 加密。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-image-2',
  imageSize: '1024x1024',
  timeoutMs: 60000,
};

// 如果同机安装了 dsh-image-gen，读取它当前配置的 OpenAI 兼容端点和模型，
// 让 VN Studio 的生图模型跟随插件。API Key 不读取/不落盘。
function readDshImageDefaults() {
  const candidates = [
    process.env.DSH_PROFILE_DIR && path.join(process.env.DSH_PROFILE_DIR, 'cordis.patch.yml'),
    path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const base = text.match(/^\s*openaiCompatBaseURL:\s*(\S+)\s*$/m)?.[1];
      const model = text.match(/^\s*openaiCompatModel:\s*(\S+)\s*$/m)?.[1];
      if (base || model) return { ...(base ? { baseUrl: base.replace(/\/+$/, '') } : {}), ...(model ? { model } : {}) };
    } catch {
      /* 没有插件配置时使用默认值 */
    }
  }
  return {};
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return `${key.slice(0, 2)}***`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    const error = new Error('Base URL 不是合法 URL');
    error.code = 'E_AI_CONFIG';
    throw error;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const error = new Error('Base URL 只支持 http/https');
    error.code = 'E_AI_CONFIG';
    throw error;
  }
  return trimmed;
}

/**
 * @param {{filePath:string, safeStorage?:object}} options
 */
function createAiConfigStore({ filePath, safeStorage = null } = {}) {
  let cache = null;

  function readRaw() {
    if (cache) return cache;
    try {
      cache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      cache = {};
    }
    return cache;
  }

  function canEncrypt() {
    return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
  }

  function writeRaw(next) {
    cache = next;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, filePath);
  }

  function getApiKey() {
    const raw = readRaw();
    if (raw.encryptedApiKey && canEncrypt()) {
      try {
        return safeStorage.decryptString(Buffer.from(raw.encryptedApiKey, 'base64'));
      } catch {
        return '';
      }
    }
    return typeof raw.apiKey === 'string' ? raw.apiKey : '';
  }

  function getPublicConfig() {
    const raw = readRaw();
    const apiKey = getApiKey();
    const pluginDefaults = readDshImageDefaults();
    return {
      baseUrl: raw.baseUrl ?? pluginDefaults.baseUrl ?? DEFAULTS.baseUrl,
      model: raw.model ?? pluginDefaults.model ?? DEFAULTS.model,
      imageSize: raw.imageSize ?? DEFAULTS.imageSize,
      timeoutMs: raw.timeoutMs ?? DEFAULTS.timeoutMs,
      hasApiKey: Boolean(apiKey),
      keyPreview: maskKey(apiKey),
    };
  }

  /**
   * @param {{baseUrl?:string, model?:string, imageSize?:string, timeoutMs?:number, apiKey?:string|null}} patch
   */
  function saveConfig(patch = {}) {
    const raw = { ...readRaw() };
    if (patch.baseUrl !== undefined) raw.baseUrl = normalizeBaseUrl(patch.baseUrl) || DEFAULTS.baseUrl;
    if (patch.model !== undefined) raw.model = String(patch.model).trim() || DEFAULTS.model;
    if (patch.imageSize !== undefined) raw.imageSize = String(patch.imageSize).trim() || DEFAULTS.imageSize;
    if (patch.timeoutMs !== undefined) {
      const timeout = Number(patch.timeoutMs);
      raw.timeoutMs = Number.isFinite(timeout) ? Math.min(300000, Math.max(5000, Math.round(timeout))) : DEFAULTS.timeoutMs;
    }
    if (patch.apiKey !== undefined) {
      const key = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : '';
      delete raw.apiKey;
      delete raw.encryptedApiKey;
      if (key) {
        if (canEncrypt()) {
          raw.encryptedApiKey = safeStorage.encryptString(key).toString('base64');
        } else {
          raw.apiKey = key;
        }
      }
    }
    writeRaw(raw);
    return getPublicConfig();
  }

  return { getPublicConfig, saveConfig, getApiKey, readRaw };
}

let singleton = null;
function getStore() {
  if (singleton) return singleton;
  let app;
  let safeStorage;
  try {
    ({ app, safeStorage } = require('electron'));
  } catch {
    app = null;
    safeStorage = null;
  }
  const base = app && typeof app.getPath === 'function' ? app.getPath('userData') : path.join(process.cwd(), '.vnstudio');
  singleton = createAiConfigStore({ filePath: path.join(base, 'ai-service.json'), safeStorage });
  return singleton;
}

async function testConnection() {
  const store = getStore();
  const config = store.getPublicConfig();
  const apiKey = store.getApiKey();
  if (!config.baseUrl) {
    return { ok: false, error: '请先填写 Base URL' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(20000, config.timeoutMs));
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    return {
      connected: response.ok,
      status: response.status,
      message: response.ok ? '连接成功' : `服务返回 HTTP ${response.status}`,
    };
  } catch (error) {
    return { connected: false, error: error.name === 'AbortError' ? '连接超时' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULTS,
  maskKey,
  normalizeBaseUrl,
  createAiConfigStore,
  getPublicConfig: () => getStore().getPublicConfig(),
  saveConfig: (patch) => getStore().saveConfig(patch),
  getApiKey: () => getStore().getApiKey(),
  testConnection,
};
