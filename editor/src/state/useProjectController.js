import { useCallback, useEffect, useRef, useState } from 'react';

import { appApi, assetsApi, exportApi, projectsApi } from '../api';
import {
  commandsToMcpTools as listMcpTools,
  executeCommand as executeProjectCommand,
  listCommands as listProjectCommands,
} from '../commands';
import {
  addEdgeToProject,
  addNodeExitToProject,
  addNodeToProject,
  removeEdgeFromProject,
  removeNodeExitFromProject,
  removeNodeFromProject,
  setNodePositionsInProject,
  updateEdgeInProject,
  updateNodeExitInProject,
  updateNodeInProject,
} from './projectMutations';
import {
  removeTimelineFromProject,
  setTimelineInProject,
  updateTimelineDurationInProject,
} from './timelineMutations';

export function flattenAssets(project) {
  if (!project?.assets) return [];
  return [
    ...(project.assets.images ?? []),
    ...(project.assets.audio ?? []),
    ...(project.assets.videos ?? []),
    ...(project.assets.minigames ?? []),
  ];
}

export function findAsset(project, assetId) {
  if (!assetId) return null;
  return flattenAssets(project).find((asset) => asset.id === assetId) ?? null;
}

export function countAssets(project) {
  return {
    image: project?.assets?.images?.length ?? 0,
    audio: project?.assets?.audio?.length ?? 0,
    video: project?.assets?.videos?.length ?? 0,
    minigame: project?.assets?.minigames?.length ?? 0,
  };
}

function withUpdatedAssets(project, updater) {
  const assets = project.assets ?? { images: [], audio: [], videos: [], minigames: [] };
  return { ...project, assets: updater(assets) };
}

export function addAssetsToProject(project, incoming) {
  const list = Array.isArray(incoming) ? incoming : [incoming];
  if (list.length === 0) return project;
  return withUpdatedAssets(project, (assets) => {
    const next = {
      images: [...(assets.images ?? [])],
      audio: [...(assets.audio ?? [])],
      videos: [...(assets.videos ?? [])],
      minigames: [...(assets.minigames ?? [])],
    };
    for (const asset of list) {
      const bucket =
        asset.kind === 'image'
          ? next.images
          : asset.kind === 'audio'
            ? next.audio
            : asset.kind === 'video'
              ? next.videos
              : asset.kind === 'minigame'
                ? next.minigames
                : null;
      if (!bucket) continue;
      const index = bucket.findIndex((item) => item.id === asset.id);
      if (index >= 0) bucket[index] = asset;
      else bucket.push(asset);
    }
    return next;
  });
}

export function updateAssetInProject(project, assetId, patch) {
  return withUpdatedAssets(project, (assets) => ({
    images: (assets.images ?? []).map((asset) =>
      asset.id === assetId ? { ...asset, ...patch } : asset,
    ),
    audio: (assets.audio ?? []).map((asset) =>
      asset.id === assetId ? { ...asset, ...patch } : asset,
    ),
    videos: (assets.videos ?? []).map((asset) =>
      asset.id === assetId ? { ...asset, ...patch } : asset,
    ),
    minigames: (assets.minigames ?? []).map((asset) =>
      asset.id === assetId ? { ...asset, ...patch } : asset,
    ),
  }));
}

export function replaceAssetInProject(project, asset) {
  if (!asset?.id) return project;
  return withUpdatedAssets(project, (assets) => ({
    images: (assets.images ?? []).map((item) => (item.id === asset.id ? asset : item)),
    audio: (assets.audio ?? []).map((item) => (item.id === asset.id ? asset : item)),
    videos: (assets.videos ?? []).map((item) => (item.id === asset.id ? asset : item)),
    minigames: (assets.minigames ?? []).map((item) => (item.id === asset.id ? asset : item)),
  }));
}

export function removeAssetFromProject(project, assetId) {
  return withUpdatedAssets(project, (assets) => ({
    images: (assets.images ?? []).filter((asset) => asset.id !== assetId),
    audio: (assets.audio ?? []).filter((asset) => asset.id !== assetId),
    videos: (assets.videos ?? []).filter((asset) => asset.id !== assetId),
    minigames: (assets.minigames ?? []).filter((asset) => asset.id !== assetId),
  }));
}

