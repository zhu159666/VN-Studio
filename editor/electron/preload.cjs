'use strict';

// 渲染层桥接：只暴露 IPC 白名单，不泄漏 Node / Electron 对象。

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('vnStudio', {
  app: {
    getInfo: () => invoke('app:info'),
    getStartupProject: () => invoke('app:startup-project'),
    setTitle: (title) => invoke('app:set-title', title),
    onSmokeLoadProject: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('smoke:load-project', handler);
      return () => ipcRenderer.removeListener('smoke:load-project', handler);
    },
    onSmokeSelectAsset: (callback) => {
      const handler = (_event, assetId) => callback(assetId);
      ipcRenderer.on('smoke:select-asset', handler);
      return () => ipcRenderer.removeListener('smoke:select-asset', handler);
    },
  },
  projects: {
    create: (payload) => invoke('project:create', payload),
    open: () => invoke('project:open'),
    openPath: (projectPath) => invoke('project:open-path', projectPath),
    save: (payload) => invoke('project:save', payload),
    recent: () => invoke('project:recent'),
    removeRecent: (projectPath) => invoke('project:remove-recent', projectPath),
  },
  assets: {
    importImages: (payload) => invoke('asset:import-images', payload),
    importAudio: (payload) => invoke('asset:import-audio', payload),
    importVideos: (payload) => invoke('asset:import-videos', payload),
    importMinigames: (payload) => invoke('asset:import-minigames', payload),
    saveGeneratedAudio: (payload) => invoke('asset:save-generated-audio', payload),
    readDataUrl: (payload) => invoke('asset:read-data-url', payload),
    readText: (payload) => invoke('asset:read-text', payload),
    assetUrl: (payload) => invoke('asset:url', payload),
    exportImage: (payload) => invoke('asset:export-image', payload),
    exportAudio: (payload) => invoke('asset:export-audio', payload),
    remove: (payload) => invoke('asset:remove', payload),
  },
  saves: {
    list: (payload) => invoke('saves:list', payload),
    get: (payload) => invoke('saves:get', payload),
    put: (payload) => invoke('saves:put', payload),
    remove: (payload) => invoke('saves:delete', payload),
  },
  exports: {
    validate: (payload) => invoke('export:validate', payload),
    web: (payload) => invoke('export:web', payload),
    desktop: (payload) => invoke('export:desktop', payload),
    openPath: (payload) => invoke('shell:open-path', payload),
  },
});
