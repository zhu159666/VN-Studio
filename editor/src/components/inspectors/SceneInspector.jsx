// 场景节点属性面板：A 背景 / B 立绘（+ B2 UI 图片层）/ C 文本框 / D 音频 / E 场景变量 + 通用区。
// 所有提交都构造完整、schema 合法的对象后交给 actions.updateNode。
import { useProjectController } from '../../state/ProjectContext';
import {
  AssetSelect,
  FieldCheckbox,
  FieldColor,
  FieldNumber,
  FieldSelect,
  FieldText,
  FieldTextArea,
  FieldNotifyProvider,
  Hint,
  ReadonlyRow,
  Row,
  Section,
  SmallButton,
  SubList,
  TypedValueEditor,
  isValidVariableKey,
  nextPrefixedId,
  typedDefaultValue,
} from './controls';
import { MaterialFields } from './MaterialFields';
import { applySpriteAnimationToTimeline, SPRITE_ANIMATIONS } from '../../features/timeline/spriteAnimations';
import '../../styles/inspector.css';

const BACKGROUND_FITS = [
  ['cover', 'cover · 铺满裁切'],
  ['contain', 'contain · 完整显示'],
  ['stretch', 'stretch · 拉伸铺满'],
];

const FOREGROUND_FITS = BACKGROUND_FITS;
const PARTICLE_PRESETS = [
  ['rain', '雨'],
  ['snow', '雪'],
  ['dust', '浮尘'],
  ['embers', '火星'],
  ['sparkles', '光点'],
  ['none', '关闭'],
];

const DEFAULT_TEXTBOX = {
  x: 0.5,
  y: 0.84,
  width: 0.86,
  height: 0.2,
  fontSizePx: 28,
  color: '#ffffff',
  background: '#000000',
  backgroundOpacity: 0.6,
  opacity: 1,
};

function patchBackground(background, patch) {
  return {
    assetId: background.assetId,
    fit: background.fit ?? 'cover',
    x: background.x ?? 0.5,
    y: background.y ?? 0.5,
    scale: background.scale ?? 1,
    opacity: background.opacity ?? 1,
    ...patch,
  };
}

function patchForeground(foreground, patch) {
  const next = {
    assetId: foreground.assetId,
    opacity: foreground.opacity ?? 1,
    fit: foreground.fit ?? 'cover',
    scale: foreground.scale ?? 1,
    scrollX: foreground.scrollX ?? 0,
    scrollY: foreground.scrollY ?? 0,
    ...patch,
  };
  return next;
}

function patchParticles(particles, patch) {
  const next = {
    preset: particles.preset ?? 'rain',
    density: particles.density ?? 1,
    speed: particles.speed ?? 1,
    wind: particles.wind ?? 0,
    opacity: particles.opacity ?? 0.6,
    ...patch,
  };
  if (next.color == null) delete next.color;
  return next;
}

function makeSprite(base, patch) {
  return {
    id: base.id,
    assetId: base.assetId,
    x: base.x ?? 0.5,
    y: base.y ?? 0.6,
    scale: base.scale ?? 1,
    zIndex: base.zIndex ?? 10,
    opacity: base.opacity ?? 1,
    ...patch,
  };
}

function makeSfxRef(base, patch) {
  const next = { assetId: base.assetId };
  if (base.volume != null) next.volume = base.volume;
  if (base.loop != null) next.loop = base.loop;
  return { ...next, ...patch };
}

function makeSceneVariable(base, patch) {
  const next = {
    key: base.key,
    value: base.value ?? typedDefaultValue('number'),
  };
  if (base.description != null) next.description = base.description;
  return { ...next, ...patch };
}

// ---------------------------------------------------------------------------
// B / B2：立绘与 UI 图片列表（两者结构相同）
// ---------------------------------------------------------------------------