export function useProjectControllerState() {
  const [project, setProject] = useState(null);
  const [projectPath, setProjectPath] = useState(null);
  const [projectDir, setProjectDir] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [recentProjects, setRecentProjects] = useState([]);
  const [toast, setToast] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [lastExportDir, setLastExportDir] = useState(null);

  const stateRef = useRef({});
  stateRef.current = { project, projectPath, projectDir, dirty, saving };

  const notify = useCallback((message, kind = 'info') => {
    setToast({ id: Date.now(), message: String(message ?? ''), kind });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  const refreshRecent = useCallback(async () => {
    try {
      const result = await projectsApi.recent();
      setRecentProjects(result.items ?? []);
    } catch {
      /* 最近项目读取失败不阻塞主流程 */
    }
  }, []);

  const loadFromPayload = useCallback(
    (payload) => {
      if (!payload?.project) return;
      setProject(payload.project);
      setProjectPath(payload.projectPath ?? null);
      setProjectDir(payload.projectDir ?? null);
      setDirty(false);
      setLastSavedAt(payload.project?.meta?.updatedAt ? new Date(payload.project.meta.updatedAt) : new Date());
      appApi.setTitle(`${payload.project.meta?.title ?? '未命名项目'} — VN Studio`);
      refreshRecent();
    },
    [refreshRecent],
  );

  const saveNow = useCallback(
    async ({ silent = false } = {}) => {
      const current = stateRef.current;
      if (!current.project || !current.projectPath) return false;
      if (current.saving) return false;
      setSaving(true);
      try {
        const result = await projectsApi.save({
          project: current.project,
          projectPath: current.projectPath,
        });
        setProject(result.project);
        setProjectPath(result.projectPath);
        setProjectDir(result.projectDir);
        setDirty(false);
        setLastSavedAt(new Date());
        refreshRecent();
        if (!silent) notify('已保存', 'success');
        return true;
      } catch (error) {
        notify(error.message, 'error');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [notify, refreshRecent],
  );

  // 自动保存：存在未保存改动时每 15 分钟落盘一次（手动保存 / Ctrl+S 不受影响）。
  useEffect(() => {
    if (!dirty || !project) return undefined;
    const timer = setInterval(() => {
      saveNow({ silent: true });
    }, 15 * 60 * 1000);
    return () => clearInterval(timer);
  }, [dirty, project?.meta?.id, saveNow]);

  const mutate = useCallback((updater) => {
    setProject((previous) => {
      if (!previous) return previous;
      const next = updater(previous);
      if (!next || next === previous) return previous;
      setDirty(true);
      return next;
    });
  }, []);

  const createProject = useCallback(
    async ({ title, resolution }) => {
      setBusy(true);
      try {
        const result = await projectsApi.create({ title, resolution });
        if (result.canceled) return false;
        loadFromPayload(result);
        notify('项目已创建', 'success');
        return true;
      } catch (error) {
        notify(error.message, 'error');
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [loadFromPayload, notify],
  );

  const openProject = useCallback(async () => {
    setBusy(true);
    try {
      const result = await projectsApi.open();
      if (result.canceled) return false;
      loadFromPayload(result);
      notify('项目已打开', 'success');
      return true;
    } catch (error) {
      notify(error.message, 'error');
      throw error;
    } finally {
      setBusy(false);
    }
  }, [loadFromPayload, notify]);

  const openProjectPath = useCallback(
    async (path) => {
      setBusy(true);
      try {
        const result = await projectsApi.openPath(path);
        loadFromPayload(result);
        notify('项目已打开', 'success');
        return true;
      } catch (error) {
        notify(error.message, 'error');
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [loadFromPayload, notify],
  );

  const closeProject = useCallback(async () => {
    if (stateRef.current.dirty) {
      await saveNow({ silent: true });
    }
    setProject(null);
    setProjectPath(null);
    setProjectDir(null);
    setDirty(false);
    setLastSavedAt(null);
    appApi.setTitle('VN Studio');
    refreshRecent();
  }, [refreshRecent, saveNow]);

  const removeAsset = useCallback(
    async (asset) => {
      const current = stateRef.current;
      if (!asset || !current.projectDir) return;
      try {
        await assetsApi.remove({ projectDir: current.projectDir, asset });
        mutate((previous) => removeAssetFromProject(previous, asset.id));
        notify('素材已删除', 'success');
      } catch (error) {
        notify(`删除素材失败：${error.message}`, 'error');
        throw error;
      }
    },
    [mutate, notify],
  );

  const exportWeb = useCallback(async () => {
    const current = stateRef.current;
    if (!current.project || !current.projectDir) {
      notify('请先打开项目再导出', 'warn');
      return null;
    }
    setExporting(true);
    try {
      const result = await exportApi.web({
        project: current.project,
        projectDir: current.projectDir,
      });
      if (result.canceled) return null;
      setLastExportDir(result.outputDir ?? null);
      notify(`Web 包已导出：${result.outputDir}`, 'success');
      return result;
    } catch (error) {
      const errors = Array.isArray(error.errors) ? error.errors : [];
      const detail = errors
        .slice(0, 3)
        .map((item) => `${item.code ? `${item.code} ` : ''}${item.message}`)
        .join('；');
      notify(`导出失败：${detail || error.message}`, 'error');
      console.warn('[export] 导出失败', errors.length > 0 ? errors : error);
      return null;
    } finally {
      setExporting(false);
    }
  }, [notify]);

  const exportDesktop = useCallback(async () => {
    const current = stateRef.current;
    if (!current.project || !current.projectDir) {
      notify('请先打开项目再导出', 'warn');
      return null;
    }
    setExporting(true);
    try {
      const result = await exportApi.desktop({
        project: current.project,
        projectDir: current.projectDir,
      });
      if (result.canceled) return null;
      setLastExportDir(result.outputDir ?? null);
      notify(`桌面版已导出：${result.outputDir}（双击「启动游戏.cmd」游玩）`, 'success');
      return result;
    } catch (error) {
      const errors = Array.isArray(error.errors) ? error.errors : [];
      const detail = errors
        .slice(0, 3)
        .map((item) => `${item.code ? `${item.code} ` : ''}${item.message}`)
        .join('；');
      notify(`桌面版导出失败：${detail || error.message}`, 'error');
      console.warn('[export] 桌面版导出失败', errors.length > 0 ? errors : error);
      return null;
    } finally {
      setExporting(false);
    }
  }, [notify]);

  const openExportDir = useCallback(async () => {
    if (!lastExportDir) return;
    try {
      await exportApi.openPath({ path: lastExportDir });
    } catch (error) {
      notify(`打开导出目录失败：${error.message}`, 'error');
    }
  }, [lastExportDir, notify]);

  const actions = {
    refreshRecent,
    loadFromPayload,
    createProject,
    openProject,
    openProjectPath,
    closeProject,
    saveNow,
    removeAsset,
    updateMeta: (patch) => mutate((p) => ({ ...p, meta: { ...p.meta, ...patch } })),
    updateSettings: (patch) => mutate((p) => ({ ...p, settings: { ...p.settings, ...patch } })),
    updateLayout: (patch) => mutate((p) => ({ ...p, layout: { ...(p.layout ?? {}), ...patch } })),
    updateEditor: (patch) => mutate((p) => ({ ...p, editor: { ...(p.editor ?? {}), ...patch } })),
    setVariables: (variables) => mutate((p) => ({ ...p, variables: { ...variables } })),
    addAssets: (incoming) => mutate((p) => addAssetsToProject(p, incoming)),
    updateAsset: (assetId, patch) => mutate((p) => updateAssetInProject(p, assetId, patch)),
    replaceAsset: (asset) => mutate((p) => replaceAssetInProject(p, asset)),
    // 阶段三：蓝图节点与连线
    addNode: (node) => mutate((p) => addNodeToProject(p, node)),
    replaceProject: (next) => mutate((previous) => (next && next !== previous ? next : previous)),
    updateNode: (nodeId, patch) => mutate((p) => updateNodeInProject(p, nodeId, patch)),
    removeNode: (nodeId) => mutate((p) => removeNodeFromProject(p, nodeId)),
    setNodePositions: (patches) => mutate((p) => setNodePositionsInProject(p, patches)),
    addEdge: (edge) => mutate((p) => addEdgeToProject(p, edge)),
    updateEdge: (edgeId, patch) => mutate((p) => updateEdgeInProject(p, edgeId, patch)),
    removeEdge: (edgeId) => mutate((p) => removeEdgeFromProject(p, edgeId)),
    addNodeExit: (nodeId, exit) => mutate((p) => addNodeExitToProject(p, nodeId, exit)),
    updateNodeExit: (nodeId, exitId, patch) =>
      mutate((p) => updateNodeExitInProject(p, nodeId, exitId, patch)),
    removeNodeExit: (nodeId, exitId) =>
      mutate((p) => removeNodeExitFromProject(p, nodeId, exitId)),
    // Command bus：给 UI / 未来 MCP 统一的操作入口（纯 JSON 参数 + 结构化结果）
    executeCommand: (name, params) => {
      const current = stateRef.current;
      if (!current.project) {
        return {
          ok: false,
          command: String(name ?? ''),
          affectedNodeIds: [],
          affectedTrackIds: [],
          warnings: [],
          error: { code: 'E_NO_PROJECT', message: '当前没有打开的项目' },
        };
      }
      const result = executeProjectCommand(current.project, name, params);
      if (result.ok) {
        setProject(result.project);
        setDirty(true);
      }
      return result;
    },
    listCommands: () => listProjectCommands(),
    commandsToMcpTools: () => listMcpTools(),
    // 阶段四：场景时间轴
    setTimeline: (sceneNodeId, timeline) =>
      mutate((p) => setTimelineInProject(p, sceneNodeId, timeline)),
    removeTimeline: (sceneNodeId) =>
      mutate((p) => removeTimelineFromProject(p, sceneNodeId)),
    setTimelineDuration: (sceneNodeId, durationMs) =>
      mutate((p) => updateTimelineDurationInProject(p, sceneNodeId, durationMs)),
    exportWeb,
    exportDesktop,
    openExportDir,
  };

  return {
    project,
    projectPath,
    projectDir,
    dirty,
    saving,
    busy,
    exporting,
    lastExportDir,
    lastSavedAt,
    recentProjects,
    toast,
    notify,
    actions,
  };
}
