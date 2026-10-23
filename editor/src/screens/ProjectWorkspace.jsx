import { useCallback, useEffect, useRef, useState } from 'react';

import { assetsApi } from '../api';
import AIAssistantPanel from '../components/AIAssistantPanel';
import AssetPanel from '../components/AssetPanel';
import AudioStudioModal from '../components/AudioStudioModal';
import InspectorPanel from '../components/InspectorPanel';
import SettingsModal from '../components/SettingsModal';
import ThemeToggle from '../components/ThemeToggle';
import EdgeInspector from '../components/inspectors/EdgeInspector';
import NodeInspector from '../components/inspectors/NodeInspector';
import SceneInspector from '../components/inspectors/SceneInspector';
import AudioEditor from '../features/assets/AudioEditor';
import ImageEditor from '../features/assets/ImageEditor';
import MinigamePreview from '../features/assets/MinigamePreview';
import VideoPreview from '../features/assets/VideoPreview';
import BlueprintEditor from '../features/blueprint/BlueprintEditor';
import RuntimePreview from '../features/preview/RuntimePreview';
import SceneMiniPreview from '../features/preview/SceneMiniPreview';
import TimelineEditor from '../features/timeline/TimelineEditor';
import { findAsset } from '../state/useProjectController';
import { useProjectController } from '../state/ProjectContext';
import '../styles/workspace.css';

