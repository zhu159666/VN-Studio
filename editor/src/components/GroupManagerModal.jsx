import { useMemo, useState } from 'react';

import { useProjectController } from '../state/ProjectContext';
import '../styles/group-manager.css';

function nextGroupId(groups) {
  let index = groups.length + 1;
  while (groups.some((group) => group.id === `grp_${index}`)) index += 1;
  return `grp_${index}`;
}

export default function GroupManagerModal({ selectedAssetId, selectedNodeId, onClose }) {
  const { project, actions } = useProjectController();
  const groups = useMemo(() => (Array.isArray(project.editor?.groups) ? project.editor.groups : []), [project.editor?.groups]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('asset');
  const [activeId, setActiveId] = useState(groups[0]?.id ?? null);

  const writeGroups = (next) => actions.updateEditor({ groups: next });
  const createGroup = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = [...groups, { id: nextGroupId(groups), name: trimmed, kind, itemIds: [] }];
    writeGroups(next);
    setActiveId(next[next.length - 1].id);
    setName('');
  };
  const removeGroup = (id) => {
    writeGroups(groups.filter((group) => group.id !== id));
    if (activeId === id) setActiveId(groups.find((group) => group.id !== id)?.id ?? null);
  };
  const active = groups.find((group) => group.id === activeId) ?? null;
  const addItem = (itemId) => {
    if (!active || !itemId) return;
    if (active.itemIds.includes(itemId)) return;
    writeGroups(groups.map((group) => (group.id === active.id ? { ...group, itemIds: [...group.itemIds, itemId] } : group)));
  };
  const removeItem = (itemId) => {
    if (!active) return;
    writeGroups(groups.map((group) => (group.id === active.id ? { ...group, itemIds: group.itemIds.filter((id) => id !== itemId) } : group)));
  };

  const nodeName = selectedNodeId ? project.nodes.find((node) => node.id === selectedNodeId)?.name ?? selectedNodeId : null;
  const assetName = selectedAssetId ? project.assets.images.find((asset) => asset.id === selectedAssetId)?.name ?? selectedAssetId : null;

  return (
    <div className="vn-group-manager">
      <div className="vn-group-manager__panel">
        <header className="vn-group-manager__head">
          <strong>素材 / 节点分组</strong>
          <button type="button" className="vn-btn" onClick={onClose}>关闭</button>
        </header>

        <div className="vn-group-manager__body">
          <aside className="vn-group-manager__list">
            <div className="vn-group-manager__create">
              <input value={name} placeholder="新分组名称" onChange={(event) => setName(event.target.value)} />
              <select value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="asset">素材</option>
                <option value="node">节点</option>
              </select>
              <button type="button" className="vn-btn" onClick={createGroup}>新建</button>
            </div>
            {groups.length === 0 ? <p className="vn-group-manager__empty">还没有分组。</p> : null}
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={`vn-group-manager__group${activeId === group.id ? ' is-active' : ''}`}
                onClick={() => setActiveId(group.id)}
              >
                <span>{group.name}</span>
                <small>{group.kind === 'node' ? '节点' : '素材'} · {group.itemIds.length}</small>
              </button>
            ))}
          </aside>

          <main className="vn-group-manager__detail">
            {active ? (
              <>
                <div className="vn-group-manager__title">
                  <div>
                    <strong>{active.name}</strong>
                    <span>{active.kind === 'node' ? '节点分组' : '素材分组'}</span>
                  </div>
                  <button type="button" className="vn-btn" onClick={() => removeGroup(active.id)}>删除分组</button>
                </div>
                <div className="vn-group-manager__add">
                  <button
                    type="button"
                    className="vn-btn"
                    disabled={!selectedAssetId}
                    onClick={() => addItem(selectedAssetId)}
                  >
                    加入当前选中素材{assetName ? `：${assetName}` : ''}
                  </button>
                  <button
                    type="button"
                    className="vn-btn"
                    disabled={!selectedNodeId}
                    onClick={() => addItem(selectedNodeId)}
                  >
                    加入当前选中节点{nodeName ? `：${nodeName}` : ''}
                  </button>
                </div>
                <div className="vn-group-manager__items">
                  {active.itemIds.length === 0 ? <p className="vn-group-manager__empty">空分组。先在左侧选中素材或蓝图节点，再加入。</p> : null}
                  {active.itemIds.map((itemId) => {
                    const node = project.nodes.find((item) => item.id === itemId);
                    const image = project.assets.images.find((item) => item.id === itemId);
                    return (
                      <div className="vn-group-manager__item" key={itemId}>
                        <span>{node?.name || image?.name || itemId}</span>
                        <small>{node ? '节点' : '素材'}</small>
                        <button type="button" className="vn-btn" onClick={() => removeItem(itemId)}>移出</button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="vn-group-manager__empty">选择或创建一个分组。</p>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
