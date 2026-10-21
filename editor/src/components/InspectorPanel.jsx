import { useEffect, useState } from 'react';

import { useProjectController } from '../state/ProjectContext';

const IMAGE_ROLES = [
  ['background', '背景'],
  ['sprite', '立绘'],
  ['ui', 'UI'],
  ['other', '其他'],
];

const AUDIO_ROLES = [
  ['bgm', '背景音乐'],
  ['sfx', '音效'],
  ['voice', '语音'],
];

const LIMITS = { minWidth: 320, maxWidth: 7680, minHeight: 240, maxHeight: 4320 };

function formatMs(ms) {
  if (!Number.isFinite(ms)) return '—';
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function Field({ label, children }) {
  return (
    <label className="vn-inspector__field">
      <span className="vn-inspector__label">{label}</span>
      {children}
    </label>
  );
}

function ReadonlyRow({ label, value, mono = false }) {
  return (
    <div className="vn-inspector__row">
      <span className="vn-inspector__label">{label}</span>
      <span className={`vn-inspector__value ${mono ? 'vn-mono' : ''}`}>{value ?? '—'}</span>
    </div>
  );
}

function ImageDetails({ asset }) {
  const edit = asset.edit ?? {};
  const crop = edit.crop;
  const background = edit.removeBackground;
  const adjustments = edit.adjustments;
  return (
    <>
      <ReadonlyRow label="尺寸" value={`${asset.width} × ${asset.height}`} />
      <ReadonlyRow label="格式" value={asset.format} />
      {crop ? (
        <ReadonlyRow
          label="裁剪"
          value={`x${crop.x} y${crop.y} ${crop.width}×${crop.height}`}
          mono
        />
      ) : null}
      {background ? (
        <ReadonlyRow
          label="去背景"
          value={`${background.color} · 容差 ${background.tolerance} · 羽化 ${background.softness ?? 0}px`}
        />
      ) : null}
      {adjustments && (adjustments.brightness || adjustments.contrast) ? (
        <ReadonlyRow
          label="亮度/对比度"
          value={`${adjustments.brightness ?? 0} / ${adjustments.contrast ?? 0}`}
        />
      ) : null}
      {asset.source ? (
        <ReadonlyRow label="原始文件" value={asset.source.path} mono />
      ) : null}
    </>
  );
}

function AudioDetails({ asset }) {
  return (
    <>
      <ReadonlyRow label="时长" value={formatMs(asset.durationMs)} />
      <ReadonlyRow label="格式" value={asset.format} />
      {asset.trim ? (
        <ReadonlyRow
          label="截取"
          value={`${formatMs(asset.trim.startMs)} → ${formatMs(asset.trim.endMs)}`}
        />
      ) : null}
      <ReadonlyRow label="增益" value={`${asset.gainDb ?? 0} dB`} />
      {asset.source ? (
        <ReadonlyRow label="原始文件" value={asset.source.path} mono />
      ) : null}
    </>
  );
}

function VideoDetails({ asset }) {
  return (
    <>
      <ReadonlyRow label="容器" value={asset.format} />
      <ReadonlyRow label="编码" value={asset.codec ?? '未探测'} />
      <ReadonlyRow
        label="分辨率"
        value={asset.width && asset.height ? `${asset.width} × ${asset.height}` : '未探测'}
      />
      <ReadonlyRow label="时长" value={formatMs(asset.durationMs)} />
      <ReadonlyRow label="音轨" value={asset.hasAudio ? '有' : '无 / 未知'} />
      <ReadonlyRow label="大小" value={asset.sizeBytes ? `${(asset.sizeBytes / 1024 / 1024).toFixed(2)} MB` : '—'} />
    </>
  );
}

function MinigameDetails({ asset }) {
  return (
    <>
      <ReadonlyRow label="模式" value={asset.mode ?? 'blocking'} />
      <div className="vn-inspector__row vn-inspector__row--wrap">
        <span className="vn-inspector__label">声明出口</span>
        <span className="vn-inspector__chips">
          {(asset.declaredExits ?? []).map((exit) => (
            <span className="vn-chip" key={exit}>
              {exit}
            </span>
          ))}
        </span>
      </div>
      <ReadonlyRow label="入口文件" value={asset.path} mono />
    </>
  );
}

export default function InspectorPanel({ project, selectedAsset, onRemoveAsset }) {
  const controller = useProjectController();
  const { actions, notify } = controller;

  const [title, setTitle] = useState(project.meta?.title ?? '');
  const [author, setAuthor] = useState(project.meta?.author ?? '');
  const [description, setDescription] = useState(project.meta?.description ?? '');
  const [assetName, setAssetName] = useState(selectedAsset?.name ?? '');
  const [resolution, setResolution] = useState({
    width: project.settings?.resolution?.width ?? 1280,
    height: project.settings?.resolution?.height ?? 720,
  });
  const [textSpeed, setTextSpeed] = useState(project.settings?.textSpeedCps ?? 30);

  useEffect(() => {
    setTitle(project.meta?.title ?? '');
    setAuthor(project.meta?.author ?? '');
    setDescription(project.meta?.description ?? '');
    setResolution({
      width: project.settings?.resolution?.width ?? 1280,
      height: project.settings?.resolution?.height ?? 720,
    });
    setTextSpeed(project.settings?.textSpeedCps ?? 30);
  }, [project.meta?.id, project.meta?.title, project.meta?.author, project.meta?.description, project.settings?.resolution?.width, project.settings?.resolution?.height, project.settings?.textSpeedCps]);

  useEffect(() => {
    setAssetName(selectedAsset?.name ?? '');
  }, [selectedAsset?.id, selectedAsset?.name]);

  const commitTitle = () => {
    const value = title.trim();
    if (!value) {
      notify('项目标题不能为空', 'error');
      setTitle(project.meta?.title ?? '');
      return;
    }
    actions.updateMeta({ title: value });
    setTitle(value);
  };

  const commitAssetName = () => {
    if (!selectedAsset) return;
    const value = assetName.trim();
    if (!value) {
      notify('素材名称不能为空', 'error');
      setAssetName(selectedAsset.name);
      return;
    }
    actions.updateAsset(selectedAsset.id, { name: value });
    setAssetName(value);
  };

  const applyResolution = () => {
    const width = Math.round(Number(resolution.width));
    const height = Math.round(Number(resolution.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      notify('分辨率必须是数字', 'error');
      return;
    }
    if (
      width < LIMITS.minWidth ||
      width > LIMITS.maxWidth ||
      height < LIMITS.minHeight ||
      height > LIMITS.maxHeight
    ) {
      notify('分辨率超出允许范围', 'error');
      return;
    }
    actions.updateSettings({ resolution: { width, height } });
    notify('分辨率已更新（将在阶段 3 的画布中生效）', 'success');
  };

  const handleDelete = async () => {
    if (!selectedAsset) return;
    const confirmed = window.confirm(
      `确定删除素材「${selectedAsset.name}」？将同时删除磁盘文件，引用它的节点/时间轴会失效。`,
    );
    if (!confirmed) return;
    await onRemoveAsset(selectedAsset);
  };

  return (
    <div className="vn-inspector">
      {selectedAsset ? (
        <>
          <header className="vn-inspector__header">
            <div>
              <h2>{selectedAsset.kind === 'image' ? '图片素材' : selectedAsset.kind === 'audio' ? '音频素材' : selectedAsset.kind === 'video' ? '视频素材' : '小游戏素材'}</h2>
              <p className="vn-inspector__subtitle vn-mono">{selectedAsset.id}</p>
            </div>
            <span className={`vn-chip vn-chip--kind vn-chip--${selectedAsset.kind}`}>
              {selectedAsset.kind}
            </span>
          </header>

          <section className="vn-inspector__section">
            <h3 className="vn-inspector__heading">基础</h3>
            <Field label="名称">
              <input
                className="vn-input"
                value={assetName}
                maxLength={200}
                onChange={(event) => setAssetName(event.target.value)}
                onBlur={commitAssetName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </Field>
            {selectedAsset.kind === 'image' ? (
              <Field label="用途">
                <select
                  className="vn-select"
                  value={selectedAsset.role}
                  onChange={(event) => actions.updateAsset(selectedAsset.id, { role: event.target.value })}
                >
                  {IMAGE_ROLES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {selectedAsset.kind === 'audio' ? (
              <Field label="用途">
                <select
                  className="vn-select"
                  value={selectedAsset.role}
                  onChange={(event) => actions.updateAsset(selectedAsset.id, { role: event.target.value })}
                >
                  {AUDIO_ROLES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <ReadonlyRow label="路径" value={selectedAsset.path} mono />
            {selectedAsset.importedAt ? (
              <ReadonlyRow label="导入时间" value={new Date(selectedAsset.importedAt).toLocaleString('zh-CN')} />
            ) : null}
            {selectedAsset.sizeBytes ? (
              <ReadonlyRow label="文件大小" value={`${(selectedAsset.sizeBytes / 1024).toFixed(1)} KB`} />
            ) : null}
          </section>

          <section className="vn-inspector__section">
            <h3 className="vn-inspector__heading">素材属性</h3>
            {selectedAsset.kind === 'image' ? <ImageDetails asset={selectedAsset} /> : null}
            {selectedAsset.kind === 'audio' ? <AudioDetails asset={selectedAsset} /> : null}
            {selectedAsset.kind === 'video' ? <VideoDetails asset={selectedAsset} /> : null}
            {selectedAsset.kind === 'minigame' ? <MinigameDetails asset={selectedAsset} /> : null}
          </section>

          <section className="vn-inspector__section">
            <h3 className="vn-inspector__heading">编辑</h3>
            <p className="vn-inspector__hint">
              在中间工作区编辑该素材；保存后项目文件会自动更新。删除素材不可撤销。
            </p>
            <button type="button" className="vn-btn vn-btn--danger" onClick={handleDelete}>
              删除素材
            </button>
          </section>
        </>
      ) : (
        <>
          <header className="vn-inspector__header">
            <div>
              <h2>项目设置</h2>
              <p className="vn-inspector__subtitle">未选中素材</p>
            </div>
          </header>

          <section className="vn-inspector__section">
            <h3 className="vn-inspector__heading">基本信息</h3>
            <Field label="标题">
              <input
                className="vn-input"
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </Field>
            <Field label="作者">
              <input
                className="vn-input"
                value={author}
                maxLength={200}
                onChange={(event) => setAuthor(event.target.value)}
                onBlur={() => actions.updateMeta({ author })}
              />
            </Field>
            <Field label="简介">
              <textarea
                className="vn-textarea"
                value={description}
                maxLength={2000}
                rows={4}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={() => actions.updateMeta({ description })}
              />
            </Field>
          </section>

          <section className="vn-inspector__section">
            <h3 className="vn-inspector__heading">运行时</h3>
            <div className="vn-inspector__inline">
              <Field label="宽">
                <input
                  className="vn-input"
                  type="number"
                  min={LIMITS.minWidth}
                  max={LIMITS.maxWidth}
                  value={resolution.width}
                  onChange={(event) => setResolution((prev) => ({ ...prev, width: event.target.value }))}
                />
              </Field>
              <Field label="高">
                <input
                  className="vn-input"
                  type="number"
                  min={LIMITS.minHeight}
                  max={LIMITS.maxHeight}
                  value={resolution.height}
                  onChange={(event) => setResolution((prev) => ({ ...prev, height: event.target.value }))}
                />
              </Field>
            </div>
            <button type="button" className="vn-btn" onClick={applyResolution}>
              应用分辨率
            </button>
            <Field label="文字速度（字/秒，0=瞬显）">
              <input
                className="vn-input"
                type="number"
                min={0}
                max={1000}
                value={textSpeed}
                onChange={(event) => setTextSpeed(event.target.value)}
                onBlur={() => {
                  const value = Number(textSpeed);
                  if (!Number.isFinite(value) || value < 0 || value > 1000) {
                    notify('文字速度必须在 0–1000 之间', 'error');
                    setTextSpeed(project.settings?.textSpeedCps ?? 30);
                    return;
                  }
                  actions.updateSettings({ textSpeedCps: value });
                }}
              />
            </Field>
            <ReadonlyRow label="起始节点" value={project.settings?.startNodeId} mono />
            <ReadonlyRow label="背景色" value={project.settings?.backgroundColor} mono />
          </section>

          <section className="vn-inspector__section">
            <h3 className="vn-inspector__heading">文件</h3>
            <ReadonlyRow label="项目 ID" value={project.meta?.id} mono />
            <ReadonlyRow label="schemaVersion" value={project.schemaVersion} />
            <ReadonlyRow label="项目文件" value={controller.projectPath} mono />
          </section>
        </>
      )}
    </div>
  );
}
