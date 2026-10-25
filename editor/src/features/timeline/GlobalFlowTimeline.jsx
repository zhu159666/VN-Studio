import { useMemo } from 'react';

import '../../styles/global-flow-timeline.css';

function assetDuration(project, kind, id) {
  const list = project.assets?.[kind] || [];
  return list.find((item) => item.id === id)?.durationMs ?? 0;
}

function estimateNode(node, project) {
  if (!node) return 0;
  if (node.type === 'scene') {
    const cps = Number(project.settings?.textSpeedCps) || 30;
    let total = 500;
    for (const entry of node.dialogues || []) {
      if (entry.type === 'branch') {
        total += 600;
        continue;
      }
      total += Math.max(700, Math.round(String(entry.text || '').length / cps * 1000) + 260);
    }
    return total;
  }
  if (node.type === 'dialogue') {
    const cps = Number(project.settings?.textSpeedCps) || 30;
    return Math.max(700, Math.round(String(node.text || '').length / cps * 1000) + 260);
  }
  if (node.type === 'video') return assetDuration(project, 'videos', node.videoAssetId) || 5000;
  if (node.type === 'minigame') {
    return Number(node.timeoutMs) || Number(project.settings?.runtime?.defaultMinigameTimeoutMs) || 12000;
  }
  return 300;
}

function firstTarget(project, node) {
  if (!node) return null;
  const edges = project.edges.filter((edge) => edge.from === node.id);
  if (node.type === 'scene') {
    const branch = (node.dialogues || []).find((entry) => entry.type === 'branch');
    if (branch?.options?.length) return branch.options[0].targetNodeId;
    return edges.find((edge) => edge.port === 'next')?.to ?? null;
  }
  if (node.type === 'choice') return edges[0]?.to ?? null;
  if (node.type === 'condition') return edges.find((edge) => edge.port === 'true')?.to ?? edges[0]?.to ?? null;
  if (node.type === 'video' || node.type === 'minigame') return edges[0]?.to ?? null;
  if (node.type === 'jump') return node.targetNodeId ?? null;
  return edges.find((edge) => edge.port === 'next')?.to ?? null;
}

export default function GlobalFlowTimeline({ project, onClose, onSelectNode }) {
  const model = useMemo(() => {
    const byId = new Map(project.nodes.map((node) => [node.id, node]));
    const blocks = [];
    const seen = new Set();
    let current = project.settings?.startNodeId;
    let total = 0;
    let withoutMinigames = 0;
    let branchPoints = 0;
    let guard = 0;
    while (current && !seen.has(current) && guard++ < 2000) {
      seen.add(current);
      const node = byId.get(current);
      if (!node) break;
      const duration = estimateNode(node, project);
      const excluded = node.type === 'minigame';
      total += duration;
      if (!excluded) withoutMinigames += duration;
      if (node.type === 'scene' && (node.dialogues || []).some((entry) => entry.type === 'branch')) branchPoints += 1;
      blocks.push({ node, duration, excluded });
      current = firstTarget(project, node);
    }
    return { blocks, total, withoutMinigames, branchPoints };
  }, [project]);

  const maxDuration = Math.max(1, ...model.blocks.map((block) => block.duration));

  return (
    <div className="vn-global-timeline">
      <div className="vn-global-timeline__head">
        <div>
          <strong>全局流程时间轴</strong>
          <span>
            当前路线 {model.blocks.length} 个节点 · 总时长约 {Math.round(model.total / 1000)} 秒 ·
            排除小游戏约 {Math.round(model.withoutMinigames / 1000)} 秒 · 分支点 {model.branchPoints}
          </span>
        </div>
        <button type="button" className="vn-btn" onClick={onClose}>关闭</button>
      </div>

      <div className="vn-global-timeline__legend">
        <span><i className="is-normal" />普通/场景</span>
        <span><i className="is-video" />视频 CG</span>
        <span><i className="is-minigame" />小游戏（不计入排除值）</span>
        <span>点击块会选中并高亮蓝图节点</span>
      </div>

      <div className="vn-global-timeline__scroll">
        <div className="vn-global-timeline__track">
          {model.blocks.map((block, index) => (
            <button
              type="button"
              key={`${block.node.id}-${index}`}
              className={`vn-global-block vn-global-block--${block.node.type}${block.excluded ? ' is-excluded' : ''}`}
              style={{ flexGrow: Math.max(0.35, block.duration / maxDuration) }}
              title={`${block.node.name} · ${block.duration}ms`}
              onClick={() => {
                onSelectNode(block.node.id);
                onClose();
              }}
            >
              <span className="vn-global-block__index">{index + 1}</span>
              <span className="vn-global-block__name">{block.node.name || block.node.id}</span>
              <span className="vn-global-block__meta">
                {block.node.type === 'scene' ? '场景' : block.node.type === 'video' ? 'CG' : block.node.type === 'minigame' ? '小游戏' : block.node.type}
                {' · '}{Math.round(block.duration / 1000)}s
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="vn-global-timeline__ruler">
        {model.blocks.map((block, index) => (
          <span key={`${block.node.id}-ruler-${index}`} style={{ flexGrow: Math.max(0.35, block.duration / maxDuration) }}>
            {Math.round((block.duration / 1000) * 10) / 10}s
          </span>
        ))}
      </div>
    </div>
  );
}
