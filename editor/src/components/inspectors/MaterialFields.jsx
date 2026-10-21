/**
 * 界面材质编辑控件（对话框 / 选项 / 标题 / 结束 / 存档菜单共用）。
 *
 * 材质是「可选对象」：所有字段省略时运行时使用内置样式；
 * 这里只在作者调整某个字段时写入对应字段，避免把默认值固化成项目数据。
 */
import { AssetSelect, FieldColor, FieldNumber, FieldSelect } from './controls';

export const IMAGE_MODES = [
  ['stretch', '拉伸铺满'],
  ['cover', '铺满裁切'],
  ['contain', '完整显示'],
];

const DEFAULT_BORDER_COLOR = '#3a4a5e';

function merge(value, patch) {
  return { ...(value ?? {}), ...patch };
}

/** uiMaterial 的通用字段：图片 / 填充方式 / 图片透明度 / 边框 / 圆角 */
export function MaterialFields({ material, onChange, projectDir, assets, label = '材质' }) {
  const value = material ?? {};
  const patch = (next) => onChange(merge(value, next));
  return (
    <>
      <AssetSelect
        label={`${label}图片`}
        assets={assets}
        value={value.imageAssetId ?? null}
        onChange={(imageAssetId) => patch({ imageAssetId })}
        allowNull
        nullLabel="（无，使用内置样式）"
        projectDir={projectDir}
        thumbnail
        emptyHint="素材库中没有图片；可先导入 role=UI 的图片作为界面材质。"
      />
      <FieldSelect
        label="图片填充方式"
        value={value.imageMode ?? 'stretch'}
        options={IMAGE_MODES}
        onChange={(imageMode) => patch({ imageMode })}
      />
      <FieldNumber
        label="图片透明度"
        value={value.imageOpacity ?? 1}
        min={0}
        max={1}
        step={0.05}
        onChange={(imageOpacity) => patch({ imageOpacity })}
      />
      <FieldColor
        label="边框颜色"
        value={value.borderColor ?? DEFAULT_BORDER_COLOR}
        onChange={(borderColor) => patch({ borderColor })}
      />
      <div className="vn-insp-ctl-grid-2">
        <FieldNumber
          label="边框宽度 px"
          value={value.borderWidthPx ?? 1}
          min={0}
          max={24}
          step={1}
          onChange={(borderWidthPx) => patch({ borderWidthPx })}
        />
        <FieldNumber
          label="圆角 px"
          value={value.borderRadiusPx ?? 10}
          min={0}
          max={120}
          step={1}
          onChange={(borderRadiusPx) => patch({ borderRadiusPx })}
        />
      </div>
    </>
  );
}

/** choiceMaterial：通用材质 + 选项专属（文字色 / 间距 / 悬停配色） */
export function ChoiceMaterialFields({ material, onChange, projectDir, assets }) {
  const value = material ?? {};
  const patch = (next) => onChange(merge(value, next));
  return (
    <>
      <MaterialFields
        material={material}
        onChange={onChange}
        projectDir={projectDir}
        assets={assets}
        label="选项"
      />
      <FieldColor
        label="选项文字颜色"
        value={value.textColor ?? '#e9f2fd'}
        onChange={(textColor) => patch({ textColor })}
      />
      <FieldNumber
        label="选项间距 px"
        value={value.gapPx ?? 10}
        min={0}
        max={60}
        step={1}
        onChange={(gapPx) => patch({ gapPx })}
      />
      <FieldColor
        label="悬停背景色"
        value={value.hoverBackgroundColor ?? '#243852'}
        onChange={(hoverBackgroundColor) => patch({ hoverBackgroundColor })}
      />
      <FieldColor
        label="悬停边框色"
        value={value.hoverBorderColor ?? '#6ba6f4'}
        onChange={(hoverBorderColor) => patch({ hoverBorderColor })}
      />
    </>
  );
}

/** 标题界面整屏背景图材质（uiBackdrop） */
export function BackdropFields({ backdrop, onChange, projectDir, assets }) {
  const value = backdrop ?? {};
  const patch = (next) => onChange(merge(value, next));
  return (
    <>
      <AssetSelect
        label="标题背景图"
        assets={assets}
        value={value.imageAssetId ?? null}
        onChange={(imageAssetId) => patch({ imageAssetId })}
        allowNull
        nullLabel="（无，使用内置标题样式）"
        projectDir={projectDir}
        thumbnail
        emptyHint="素材库中没有图片；可先导入 role=UI 或 background 的图片。"
      />
      <FieldSelect
        label="背景填充方式"
        value={value.imageMode ?? 'cover'}
        options={IMAGE_MODES}
        onChange={(imageMode) => patch({ imageMode })}
      />
      <FieldNumber
        label="背景透明度"
        value={value.imageOpacity ?? 1}
        min={0}
        max={1}
        step={0.05}
        onChange={(imageOpacity) => patch({ imageOpacity })}
      />
    </>
  );
}
