/**
 * LeftBottomPanels —— 左栏下方面板（阶段二）
 *
 * 三个互斥面板：
 *  - variables     变量表：增删改、六种类型、JSON 草稿校验
 *  - structure     项目结构：按 8 类节点分组折叠（只读总览；节点/连线编辑在蓝图完成）
 *  - minigameExits 小游戏出口：declaredExits 与使用它的 minigame 节点
 *
 * 本组件不直接调 IPC；变量修改通过 onVariablesChange(完整 variables 对象) 上抛。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/assets.css';

const PANEL_TABS = [
  { key: 'variables', label: '变量表' },
  { key: 'structure', label: '项目结构' },
  { key: 'minigameExits', label: '小游戏出口' },
];

/** 8 类节点，顺序与蓝图一致 */
const NODE_GROUPS = [
  { type: 'dialogue', label: '对话' },
  { type: 'scene', label: '场景' },
  { type: 'choice', label: '选项' },
  { type: 'minigame', label: '小游戏' },
  { type: 'video', label: '视频' },
  { type: 'jump', label: '跳转' },
  { type: 'condition', label: '条件' },
  { type: 'variable', label: '变量操作' },
];

const VARIABLE_TYPES = ['number', 'string', 'boolean', 'array', 'object', 'null'];

const TYPE_LABELS = {
  number: '数字',
  string: '文本',
  boolean: '布尔',
  array: '数组',
  object: '对象',
  null: '空值',
};

/** 保留变量：运行时写入小游戏结果，类型固定 string，不可删除 */
const RESERVED_VARIABLE = 'last_minigame_result';

const VARIABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** 小游戏出口 chip 的配色循环 */
const CHIP_COLORS = ['#5aa9ff', '#7be0c0', '#ffc857', '#ff9f6b', '#c792ea', '#ff6b9d'];

function chipStyle(index) {
  const color = CHIP_COLORS[index % CHIP_COLORS.length];
  return {
    color,
    borderColor: `${color}66`,
    background: `${color}1a`,
  };
}

/* ───────────── inline SVG 小图标 ───────────── */

const strokeProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

