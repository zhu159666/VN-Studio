import { useEffect, useMemo, useRef, useState } from 'react';

import { assetsApi } from '../../api';
import { useProjectController } from '../../state/ProjectContext';
import '../../styles/scene-stage-editor.css';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function SceneStageEditor({ nodeId, onClose }) {
  const { project, projectDir, actions } = useProjectController();
  const node = project.nodes.find((item) => item.id === nodeId) || null;
  const [urls, setUrls] = useState({});
  const [selected, setSelected] = useState({ kind: 'background', id: 'background' });
  const stageRef = useRef(null);
  const dragRef = useRef(null);

  const assetIds = useMemo(() => {
    const ids = new Set();
    if (node?.background?.assetId) ids.add(node.background.assetId);
    if (node?.foreground?.assetId) ids.add(node.foreground.assetId);
    for (const item of node?.sprites ?? []) if (item.assetId) ids.add(item.assetId);
    for (const item of node?.uiImages ?? []) if (item.assetId) ids.add(item.assetId);
    return [...ids];
  }, [node]);

  useEffect(() => {
    let cancelled = false;
    const next = {};
    Promise.all(
      assetIds.map(async (id) => {
        const asset = project.assets.images.find((item) => item.id === id);
        if (!asset) return;
        try {
          const result = await assetsApi.assetUrl({ projectDir, relativePath: asset.path });
          if (result?.url) next[id] = result.url;
        } catch {
          /* 忽略单张素材加载失败 */
        }
      }),
    ).then(() => {
      if (!cancelled) setUrls(next);
    });
    return () => {
      cancelled = true;
    };
  }, [assetIds, project.assets.images, projectDir]);

  if (!node || node.type !== 'scene') {
    return (
      <div className="vn-stage-editor">
        <div className="vn-stage-editor__empty">该节点不是普通场景节点。</div>
        <button type="button" className="vn-btn" onClick={onClose}>关闭</button>
      </div>
    );
  }

  const updateSprites = (nextSprites) => actions.updateNode(node.id, { sprites: nextSprites });
  const updateUi = (nextImages) => actions.updateNode(node.id, { uiImages: nextImages });

  const selectedLayer = (() => {
    if (selected.kind === 'background') return node.background;
    if (selected.kind === 'foreground') return node.foreground;
    if (selected.kind === 'sprite') return (node.sprites || []).find((item) => item.id === selected.id);
    if (selected.kind === 'ui') return (node.uiImages || []).find((item) => item.id === selected.id);
    return null;
  })();

  const patchSelected = (patch) => {
    if (selected.kind === 'background' && node.background) {
      actions.updateNode(node.id, { background: { ...node.background, ...patch } });
    } else if (selected.kind === 'foreground' && node.foreground) {
      actions.updateNode(node.id, { foreground: { ...node.foreground, ...patch } });
    } else if (selected.kind === 'sprite') {
      updateSprites((node.sprites || []).map((item) => (item.id === selected.id ? { ...item, ...patch } : item)));
    } else if (selected.kind === 'ui') {
      updateUi((node.uiImages || []).map((item) => (item.id === selected.id ? { ...item, ...patch } : item)));
    }
  };

  const startDrag = (event, kind, id) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    setSelected({ kind, id });
    const layer = kind === 'sprite'
      ? (node.sprites || []).find((item) => item.id === id)
      : (node.uiImages || []).find((item) => item.id === id);
    if (!layer) return;
    dragRef.current = {
      pointerId: event.pointerId,
      kind,
      id,
      startX: event.clientX,
      startY: event.clientY,
      originX: layer.x ?? 0.5,
      originY: layer.y ?? 0.6,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = clamp(drag.originX + (event.clientX - drag.startX) / Math.max(1, bounds.width), 0, 1);
    const y = clamp(drag.originY + (event.clientY - drag.startY) / Math.max(1, bounds.height), 0, 1);
    if (drag.kind === 'sprite') {
      updateSprites((node.sprites || []).map((item) => (item.id === drag.id ? { ...item, x, y } : item)));
    } else {
      updateUi((node.uiImages || []).map((item) => (item.id === drag.id ? { ...item, x, y } : item)));
    }
  };

  const endDrag = (event) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const layerButton = (kind, id, label) => (
    <button
      key={`${kind}:${id}`}
      type="button"
      className={`vn-stage-layer${selected.kind === kind && selected.id === id ? ' is-active' : ''}`}
      onClick={() => setSelected({ kind, id })}
    >
      <span>{label}</span>
      <small>{kind === 'background' ? '背景' : kind === 'foreground' ? '前景' : kind === 'ui' ? 'UI' : '立绘'}</small>
    </button>
  );

  return (
    <div className="vn-stage-editor">
      <div className="vn-stage-editor__head">
        <div>
          <strong>{node.name}</strong>
          <span>Unity 式场景画布 · 拖动立绘/UI 直接改位置</span>
        </div>
        <button type="button" className="vn-btn" onClick={onClose}>返回蓝图</button>
      </div>

      <div className="vn-stage-editor__body">
        <aside className="vn-stage-editor__layers">
          <div className="vn-stage-editor__layers-title">图层</div>
          {node.background ? layerButton('background', 'background', '背景') : null}
          {(node.sprites || []).map((item) => layerButton('sprite', item.id, `立绘 · ${item.id}`))}
          {(node.uiImages || []).map((item) => layerButton('ui', item.id, `UI · ${item.id}`))}
          {node.foreground ? layerButton('foreground', 'foreground', '前景层') : null}
          {node.particles ? (
            <button type="button" className="vn-stage-layer" onClick={() => setSelected({ kind: 'particles', id: 'particles' })}>
              <span>粒子层</span>
              <small>{node.particles.preset}</small>
            </button>
          ) : null}
          <div className="vn-stage-editor__quick">
            {selectedLayer && selected.kind !== 'particles' ? (
              <>
                <label>
                  x
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={Number(selectedLayer.x ?? 0.5)}
                    onChange={(event) => patchSelected({ x: Number(event.target.value) })}
                  />
                </label>
                <label>
                  y
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={Number(selectedLayer.y ?? 0.5)}
                    onChange={(event) => patchSelected({ y: Number(event.target.value) })}
                  />
                </label>
                <label>
                  缩放
                  <input
                    type="number"
                    min="0.05"
                    max="5"
                    step="0.01"
                    value={Number(selectedLayer.scale ?? 1)}
                    onChange={(event) => patchSelected({ scale: Number(event.target.value) })}
                  />
                </label>
                <label>
                  透明度
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={Number(selectedLayer.opacity ?? 1)}
                    onChange={(event) => patchSelected({ opacity: Number(event.target.value) })}
                  />
                </label>
              </>
            ) : null}
          </div>
        </aside>

        <div className="vn-stage-editor__stage-wrap">
          <div
            className="vn-stage-editor__stage"
            ref={stageRef}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {node.background?.assetId && urls[node.background.assetId] ? (
              <img
                className="vn-stage-layer-img vn-stage-layer-img--background"
                src={urls[node.background.assetId]}
                alt="背景"
              />
            ) : (
              <div className="vn-stage-editor__placeholder">未设置背景</div>
            )}
            {(node.sprites || []).map((item) => (
              <img
                key={item.id}
                className={`vn-stage-layer-img vn-stage-layer-img--sprite${selected.kind === 'sprite' && selected.id === item.id ? ' is-selected' : ''}`}
                src={urls[item.assetId] || ''}
                alt={item.id}
                draggable={false}
                style={{
                  left: `${(item.x ?? 0.5) * 100}%`,
                  top: `${(item.y ?? 0.6) * 100}%`,
                  transform: `translate(-50%, -50%) scale(${item.scale ?? 1})`,
                  opacity: item.opacity ?? 1,
                  zIndex: item.zIndex ?? 10,
                }}
                onPointerDown={(event) => startDrag(event, 'sprite', item.id)}
              />
            ))}
            {(node.uiImages || []).map((item) => (
              <img
                key={item.id}
                className={`vn-stage-layer-img vn-stage-layer-img--ui${selected.kind === 'ui' && selected.id === item.id ? ' is-selected' : ''}`}
                src={urls[item.assetId] || ''}
                alt={item.id}
                draggable={false}
                style={{
                  left: `${(item.x ?? 0.5) * 100}%`,
                  top: `${(item.y ?? 0.5) * 100}%`,
                  transform: `translate(-50%, -50%) scale(${item.scale ?? 1})`,
                  opacity: item.opacity ?? 1,
                  zIndex: item.zIndex ?? 20,
                }}
                onPointerDown={(event) => startDrag(event, 'ui', item.id)}
              />
            ))}
            {node.foreground?.assetId && urls[node.foreground.assetId] ? (
              <img
                className="vn-stage-layer-img vn-stage-layer-img--foreground"
                src={urls[node.foreground.assetId]}
                alt="前景"
                style={{ opacity: node.foreground.opacity ?? 1 }}
              />
            ) : null}
            {node.particles && node.particles.preset !== 'none' ? (
              <div className="vn-stage-editor__particle-tag">粒子：{node.particles.preset}</div>
            ) : null}
            <div className="vn-stage-editor__hint">拖动立绘 / UI 图层调整位置；其他属性在左侧面板</div>
          </div>
          {selected.kind === 'particles' ? (
            <div className="vn-stage-editor__notice">粒子层参数在左侧 B4 · 粒子层 编辑。</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
