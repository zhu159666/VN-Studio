import { Handle, Position } from '@xyflow/react';

import { NODE_TYPE_META } from './blueprintUtils';

export default function BlueprintNode({ data, selected }) {
  const { node, meta = NODE_TYPE_META[node.type], summary = [], ports = [], width = 236 } = data;
  const typeMeta = meta ?? { label: node.type, short: '?', color: '#9aa8b5' };

  const handleDragOver = (event) => {
    if (!data.onAssetDrop) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (event) => {
    if (!data.onAssetDrop) return;
    event.preventDefault();
    event.stopPropagation();
    const raw = event.dataTransfer.getData('application/x-vn-asset');
    if (!raw) return;
    try {
      data.onAssetDrop(node.id, JSON.parse(raw));
    } catch (error) {
      console.warn('[blueprint] 无法解析拖拽素材', error);
    }
  };

  return (
    <div
      className={`vn-bp-node vn-bp-node--${node.type}${selected ? ' is-selected' : ''}`}
      style={{ width }}
      data-node-type={node.type}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      title={`${typeMeta.label}节点 · ${node.id}`}
    >
      <Handle type="target" position={Position.Left} id="in" className="vn-bp-handle vn-bp-handle--target" />
      <header className="vn-bp-node__head">
        <span className="vn-bp-node__badge" style={{ background: `${typeMeta.color}22`, color: typeMeta.color }}>
          {typeMeta.short}
        </span>
        <span className="vn-bp-node__titles">
          <span className="vn-bp-node__name">{node.name}</span>
          <span className="vn-bp-node__type">
            {typeMeta.label} <span className="vn-bp-node__id">{node.id}</span>
          </span>
        </span>
      </header>

      {summary.length > 0 ? (
        <div className="vn-bp-node__body">
          {summary.slice(0, 3).map((line, index) => (
            <div className="vn-bp-node__line" key={`${index}-${line}`}>
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {ports.length > 0 ? (
        <div className="vn-bp-node__ports" aria-label="出口">
          {ports.map((port) => (
            <div className="vn-bp-node__port" key={port.id}>
              <span className="vn-bp-node__port-dot" />
              <span className="vn-bp-node__port-name">{port.label ?? port.name}</span>
              <span className="vn-bp-node__port-id">{port.id}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                className="vn-bp-handle vn-bp-handle--source"
                title={`出口 ${port.id}`}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="vn-bp-node__ports vn-bp-node__ports--empty">无出口（跳转）</div>
      )}
    </div>
  );
}
