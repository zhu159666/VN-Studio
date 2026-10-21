// 节点属性面板：通用区 + 按 node.type 分支的专属字段。
// 数据合法性约束见 CONTRACT-PHASE3.md 与 schema/schema.json：
// - 数字在失焦 / Enter 时校验范围与整数性，非法 notify 并回退；
// - 可空字段用「启用 / 清除」；
// - 出口、赋值列表整体构造合法数组后提交。
import { useMemo } from 'react';

import { useProjectController } from '../../state/ProjectContext';
import {
  AssetSelect,
  FieldCheckbox,
  FieldNotifyProvider,
  FieldNumber,
  FieldSelect,
  FieldText,
  FieldTextArea,
  Hint,
  NullableNumberField,
  ReadonlyRow,
  Section,
  SmallButton,
  SubList,
  TypedValueEditor,
  isValidVariableKey,
  makeExitIdForName,
  nextPrefixedId,
  typedDefaultValue,
} from './controls';
import { ChoiceMaterialFields } from './MaterialFields';
import '../../styles/inspector.css';

const TYPE_LABELS = {
  scene: '场景节点',
  dialogue: '对话节点',
  choice: '选项节点',
  minigame: '小游戏节点',
  video: '视频节点',
  jump: '跳转节点',
  condition: '条件节点',
  variable: '变量操作节点',
};

const IMAGE_ROLE_SPRITE = 'sprite';
const AUDIO_ROLE_VOICE = 'voice';
const AUDIO_ROLE_BGM = 'bgm';

const ASSIGNMENT_OPS = [
  ['set', 'set · 赋值'],
  ['add', 'add · 加'],
  ['subtract', 'subtract · 减'],
  ['toggle', 'toggle · 取反'],
  ['push', 'push · 追加'],
];

// 小游戏节点 exits 的 schema 上限（素材 declaredExits 最多 32，节点最多 16）。
const MAX_MINIGAME_EXITS = 16;

// ---------------------------------------------------------------------------
// 纯函数工具
// ---------------------------------------------------------------------------

function makePortrait(base, patch) {
  const next = { assetId: base.assetId };
  if (base.expression != null) next.expression = base.expression;
  if (base.x != null) next.x = base.x;
  if (base.y != null) next.y = base.y;
  if (base.scale != null) next.scale = base.scale;
  return { ...next, ...patch };
}

function makeVoice(base, patch) {
  const next = { assetId: base.assetId };
  if (base.volume != null) next.volume = base.volume;
  return { ...next, ...patch };
}

function countEdgesForExit(project, nodeId, exitId) {
  return (project?.edges ?? []).filter((edge) => edge.from === nodeId && edge.port === exitId).length;
}

/** condition 表达式的轻量静态检查：非空 + 括号 / 引号配平。 */
function checkExpression(expression) {
  const text = String(expression ?? '');
  if (!text.trim()) return { error: '表达式不能为空' };
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  let quote = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      stack.push({ char, index });
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      const open = stack.pop();
      if (!open || open.char !== pairs[char]) {
        return { error: `第 ${index + 1} 个字符的 ${char} 不匹配` };
      }
    }
  }
  if (quote) return { error: `引号未闭合（${quote}）` };
  if (stack.length) {
    const open = stack[stack.length - 1];
    return { error: `括号未闭合（第 ${open.index + 1} 个字符的 ${open.char}）` };
  }
  return { error: null };
}

/** 按声明出口重建：已有同名出口复用 id，新出口生成唯一 exit_<slug>。 */
function exitsFromDeclared(declared, existing) {
  const used = new Set();
  return (declared ?? []).map((rawName) => {
    const name = String(rawName);
    const found = (existing ?? []).find((item) => item.name === name && !used.has(item.id));
    if (found) {
      used.add(found.id);
      return { id: found.id, name };
    }
    const id = makeExitIdForName(name, used);
    used.add(id);
    return { id, name };
  });
}

// ---------------------------------------------------------------------------
// 出口展示组件
// ---------------------------------------------------------------------------

function ExitLinkStatus({ project, nodeId, exitId }) {
  const linked = (project?.edges ?? []).some(
    (edge) =>
      edge.from === nodeId &&
      edge.port === exitId &&
      (edge.kind === 'sequence' || edge.kind === 'conditional'),
  );
  if (linked) return null;
  return (
    <span className="vn-node-insp-exit-status" title="该出口还没有有效连线，导出校验会报错">
      未连线
    </span>
  );
}