const MIN_LEFT = 200;
const MAX_LEFT = 480;
const MIN_RIGHT = 240;
const MAX_RIGHT = 560;
const MIN_TIMELINE = 120;
const MAX_TIMELINE = 600;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatSavedAt(date) {
  if (!date) return '';
  try {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function ProjectOverview({ project, onImport, notify, onOpenBlueprint }) {
  const counts = {
    nodes: project.nodes?.length ?? 0,
    edges: project.edges?.length ?? 0,
    images: project.assets?.images?.length ?? 0,
    audio: project.assets?.audio?.length ?? 0,
    videos: project.assets?.videos?.length ?? 0,
    minigames: project.assets?.minigames?.length ?? 0,
    variables: Object.keys(project.variables ?? {}).length,
    timelines: Object.keys(project.timelines ?? {}).length,
  };
  return (
    <div className="vn-overview">
      <header className="vn-overview__hero">
        <div>
          <h1>{project.meta?.title ?? '未命名项目'}</h1>
          <p className="vn-overview__subtitle">
            阶段 6 · Web 打包已启用。完成后点击顶部「导出」生成 index.html + assets/ + game.json。
          </p>
        </div>
        <div className="vn-overview__badge">可部署静态 Web 包</div>
      </header>

      <section className="vn-overview__stats">
        {[
          ['节点', counts.nodes],
          ['连线', counts.edges],
          ['变量', counts.variables],
          ['时间轴', counts.timelines],
          ['图片', counts.images],
          ['音频', counts.audio],
          ['视频', counts.videos],
          ['小游戏', counts.minigames],
        ].map(([label, value]) => (
          <div className="vn-overview__stat" key={label}>
            <span className="vn-overview__stat-value">{value}</span>
            <span className="vn-overview__stat-label">{label}</span>
          </div>
        ))}
      </section>

      <section className="vn-overview__grid">
        <div className="vn-overview__card">
          <h3>快速导入素材</h3>
          <p>图片会在导入时转为 webp；音频会转成 ogg；视频校验编码后复制；小游戏校验 MINIGAME_EXITS。</p>
          <div className="vn-overview__actions">
            <button type="button" className="vn-btn" onClick={() => onImport('images', 'background')}>
              导入背景
            </button>
            <button type="button" className="vn-btn" onClick={() => onImport('images', 'sprite')}>
              导入立绘
            </button>
            <button type="button" className="vn-btn" onClick={() => onImport('audio', 'bgm')}>
              导入音乐
            </button>
            <button type="button" className="vn-btn" onClick={() => onImport('videos')}>
              导入视频
            </button>
            <button type="button" className="vn-btn" onClick={() => onImport('minigames')}>
              导入小游戏
            </button>
          </div>
        </div>
        <div className="vn-overview__card">
          <h3>项目信息</h3>
          <dl className="vn-overview__meta">
            <div>
              <dt>作者</dt>
              <dd>{project.meta?.author || '未填写'}</dd>
            </div>
            <div>
              <dt>分辨率</dt>
              <dd>
                {project.settings?.resolution?.width} × {project.settings?.resolution?.height}
              </dd>
            </div>
            <div>
              <dt>起始节点</dt>
              <dd className="vn-mono">{project.settings?.startNodeId || '未设置'}</dd>
            </div>
            <div>
              <dt>schemaVersion</dt>
              <dd>{project.schemaVersion}</dd>
            </div>
          </dl>
          <p className="vn-overview__hint">
            在右侧属性面板可以编辑标题、作者与分辨率；素材属性随选中对象切换。
          </p>
        </div>
      </section>

      <section className="vn-overview__roadmap">
        <h3>阶段路线</h3>
        <ol>
          <li className="is-done">① 项目文件 + 素材管理</li>
          <li className="is-done">② 蓝图编辑器</li>
          <li className="is-done">③ 场景时间轴</li>
          <li className="is-done">④ 浏览器运行时</li>
          <li className="is-done">⑤ Web 打包导出（当前）</li>
        </ol>
        <button type="button" className="vn-btn vn-btn--ghost" onClick={onOpenBlueprint}>
          打开蓝图
        </button>
      </section>
    </div>
  );
}

export default function ProjectWorkspace({ initialFilter, focusAssetId, onBack, openAudioStudio = false, onAudioStudioOpened }) {
  const controller = useProjectController();
  const { project, projectDir, dirty, saving, exporting, lastExportDir, lastSavedAt, actions, notify } = controller;
  const layout = project.layout ?? {};

  const [selectedAssetId, setSelectedAssetId] = useState(
    project.editor?.selectedAssetId && findAsset(project, project.editor.selectedAssetId)
      ? project.editor.selectedAssetId
      : null,
  );
  const [activeTab, setActiveTab] = useState('blueprint');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [query, setQuery] = useState('');
  const [leftWidth, setLeftWidth] = useState(layout.leftWidth ?? 280);
  const [rightWidth, setRightWidth] = useState(layout.rightWidth ?? 320);
  const [timelineHeight, setTimelineHeight] = useState(layout.timelineHeight ?? 200);
  const [rightCollapsed, setRightCollapsed] = useState(Boolean(layout.rightCollapsed));
  const [audioStudioOpen, setAudioStudioOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);

  useEffect(() => {
    if (!openAudioStudio) return;
    setAudioStudioOpen(true);
    onAudioStudioOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAudioStudio]);

  const sizeRef = useRef({ leftWidth, rightWidth, timelineHeight });
  sizeRef.current = { leftWidth, rightWidth, timelineHeight };
  const dragRef = useRef(null);

  const selectedAsset = findAsset(project, selectedAssetId);
  const selectedNode = project.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = project.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  // 打开新项目时重置布局尺寸（layout 属于项目文件）。
  useEffect(() => {
    setLeftWidth(project.layout?.leftWidth ?? 280);
    setRightWidth(project.layout?.rightWidth ?? 320);
    setTimelineHeight(project.layout?.timelineHeight ?? 200);
    setRightCollapsed(Boolean(project.layout?.rightCollapsed));
    setSelectedAssetId(
      project.editor?.selectedAssetId && findAsset(project, project.editor.selectedAssetId)
        ? project.editor.selectedAssetId
        : null,
    );
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setActiveTab('blueprint');
    setQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.schemaVersion, project.meta?.id]);

  useEffect(() => {
    if (initialFilter) {
      actions.updateLayout({ assetTypeFilter: initialFilter });
      setSelectedAssetId(null);
      setActiveTab('asset');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilter]);

  useEffect(() => {
    if (focusAssetId) {
      const asset = findAsset(project, focusAssetId);
      if (asset) {
        setSelectedAssetId(asset.id);
        setActiveTab('asset');
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        actions.updateEditor({ selectedAssetId: asset.id });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAssetId, project.meta?.id]);

  useEffect(() => {
    if (selectedAssetId && !findAsset(project, selectedAssetId)) {
      setSelectedAssetId(null);
    }
  }, [project, selectedAssetId]);

  useEffect(() => {
    if (selectedNodeId && !project.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
    if (selectedEdgeId && !project.edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [project.nodes, project.edges, selectedNodeId, selectedEdgeId]);

  const selectAsset = useCallback(
    (asset) => {
      const id = asset?.id ?? null;
      setSelectedAssetId(id);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setActiveTab('asset');
      actions.updateEditor({ selectedAssetId: id });
    },
    [actions],
  );

  const handleBlueprintSelection = useCallback(({ nodeId, edgeId }) => {
    setSelectedNodeId(nodeId ?? null);
    setSelectedEdgeId(edgeId ?? null);
    if (nodeId || edgeId) {
      setSelectedAssetId(null);
      setActiveTab('blueprint');
    }
  }, []);

  const handleLayoutPersist = useCallback(
    (patch) => {
      actions.updateLayout(patch);
    },
    [actions],
  );

  const beginDrag = (kind) => (event) => {
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, ...sizeRef.current };
    dragRef.current = { kind, start };
    const onMove = (moveEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'left') {
        setLeftWidth(
          clamp(drag.start.leftWidth + (moveEvent.clientX - drag.start.x), MIN_LEFT, MAX_LEFT),
        );
      } else if (drag.kind === 'right') {
        setRightWidth(
          clamp(drag.start.rightWidth - (moveEvent.clientX - drag.start.x), MIN_RIGHT, MAX_RIGHT),
        );
      } else if (drag.kind === 'timeline') {
        setTimelineHeight(
          clamp(drag.start.timelineHeight - (moveEvent.clientY - drag.start.y), MIN_TIMELINE, MAX_TIMELINE),
        );
      }
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const current = sizeRef.current;
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.kind === 'left') handleLayoutPersist({ leftWidth: current.leftWidth });
      if (drag.kind === 'right') handleLayoutPersist({ rightWidth: current.rightWidth });
      if (drag.kind === 'timeline') handleLayoutPersist({ timelineHeight: current.timelineHeight });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const runImport = useCallback(
    async (kind, payload = {}) => {
      if (!projectDir) return null;
      try {
        const handler =
          kind === 'images'
            ? assetsApi.importImages
            : kind === 'audio'
              ? assetsApi.importAudio
              : kind === 'videos'
                ? assetsApi.importVideos
                : assetsApi.importMinigames;
        const result = await handler({ ...payload, projectDir });
        if (!result || result.canceled) return result;
        if (result.assets?.length) {
          actions.addAssets(result.assets);
        }
        if (result.warnings?.length) {
          notify(result.warnings.slice(0, 4).join('；'), 'warn');
        }
        return result;
      } catch (error) {
        // 错误 toast 由 AssetPanel 统一负责，这里只向上抛出，避免重复提示。
        throw error;
      }
    },
    [actions, notify, projectDir],
  );

  const handleRemoveAsset = async (asset) => {
    try {
      await actions.removeAsset(asset);
      if (selectedAssetId === asset.id) {
        setSelectedAssetId(null);
        actions.updateEditor({ selectedAssetId: null });
      }
    } catch {
      /* actions 内已 notify */
    }
  };

  const handleOpenProject = async () => {
    try {
      await actions.openProject();
    } catch {
      /* 已 notify */
    }
  };

  const toggleRight = () => {
    const next = !rightCollapsed;
    setRightCollapsed(next);
    actions.updateLayout({ rightCollapsed: next });
  };

  const renderEditor = () => {
    if (!selectedAsset) {
      return (
        <ProjectOverview
          project={project}
          notify={notify}
          onImport={(kind, role) => runImport(kind, { role })}
          onOpenBlueprint={() => setActiveTab('blueprint')}
        />
      );
    }
    if (selectedAsset.kind === 'image') {
      return (
        <ImageEditor
          key={selectedAsset.id}
          asset={selectedAsset}
          projectDir={projectDir}
          onAssetUpdated={(updated) => actions.replaceAsset(updated)}
          notify={notify}
        />
      );
    }
    if (selectedAsset.kind === 'audio') {
      return (
        <AudioEditor
          key={selectedAsset.id}
          asset={selectedAsset}
          projectDir={projectDir}
          onAssetUpdated={(updated) => actions.replaceAsset(updated)}
          notify={notify}
        />
      );
    }
    if (selectedAsset.kind === 'video') {
      return <VideoPreview key={selectedAsset.id} asset={selectedAsset} projectDir={projectDir} />;
    }
    return (
      <MinigamePreview key={selectedAsset.id} asset={selectedAsset} projectDir={projectDir} />
    );
  };

  const saveLabel = saving ? '保存中…' : dirty ? '未保存' : lastSavedAt ? `已保存 ${formatSavedAt(lastSavedAt)}` : '已保存';

  return (
    <div className="vn-workspace">
      <header className="vn-workspace__topbar">
        <div className="vn-topbar__left">
          <button type="button" className="vn-btn vn-btn--ghost" onClick={onBack} title="返回开始界面">
            ← 开始
          </button>
          <div className="vn-topbar__title">
            <span>{project.meta?.title ?? '未命名项目'}</span>
            <small className={`vn-save-state ${dirty ? 'is-dirty' : ''}`}>{saveLabel}</small>
          </div>
        </div>
        <div className="vn-topbar__center">
          <span className="vn-phase-badge">阶段 6 · 可导出 Web 包</span>
        </div>
        <div className="vn-topbar__right">
          <ThemeToggle compact />
          <button type="button" className="vn-btn vn-btn--ghost" onClick={() => setAiAssistantOpen(true)} title="AI 助手：调用外部生图服务">
            AI 助手
          </button>
          <button type="button" className="vn-btn vn-btn--ghost" onClick={() => setSettingsOpen(true)} title="设置（外部 AI 服务）">
            设置
          </button>
          <button type="button" className="vn-btn" onClick={() => actions.saveNow()} disabled={saving}>
            保存
          </button>
          <button type="button" className="vn-btn vn-btn--ghost" onClick={handleOpenProject}>
            打开
          </button>
          <button
            type="button"
            className="vn-btn vn-btn--ghost"
            onClick={() => actions.exportWeb()}
            disabled={exporting}
            title="导出 index.html + assets/ + game.json 的可部署 Web 包"
          >
            {exporting ? '导出中…' : '导出'}
          </button>
          <button
            type="button"
            className="vn-btn vn-btn--ghost"
            onClick={() => actions.exportDesktop()}
            disabled={exporting}
            title="导出桌面版：双击「启动游戏.cmd」用 VN Studio 播放，无需浏览器"
          >
            桌面版
          </button>
          {lastExportDir ? (
            <button
              type="button"
              className="vn-btn vn-btn--ghost"
              onClick={() => actions.openExportDir()}
              title={lastExportDir}
            >
              打开目录
            </button>
          ) : null}
          <button
            type="button"
            className="vn-btn vn-btn--ghost"
            onClick={toggleRight}
            title={rightCollapsed ? '展开属性面板' : '折叠属性面板'}
          >
            {rightCollapsed ? '展开面板' : '折叠面板'}
          </button>
        </div>
      </header>

      <div
        className="vn-workspace__body"
        style={{
          gridTemplateColumns: `${leftWidth}px 6px minmax(0, 1fr) ${
            rightCollapsed ? '0px' : '6px'
          } ${rightCollapsed ? '0px' : `${rightWidth}px`}`,
        }}
      >
        <aside className="vn-workspace__left">
          <AssetPanel
            project={project}
            projectDir={projectDir}
            selectedAssetId={selectedAssetId}
            onSelectAsset={selectAsset}
            filter={layout.assetTypeFilter ?? 'all'}
            onFilterChange={(type) => actions.updateLayout({ assetTypeFilter: type })}
            view={layout.assetView ?? 'grid'}
            onViewChange={(view) => actions.updateLayout({ assetView: view })}
            query={query}
            onQueryChange={setQuery}
            onImportImages={(role) => runImport('images', { role })}
            onImportAudio={(role) => runImport('audio', { role })}
            onImportVideos={() => runImport('videos')}
            onImportMinigames={() => runImport('minigames')}
            onOpenAudioStudio={() => setAudioStudioOpen(true)}
            onRemoveAsset={handleRemoveAsset}
            notify={notify}
            lowerPanel={layout.leftBottomPanel ?? 'variables'}
            onLowerPanelChange={(panel) => actions.updateLayout({ leftBottomPanel: panel })}
            onVariablesChange={(next) => actions.setVariables(next)}
            onSelectAssetById={(id) => {
              const asset = findAsset(project, id);
              if (asset) selectAsset(asset);
            }}
          />
        </aside>

        <div className="vn-splitter vn-splitter--v" onPointerDown={beginDrag('left')} role="separator" aria-orientation="vertical" />

        <main className="vn-workspace__center">
          <nav className="vn-workspace__tabs" aria-label="中栏视图">
            <button
              type="button"
              className={`vn-tab${activeTab === 'blueprint' ? ' is-active' : ''}`}
              onClick={() => {
                setActiveTab('blueprint');
                setSelectedAssetId(null);
              }}
            >
              蓝图
            </button>
            <button
              type="button"
              className={`vn-tab${activeTab === 'asset' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('asset')}
            >
              素材编辑
            </button>
            <button
              type="button"
              className={`vn-tab${activeTab === 'preview' ? ' is-active' : ''}`}
              onClick={() => {
                setActiveTab('preview');
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
                setSelectedAssetId(null);
              }}
            >
              演示
            </button>
            <div className="vn-tabs__spacer" />
            <span className="vn-tabs__current">
              {activeTab === 'preview'
                ? '运行时预览'
                : selectedEdge
                  ? `连线：${selectedEdge.id}`
                  : selectedNode
                    ? `节点：${selectedNode.name}`
                    : selectedAsset
                      ? `素材：${selectedAsset.name}`
                      : '项目概览'}
            </span>
          </nav>
          <div className="vn-workspace__canvas">
            {activeTab === 'preview' ? (
              <RuntimePreview project={project} projectDir={projectDir} />
            ) : activeTab === 'blueprint' ? (
              <>
                <BlueprintEditor onSelectionChange={handleBlueprintSelection} />
                <SceneMiniPreview
                  project={project}
                  projectDir={projectDir}
                  sceneNode={selectedNode?.type === 'scene' ? selectedNode : null}
                />
              </>
            ) : (
              renderEditor()
            )}
          </div>
          <div
            className="vn-splitter vn-splitter--h"
            onPointerDown={beginDrag('timeline')}
            role="separator"
            aria-orientation="horizontal"
          />
          <section className="vn-workspace__timeline" style={{ height: `${timelineHeight}px` }}>
            <TimelineEditor
              project={project}
              projectDir={projectDir}
              sceneNode={selectedNode?.type === 'scene' ? selectedNode : null}
              height={timelineHeight}
            />
          </section>
        </main>

        {!rightCollapsed ? (
          <div className="vn-splitter vn-splitter--v" onPointerDown={beginDrag('right')} role="separator" aria-orientation="vertical" />
        ) : null}

        {!rightCollapsed ? (
          <aside className="vn-workspace__right">
            {selectedEdge ? (
              <EdgeInspector project={project} edge={selectedEdge} />
            ) : selectedNode ? (
              selectedNode.type === 'scene' ? (
                <SceneInspector project={project} projectDir={projectDir} node={selectedNode} />
              ) : (
                <NodeInspector project={project} projectDir={projectDir} node={selectedNode} />
              )
            ) : (
              <InspectorPanel
                project={project}
                selectedAsset={selectedAsset}
                onRemoveAsset={handleRemoveAsset}
              />
            )}
          </aside>
        ) : null}
      </div>

      {audioStudioOpen ? (
        <AudioStudioModal
          projectDir={projectDir}
          notify={notify}
          onClose={() => setAudioStudioOpen(false)}
          onCreated={(asset) => {
            actions.addAssets([asset]);
            setSelectedAssetId(asset.id);
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
            setActiveTab('asset');
            actions.updateEditor({ selectedAssetId: asset.id });
          }}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsModal notify={notify} onClose={() => setSettingsOpen(false)} />
      ) : null}

      {aiAssistantOpen ? (
        <AIAssistantPanel
          projectDir={projectDir}
          notify={notify}
          onClose={() => setAiAssistantOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onCreated={(asset) => {
            actions.addAssets([asset]);
            setSelectedAssetId(asset.id);
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
            setActiveTab('asset');
            actions.updateEditor({ selectedAssetId: asset.id });
          }}
        />
      ) : null}
    </div>
  );
}
