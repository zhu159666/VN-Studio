import { useEffect, useRef } from 'react';

import { CREATE_NODE_TYPE_ORDER, NODE_TYPE_META } from './blueprintUtils';

export default function NodeCreateMenu({ open, x, y, project, pendingConnection, onPick, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const hasVideos = (project.assets?.videos ?? []).length > 0;
  const hasMinigames = (project.assets?.minigames ?? []).length > 0;

  return (
    <div
      ref={ref}
      className="vn-bp-node-menu"
      style={{ left: x, top: y }}
      role="menu"
      aria-label="创建节点"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="vn-bp-node-menu__title">创建节点</div>
      {pendingConnection ? (
        <div className="vn-bp-node-menu__hint">将自动连接出口 {pendingConnection.port}</div>
      ) : null}
      <div className="vn-bp-node-menu__grid">
        {CREATE_NODE_TYPE_ORDER.map((type) => {
          const meta = NODE_TYPE_META[type];
          const disabled = (type === 'video' && !hasVideos) || (type === 'minigame' && !hasMinigames);
          return (
            <button
              key={type}
              type="button"
              className="vn-bp-node-menu__item"
              disabled={disabled}
              title={disabled ? '请先导入对应素材' : `创建${meta.label}节点`}
              onClick={() => onPick(type)}
            >
              <span
                className="vn-bp-node-menu__badge"
                style={{ background: `${meta.color}22`, color: meta.color }}
              >
                {meta.short}
              </span>
              <span className="vn-bp-node-menu__label">{meta.label}</span>
            </button>
          );
        })}
      </div>
      <div className="vn-bp-node-menu__footer">双击空白 / 从出口拖到空白处都会打开此菜单</div>
    </div>
  );
}