function SpriteSection({ node, project, projectDir, kind, assets, updateNode, actions, notify, defaultOpen = true, title, max = 32 }) {
  const field = kind === 'ui' ? 'uiImages' : 'sprites';
  const otherField = kind === 'ui' ? 'sprites' : 'uiImages';
  const list = node[field] ?? [];
  const otherList = node[otherField] ?? [];
  const usedIds = new Set([
    ...list.map((item) => item.id),
    ...otherList.map((item) => item.id),
  ]);
  const prefix = kind === 'ui' ? 'ui_' : 'sp_';
  const role = kind === 'ui' ? 'ui' : 'sprite';
  const noun = kind === 'ui' ? 'UI 图片' : '立绘';

  const addItem = () => {
    if (!assets?.length) {
      notify(`素材库中没有${noun}素材（role=${role}），请先在左栏导入`, 'error');
      return;
    }
    if (list.length >= max) {
      notify(`${noun}列表最多 ${max} 项`, 'warn');
      return;
    }
    const id = nextPrefixedId(prefix, usedIds);
    const maxZ = list.reduce((value, item) => Math.max(value, Number(item.zIndex) || 0), 0);
    updateNode({
      [field]: [
        ...list,
        {
          id,
          assetId: assets[0].id,
          x: 0.5,
          y: kind === 'ui' ? 0.5 : 0.6,
          scale: 1,
          zIndex: Math.min(1000, maxZ >= 10 ? maxZ + 1 : 10),
          opacity: 1,
        },
      ],
    });
  };

  const patchItem = (index, patch) => {
    updateNode({
      [field]: list.map((item, itemIndex) =>
        itemIndex === index ? makeSprite(item, patch) : item,
      ),
    });
  };

  const removeItem = (index) => {
    updateNode({ [field]: list.filter((_, itemIndex) => itemIndex !== index) });
  };

  const applySpriteAnimation = (item, presetKey) => {
    const preset = SPRITE_ANIMATIONS.find((animation) => animation.key === presetKey);
    if (!preset || kind !== 'sprite') return;
    const existing = project?.timelines?.[node.id] ?? null;
    const timeline = applySpriteAnimationToTimeline(existing, item, presetKey);
    actions.setTimeline(node.id, timeline);
    notify(`已应用动画模板「${preset.label}」，关键帧已写入场景时间轴`, 'success');
  };

  return (
    <Section title={title} badge={`${list.length}/${max}`} defaultOpen={defaultOpen}>
      <SubList
        title={noun}
        count={list.length}
        max={max}
        onAdd={addItem}
        addLabel={`添加${noun}`}
        addDisabled={list.length >= max}
        addTitle={
          list.length >= max
            ? `${noun}列表已满（${max}）`
            : assets?.length
              ? `添加一个${noun}实例`
              : '素材库中没有可用的图片素材'
        }
        emptyText={`暂无${noun}。${kind === 'ui' ? 'UI 图片层可放血条、遮罩等装饰。' : '添加后会在舞台上叠加显示。'}`}
        hint={
          kind === 'ui'
            ? '可选的 UI 图片层，复用立绘条目结构，素材 role 应为 ui。'
            : null
        }
      >
        {list.map((item, index) => (
          <div className="vn-scene-insp-item" key={item.id}>
            <div className="vn-scene-insp-item-head">
              <span className="vn-scene-insp-item-title vn-mono" title="场景内实例 id，时间轴按它引用">
                {item.id}
              </span>
              <SmallButton
                variant="danger"
                onClick={() => removeItem(index)}
                title={`删除${noun}实例「${item.id}」，不会删除素材文件`}
              >
                删除
              </SmallButton>
            </div>
            <AssetSelect
              label={`${noun}素材`}
              assets={assets}
              value={item.assetId}
              onChange={(assetId) => {
                if (assetId) patchItem(index, { assetId });
              }}
              projectDir={projectDir}
              thumbnail
              required
              emptyHint={`素材库中没有${noun}类图片，请先在左栏导入。`}
            />
            {kind === 'sprite' ? (
              <FieldSelect
                label="动画模板"
                value=""
                options={SPRITE_ANIMATIONS.map((animation) => [animation.key, animation.label])}
                placeholder="选择模板…（生成关键帧）"
                onChange={(presetKey) => {
                  if (presetKey) applySpriteAnimation(item, presetKey);
                }}
                hint="选择后会在当前场景时间轴生成可继续编辑的关键帧"
              />
            ) : null}            <div className="vn-insp-ctl-grid-2">
              <FieldNumber
                label="x（0–1）"
                value={item.x ?? 0.5}
                min={0}
                max={1}
                onChange={(x) => patchItem(index, { x })}
              />
              <FieldNumber
                label="y（0–1）"
                value={item.y ?? 0.5}
                min={0}
                max={1}
                onChange={(y) => patchItem(index, { y })}
              />
              <FieldNumber
                label="缩放"
                value={item.scale ?? 1}
                min={0.05}
                max={10}
                onChange={(scale) => patchItem(index, { scale })}
              />
              <FieldNumber
                label="层级 zIndex"
                value={item.zIndex ?? 10}
                min={0}
                max={1000}
                integer
                onChange={(zIndex) => patchItem(index, { zIndex })}
              />
              <FieldNumber
                label="不透明度"
                value={item.opacity ?? 1}
                min={0}
                max={1}
                onChange={(opacity) => patchItem(index, { opacity })}
              />
            </div>
          </div>
        ))}
      </SubList>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// SceneInspector
// ---------------------------------------------------------------------------

export default function SceneInspector({ project: projectProp, projectDir: projectDirProp, node }) {
  const controller = useProjectController();
  const { actions, notify } = controller;
  const project = projectProp ?? controller.project;
  const projectDir = projectDirProp ?? controller.projectDir;

  if (!node) {
    return (
      <div className="vn-scene-insp">
        <p className="vn-insp-ctl-empty">未选中场景节点</p>
      </div>
    );
  }

  const updateNode = (patch) => actions.updateNode(node.id, patch);

  const images = project?.assets?.images ?? [];
  const audioAssets = project?.assets?.audio ?? [];
  const backgroundAssets = images.filter((asset) => asset.role === 'background');
  const spriteAssets = images.filter((asset) => asset.role === 'sprite');
  const uiImageAssets = images.filter((asset) => asset.role === 'ui');
  const foregroundAssets = images.filter((asset) => ['ui', 'background', 'other'].includes(asset.role));
  const bgmAssets = audioAssets.filter((asset) => asset.role === 'bgm');
  const sfxAssets = audioAssets.filter((asset) => asset.role === 'sfx');

  const background = node.background ?? null;
  const sprites = node.sprites ?? [];
  const uiImages = node.uiImages ?? [];
  const foreground = node.foreground ?? null;
  const particles = node.particles ?? null;
  const textbox = node.textbox ?? DEFAULT_TEXTBOX;
  const audio = node.audio ?? { bgmAssetId: null, volume: 0.8, loop: true };
  const sfx = audio.sfx ?? [];
  const sceneVariables = node.variables ?? [];

  const enableBackground = () => {
    if (!backgroundAssets.length) {
      notify('素材库中没有背景素材（role=background），请先在左栏导入', 'error');
      return;
    }
    updateNode({
      background: {
        assetId: backgroundAssets[0].id,
        fit: 'cover',
        x: 0.5,
        y: 0.5,
        scale: 1,
        opacity: 1,
      },
    });
  };

  const enableForeground = () => {
    if (!foregroundAssets.length) {
      notify('素材库中没有可用的前景图片（ui/background/other）', 'error');
      return;
    }
    updateNode({
      foreground: { assetId: foregroundAssets[0].id, opacity: 1, fit: 'cover', scale: 1, scrollX: 0, scrollY: 0 },
    });
  };

  const enableParticles = () => {
    updateNode({ particles: { preset: 'rain', density: 1, speed: 1, wind: 0, opacity: 0.6 } });
  };

  const baseTextbox = {
    x: textbox.x ?? DEFAULT_TEXTBOX.x,
    y: textbox.y ?? DEFAULT_TEXTBOX.y,
    width: textbox.width ?? DEFAULT_TEXTBOX.width,
    height: textbox.height ?? DEFAULT_TEXTBOX.height,
    fontSizePx: textbox.fontSizePx ?? DEFAULT_TEXTBOX.fontSizePx,
    color: textbox.color ?? DEFAULT_TEXTBOX.color,
    background: textbox.background ?? DEFAULT_TEXTBOX.background,
    backgroundOpacity: textbox.backgroundOpacity ?? DEFAULT_TEXTBOX.backgroundOpacity,
    opacity: textbox.opacity ?? DEFAULT_TEXTBOX.opacity,
  };
  if (textbox.paddingPx != null) baseTextbox.paddingPx = textbox.paddingPx;
  baseTextbox.material = textbox.material ?? null;
  const patchTextbox = (patch) => updateNode({ textbox: { ...baseTextbox, ...patch } });

  const baseAudio = {
    bgmAssetId: audio.bgmAssetId ?? null,
    volume: audio.volume ?? 0.8,
    loop: Boolean(audio.loop),
    sfx,
  };
  if (audio.fadeInMs != null) baseAudio.fadeInMs = audio.fadeInMs;
  const patchAudio = (patch) => updateNode({ audio: { ...baseAudio, ...patch } });

  const addSfx = () => {
    if (!sfxAssets.length) {
      notify('素材库中没有音效素材（role=sfx），请先在左栏导入', 'error');
      return;
    }
    if (sfx.length >= 8) {
      notify('场景音效最多 8 条', 'warn');
      return;
    }
    patchAudio({ sfx: [...sfx, { assetId: sfxAssets[0].id, volume: 1, loop: false }] });
  };

  const patchSfxAt = (index, patch) => {
    patchAudio({
      sfx: sfx.map((item, itemIndex) =>
        itemIndex === index ? makeSfxRef(item, patch) : item,
      ),
    });
  };

  const removeSfxAt = (index) => {
    patchAudio({ sfx: sfx.filter((_, itemIndex) => itemIndex !== index) });
  };

  const addSceneVariable = () => {
    if (sceneVariables.length >= 128) {
      notify('场景变量最多 128 个', 'warn');
      return;
    }
    const usedKeys = new Set(sceneVariables.map((item) => item.key));
    const key = nextPrefixedId('var_', usedKeys);
    updateNode({
      variables: [...sceneVariables, { key, value: typedDefaultValue('number') }],
    });
  };

  const patchVariableAt = (index, patch) => {
    updateNode({
      variables: sceneVariables.map((item, itemIndex) =>
        itemIndex === index ? makeSceneVariable(item, patch) : item,
      ),
    });
  };

  const removeVariableAt = (index) => {
    updateNode({ variables: sceneVariables.filter((_, itemIndex) => itemIndex !== index) });
  };

  return (
    <div className="vn-scene-insp">
      <header className="vn-scene-insp-header">
        <div className="vn-scene-insp-heading">
          <h2 className="vn-scene-insp-title">场景节点</h2>
          <p className="vn-scene-insp-subtitle vn-mono">{node.id}</p>
        </div>
        <span className="vn-chip vn-scene-insp-kind">scene</span>
      </header>

      <FieldNotifyProvider key={node.id} notify={notify}>
        <Section title="通用" defaultOpen badge="scene">
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

        {/* A. 背景 */}
        <Section title="A · 背景" defaultOpen badge={background ? background.assetId : '无背景'}>
          {background ? (
            <>
              <AssetSelect
                label="背景图"
                assets={backgroundAssets}
                value={background.assetId}
                onChange={(assetId) => {
                  if (assetId) updateNode({ background: patchBackground(background, { assetId }) });
                }}
                projectDir={projectDir}
                thumbnail
                required
                emptyHint="素材库中没有背景素材（role=background）。"
              />
              <FieldSelect
                label="铺满方式 fit"
                value={background.fit ?? 'cover'}
                onChange={(fit) => updateNode({ background: patchBackground(background, { fit }) })}
                options={BACKGROUND_FITS}
                required
              />
              <div className="vn-insp-ctl-grid-2">
                <FieldNumber
                  label="x（0–1）"
                  value={background.x ?? 0.5}
                  min={0}
                  max={1}
                  onChange={(x) => updateNode({ background: patchBackground(background, { x }) })}
                />
                <FieldNumber
                  label="y（0–1）"
                  value={background.y ?? 0.5}
                  min={0}
                  max={1}
                  onChange={(y) => updateNode({ background: patchBackground(background, { y }) })}
                />
                <FieldNumber
                  label="缩放"
                  value={background.scale ?? 1}
                  min={0.05}
                  max={10}
                  onChange={(scale) =>
                    updateNode({ background: patchBackground(background, { scale }) })
                  }
                />
                <FieldNumber
                  label="不透明度"
                  value={background.opacity ?? 1}
                  min={0}
                  max={1}
                  onChange={(opacity) =>
                    updateNode({ background: patchBackground(background, { opacity }) })
                  }
                />
              </div>
              <div className="vn-insp-ctl-actions">
                <SmallButton
                  variant="danger"
                  onClick={() => updateNode({ background: null })}
                  title="清除背景（将该场景 background 设为 null）"
                >
                  清除背景
                </SmallButton>
              </div>
            </>
          ) : (
            <>
              <Row label="背景">
                <div className="vn-insp-ctl-inline">
                  <span className="vn-insp-ctl-null">未启用</span>
                  <SmallButton
                    onClick={enableBackground}
                    disabled={!backgroundAssets.length}
                    title={
                      backgroundAssets.length
                        ? '为该场景添加背景'
                        : '素材库中没有背景素材（role=background）'
                    }
                  >
                    启用背景
                  </SmallButton>
                </div>
              </Row>
              <Hint kind={backgroundAssets.length ? 'info' : 'warn'}>
                {backgroundAssets.length
                  ? '背景是场景静态基线值，阶段四可用时间轴 background 轨道覆盖。'
                  : '素材库中没有背景素材，请先在左栏导入 role=background 的图片。'}
              </Hint>
            </>
          )}
        </Section>

        {/* B. 立绘 */}
        <SpriteSection
          node={node}
          project={project}
          projectDir={projectDir}
          kind="sprite"
          assets={spriteAssets}
          updateNode={updateNode}
          actions={actions}
          notify={notify}
          title="B · 立绘"
        />

        {/* B2. UI 图片层（可选） */}
        <SpriteSection
          node={node}
          project={project}
          projectDir={projectDir}
          kind="ui"
          assets={uiImageAssets}
          updateNode={updateNode}
          actions={actions}
          notify={notify}
          title="B2 · UI 图片层"
          defaultOpen={false}
        />

        {/* B3. 前景层（可选） */}
        <Section title="B3 · 前景层" defaultOpen={false} badge={foreground ? foreground.assetId : '关'}>
          {foreground ? (
            <>
              <AssetSelect
                label="前景图片"
                assets={foregroundAssets}
                value={foreground.assetId}
                onChange={(assetId) => {
                  if (assetId) updateNode({ foreground: patchForeground(foreground, { assetId }) });
                }}
                projectDir={projectDir}
                thumbnail
                required
                emptyHint="素材库中没有 ui/background/other 图片。"
              />
              <FieldSelect
                label="铺满方式 fit"
                value={foreground.fit ?? 'cover'}
                onChange={(fit) => updateNode({ foreground: patchForeground(foreground, { fit }) })}
                options={FOREGROUND_FITS}
                required
              />
              <div className="vn-insp-ctl-grid-2">
                <FieldNumber
                  label="不透明度"
                  value={foreground.opacity ?? 1}
                  min={0}
                  max={1}
                  onChange={(opacity) => updateNode({ foreground: patchForeground(foreground, { opacity }) })}
                />
                <FieldNumber
                  label="缩放"
                  value={foreground.scale ?? 1}
                  min={0.05}
                  max={5}
                  onChange={(scale) => updateNode({ foreground: patchForeground(foreground, { scale }) })}
                />
                <FieldNumber
                  label="视差 X"
                  value={foreground.scrollX ?? 0}
                  min={-2}
                  max={2}
                  onChange={(scrollX) => updateNode({ foreground: patchForeground(foreground, { scrollX }) })}
                />
                <FieldNumber
                  label="视差 Y"
                  value={foreground.scrollY ?? 0}
                  min={-2}
                  max={2}
                  onChange={(scrollY) => updateNode({ foreground: patchForeground(foreground, { scrollY }) })}
                />
              </div>
              <div className="vn-insp-ctl-actions">
                <SmallButton variant="danger" onClick={() => updateNode({ foreground: null })}>
                  清除前景层
                </SmallButton>
              </div>
            </>
          ) : (
            <Row label="前景层">
              <div className="vn-insp-ctl-inline">
                <span className="vn-insp-ctl-null">未启用</span>
                <SmallButton onClick={enableForeground} disabled={!foregroundAssets.length}>
                  启用前景
                </SmallButton>
              </div>
            </Row>
          )}
          <Hint kind="info">前景层叠在立绘之上、文本框之下，可按镜头做视差偏移。</Hint>
        </Section>

        {/* B4. 粒子层（可选） */}
        <Section title="B4 · 粒子层" defaultOpen={false} badge={particles ? particles.preset : '关'}>
          {particles ? (
            <>
              <FieldSelect
                label="粒子 preset"
                value={particles.preset ?? 'rain'}
                onChange={(preset) => updateNode({ particles: patchParticles(particles, { preset }) })}
                options={PARTICLE_PRESETS}
                required
              />
              <div className="vn-insp-ctl-grid-2">
                <FieldNumber
                  label="密度"
                  value={particles.density ?? 1}
                  min={0}
                  max={3}
                  onChange={(density) => updateNode({ particles: patchParticles(particles, { density }) })}
                />
                <FieldNumber
                  label="速度"
                  value={particles.speed ?? 1}
                  min={0.1}
                  max={5}
                  onChange={(speed) => updateNode({ particles: patchParticles(particles, { speed }) })}
                />
                <FieldNumber
                  label="风向"
                  value={particles.wind ?? 0}
                  min={-2}
                  max={2}
                  onChange={(wind) => updateNode({ particles: patchParticles(particles, { wind }) })}
                />
                <FieldNumber
                  label="不透明度"
                  value={particles.opacity ?? 0.6}
                  min={0}
                  max={1}
                  onChange={(opacity) => updateNode({ particles: patchParticles(particles, { opacity }) })}
                />
              </div>
              <FieldColor
                label="粒子颜色（可选）"
                value={particles.color ?? '#a9c8e8'}
                onChange={(color) => updateNode({ particles: patchParticles(particles, { color }) })}
              />
              <div className="vn-insp-ctl-actions">
                <SmallButton variant="danger" onClick={() => updateNode({ particles: null })}>
                  清除粒子层
                </SmallButton>
              </div>
            </>
          ) : (
            <Row label="粒子层">
              <div className="vn-insp-ctl-inline">
                <span className="vn-insp-ctl-null">未启用</span>
                <SmallButton onClick={enableParticles}>启用粒子</SmallButton>
              </div>
            </Row>
          )}
          <Hint kind="info">粒子是运行时实时生成，不会增加图片素材体积。</Hint>
        </Section>

        {/* C. 文本框 */}
        <Section title="C · 文本框" defaultOpen badge={`${baseTextbox.fontSizePx}px`}>
          <div className="vn-insp-ctl-grid-2">
            <FieldNumber
              label="x（0–1）"
              value={baseTextbox.x}
              min={0}
              max={1}
              onChange={(x) => patchTextbox({ x })}
            />
            <FieldNumber
              label="y（0–1）"
              value={baseTextbox.y}
              min={0}
              max={1}
              onChange={(y) => patchTextbox({ y })}
            />
            <FieldNumber
              label="宽度（0.05–1）"
              value={baseTextbox.width}
              min={0.05}
              max={1}
              onChange={(width) => patchTextbox({ width })}
            />
            <FieldNumber
              label="高度（0.05–1）"
              value={baseTextbox.height}
              min={0.05}
              max={1}
              onChange={(height) => patchTextbox({ height })}
            />
            <FieldNumber
              label="字号 fontSizePx"
              value={baseTextbox.fontSizePx}
              min={8}
              max={200}
              integer
              onChange={(fontSizePx) => patchTextbox({ fontSizePx })}
            />
            <FieldNumber
              label="内边距 paddingPx"
              value={baseTextbox.paddingPx ?? 0}
              min={0}
              max={200}
              onChange={(paddingPx) => patchTextbox({ paddingPx })}
            />
          </div>
          <FieldColor
            label="文字颜色"
            value={baseTextbox.color}
            onChange={(color) => patchTextbox({ color })}
            required
          />
          <FieldColor
            label="底框颜色"
            value={baseTextbox.background}
            onChange={(bgColor) => patchTextbox({ background: bgColor })}
            required
          />
          <div className="vn-insp-ctl-grid-2">
            <FieldNumber
              label="底框不透明度"
              value={baseTextbox.backgroundOpacity}
              min={0}
              max={1}
              onChange={(backgroundOpacity) => patchTextbox({ backgroundOpacity })}
            />
            <FieldNumber
              label="整体不透明度"
              value={baseTextbox.opacity}
              min={0}
              max={1}
              onChange={(opacity) => patchTextbox({ opacity })}
            />
          </div>
        </Section>

        {/* C2. 对话框材质 */}
        <Section
          title="对话框材质"
          defaultOpen={false}
          badge={baseTextbox.material?.imageAssetId ? '图片' : '内置'}
        >
          <Hint>
            选一张图片作为对话框背景，可调填充方式、透明度、边框与圆角；不设置时使用运行时内置样式。
          </Hint>
          <MaterialFields
            material={baseTextbox.material}
            onChange={(material) => patchTextbox({ material })}
            projectDir={projectDir}
            assets={images}
            label="对话框"
          />
          <div className="vn-insp-ctl-actions">
            <SmallButton onClick={() => patchTextbox({ material: null })}>
              恢复内置样式
            </SmallButton>
          </div>
        </Section>

        {/* D. 音频 */}
        <Section title="D · 音频" defaultOpen={false} badge={audio.bgmAssetId ? 'BGM' : '静音'}>
          <AssetSelect
            label="背景音乐 bgmAssetId"
            assets={bgmAssets}
            value={audio.bgmAssetId ?? null}
            onChange={(bgmAssetId) => patchAudio({ bgmAssetId })}
            allowNull
            nullLabel="（无背景音乐）"
            projectDir={projectDir}
            thumbnail
            emptyHint="素材库中没有背景音乐素材（role=bgm），可先导入。"
          />
          <div className="vn-insp-ctl-grid-2">
            <FieldNumber
              label="音量 volume"
              value={audio.volume ?? 0.8}
              min={0}
              max={1}
              onChange={(volume) => patchAudio({ volume })}
            />
            <FieldNumber
              label="淡入 fadeInMs"
              value={audio.fadeInMs ?? 0}
              min={0}
              max={60000}
              integer
              suffix="ms"
              onChange={(fadeInMs) => patchAudio({ fadeInMs })}
            />
          </div>
          <FieldCheckbox
            label="循环播放 loop"
            value={Boolean(audio.loop)}
            onChange={(loop) => patchAudio({ loop })}
          />
          <SubList
            title="场景音效 sfx"
            count={sfx.length}
            max={8}
            onAdd={addSfx}
            addLabel="添加音效"
            addDisabled={sfx.length >= 8}
            addTitle={sfx.length >= 8 ? '场景音效最多 8 条' : '进入场景时播放的音效'}
            emptyText="暂无场景音效"
          >
            {sfx.map((item, index) => (
              <div className="vn-scene-insp-item" key={index}>
                <div className="vn-scene-insp-item-head">
                  <span className="vn-scene-insp-item-title">音效 {index + 1}</span>
                  <SmallButton
                    variant="danger"
                    onClick={() => removeSfxAt(index)}
                    title={`删除第 ${index + 1} 条场景音效`}
                  >
                    删除
                  </SmallButton>
                </div>
                <AssetSelect
                  label="音效素材"
                  assets={sfxAssets}
                  value={item.assetId}
                  onChange={(assetId) => {
                    if (assetId) patchSfxAt(index, { assetId });
                  }}
                  projectDir={projectDir}
                  thumbnail
                  required
                />
                <div className="vn-insp-ctl-grid-2">
                  <FieldNumber
                    label="音量"
                    value={item.volume ?? 1}
                    min={0}
                    max={1}
                    onChange={(volume) => patchSfxAt(index, { volume })}
                  />
                  <FieldCheckbox
                    label="循环"
                    value={Boolean(item.loop)}
                    onChange={(loop) => patchSfxAt(index, { loop })}
                  />
                </div>
              </div>
            ))}
          </SubList>
        </Section>

        {/* E. 场景变量 */}
        <Section title="E · 场景变量" defaultOpen={false} badge={sceneVariables.length}>
          <Hint>
            进入场景时，若全局变量表尚无该键，则按「初值」初始化；已有值不会被覆盖。变量名须匹配
            {'^[A-Za-z_][A-Za-z0-9_]{0,63}$'}，且场景内不重复。
          </Hint>
          <SubList
            title="变量声明"
            count={sceneVariables.length}
            max={128}
            onAdd={addSceneVariable}
            addLabel="添加变量"
            addDisabled={sceneVariables.length >= 128}
            addTitle={sceneVariables.length >= 128 ? '场景变量最多 128 个' : '添加一条场景变量声明'}
            emptyText="暂无场景变量"
          >
            {sceneVariables.map((item, index) => (
              <div className="vn-scene-insp-item" key={index}>
                <div className="vn-scene-insp-item-head">
                  <span className="vn-scene-insp-item-title vn-mono">{item.key}</span>
                  <SmallButton
                    variant="danger"
                    onClick={() => removeVariableAt(index)}
                    title={`删除场景变量「${item.key}」`}
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
                  validate={(next) => {
                    if (!isValidVariableKey(next)) {
                      return '变量名必须以字母或下划线开头，只能包含字母 / 数字 / 下划线（1–64 字符）';
                    }
                    if (
                      sceneVariables.some(
                        (other, otherIndex) => otherIndex !== index && other.key === next,
                      )
                    ) {
                      return `场景内变量名「${next}」重复`;
                    }
                    return null;
                  }}
                  onChange={(key) => patchVariableAt(index, { key })}
                  hint="^[A-Za-z_][A-Za-z0-9_]{0,63}$"
                />
                <TypedValueEditor
                  label="初值"
                  value={item.value}
                  onChange={(value) => patchVariableAt(index, { value })}
                />
                <FieldText
                  label="说明"
                  value={item.description ?? ''}
                  maxLength={500}
                  onChange={(description) => patchVariableAt(index, { description })}
                />
              </div>
            ))}
          </SubList>
        </Section>
      </FieldNotifyProvider>
    </div>
  );
}
