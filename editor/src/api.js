// 渲染层访问主进程的唯一入口。
// 所有方法都会 unwrap 统一响应：成功返回数据，失败抛 Error。

function bridge() {
  const api = window.vnStudio;
  if (!api) {
    throw new Error('主进程桥接不可用（window.vnStudio 未注入）');
  }
  return api;
}

export function unwrap(response) {
  if (!response || typeof response !== 'object') {
    throw new Error('主进程返回了无效响应');
  }
  if (response.ok === false) {
    const error = new Error(response.error || '操作失败');
    if (response.code) error.code = response.code;
    if (response.errors) error.errors = response.errors;
    throw error;
  }
  return response;
}

function invoke(fn) {
  return Promise.resolve()
    .then(fn)
    .then(unwrap);
}

export const appApi = {
  getInfo: () => invoke(() => bridge().app.getInfo()),
  getStartupProject: () => invoke(() => bridge().app.getStartupProject()),
  async setTitle(title) {
    try {
      await invoke(() => bridge().app.setTitle(title));
    } catch {
      /* 标题设置失败不影响功能 */
    }
  },
  onSmokeLoadProject(callback) {
    try {
      return bridge().app.onSmokeLoadProject(callback);
    } catch {
      return () => {};
    }
  },
  onSmokeSelectAsset(callback) {
    try {
      return bridge().app.onSmokeSelectAsset(callback);
    } catch {
      return () => {};
    }
  },
};

export const projectsApi = {
  create: (payload) => invoke(() => bridge().projects.create(payload)),
  open: () => invoke(() => bridge().projects.open()),
  openPath: (projectPath) => invoke(() => bridge().projects.openPath(projectPath)),
  save: (payload) => invoke(() => bridge().projects.save(payload)),
  recent: () => invoke(() => bridge().projects.recent()),
  removeRecent: (projectPath) => invoke(() => bridge().projects.removeRecent(projectPath)),
};

export const assetsApi = {
  importImages: (payload) => invoke(() => bridge().assets.importImages(payload)),
  importAudio: (payload) => invoke(() => bridge().assets.importAudio(payload)),
  importVideos: (payload) => invoke(() => bridge().assets.importVideos(payload)),
  importMinigames: (payload) => invoke(() => bridge().assets.importMinigames(payload)),
  saveGeneratedAudio: (payload) => invoke(() => bridge().assets.saveGeneratedAudio(payload)),
  readDataUrl: (payload) => invoke(() => bridge().assets.readDataUrl(payload)),
  readText: (payload) => invoke(() => bridge().assets.readText(payload)),
  assetUrl: (payload) => invoke(() => bridge().assets.assetUrl(payload)),
  exportImage: (payload) => invoke(() => bridge().assets.exportImage(payload)),
  exportAudio: (payload) => invoke(() => bridge().assets.exportAudio(payload)),
  remove: (payload) => invoke(() => bridge().assets.remove(payload)),
};

export const savesApi = {
  list: (payload) => invoke(() => bridge().saves.list(payload)),
  get: (payload) => invoke(() => bridge().saves.get(payload)),
  put: (payload) => invoke(() => bridge().saves.put(payload)),
  remove: (payload) => invoke(() => bridge().saves.remove(payload)),
};

export const exportApi = {
  validate: (payload) => invoke(() => bridge().exports.validate(payload)),
  web: (payload) => invoke(() => bridge().exports.web(payload)),
  openPath: (payload) => invoke(() => bridge().exports.openPath(payload)),
};

export async function assetDataUrl(projectDir, asset, which = 'final') {
  if (!projectDir || !asset) return null;
  const relativePath = which === 'source' ? (asset.source?.path ?? asset.path) : asset.path;
  if (!relativePath) return null;
  try {
    const result = await assetsApi.readDataUrl({ projectDir, relativePath });
    return result.dataUrl ?? null;
  } catch {
    return null;
  }
}

export async function assetStreamUrl(projectDir, relativePath) {
  if (!projectDir || !relativePath) return null;
  const result = await assetsApi.assetUrl({ projectDir, relativePath });
  return result.url ?? null;
}
