// 连线属性面板：展示 from / port / to / kind，所有字段只读，仅提供删除操作。
import { useProjectController } from '../../state/ProjectContext';
import {
  Hint,
  ReadonlyRow,
  Section,
  SmallButton,
} from './controls';
import '../../styles/inspector.css';

const KIND_LABELS = {
  sequence: 'sequence · 顺序推进',
  conditional: 'conditional · 条件分支',
  data: 'data · 数据流（第一版预留）',
};

function typeLabel(node) {
  if (!node) return '（节点已删除）';
  return node.name ? `${node.name}（${node.id}）` : node.id;
}

function stringifyData(data) {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

export default function EdgeInspector({ project: projectProp, edge }) {
  const controller = useProjectController();
  const { actions, notify } = controller;
  const project = projectProp ?? controller.project;

  if (!edge) {
    return (
      <div className="vn-edge-insp">
        <p className="vn-insp-ctl-empty">未选中连线</p>
      </div>
    );
  }

  const nodes = project?.nodes ?? [];
  const fromNode = nodes.find((node) => node.id === edge.from) ?? null;
  const toNode = nodes.find((node) => node.id === edge.to) ?? null;
  const sourceExit = fromNode?.exits?.find((exit) => exit.id === edge.port) ?? null;
  const dataText = edge.data == null ? null : stringifyData(edge.data);

  const removeEdge = () => {
    const confirmed = window.confirm(
      `确定删除连线「${fromNode?.name ?? edge.from} · ${sourceExit?.name ?? edge.port} → ${
        toNode?.name ?? edge.to
      }」？\n只会删除这一条连线，不会删除节点。`,
    );
    if (!confirmed) return;
    actions.removeEdge(edge.id);
    notify('连线已删除', 'success');
  };

  return (
    <div className="vn-edge-insp">
      <header className="vn-edge-insp-header">
        <div className="vn-edge-insp-heading">
          <h2 className="vn-edge-insp-title">连线</h2>
          <p className="vn-edge-insp-subtitle vn-mono">{edge.id}</p>
        </div>
        <span className="vn-chip vn-edge-insp-kind">{edge.kind}</span>
      </header>

      <Section title="连线信息" defaultOpen>
        <ReadonlyRow label="起点节点 from" value={typeLabel(fromNode)} />
        <ReadonlyRow label="源出口 port" value={sourceExit ? `${sourceExit.name}（${edge.port}）` : edge.port} mono={!sourceExit} />
        <ReadonlyRow label="终点节点 to" value={typeLabel(toNode)} />
        <ReadonlyRow label="类型 kind" value={KIND_LABELS[edge.kind] ?? edge.kind} />
        <ReadonlyRow label="连线 id" value={edge.id} mono />
        {!fromNode || !toNode ? (
          <Hint kind="error">该连线引用的节点已不存在，建议删除这条失效连线。</Hint>
        ) : null}
        {fromNode && !sourceExit ? (
          <Hint kind="error">源节点上已经找不到出口「{edge.port}」，这条连线已失效。</Hint>
        ) : null}
      </Section>

      {dataText != null ? (
        <Section title="data 字段（只读）" defaultOpen={false}>
          <Hint>data 连线第一版不创建，这里仅供排查存量数据。</Hint>
          <pre className="vn-edge-insp-json vn-mono">{dataText}</pre>
        </Section>
      ) : null}

      <Section title="规则说明" defaultOpen={false}>
        <Hint>
          kind 由源节点类型派生：condition 节点的出边为 conditional，其余节点的出边为 sequence；data 连线第一版不创建。
        </Hint>
        <Hint>源出口由 edge.port（出口 id）确定；出口改名不会断开连线。</Hint>
      </Section>

      <Section title="删除" defaultOpen>
        <Hint kind="warn">删除连线不可撤销；只删除这条边，不会删除任何节点或出口。</Hint>
        <SmallButton variant="danger" onClick={removeEdge} title="删除这条连线">
          删除连线
        </SmallButton>
      </Section>
    </div>
  );
}
