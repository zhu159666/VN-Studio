/**
 * VN Studio 运行时存档层：IndexedDB 实现。
 *
 * 存储模型：
 * - 数据库默认 `vn-studio-runtime`，对象存储 `saves`，keyPath 为 `key`。
 * - key = `${projectId}:${kind}:${slot}`（kind: manual | auto | quick）。
 * - 记录内容即 schema `$defs.saveState` 外加 `key` 字段。
 *
 * 本模块不依赖 DOM（除 indexedDB 全局对象），可在浏览器主线程使用；
 * 浏览器不支持 IndexedDB 时同步抛出清晰的中文错误，由 UI 提示。
 */

const DEFAULT_DB_NAME = 'vn-studio-runtime';
const STORE_NAME = 'saves';
const DB_VERSION = 1;
const VALID_KINDS = new Set(['manual', 'auto', 'quick']);

function buildKey(projectId, kind, slot) {
  return `${projectId}:${kind}:${slot}`;
}

function assertProjectId(projectId) {
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('存档操作失败：缺少有效的 projectId');
  }
}

function normalizeSlot(slot, kind) {
  const value = Number(slot);
  if (!Number.isInteger(value) || value < 0 || value > 999) {
    throw new Error(`存档操作失败：槽位号无效（${slot}）`);
  }
  if (kind === 'manual' && value < 1) {
    throw new Error('存档操作失败：手动存档槽位必须为 1–999');
  }
  if ((kind === 'auto' || kind === 'quick') && value !== 0) {
    throw new Error(`存档操作失败：${kind} 存档槽位固定为 0`);
  }
  return value;
}

/**
 * 创建 IndexedDB 存档后端。
 * @param {{ dbName?: string }} [options]
 * @returns {{
 *   list(projectId: string): Promise<Array<object>>,
 *   get(projectId: string, kind: string, slot: number): Promise<object|null>,
 *   put(saveState: object): Promise<string>,
 *   remove(projectId: string, kind: string, slot: number): Promise<void>
 * }}
 */
export function createIndexedDbStorage({ dbName = DEFAULT_DB_NAME } = {}) {
  if (typeof indexedDB === 'undefined' || !indexedDB) {
    throw new Error('当前浏览器不支持 IndexedDB，无法使用存档功能');
  }

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(dbName, DB_VERSION);
      } catch (error) {
        reject(new Error(`打开存档数据库失败：${error?.message || error}`));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            /* ignore */
          }
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        reject(new Error(`打开存档数据库失败：${request.error?.message || '未知错误'}`));
      };
      request.onblocked = () => {
        console.warn('[runtime] 存档数据库升级被其他页面阻塞，请关闭其他运行时页面后重试');
      };
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  }

  async function runRequest(mode, action, { waitForTransaction = false } = {}) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STORE_NAME, mode);
      } catch (error) {
        reject(new Error(`存档数据库事务失败：${error?.message || error}`));
        return;
      }
      const store = tx.objectStore(STORE_NAME);
      let request;
      try {
        request = action(store);
      } catch (error) {
        reject(new Error(`存档操作失败：${error?.message || error}`));
        return;
      }
      let result;
      if (request) {
        request.onsuccess = () => {
          result = request.result;
          if (!waitForTransaction) resolve(result);
        };
        request.onerror = () => {
          reject(new Error(`存档操作失败：${request.error?.message || '未知错误'}`));
        };
      }
      tx.oncomplete = () => {
        if (waitForTransaction || !request) resolve(result);
      };
      tx.onerror = () => {
        reject(new Error(`存档事务失败：${tx.error?.message || '未知错误'}`));
      };
      tx.onabort = () => {
        reject(new Error('存档事务被中止'));
      };
    });
  }

  return {
    async list(projectId) {
      assertProjectId(projectId);
      const all = await runRequest('readonly', (store) => store.getAll());
      const prefix = `${projectId}:`;
      return (Array.isArray(all) ? all : [])
        .filter((item) => item && typeof item.key === 'string' && item.key.startsWith(prefix))
        .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
    },

    async get(projectId, kind, slot) {
      assertProjectId(projectId);
      if (!VALID_KINDS.has(kind)) throw new Error(`存档操作失败：未知存档类型 ${kind}`);
      const key = buildKey(projectId, kind, normalizeSlot(slot, kind));
      const record = await runRequest('readonly', (store) => store.get(key));
      if (!record) return null;
      const { key: _key, ...saveState } = record;
      return saveState;
    },

    async put(saveState) {
      if (!saveState || typeof saveState !== 'object') {
        throw new Error('存档写入失败：存档内容为空');
      }
      const { projectId, kind } = saveState;
      assertProjectId(projectId);
      if (!VALID_KINDS.has(kind)) throw new Error(`存档写入失败：未知存档类型 ${kind}`);
      const slot = normalizeSlot(saveState.slot, kind);
      const key = buildKey(projectId, kind, slot);
      const record = { ...saveState, key };
      await runRequest('readwrite', (store) => store.put(record), { waitForTransaction: true });
      return key;
    },

    async remove(projectId, kind, slot) {
      assertProjectId(projectId);
      if (!VALID_KINDS.has(kind)) throw new Error(`存档删除失败：未知存档类型 ${kind}`);
      const key = buildKey(projectId, kind, normalizeSlot(slot, kind));
      await runRequest('readwrite', (store) => store.delete(key), { waitForTransaction: true });
    },
  };
}