function FixedExits({ project, node, ids, note }) {
  const exits = node?.exits ?? [];
  return (
    <div className="vn-node-insp-exits">
      {ids.map((id) => {
        const exit = exits.find((item) => item.id === id);
        return (
          <div className="vn-node-insp-exit-chip" key={id}>
            <span className="vn-node-insp-exit-id vn-mono" title={`出口 id：${id}（固定，不可修改）`}>
              {id}
            </span>
            {exit?.name && exit.name !== id ? (
              <span className="vn-node-insp-exit-name">{exit.name}</span>
            ) : null}
            <ExitLinkStatus project={project} nodeId={node.id} exitId={id} />
          </div>
        );
      })}
      {note ? <p className="vn-insp-ctl-hint">{note}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// dialogue
// ---------------------------------------------------------------------------

function DialogueFields({ project, projectDir, node, actions, notify }) {
  const updateNode = (patch) => actions.updateNode(node.id, patch);
  const spriteAssets = (project?.assets?.images ?? []).filter(
    (asset) => asset.role === IMAGE_ROLE_SPRITE,
  );
  const voiceAssets = (project?.assets?.audio ?? []).filter(
    (asset) => asset.role === AUDIO_ROLE_VOICE,
  );
  const portrait = node.portrait ?? null;
  const voice = node.voice ?? null;

  const enablePortrait = () => {
    if (!spriteAssets.length) {
      notify('素材库中没有立绘素材（role=sprite），请先在左栏导入', 'error');
      return;
    }
    updateNode({
      portrait: { assetId: spriteAssets[0].id, x: 0.5, y: 0.5, scale: 1 },
    });
  };

  const enableVoice = () => {
    if (!voiceAssets.length) {
      notify('素材库中没有语音素材（role=voice），请先在左栏导入', 'error');
      return;
    }
    updateNode({ voice: { assetId: voiceAssets[0].id, volume: 1 } });
  };

  return (
    <>
      <Section title="台词" defaultOpen>
        <FieldTextArea
          label="台词 text"
          value={node.text ?? ''}
          maxLength={20000}
          rows={6}
          onChange={(text) => updateNode({ text })}
          hint="≤20000 字，允许空串"
        />
        <FieldText
          label="说话人 speaker"
          value={node.speaker ?? ''}
          allowNull
          maxLength={80}
          placeholder="留空 = 旁白 / 无名"
          onChange={(speaker) => updateNode({ speaker })}
          hint="可空；清空后写回 null"
        />
      </Section>

      <Section title="立绘" defaultOpen={false} badge={portrait ? '已启用' : '未启用'}>
        {portrait ? (
          <>
            <AssetSelect
              label="立绘素材"
              assets={spriteAssets}
              value={portrait.assetId}
              onChange={(assetId) => {
                if (assetId) updateNode({ portrait: makePortrait(portrait, { assetId }) });
              }}
              projectDir={projectDir}
              thumbnail
              required
              emptyHint="素材库中没有立绘素材（role=sprite）。"
            />
            <FieldText
              label="表情标签 expression"
              value={portrait.expression ?? ''}
              maxLength={40}
              placeholder="可选，仅编辑器分组用"
              onChange={(expression) =>
                updateNode({ portrait: makePortrait(portrait, { expression }) })
              }
            />
            <div className="vn-insp-ctl-grid-2">
              <FieldNumber
                label="x（0–1）"
                value={portrait.x ?? 0.5}
                min={0}
                max={1}
                onChange={(x) => updateNode({ portrait: makePortrait(portrait, { x }) })}
              />
              <FieldNumber
                label="y（0–1）"
                value={portrait.y ?? 0.5}
                min={0}
                max={1}
                onChange={(y) => updateNode({ portrait: makePortrait(portrait, { y }) })}
              />
              <FieldNumber
                label="缩放"
                value={portrait.scale ?? 1}
                min={0.05}
                max={10}
                onChange={(scale) => updateNode({ portrait: makePortrait(portrait, { scale }) })}
              />
            </div>
            <div className="vn-insp-ctl-actions">
              <SmallButton
                variant="danger"
                onClick={() => updateNode({ portrait: null })}
                title="清除本句立绘（portrait = null）"
              >
                清除立绘
              </SmallButton>
            </div>
          </>
        ) : (
          <>
            <div className="vn-insp-ctl-row">
              <span className="vn-insp-ctl-label">立绘</span>
              <div className="vn-insp-ctl-inline">
                <span className="vn-insp-ctl-null">未启用</span>
                <SmallButton
                  onClick={enablePortrait}
                  disabled={!spriteAssets.length}
                  title={
                    spriteAssets.length
                      ? '为本句启用立绘'
                      : '素材库中没有立绘素材（role=sprite）'
                  }
                >
                  启用立绘
                </SmallButton>
              </div>
            </div>
            <Hint kind={spriteAssets.length ? 'info' : 'warn'}>
              {spriteAssets.length
                ? '立绘为可选字段；启用后显示在台词旁（运行时按 assetId 显示）。'
                : '素材库中没有立绘素材，请先在左栏导入 role=sprite 的图片。'}
            </Hint>
          </>
        )}
      </Section>

      <Section title="语音" defaultOpen={false} badge={voice ? '已启用' : '未启用'}>
        {voice ? (
          <>
            <AssetSelect
              label="语音素材"
              assets={voiceAssets}
              value={voice.assetId}
              onChange={(assetId) => {
                if (assetId) updateNode({ voice: makeVoice(voice, { assetId }) });
              }}
              projectDir={projectDir}
              required
              emptyHint="素材库中没有语音素材（role=voice）。"
            />
            <FieldNumber
              label="音量 volume"
              value={voice.volume ?? 1}
              min={0}
              max={1}
              onChange={(volume) => updateNode({ voice: makeVoice(voice, { volume }) })}
            />
            <div className="vn-insp-ctl-actions">
              <SmallButton
                variant="danger"
                onClick={() => updateNode({ voice: null })}
                title="清除本句语音（voice = null）"
              >
                清除语音
              </SmallButton>
            </div>
          </>
        ) : (
          <>
            <div className="vn-insp-ctl-row">
              <span className="vn-insp-ctl-label">语音</span>
              <div className="vn-insp-ctl-inline">
                <span className="vn-insp-ctl-null">未启用</span>
                <SmallButton
                  onClick={enableVoice}
                  disabled={!voiceAssets.length}
                  title={
                    voiceAssets.length
                      ? '为本句启用语音'
                      : '素材库中没有语音素材（role=voice）'
                  }
                >
                  启用语音
                </SmallButton>
              </div>
            </div>
            <Hint kind={voiceAssets.length ? 'info' : 'warn'}>
              {voiceAssets.length
                ? '语音为可选字段；启用后播放该句配音。'
                : '素材库中没有语音素材，请先在左栏导入 role=voice 的音频。'}
            </Hint>
          </>
        )}
      </Section>

      <Section title="节奏" defaultOpen>
        <NullableNumberField
          label="本句语速（字/秒）"
          value={node.speedCps ?? null}
          min={0}
          max={1000}
          enableValue={0}
          onChange={(speedCps) => updateNode({ speedCps })}
          hint="清除后沿用项目默认文字速度；0 表示瞬显。"
        />
        <NullableNumberField
          label="自动前进等待（毫秒）"
          value={node.autoAdvanceMs ?? null}
          min={0}
          max={600000}
          integer
          enableValue={0}
          onChange={(autoAdvanceMs) => updateNode({ autoAdvanceMs })}
          hint="清除后必须玩家点击才能继续。"
        />
      </Section>

      <Section title="固定出口" defaultOpen>
        <FixedExits
          project={project}
          node={node}
          ids={['next']}
          note="对话节点只有固定 next 出口，出口 id / name 不可修改。"
        />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// choice
// ---------------------------------------------------------------------------

function ChoiceFields({ project, projectDir, node, actions, notify }) {
  const updateNode = (patch) => actions.updateNode(node.id, patch);
  const exits = node.exits ?? [];
  const usedIds = new Set(exits.map((exit) => exit.id));

  const addExit = () => {
    if (exits.length >= 12) {
      notify('选项节点最多 12 个出口', 'warn');
      return;
    }
    const id = nextPrefixedId('opt_', usedIds);
    const name = `选项 ${exits.length + 1}`;
    actions.addNodeExit(node.id, { id, name });
  };

  const removeExit = (exit) => {
    if (exits.length <= 2) {
      notify('选项节点至少保留 2 个出口', 'warn');
      return;
    }
    const edgeCount = countEdgesForExit(project, node.id, exit.id);
    const confirmed = window.confirm(
      `确定删除选项「${exit.name}」（出口 ${exit.id}）？\n将同时删除该出口的 ${edgeCount} 条连线。`,
    );
    if (!confirmed) return;
    actions.removeNodeExit(node.id, exit.id);
  };

  return (
    <>
      <Section title="题目" defaultOpen>
        <FieldTextArea
          label="提示语 prompt"
          value={node.prompt ?? ''}
          maxLength={500}
          rows={3}
          onChange={(prompt) => updateNode({ prompt })}
          hint="显示在选项列表上方，可空。"
        />
      </Section>

      <Section title="选项出口" defaultOpen badge={`${exits.length}/12`}>
        <Hint>
          每个选项就是一个出口：id 创建后不可修改，选项文本即 exit.name；连线写在 edge.port。
        </Hint>
        <SubList
          title="选项"
          count={exits.length}
          max={12}
          onAdd={addExit}
          addLabel="添加选项"
          addDisabled={exits.length >= 12}
          addTitle={exits.length >= 12 ? '选项节点最多 12 个出口' : '添加一个选项出口'}
          emptyText="没有选项出口（至少需要 2 个）"
        >
          {exits.map((exit) => (
            <div className="vn-node-insp-exit" key={exit.id}>
              <div className="vn-node-insp-exit-head">
                <span className="vn-node-insp-exit-id vn-mono" title="出口 id 创建后不可修改">
                  {exit.id}
                </span>
                <ExitLinkStatus project={project} nodeId={node.id} exitId={exit.id} />
                <SmallButton
                  variant="danger"
                  onClick={() => removeExit(exit)}
                  disabled={exits.length <= 2}
                  title={
                    exits.length <= 2
                      ? '选项节点至少保留 2 个出口'
                      : `删除选项「${exit.name}」及其连线`
                  }
                >
                  删除
                </SmallButton>
              </div>
              <FieldText
                label="选项文本"
                value={exit.name}
                minLength={1}
                maxLength={120}
                required
                onChange={(name) => actions.updateNodeExit(node.id, exit.id, { name })}
                hint="即运行时显示的选项文字"
              />
              <FieldText
                label="显示别名 label（可选）"
                value={exit.label ?? ''}
                maxLength={120}
                onChange={(label) => actions.updateNodeExit(node.id, exit.id, { label })}
                hint="仅编辑器展示用，不参与连线"
              />
            </div>
          ))}
        </SubList>
      </Section>

      <Section
        title="选项材质"
        defaultOpen={false}
        badge={node.material?.imageAssetId ? '图片' : '内置'}
      >
        <Hint>
          每个选项节点可以单独设置按钮材质（图片 + 边框/圆角/文字色/间距/悬停配色）；不设置时使用运行时内置样式。
        </Hint>
        <ChoiceMaterialFields
          material={node.material ?? null}
          onChange={(material) => updateNode({ material })}
          projectDir={projectDir}
          assets={project?.assets?.images ?? []}
        />
        <div className="vn-insp-ctl-actions">
          <SmallButton onClick={() => updateNode({ material: null })}>
            恢复内置样式
          </SmallButton>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// minigame
// ---------------------------------------------------------------------------

function MinigameFields({ project, node, actions, notify }) {
  const updateNode = (patch) => actions.updateNode(node.id, patch);
  const minigameAssets = project?.assets?.minigames ?? [];
  const asset = minigameAssets.find((item) => item.id === node.minigameAssetId) ?? null;
  const declaredAll = asset?.declaredExits ?? [];
  const declared = declaredAll.slice(0, MAX_MINIGAME_EXITS);
  const overflowDeclared = Math.max(0, declaredAll.length - declared.length);
  const exits = node.exits ?? [];
  const missingDeclared = declared.filter(
    (name) => !exits.some((exit) => exit.name === name),
  );

  const changeAsset = (nextId) => {
    if (!nextId) return;
    const nextAsset = minigameAssets.find((item) => item.id === nextId) ?? null;
    const patch = { minigameAssetId: nextId };
    if (!exits.length && nextAsset?.declaredExits?.length) {
      patch.exits = exitsFromDeclared(
        nextAsset.declaredExits.slice(0, MAX_MINIGAME_EXITS),
        [],
      );
      patch.defaultExitId = null;
    }
    updateNode(patch);
  };

  const rebuildFromDeclared = () => {
    if (!asset) {
      notify('请先选择小游戏素材', 'error');
      return;
    }
    if (!declared.length) {
      notify('该小游戏素材没有声明出口', 'error');
      return;
    }
    const finalExits = exitsFromDeclared(declared, exits);
    const same =
      finalExits.length === exits.length &&
      finalExits.every(
        (item, index) => item.id === exits[index]?.id && item.name === exits[index]?.name,
      );
    if (same) {
      notify('出口列表已与小游戏声明出口一致', 'success');
      return;
    }
    const finalIds = new Set(finalExits.map((item) => item.id));
    const removedIds = exits
      .filter((item) => !finalIds.has(item.id))
      .map((item) => item.id);
    const removedEdges = (project?.edges ?? []).filter(
      (edge) => edge.from === node.id && removedIds.includes(edge.port),
    );
    const willResetDefault = Boolean(node.defaultExitId && !finalIds.has(node.defaultExitId));
    if (removedIds.length || removedEdges.length || willResetDefault) {
      const confirmed = window.confirm(
        `按声明出口重建会删除 ${removedIds.length} 个出口，并同时删除它们的 ${removedEdges.length} 条连线${
          willResetDefault ? '，默认出口将被重置为 null' : ''
        }。\n确定继续？`,
      );
      if (!confirmed) return;
    }
    for (const edge of removedEdges) actions.removeEdge(edge.id);
    actions.updateNode(node.id, {
      exits: finalExits,
      defaultExitId:
        node.defaultExitId && finalIds.has(node.defaultExitId) ? node.defaultExitId : null,
    });
    notify(`已按声明出口重建（${finalExits.length} 个出口）`, 'success');
  };

  const addExit = () => {
    if (exits.length >= MAX_MINIGAME_EXITS) {
      notify(`小游戏节点最多 ${MAX_MINIGAME_EXITS} 个出口`, 'warn');
      return;
    }
    const usedIds = new Set(exits.map((exit) => exit.id));
    const usedNames = new Set(exits.map((exit) => exit.name));
    const id = nextPrefixedId('exit_', usedIds);
    let n = 1;
    while (usedNames.has(`result_${n}`)) n += 1;
    actions.addNodeExit(node.id, { id, name: `result_${n}` });
  };

  const removeExit = (exit) => {
    if (exits.length <= 1) {
      notify('小游戏节点至少保留 1 个出口', 'warn');
      return;
    }
    const edgeCount = countEdgesForExit(project, node.id, exit.id);
    const confirmed = window.confirm(
      `确定删除出口「${exit.name}」（${exit.id}）？\n将同时删除该出口的 ${edgeCount} 条连线。`,
    );
    if (!confirmed) return;
    actions.removeNodeExit(node.id, exit.id);
    if (node.defaultExitId === exit.id) {
      actions.updateNode(node.id, { defaultExitId: null });
    }
  };

  return (
    <>
      <Section title="小游戏素材" defaultOpen badge={asset ? asset.name : '未选择'}>
        <AssetSelect
          label="小游戏 minigameAssetId"
          assets={minigameAssets}
          value={node.minigameAssetId}
          onChange={changeAsset}
          required
          emptyHint="素材库中没有小游戏素材，请先在左栏导入。"
        />
        <div className="vn-node-insp-chips">
          {declared.length ? (
            declared.map((name) => (
              <span className="vn-chip" key={name} title="小游戏声明的出口字符串">
                {name}
              </span>
            ))
          ) : (
            <span className="vn-insp-ctl-null">该素材没有声明出口</span>
          )}
          {overflowDeclared ? (
            <span className="vn-chip" title="小游戏节点最多 16 个出口">
              +{overflowDeclared} 未列出
            </span>
          ) : null}
        </div>
        <div className="vn-insp-ctl-actions">
          <SmallButton
            onClick={rebuildFromDeclared}
            disabled={!asset || !declared.length}
            title={
              asset && declared.length
                ? '用素材声明的出口重建本节点出口列表（保留同名出口的 id）'
                : '请先选择带声明出口的小游戏素材'
            }
          >
            按声明出口重建
          </SmallButton>
        </div>
        {overflowDeclared ? (
          <Hint kind="warn">
            该素材声明了 {declaredAll.length} 个出口，但小游戏节点最多 {MAX_MINIGAME_EXITS} 个；
            仅处理前 {MAX_MINIGAME_EXITS} 个声明。
          </Hint>
        ) : null}
        {missingDeclared.length ? (
          <Hint kind="error">
            缺失声明出口：{missingDeclared.join('、')}。运行时上报这些结果时无法匹配，请补充出口或重建。
          </Hint>
        ) : (
          <Hint kind="info">切换素材不会自动重排已有出口；需要对齐时使用「按声明出口重建」。</Hint>
        )}
      </Section>

      <Section title="出口映射" defaultOpen badge={`${exits.length}/${MAX_MINIGAME_EXITS}`}>
        <Hint>出口 name 是运行时结果串的精确匹配值；id 创建后不可修改。</Hint>
        <SubList
          title="出口"
          count={exits.length}
          max={MAX_MINIGAME_EXITS}
          onAdd={addExit}
          addLabel="添加出口"
          addDisabled={exits.length >= MAX_MINIGAME_EXITS}
          addTitle={
            exits.length >= MAX_MINIGAME_EXITS
              ? `小游戏节点最多 ${MAX_MINIGAME_EXITS} 个出口`
              : '添加一个出口'
          }
          emptyText="没有出口（至少需要 1 个）"
        >
          {exits.map((exit) => (
            <div className="vn-node-insp-exit" key={exit.id}>
              <div className="vn-node-insp-exit-head">
                <span className="vn-node-insp-exit-id vn-mono" title="出口 id 创建后不可修改">
                  {exit.id}
                </span>
                <ExitLinkStatus project={project} nodeId={node.id} exitId={exit.id} />
                <SmallButton
                  variant="danger"
                  onClick={() => removeExit(exit)}
                  disabled={exits.length <= 1}
                  title={
                    exits.length <= 1
                      ? '小游戏节点至少保留 1 个出口'
                      : `删除出口「${exit.name}」及其连线`
                  }
                >
                  删除
                </SmallButton>
              </div>
              <FieldText
                label="结果串 name"
                value={exit.name}
                minLength={1}
                maxLength={120}
                required
                onChange={(name) => actions.updateNodeExit(node.id, exit.id, { name })}
                hint="必须与小游戏上报的 result 精确一致"
              />
            </div>
          ))}
        </SubList>

        <FieldSelect
          label="默认出口 defaultExitId"
          value={node.defaultExitId ?? null}
          allowNull
          nullLabel="（无兜底）"
          options={exits.map((exit) => [exit.id, `${exit.name}（${exit.id}）`])}
          onChange={(next) => actions.updateNode(node.id, { defaultExitId: next })}
          hint="结果串无匹配时使用；无兜底时运行时停在小游戏前。"
        />
        {node.defaultExitId && !exits.some((exit) => exit.id === node.defaultExitId) ? (
          <Hint kind="error">当前默认出口已不在出口列表中，请重新选择或设为无兜底。</Hint>
        ) : null}
      </Section>

      <Section title="超时与说明" defaultOpen>
        <NullableNumberField
          label="超时保护 timeoutMs"
          value={node.timeoutMs ?? null}
          min={1000}
          max={600000}
          integer
          enableValue={1000}
          onChange={(timeoutMs) => updateNode({ timeoutMs })}
          suffix="ms"
          hint="超时按「无匹配结果」处理，再走默认出口。"
        />
        <FieldTextArea
          label="玩法说明 instructions"
          value={node.instructions ?? ''}
          maxLength={1000}
          rows={3}
          onChange={(instructions) => updateNode({ instructions })}
          hint="显示在 iframe 上方，可空。"
        />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// video
// ---------------------------------------------------------------------------

function VideoFields({ project, projectDir, node, actions }) {
  const updateNode = (patch) => actions.updateNode(node.id, patch);
  const videos = project?.assets?.videos ?? [];

  return (
    <>
      <Section title="视频素材" defaultOpen>
        <AssetSelect
          label="视频 videoAssetId"
          assets={videos}
          value={node.videoAssetId}
          onChange={(videoAssetId) => {
            if (videoAssetId) updateNode({ videoAssetId });
          }}
          required
          emptyHint="素材库中没有视频素材，请先在左栏导入。"
        />
      </Section>

      <Section title="播放选项" defaultOpen>
        <FieldNumber
          label="音量 volume"
          value={node.volume ?? 1}
          min={0}
          max={1}
          onChange={(volume) => updateNode({ volume })}
        />
        <FieldCheckbox
          label="循环播放 loop"
          value={Boolean(node.loop)}
          onChange={(loop) => updateNode({ loop })}
          hint="循环时不会自动走 completed 出口。"
        />
        <FieldCheckbox
          label="显示跳过按钮 showSkipButton"
          value={Boolean(node.showSkipButton)}
          onChange={(showSkipButton) => updateNode({ showSkipButton })}
        />
        <NullableNumberField
          label="允许跳过时机 skipAfterMs"
          value={node.skipAfterMs ?? null}
          min={0}
          max={600000}
          integer
          enableValue={0}
          onChange={(skipAfterMs) => updateNode({ skipAfterMs })}
          suffix="ms"
          hint="从播放开始计时；清除后满足 showSkipButton 即可立即跳过。"
        />
      </Section>

      <Section title="固定出口" defaultOpen>
        <FixedExits
          project={project}
          node={node}
          ids={['completed', 'skipped']}
          note="视频节点固定 completed / skipped 两个出口，出口 id / name 不可修改；两个出口都必须各有一条连线。"
        />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// jump
// ---------------------------------------------------------------------------

function JumpFields({ project, node, actions }) {
  const updateNode = (patch) => actions.updateNode(node.id, patch);
  const others = (project?.nodes ?? []).filter((item) => item.id !== node.id);
  const targetMissing =
    node.targetNodeId && !(project?.nodes ?? []).some((item) => item.id === node.targetNodeId);

  return (
    <>
      <Section title="跳转目标" defaultOpen>
        <FieldSelect
          label="目标节点 targetNodeId"
          value={node.targetNodeId}
          required
          options={others.map((item) => [
            item.id,
            `${item.name} · ${TYPE_LABELS[item.type] ?? item.type}（${item.id}）`,
          ])}
          onChange={(targetNodeId) => {
            if (targetNodeId) updateNode({ targetNodeId });
          }}
          placeholder="项目中还没有其他节点"
          hint="跳转节点无可见画面，直接转到目标节点；不能指向自身。"
        />
        {targetMissing ? (
          <Hint kind="error">当前目标节点已不存在，请重新选择。</Hint>
        ) : null}
      </Section>

      <Section title="出口" defaultOpen>
        <FixedExits
          project={project}
          node={node}
          ids={[]}
          note="跳转节点没有出口（exits 为空数组），通过 targetNodeId 直接跳转，不接受入端口以外的连线。"
        />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// condition
// ---------------------------------------------------------------------------

function ConditionFields({ project, node, actions }) {
  const updateNode = (patch) => actions.updateNode(node.id, patch);
  const expression = node.expression ?? '';
  const checked = useMemo(() => checkExpression(expression), [expression]);

  return (
    <>
      <Section title="表达式" defaultOpen>
        <FieldTextArea
          label="条件表达式 expression"
          value={expression}
          minLength={1}
          maxLength={2000}
          rows={5}
          mono
          required
          placeholder='例如：has_umbrella == true && money >= 15'
          onChange={(next) => updateNode({ expression: next })}
          hint="1–2000 字符，不能为空。"
        />
        {checked.error ? (
          <Hint kind="error">静态检查：{checked.error}</Hint>
        ) : (
          <Hint kind="success">静态检查通过：括号与引号配平。</Hint>
        )}
        <Hint>
          阶段 5 运行时会做完整白名单解析（不支持 eval / Function / 任意属性访问）；此处只做非空与括号、引号配平检查。
        </Hint>
      </Section>

      <Section title="固定出口" defaultOpen>
        <FixedExits
          project={project}
          node={node}
          ids={['true', 'false']}
          note="条件节点固定 true / false 两个出口；两条出边 kind 必须是 conditional。"
        />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// variable
// ---------------------------------------------------------------------------

function VariableFields({ project, node, actions, notify }) {
  const updateNode = (patch) => actions.updateNode(node.id, patch);
  const assignments = node.assignments ?? [];

  const setAssignments = (next) => updateNode({ assignments: next });

  const replaceAt = (index, next) => {
    setAssignments(assignments.map((item, itemIndex) => (itemIndex === index ? next : item)));
  };

  const addAssignment = () => {
    if (assignments.length >= 64) {
      notify('变量操作最多 64 条赋值', 'warn');
      return;
    }
    const usedKeys = new Set(assignments.map((item) => item.key));
    const key = nextPrefixedId('var_', usedKeys);
    setAssignments([
      ...assignments,
      { key, op: 'set', value: typedDefaultValue('number') },
    ]);
  };

  const removeAssignment = (index) => {
    if (assignments.length <= 1) {
      notify('变量操作节点至少保留 1 条赋值', 'warn');
      return;
    }
    setAssignments(assignments.filter((_, itemIndex) => itemIndex !== index));
  };

  const changeOp = (index, item, op) => {
    if (op === 'toggle') {
      replaceAt(index, { key: item.key, op: 'toggle' });
      return;
    }
    replaceAt(index, {
      key: item.key,
      op,
      value: item.value ?? typedDefaultValue('number'),
    });
  };

  return (
    <>
      <Section title="赋值列表" defaultOpen badge={`${assignments.length}/64`}>
        <Hint>
          按数组顺序依次执行。set 直接替换；add / subtract 仅对数字生效；toggle 不需要操作数；push 仅对数组生效；类型不符时运行时跳过该条并告警。
        </Hint>
        <SubList
          title="赋值"
          count={assignments.length}
          max={64}
          onAdd={addAssignment}
          addLabel="添加赋值"
          addDisabled={assignments.length >= 64}
          addTitle={assignments.length >= 64 ? '最多 64 条赋值' : '追加一条变量操作'}
          emptyText="没有赋值（至少需要 1 条）"
        >
          {assignments.map((item, index) => (
            <div className="vn-node-insp-assignment" key={index}>
              <div className="vn-node-insp-exit-head">
                <span className="vn-node-insp-exit-id">第 {index + 1} 条</span>
                <SmallButton
                  variant="danger"
                  onClick={() => removeAssignment(index)}
                  disabled={assignments.length <= 1}
                  title={
                    assignments.length <= 1
                      ? '变量操作节点至少保留 1 条赋值'
                      : `删除第 ${index + 1} 条赋值`
                  }
                >
                  删除
                </SmallButton>
              </div>
              <FieldText
                label="变量名 key"
                value={item.key}
                minLength={1}
                maxLength={64}
                required
                mono
                validate={(next) =>
                  isValidVariableKey(next)
                    ? null
                    : '变量名必须以字母或下划线开头，只能包含字母 / 数字 / 下划线（1–64 字符）'
                }
                onChange={(key) => replaceAt(index, { ...item, key })}
              />
              <FieldSelect
                label="操作 op"
                value={item.op}
                required
                options={ASSIGNMENT_OPS}
                onChange={(op) => changeOp(index, item, op)}
              />
              {item.op === 'toggle' ? (
                <Hint>toggle 不需要操作数，value 已省略。</Hint>
              ) : (
                <TypedValueEditor
                  label="操作数 value"
                  value={item.value ?? typedDefaultValue('number')}
                  onChange={(value) => replaceAt(index, { ...item, value })}
                />
              )}
            </div>
          ))}
        </SubList>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// 兜底
// ---------------------------------------------------------------------------

function FallbackFields({ node }) {
  const json = useMemo(() => {
    try {
      return JSON.stringify(node, null, 2);
    } catch {
      return String(node);
    }
  }, [node]);

  return (
    <Section title="节点数据（只读）" defaultOpen>
      <Hint kind="warn">
        {node.type === 'scene'
          ? '场景节点请使用 SceneInspector 编辑（A 背景 / B 立绘 / C 文本框 / D 音频 / E 场景变量）。'
          : '该类型节点暂不支持在属性面板中编辑，以下为原始 JSON。'}
      </Hint>
      <pre className="vn-node-insp-json vn-mono">{json}</pre>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// NodeInspector
// ---------------------------------------------------------------------------

export default function NodeInspector({ project: projectProp, projectDir: projectDirProp, node }) {
  const controller = useProjectController();
  const { actions, notify } = controller;
  const project = projectProp ?? controller.project;
  const projectDir = projectDirProp ?? controller.projectDir;

  if (!node) {
    return (
      <div className="vn-node-insp">
        <p className="vn-insp-ctl-empty">未选中节点</p>
      </div>
    );
  }

  const updateNode = (patch) => actions.updateNode(node.id, patch);
  const typeLabel = TYPE_LABELS[node.type] ?? '未知节点';
  const commonProps = { project, projectDir, node, actions, notify };

  let body = null;
  if (node.type === 'dialogue') body = <DialogueFields {...commonProps} />;
  else if (node.type === 'choice') body = <ChoiceFields {...commonProps} />;
  else if (node.type === 'minigame') body = <MinigameFields {...commonProps} />;
  else if (node.type === 'video') body = <VideoFields {...commonProps} />;
  else if (node.type === 'jump') body = <JumpFields {...commonProps} />;
  else if (node.type === 'condition') body = <ConditionFields {...commonProps} />;
  else if (node.type === 'variable') body = <VariableFields {...commonProps} />;
  else body = <FallbackFields node={node} />;

  return (
    <div className="vn-node-insp">
      <header className="vn-node-insp-header">
        <div className="vn-node-insp-heading">
          <h2 className="vn-node-insp-title">{typeLabel}</h2>
          <p className="vn-node-insp-subtitle vn-mono">{node.id}</p>
        </div>
        <span className="vn-chip vn-node-insp-kind">{node.type}</span>
      </header>

      <FieldNotifyProvider key={node.id} notify={notify}>
        <Section title="通用" defaultOpen badge={node.type}>
          <FieldText
            label="名称"
            value={node.name ?? ''}
            minLength={1}
            maxLength={80}
            required
            onChange={(name) => updateNode({ name })}
          />
          <FieldTextArea
            label="备注 notes"
            value={node.notes ?? ''}
            maxLength={2000}
            rows={3}
            onChange={(notes) => updateNode({ notes })}
            hint="≤2000 字，仅作者可见"
          />
          <ReadonlyRow label="节点 id" value={node.id} mono />
          <ReadonlyRow label="节点类型" value={node.type} />
        </Section>
        {body}
      </FieldNotifyProvider>
    </div>
  );
}
