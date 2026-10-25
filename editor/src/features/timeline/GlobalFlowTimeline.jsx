import { useMemo, useState } from 'react';

import '../../styles/global-flow-timeline.css';

const TRACKS = [
  { id: 'scene', label: '普通节点', types: ['scene', 'dialogue', 'choice', 'variable', 'condition', 'jump'] },
  { id: 'video', label: '视频 CG', types: ['video'] },
  { id: 'minigame', label: '小游戏', types: ['minigame'] },
];

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

function nodeTrack(node) {
  if (node.type === 'video') return 'video';
  if (node.type === 'minigame') return 'minigame';
  return 'scene';
}

function buildPath(project, choices) {
  const byId = new Map(project.nodes.map((node) => [node.id, node]));
  const edgesByFrom = new Map();
  for (const edge of project.edges || []) {
    if (!edgesByFrom.has(edge.from)) edgesByFrom.set(edge.from, []);
    edgesByFrom.get(edge.from).push(edge);
  }
  const nextEdge = (node, port) => (edgesByFrom.get(node.id) || []).find((edge) => edge.port === port)?.to ?? null;
  const blocks = [];
  const branchPoints = [];
  const seen = new Set();
  let current = project.settings?.startNodeId;
  let cursor = 0;
  let guard = 0;
  while (current && !seen.has(current) && guard++ < 2000) {
    seen.add(current);
    const node = byId.get(current);
    if (!node) break;
    const duration = estimateNode(node, project);
    blocks.push({ node, startMs: cursor, duration, track: nodeTrack(node), excluded: node.type === 'minigame' });
    cursor += duration;

    let next = null;
    if (node.type === 'scene') {
      const branch = (node.dialogues || []).find((entry) => entry.type === 'branch' && (entry.options || []).length);
      if (branch) {
        const selected = Math.min(Math.max(0, choices[node.id] ?? 0), branch.options.length - 1);
        branchPoints.push({
          node,
          atMs: cursor,
          options: branch.options,
          selected,
          prompt: branch.prompt ?? '分支',
        });
        next = branch.options[selected]?.targetNodeId ?? null;
      } else {
        next = nextEdge(node, 'next');
      }
    } else if (node.type === 'choice') {
      const exits = (edgesByFrom.get(node.id) || []).filter((edge) => edge.port !== 'next');
      const selected = Math.min(Math.max(0, choices[node.id] ?? 0), Math.max(0, exits.length - 1));
      branchPoints.push({
        node,
        atMs: cursor,
        options: exits.map((edge) => ({
          id: edge.port,
          label: node.exits?.find((exit) => exit.id === edge.port)?.label ?? edge.port,
          targetNodeId: edge.to,
        })),
        selected,
        prompt: node.name ?? '选项',
      });
      next = exits[selected]?.to ?? null;
    } else if (node.type === 'condition') {
      next = nextEdge(node, 'true') ?? (edgesByFrom.get(node.id) || [])[0]?.to ?? null;
    } else if (node.type === 'jump') {
      next = node.targetNodeId ?? null;
    } else {
      next = (edgesByFrom.get(node.id) || [])[0]?.to ?? null;
    }
    current = next;
  }
  const total = cursor;
  const withoutMinigames = blocks.reduce((sum, block) => sum + (block.excluded ? 0 : block.duration), 0);
  return { blocks, branchPoints, total, withoutMinigames };
}

function stamp(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function GlobalFlowTimeline({ project, onClose, onSelectNode }) {
  const [choices, setChoices] = useState({});
  const model = useMemo(() => buildPath(project, choices), [project, choices]);
  const pixelsPerSecond = 10;
  const width = Math.max(1200, Math.round((model.total / 1000) * pixelsPerSecond) + 120);
  const rulerStep = model.total > 240000 ? 30000 : model.total > 60000 ? 10000 : 5000;
  const ticks = [];
  for (let time = 0; time <= model.total; time += rulerStep) ticks.push(time);

  return (
    <div className="vn-global-timeline">
      <div className="vn-global-timeline__head">
        <div>
          <strong>全局流程时间轴</strong>
          <span>
            当前路线 {model.blocks.length} 个节点 · 总时长约 {Math.round(model.total / 1000)} 秒 ·
            排除小游戏约 {Math.round(model.withoutMinigames / 1000)} 秒 · 分支点 {model.branchPoints.length}
          </span>
        </div>
        <button type="button" className="vn-btn" onClick={onClose}>关闭</button>
      </div>

      <div className="vn-global-timeline__legend">
        <span><i className="is-scene" />普通节点</span>
        <span><i className="is-video" />视频 CG</span>
        <span><i className="is-minigame" />小游戏（不计入排除值）</span>
        <span>点击块会选中并高亮蓝图节点；点击下方分支选项切换路线</span>
      </div>

      <div className="vn-global-timeline__scroll">
        <div className="vn-global-timeline__canvas" style={{ width }}>
          <div className="vn-global-ruler" style={{ width }}>
            {ticks.map((time) => (
              <span key={time} className="vn-global-ruler__tick" style={{ left: (time / 1000) * pixelsPerSecond }}>
                {stamp(time)}
              </span>
            ))}
          </div>

          {TRACKS.map((track) => {
            const items = model.blocks.filter((block) => block.track === track.id);
            return (
              <div className="vn-global-track" key={track.id} style={{ width }}>
                <div className="vn-global-track__label">{track.label}</div>
                <div className="vn-global-track__lane" style={{ width }}>
                  {items.map((block, index) => {
                    const left = (block.startMs / 1000) * pixelsPerSecond;
                    const blockWidth = Math.max(8, (block.duration / 1000) * pixelsPerSecond);
                    return (
                      <button
                        type="button"
                        key={`${block.node.id}-${index}`}
                        className={`vn-global-block vn-global-block--${block.node.type}${block.excluded ? ' is-excluded' : ''}`}
                        style={{ left, width: blockWidth }}
                        title={`${block.node.name} · ${stamp(block.startMs)} · ${Math.round(block.duration / 1000)}s`}
                        onClick={() => {
                          onSelectNode(block.node.id);
                          onClose();
                        }}
                      >
                        <span className="vn-global-block__name">{block.node.name || block.node.id}</span>
                        {blockWidth > 84 ? <span className="vn-global-block__meta">{Math.round(block.duration / 1000)}s</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="vn-global-timeline__branches">
        <div className="vn-global-timeline__branches-title">分支 / 路线切换</div>
        {model.branchPoints.length === 0 ? (
          <p className="vn-global-timeline__empty">当前路线没有分支点。</p>
        ) : (
          model.branchPoints.map((point, index) => (
            <div className="vn-global-branch" key={`${point.node.id}-${index}`}>
              <div className="vn-global-branch__head">
                <span className="vn-global-branch__time">{stamp(point.atMs)}</span>
                <strong>{point.node.name || point.node.id}</strong>
                <small>{point.prompt}</small>
              </div>
              <div className="vn-global-branch__options">
                {point.options.map((option, optionIndex) => (
                  <button
                    key={option.id ?? optionIndex}
                    type="button"
                    className={`vn-btn vn-btn--ghost${point.selected === optionIndex ? ' is-active' : ''}`}
                    onClick={() => setChoices((current) => ({ ...current, [point.node.id]: optionIndex }))}
                  >
                    {option.label || option.id}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