function IconLock() {
  return (
    <svg {...strokeProps} width="13" height="13">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg {...strokeProps} width="13" height="13">
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

/* ───────────── 变量草稿 ⇄ variables 对象 ───────────── */

/** 把任意值转成某类型的文本草稿 */
function convertDraftValue(nextType, current) {
  switch (nextType) {
    case 'number': {
      const num = Number(current);
      return { text: Number.isFinite(num) ? String(num) : '0', bool: false };
    }
    case 'string':
      if (typeof current === 'string') return { text: current, bool: false };
      if (current === null || current === undefined) return { text: '', bool: false };
      if (typeof current === 'object') return { text: JSON.stringify(current), bool: false };
      return { text: String(current), bool: false };
    case 'boolean':
      return { text: '', bool: current === true };
    case 'array':
      return { text: JSON.stringify(Array.isArray(current) ? current : []), bool: false };
    case 'object':
      return {
        text: JSON.stringify(current && typeof current === 'object' && !Array.isArray(current) ? current : {}),
        bool: false,
      };
    case 'null':
    default:
      return { text: '', bool: false };
  }
}

/** project.variables → 行草稿 */
function toRows(variables) {
  const source = variables && typeof variables === 'object' ? variables : {};
  return Object.entries(source).map(([key, definition]) => {
    const type = VARIABLE_TYPES.includes(definition?.type) ? definition.type : 'string';
    const value = definition?.value;
    const { text, bool } = convertDraftValue(type, value);
    return {
      key,
      nameDraft: key,
      type,
      text,
      bool,
      nameError: false,
      valueError: false,
    };
  });
}

/** 单行草稿 → 带类型标签的值（供 schema typedValue） */
function rowValue(row) {
  switch (row.type) {
    case 'number': {
      const num = Number(row.text);
      return Number.isFinite(num) ? num : 0;
    }
    case 'string':
      return row.text;
    case 'boolean':
      return row.bool === true;
    case 'array':
      try {
        const parsed = JSON.parse(row.text);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    case 'object':
      try {
        const parsed = JSON.parse(row.text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    case 'null':
      return null;
    default:
      return null;
  }
}

/** 行草稿 → 完整 variables 对象 */
function buildVariables(rows) {
  const next = {};
  for (const row of rows) {
    next[row.key] = { type: row.type, value: rowValue(row) };
  }
  return next;
}

/* ───────────── 变量表 ───────────── */

function VariablesPanel({ project, onVariablesChange, notify }) {
  const variables = project?.variables && typeof project.variables === 'object' ? project.variables : {};
  const signature = useMemo(() => {
    try {
      return JSON.stringify(variables);
    } catch {
      return '{}';
    }
  }, [variables]);

  const [rows, setRows] = useState(() => toRows(variables));
  // 记录自己刚上抛的序列化结果，避免 props 回声把未提交的草稿冲掉
  const lastCommittedRef = useRef(null);

  // 外部 variables 变化时重置草稿（保留变量定义顺序）
  useEffect(() => {
    if (lastCommittedRef.current === signature) {
      lastCommittedRef.current = null;
      return;
    }
    setRows(toRows(variables));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const commitRows = useCallback(
    (nextRows) => {
      setRows(nextRows);
      const nextVariables = buildVariables(nextRows);
      let serialized;
      try {
        serialized = JSON.stringify(nextVariables);
      } catch {
        notify?.('变量无法序列化为 JSON', 'error');
        return;
      }
      if (serialized === signature) return; // 没有实际变化，不弄脏项目
      lastCommittedRef.current = serialized;
      try {
        onVariablesChange?.(nextVariables);
      } catch (err) {
        notify?.(err?.message || '更新变量失败', 'error');
      }
    },
    [signature, onVariablesChange, notify],
  );

  const updateRow = useCallback((index, patch) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const revertDrafts = useCallback(() => {
    setRows(toRows(variables));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  /** 变量名提交：失焦 / Enter */
  const handleNameCommit = useCallback(
    (index) => {
      const row = rows[index];
      if (!row) return;
      if (row.key === RESERVED_VARIABLE) {
        updateRow(index, { nameDraft: row.key, nameError: false });
        return;
      }
      const name = row.nameDraft.trim();
      if (!VARIABLE_NAME_RE.test(name) || rows.some((item, i) => i !== index && item.key === name)) {
        updateRow(index, { nameError: true });
        return;
      }
      if (name === row.key) {
        updateRow(index, { nameDraft: name, nameError: false });
        return;
      }
      commitRows(
        rows.map((item, i) => (i === index ? { ...item, key: name, nameDraft: name, nameError: false } : item)),
      );
    },
    [rows, commitRows, updateRow],
  );

  /** 类型切换：值按新类型转换 */
  const handleTypeChange = useCallback(
    (index, nextType) => {
      const row = rows[index];
      if (!row || row.type === nextType) return;
      if (row.key === RESERVED_VARIABLE) {
        notify?.('last_minigame_result 的类型固定为文本，不可修改', 'warn');
        return;
      }
      const converted = convertDraftValue(nextType, rowValue(row));
      commitRows(
        rows.map((item, i) =>
          i === index ? { ...item, ...converted, type: nextType, valueError: false } : item,
        ),
      );
    },
    [rows, commitRows, notify],
  );

  /** 文本 / 数字值提交 */
  const handleValueCommit = useCallback(
    (index) => {
      const row = rows[index];
      if (!row) return;
      if (row.type === 'number') {
        const raw = String(row.text).trim();
        const num = Number(raw);
        if (raw === '' || !Number.isFinite(num)) {
          updateRow(index, { valueError: true });
          return;
        }
        commitRows(rows.map((item, i) => (i === index ? { ...item, text: String(num), valueError: false } : item)));
        return;
      }
      if (row.type === 'string') {
        commitRows(rows.map((item, i) => (i === index ? { ...item, valueError: false } : item)));
      }
    },
    [rows, commitRows, updateRow],
  );

  /** 数组 / 对象 JSON 校验并提交 */
  const handleJsonCommit = useCallback(
    (index) => {
      const row = rows[index];
      if (!row) return;
      const fallback = row.type === 'array' ? '[]' : '{}';
      const raw = String(row.text).trim() || fallback;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        updateRow(index, { valueError: true });
        return;
      }
      if (row.type === 'array' && !Array.isArray(parsed)) {
        updateRow(index, { valueError: true });
        return;
      }
      if (row.type === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
        updateRow(index, { valueError: true });
        return;
      }
      commitRows(rows.map((item, i) => (i === index ? { ...item, text: JSON.stringify(parsed), valueError: false } : item)));
    },
    [rows, commitRows, updateRow],
  );

  const handleAddVariable = useCallback(() => {
    const existing = new Set(rows.map((row) => row.key));
    let name = 'new_var';
    let suffix = 2;
    while (existing.has(name)) {
      name = `new_var_${suffix}`;
      suffix += 1;
    }
    commitRows([
      ...rows,
      {
        key: name,
        nameDraft: name,
        type: 'number',
        text: '0',
        bool: false,
        nameError: false,
        valueError: false,
      },
    ]);
  }, [rows, commitRows]);

  const handleDelete = useCallback(
    (index) => {
      const row = rows[index];
      if (!row) return;
      if (row.key === RESERVED_VARIABLE) {
        notify?.('last_minigame_result 是运行时保留变量，不能删除', 'warn');
        return;
      }
      commitRows(rows.filter((_, i) => i !== index));
    },
    [rows, commitRows, notify],
  );

  /** 值控件：随类型切换 */
  const renderValueControl = (row, index) => {
    if (row.key === RESERVED_VARIABLE) {
      return (
        <span className="vn-panel-value-readonly" title="运行时写入小游戏结果">
          运行时写入
        </span>
      );
    }
    switch (row.type) {
      case 'number':
        return (
          <input
            className={`vn-panel-input vn-panel-input--num${row.valueError ? ' is-invalid' : ''}`}
            type="number"
            value={row.text}
            aria-label={`变量 ${row.key} 的值`}
            aria-invalid={row.valueError || undefined}
            onChange={(event) => updateRow(index, { text: event.target.value, valueError: false })}
            onBlur={() => handleValueCommit(index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleValueCommit(index);
              } else if (event.key === 'Escape') {
                revertDrafts();
              }
            }}
          />
        );
      case 'string':
        return (
          <input
            className={`vn-panel-input${row.valueError ? ' is-invalid' : ''}`}
            type="text"
            value={row.text}
            aria-label={`变量 ${row.key} 的值`}
            onChange={(event) => updateRow(index, { text: event.target.value })}
            onBlur={() => handleValueCommit(index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleValueCommit(index);
              } else if (event.key === 'Escape') {
                revertDrafts();
              }
            }}
          />
        );
      case 'boolean':
        return (
          <label className="vn-panel-check" title={row.bool ? 'true' : 'false'}>
            <input
              type="checkbox"
              checked={row.bool}
              aria-label={`变量 ${row.key} 的值`}
              onChange={(event) =>
                commitRows(
                  rows.map((item, i) => (i === index ? { ...item, bool: event.target.checked } : item)),
                )
              }
            />
            <span>{row.bool ? 'true' : 'false'}</span>
          </label>
        );
      case 'array':
      case 'object':
        return (
          <textarea
            className={`vn-panel-textarea${row.valueError ? ' is-invalid' : ''}`}
            rows={2}
            value={row.text}
            aria-label={`变量 ${row.key} 的 JSON 值`}
            aria-invalid={row.valueError || undefined}
            title={row.valueError ? 'JSON 格式不正确' : 'JSON 文本，失焦校验'}
            onChange={(event) => updateRow(index, { text: event.target.value, valueError: false })}
            onBlur={() => handleJsonCommit(index)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') revertDrafts();
            }}
          />
        );
      case 'null':
      default:
        return <span className="vn-panel-value-readonly">null</span>;
    }
  };

  return (
    <div className="vn-panel-section">
      <div className="vn-panel-toolbar">
        <span className="vn-panel-toolbar__hint">共 {rows.length} 个变量</span>
        <button type="button" className="vn-panel-mini-btn" onClick={handleAddVariable}>
          + 新增变量
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="vn-panel-empty">还没有变量。点击「+ 新增变量」创建第一个变量。</p>
      ) : (
        <div className="vn-panel-var-table">
          <div className="vn-panel-var-head">
            <span>变量名</span>
            <span>类型</span>
            <span>值</span>
            <span aria-hidden="true" />
          </div>
          <div className="vn-panel-var-list">
            {rows.map((row, index) => {
              const reserved = row.key === RESERVED_VARIABLE;
              return (
                <div className={`vn-panel-var-row${reserved ? ' is-reserved' : ''}`} key={row.key}>
                  <input
                    className={`vn-panel-input vn-panel-input--name${row.nameError ? ' is-invalid' : ''}`}
                    type="text"
                    value={row.nameDraft}
                    readOnly={reserved}
                    aria-label="变量名"
                    aria-invalid={row.nameError || undefined}
                    title={reserved ? '运行时保留变量，不可重命名' : '失焦或 Enter 提交，需符合标识符规则'}
                    onChange={(event) => updateRow(index, { nameDraft: event.target.value, nameError: false })}
                    onBlur={() => handleNameCommit(index)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleNameCommit(index);
                      } else if (event.key === 'Escape') {
                        revertDrafts();
                      }
                    }}
                  />
                  <select
                    className="vn-panel-select"
                    value={row.type}
                    disabled={reserved}
                    aria-label="变量类型"
                    title={reserved ? '保留变量类型固定为文本' : '切换类型会重置为新类型的默认值'}
                    onChange={(event) => handleTypeChange(index, event.target.value)}
                  >
                    {VARIABLE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                  {renderValueControl(row, index)}
                  {reserved ? (
                    <span className="vn-panel-lock" title="运行时保留变量，不可删除">
                      <IconLock />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="vn-panel-del"
                      title={`删除变量 ${row.key}`}
                      aria-label={`删除变量 ${row.key}`}
                      onClick={() => handleDelete(index)}
                    >
                      <IconTrash />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="vn-panel-note">last_minigame_result 为运行时保留变量，类型固定为文本。</p>
    </div>
  );
}

/* ───────────── 项目结构（只读） ───────────── */

function StructurePanel({ project }) {
  const nodes = Array.isArray(project?.nodes) ? project.nodes : [];
  const edges = Array.isArray(project?.edges) ? project.edges : [];
  const [collapsed, setCollapsed] = useState(() => new Set());

  const groups = useMemo(
    () => NODE_GROUPS.map((group) => ({ ...group, nodes: nodes.filter((node) => node?.type === group.type) })),
    [nodes],
  );

  const toggleGroup = (type) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <div className="vn-panel-section">
      <div className="vn-panel-toolbar">
        <span className="vn-panel-toolbar__hint">
          {nodes.length} 节点 · {edges.length} 连线
        </span>
      </div>

      {nodes.length === 0 ? (
        <p className="vn-panel-empty">项目里还没有节点。</p>
      ) : (
        <div className="vn-panel-groups">
          {groups.map((group) => {
            const open = !collapsed.has(group.type);
            const empty = group.nodes.length === 0;
            return (
              <div className={`vn-panel-group${empty ? ' is-empty' : ''}`} key={group.type}>
                <button
                  type="button"
                  className="vn-panel-group__head"
                  onClick={() => toggleGroup(group.type)}
                  aria-expanded={open}
                  disabled={empty}
                >
                  <span className="vn-panel-group__caret" aria-hidden="true">
                    {open ? '▾' : '▸'}
                  </span>
                  <span className="vn-panel-group__label">{group.label}</span>
                  <span className="vn-panel-group__count">{group.nodes.length}</span>
                </button>
                {open && !empty && (
                  <ul className="vn-panel-group__nodes">
                    {group.nodes.map((node) => (
                      <li className="vn-panel-node" key={node.id} title="在蓝图画布中编辑节点与连线">
                        <span className="vn-panel-node__name">{node.name || node.id}</span>
                        <span className="vn-panel-node__id">{node.id}</span>
                        <span className="vn-panel-node__exits">出口 {Array.isArray(node.exits) ? node.exits.length : 0}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="vn-panel-note">节点与连线的编辑请使用中栏蓝图；此面板为只读结构总览。</p>
    </div>
  );
}

/* ───────────── 小游戏出口 ───────────── */

function MinigameExitsPanel({ project, onSelectAssetById, notify }) {
  const minigames = Array.isArray(project?.assets?.minigames) ? project.assets.minigames : [];
  const nodes = Array.isArray(project?.nodes) ? project.nodes : [];

  const handleSelect = useCallback(
    async (assetId) => {
      if (typeof onSelectAssetById !== 'function') {
        notify?.('该素材当前无法跳转', 'error');
        return;
      }
      try {
        await onSelectAssetById(assetId);
      } catch (err) {
        notify?.(err?.message || '跳转素材失败', 'error');
      }
    },
    [onSelectAssetById, notify],
  );

  if (minigames.length === 0) {
    return (
      <div className="vn-panel-section">
        <p className="vn-panel-empty">还没有导入小游戏素材。用素材库的「+ 导入 → 小游戏」添加。</p>
      </div>
    );
  }

  return (
    <div className="vn-panel-section">
      {minigames.map((asset) => {
        const declaredExits = Array.isArray(asset?.declaredExits) ? asset.declaredExits : [];
        const usages = nodes.filter((node) => node?.type === 'minigame' && node.minigameAssetId === asset.id);
        return (
          <div className="vn-panel-mg" key={asset.id}>
            <button
              type="button"
              className="vn-panel-mg__name"
              onClick={() => handleSelect(asset.id)}
              title={`在素材库中定位 ${asset.id}`}
            >
              {asset.name || asset.id}
            </button>
            <div className="vn-panel-mg__id">{asset.id}</div>

            <div className="vn-panel-chips">
              {declaredExits.length === 0 ? (
                <span className="vn-panel-hint">无声明出口</span>
              ) : (
                declaredExits.map((exitName, index) => (
                  <span
                    className="vn-panel-chip"
                    key={`${exitName}-${index}`}
                    style={chipStyle(index)}
                    title="小游戏 window.MINIGAME_EXITS 声明的出口"
                  >
                    {exitName}
                  </span>
                ))
              )}
            </div>

            <div className="vn-panel-mg__usage">
              {usages.length === 0 ? (
                <span className="vn-panel-hint">尚未被节点使用</span>
              ) : (
                usages.map((node) => {
                  const nodeExits = Array.isArray(node.exits) ? node.exits : [];
                  const defaultExit = nodeExits.find((exit) => exit.id === node.defaultExitId) || null;
                  return (
                    <div className="vn-panel-mg__usage-item" key={node.id}>
                      <div className="vn-panel-mg__usage-head">
                        <span className="vn-panel-mg__node-name">{node.name || node.id}</span>
                        <span className="vn-panel-mg__node-id">{node.id}</span>
                      </div>
                      <div className="vn-panel-chips">
                        {nodeExits.map((exit, index) => (
                          <span className="vn-panel-chip vn-panel-chip--sm" key={exit.id} style={chipStyle(index + 1)}>
                            {exit.name || exit.id}
                          </span>
                        ))}
                      </div>
                      <div className="vn-panel-mg__default">
                        兜底出口：
                        {node.defaultExitId
                          ? defaultExit
                            ? defaultExit.name || defaultExit.id
                            : node.defaultExitId
                          : '无'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── 面板容器 ───────────── */

export default function LeftBottomPanels({
  project,
  activePanel,
  onPanelChange,
  onVariablesChange,
  onSelectAssetById,
  notify,
}) {
  const panel = PANEL_TABS.some((tab) => tab.key === activePanel) ? activePanel : 'variables';

  const handlePanelChange = (key) => {
    if (key === panel) return;
    try {
      onPanelChange?.(key);
    } catch (err) {
      notify?.(err?.message || '切换面板失败', 'error');
    }
  };

  return (
    <div className="vn-panel">
      <div className="vn-panel__tabs" role="tablist" aria-label="下方面板">
        {PANEL_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={panel === tab.key}
            className={`vn-panel__tab${panel === tab.key ? ' is-active' : ''}`}
            onClick={() => handlePanelChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="vn-panel__body" role="tabpanel">
        {panel === 'variables' && (
          <VariablesPanel project={project} onVariablesChange={onVariablesChange} notify={notify} />
        )}
        {panel === 'structure' && <StructurePanel project={project} />}
        {panel === 'minigameExits' && (
          <MinigameExitsPanel project={project} onSelectAssetById={onSelectAssetById} notify={notify} />
        )}
      </div>
    </div>
  );
}
