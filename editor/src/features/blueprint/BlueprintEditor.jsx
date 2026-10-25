import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { findAsset } from '../../state/useProjectController';
import { useProjectController } from '../../state/ProjectContext';
import {
  addEdgeToProject,
  addNodeToProject,
  removeEdgeFromProject,
  removeNodeFromProject,
  setNodePositionsInProject,
} from '../../state/projectMutations';
import BlueprintNode from './BlueprintNode';
import NodeCreateMenu from './NodeCreateMenu';
import SpritePositionModal from './SpritePositionModal';
import {
  NODE_TYPE_META,
  applyAssetDrop,
  buildFlowEdges,
  buildFlowNodes,
  createNodeDraft,
  edgeKindForNode,
  makeEdgeId,
  nextDefaultPosition,
} from './blueprintUtils';
import '../../styles/blueprint.css';

const NODE_TYPES = { blueprint: BlueprintNode };

const EDGE_COLOR = {
  sequence: '#5aa9ff',
  conditional: '#ffc857',
  data: '#c49bff',
};

function clampMenuPosition(x, y) {
  return { x: Math.max(12, x), y: Math.max(12, y) };
}

function InnerBlueprint({ onSelectionChange, onNodeDoubleClick }) {
  const controller = useProjectController();
  const { project, actions, notify } = controller;
  const { fitView, screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selection, setSelection] = useState({ nodeId: null, edgeId: null });
  const [menu, setMenu] = useState(null);
  const [spriteRequest, setSpriteRequest] = useState(null);
  const wrapperRef = useRef(null);
  const nodeDropRef = useRef(null);
  const viewportTimerRef = useRef(null);

  const reportSelection = useCallback(
    (next) => {
      setSelection(next);
      onSelectionChange?.(next);
    },
    [onSelectionChange],
  );

  const decorateNodes = useCallback((sourceProject, selectedNodeId = null) => {
    return buildFlowNodes(sourceProject).map((flowNode) => ({
      ...flowNode,
      selected: flowNode.id === selectedNodeId,
      data: {
        ...flowNode.data,
        onAssetDrop: (nodeId, payload) => nodeDropRef.current?.(nodeId, payload),
        onNodeDoubleClick: (nodeId) => onNodeDoubleClick?.(nodeId),
      },
    }));
  }, [onNodeDoubleClick]);

  const decorateEdges = useCallback((sourceProject, selectedEdgeId = null) => {
    return buildFlowEdges(sourceProject).map((flowEdge) => {
      const kind = flowEdge.data?.edge?.kind ?? 'sequence';
      const color = EDGE_COLOR[kind] ?? EDGE_COLOR.sequence;
      return {
        ...flowEdge,
        selected: flowEdge.id === selectedEdgeId,
        animated: kind === 'conditional',
        className: `vn-bp-edge vn-bp-edge--${kind}`,
        style: {
          stroke: color,
          strokeWidth: kind === 'conditional' ? 1.8 : 1.6,
          strokeDasharray: kind === 'conditional' ? '7 4' : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      };
    });
  }, []);

  // 外部项目数据变化时重建画布（保留当前选择）。
  useEffect(() => {
    const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    const selectedEdgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id));
    const nextNodes = decorateNodes(project).map((node) => ({
      ...node,
      selected: selectedNodeIds.has(node.id),
    }));
    const nextEdges = decorateEdges(project).map((edge) => ({
      ...edge,
      selected: selectedEdgeIds.has(edge.id),
    }));
    setNodes(nextNodes);
    setEdges(nextEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.meta?.id, project.nodes, project.edges, project.assets]);

  const applyProject = useCallback(
    (nextProject, selectedNodeId = null, selectedEdgeId = null) => {
      if (!nextProject) return;
      actions.replaceProject(nextProject);
      setNodes(decorateNodes(nextProject, selectedNodeId));
      setEdges(decorateEdges(nextProject, selectedEdgeId));
      reportSelection({ nodeId: selectedNodeId, edgeId: selectedEdgeId });
    },
    [actions, decorateEdges, decorateNodes, reportSelection],
  );

  const commitDropResult = useCallback(
    (result) => {
      if (!result) return;
      if (result.error) {
        notify(result.error, 'error');
        return;
      }
      if (result.needsSpriteOptions) return;
      applyProject(result.project, result.selectedNodeId ?? null, null);
      if (result.selectedNodeId) {
        const node = result.project.nodes.find((item) => item.id === result.selectedNodeId);
        if (node) notify(`已创建/更新「${node.name}」`, 'success');
      }
    },
    [applyProject, notify],
  );

  const handleNodeAssetDrop = useCallback(
    (nodeId, payload) => {
      const asset = findAsset(project, payload?.assetId);
      if (!asset) {
        notify('找不到被拖拽的素材，请刷新后重试', 'error');
        return;
      }
      const result = applyAssetDrop(project, { asset, targetNodeId: nodeId });
      if (result.needsSpriteOptions) {
        setSpriteRequest({ asset, targetNodeId: nodeId, flowPosition: null });
        return;
      }
      commitDropResult(result);
    },
    [commitDropResult, notify, project],
  );
  nodeDropRef.current = handleNodeAssetDrop;

  const handlePaneDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handlePaneDrop = useCallback(
    (event) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/x-vn-asset');
      if (!raw) return;
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        notify('无法识别的拖拽数据', 'error');
        return;
      }
      const asset = findAsset(project, payload.assetId);
      if (!asset) {
        notify('找不到被拖拽的素材', 'error');
        return;
      }
      const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const result = applyAssetDrop(project, { asset, flowPosition });
      if (result.needsSpriteOptions) {
        setSpriteRequest({ asset, targetNodeId: null, flowPosition });
        return;
      }
      commitDropResult(result);
    },
    [commitDropResult, notify, project, screenToFlowPosition],
  );

  const openMenu = useCallback((clientX, clientY, flowPosition, pendingConnection = null) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 276;
    const menuHeight = pendingConnection ? 300 : 278;
    const position = clampMenuPosition(
      Math.min(clientX - rect.left, rect.width - menuWidth),
      Math.min(clientY - rect.top, rect.height - menuHeight),
    );
    setMenu({ ...position, flowPosition, pendingConnection });
  }, []);

  const handleDoubleClick = useCallback(
    (event) => {
      const nodeElement = event.target.closest?.('.vn-bp-node');
      if (nodeElement?.dataset?.nodeId) {
        onNodeDoubleClick?.(nodeElement.dataset.nodeId);
        return;
      }
      if (!event.target.closest?.('.react-flow__pane')) return;
      const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      openMenu(event.clientX, event.clientY, flowPosition, null);
    },
    [onNodeDoubleClick, openMenu, screenToFlowPosition],
  );

  const handleConnectEnd = useCallback(
    (event, state) => {
      if (!state || !state.fromNode || !state.fromHandle || state.toNode) return;
      if (event.type !== 'mouseup' && event.type !== 'touchend') return;
      const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : { x: 0, y: 0 };
      const flowPosition = screenToFlowPosition(point);
      openMenu(point.x, point.y, flowPosition, {
        fromNodeId: state.fromNode.id,
        port: state.fromHandle.id,
      });
    },
    [openMenu, screenToFlowPosition],
  );

  const handleMenuPick = useCallback(
    (type) => {
      if (!menu) return;
      const draft = createNodeDraft(project, type, { position: menu.flowPosition });
      if (draft.error) {
        notify(draft.error, 'error');
        return;
      }
      let nextProject = addNodeToProject(project, draft.node);
      let newEdge = null;
      if (menu.pendingConnection) {
        const { fromNodeId, port } = menu.pendingConnection;
        const sourceNode = project.nodes.find((node) => node.id === fromNodeId);
        const exitExists = sourceNode?.exits.some((exit) => exit.id === port);
        if (sourceNode && exitExists) {
          newEdge = {
            id: makeEdgeId(project),
            from: fromNodeId,
            port,
            to: draft.node.id,
            kind: edgeKindForNode(sourceNode),
          };
          nextProject = addEdgeToProject(nextProject, newEdge);
        }
      }
      applyProject(nextProject, draft.node.id, newEdge?.id ?? null);
      setMenu(null);
      notify(`已创建${NODE_TYPE_META[type]?.label ?? type}节点`, 'success');
    },
    [applyProject, menu, notify, project],
  );

  const handleConnect = useCallback(
    (connection) => {
      const { source, sourceHandle, target } = connection;
      if (!source || !sourceHandle || !target) return;
      const sourceNode = project.nodes.find((node) => node.id === source);
      if (!sourceNode) return;
      const existing = project.edges.find(
        (edge) => edge.from === source && edge.port === sourceHandle,
      );
      if (existing && existing.kind !== 'data') {
        const confirmed = window.confirm(
          `出口「${sourceHandle}」已有一条连线，是否替换为目标节点？`,
        );
        if (!confirmed) return;
      }
      let nextProject = existing ? removeEdgeFromProject(project, existing.id) : project;
      const edge = {
        id: makeEdgeId(nextProject),
        from: source,
        port: sourceHandle,
        to: target,
        kind: edgeKindForNode(sourceNode),
      };
      nextProject = addEdgeToProject(nextProject, edge);
      applyProject(nextProject, null, edge.id);
    },
    [applyProject, project],
  );

  const handleNodeDragStop = useCallback(
    (_event, _node, draggedNodes) => {
      const list = Array.isArray(draggedNodes) && draggedNodes.length > 0 ? draggedNodes : [];
      const patches = list.map((node) => ({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
      }));
      if (patches.length === 0) return;
      const nextProject = setNodePositionsInProject(project, patches);
      if (nextProject !== project) actions.replaceProject(nextProject);
    },
    [actions, project],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }) => {
      const nodeId = selectedNodes?.[0]?.id ?? null;
      const edgeId = selectedEdges?.[0]?.id ?? null;
      reportSelection({ nodeId, edgeId });
    },
    [reportSelection],
  );

  const handleMoveEnd = useCallback(
    (_event, viewport) => {
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
      viewportTimerRef.current = setTimeout(() => {
        actions.updateEditor({ viewport });
      }, 600);
    },
    [actions],
  );

  const deleteSelection = useCallback(() => {
    if (selection.edgeId) {
      const next = removeEdgeFromProject(project, selection.edgeId);
      applyProject(next, null, null);
      return;
    }
    if (selection.nodeId) {
      if (project.nodes.length <= 1) {
        notify('项目至少需要保留一个节点', 'warn');
        return;
      }
      const node = project.nodes.find((item) => item.id === selection.nodeId);
      const next = removeNodeFromProject(project, selection.nodeId);
      applyProject(next, null, null);
      notify(`已删除节点「${node?.name ?? selection.nodeId}」`, 'success');
    }
  }, [applyProject, notify, project, selection]);

  const selectAll = useCallback(() => {
    setNodes((previous) => previous.map((node) => ({ ...node, selected: true })));
    setEdges((previous) => previous.map((edge) => ({ ...edge, selected: false })));
    reportSelection({ nodeId: nodes[0]?.id ?? null, edgeId: null });
  }, [nodes, reportSelection]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const active = document.activeElement;
      const tag = active?.tagName;
      const editing =
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || active?.isContentEditable === true;
      if (editing) return;
      // 焦点在时间轴 / 属性面板 / 素材面板时，把 Delete、F 等让给对应面板。
      if (active?.closest?.('.vn-tl, .vn-inspector, .vn-asset-panel')) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selection.nodeId && !selection.edgeId) return;
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        fitView({ padding: 0.25, maxZoom: 1.2 });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelection, fitView, selectAll, selection]);

  useEffect(
    () => () => {
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
    },
    [],
  );

  const handleCreateFromToolbar = useCallback(() => {
    const position = nextDefaultPosition(project);
    openMenu(
      (wrapperRef.current?.getBoundingClientRect().left ?? 0) + 320,
      (wrapperRef.current?.getBoundingClientRect().top ?? 0) + 120,
      position,
      null,
    );
  }, [openMenu, project]);

  const minimapColor = (node) => NODE_TYPE_META[node.data?.node?.type]?.color ?? '#9aa8b5';

  return (
    <div className="vn-bp" ref={wrapperRef}>
      <div className="vn-bp__toolbar">
        <button type="button" className="vn-btn" onClick={handleCreateFromToolbar}>
          + 创建节点
        </button>
        <button
          type="button"
          className="vn-btn vn-btn--ghost"
          onClick={() => fitView({ padding: 0.25, maxZoom: 1.2 })}
          title="F 适应全部"
        >
          适应视图
        </button>
        <span className="vn-bp__meta">
          {project.nodes.length} 节点 · {project.edges.length} 连线
        </span>
        <span className="vn-bp__hint">
          双击空白创建节点 · 从右侧端口拖出连线 · 中键/Space 平移 · Ctrl+滚轮缩放 · F 适应
        </span>
      </div>

      <div className="vn-bp__canvas" onDoubleClickCapture={handleDoubleClick}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onConnectEnd={handleConnectEnd}
          onNodeDragStop={handleNodeDragStop}
          onNodeDoubleClick={(event, flowNode) => {
            const sourceNode = project.nodes.find((item) => item.id === flowNode.id);
            if (sourceNode?.type === 'scene') onNodeDoubleClick?.(flowNode.id);
          }}
          onSelectionChange={handleSelectionChange}
          onMoveEnd={handleMoveEnd}
          onDrop={handlePaneDrop}
          onDragOver={handlePaneDragOver}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
          minZoom={0.2}
          maxZoom={2}
          panOnDrag={[1, 2]}
          selectionOnDrag
          panActivationKeyCode="Space"
          zoomOnScroll
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          connectionLineStyle={{ stroke: '#5aa9ff', strokeWidth: 2 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#2c3640" />
          <MiniMap
            nodeColor={minimapColor}
            pannable
            zoomable
            maskColor="rgba(9, 12, 16, 0.55)"
            style={{ background: '#161b21' }}
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {menu ? (
        <NodeCreateMenu
          open
          x={menu.x}
          y={menu.y}
          project={project}
          pendingConnection={menu.pendingConnection}
          onPick={handleMenuPick}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {spriteRequest ? (
        <SpritePositionModal
          open
          asset={spriteRequest.asset}
          project={project}
          onCancel={() => setSpriteRequest(null)}
          onConfirm={(spriteOptions) => {
            const result = applyAssetDrop(project, {
              asset: spriteRequest.asset,
              targetNodeId: spriteRequest.targetNodeId,
              flowPosition: spriteRequest.flowPosition ?? { x: 0, y: 0 },
              spriteOptions,
            });
            setSpriteRequest(null);
            commitDropResult(result);
          }}
        />
      ) : null}
    </div>
  );
}

export default function BlueprintEditor({ onSelectionChange, onNodeDoubleClick }) {
  return (
    <ReactFlowProvider>
      <InnerBlueprint onSelectionChange={onSelectionChange} onNodeDoubleClick={onNodeDoubleClick} />
    </ReactFlowProvider>
  );
}
