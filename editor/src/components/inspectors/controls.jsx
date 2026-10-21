// 阶段三属性面板通用控件。
// 设计约定：
// - 所有控件都做草稿（draft），失焦 / Enter 时才提交，非法输入 notify 并回退到当前值；
// - 控件本身不直接调用 controller，只通过 onChange 回调提交结果；
// - 校验失败统一通过 FieldNotifyProvider 暴露的 notify 上报，便于三个 Inspector 复用。
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { assetDataUrl } from '../../api';

const FieldNotifyContext = createContext(null);

export function FieldNotifyProvider({ notify, children }) {
  return (
    <FieldNotifyContext.Provider value={notify ?? null}>{children}</FieldNotifyContext.Provider>
  );
}

function useFieldNotify() {
  return useContext(FieldNotifyContext);
}

// ---------------------------------------------------------------------------
// 常量 / 纯函数工具
// ---------------------------------------------------------------------------

export const VARIABLE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const TYPED_VALUE_TYPES = [
  ['number', '数字'],
  ['string', '文本'],
  ['boolean', '布尔'],
  ['array', '数组 JSON'],
  ['object', '对象 JSON'],
  ['null', '空值 null'],
];

export function isValidVariableKey(value) {
  return typeof value === 'string' && VARIABLE_KEY_RE.test(value);
}

export function isValidColor(value) {
  return typeof value === 'string' && COLOR_RE.test(value);
}

/**
 * 在 used 集合里生成不冲突的 id：base 被占用时依次尝试 base_2、base_3……
 * 结果长度不超过 64（schema 的 id 上限）。
 */
export function uniqueId(base, used) {
  const usedSet = used instanceof Set ? used : new Set(used ?? []);
  const trimmedBase = String(base ?? '').slice(0, 64);
  if (!trimmedBase) return '';
  let candidate = trimmedBase;
  if (!usedSet.has(candidate)) return candidate;
  let index = 2;
  while (index < 10000) {
    const suffix = `_${index}`;
    candidate = `${trimmedBase.slice(0, 64 - suffix.length)}${suffix}`;
    if (!usedSet.has(candidate)) return candidate;
    index += 1;
  }
  return candidate;
}

/** 生成 prefix + 最小可用整数，如 opt_1 / exit_2 / sp_3。 */
export function nextPrefixedId(prefix, used) {
  const usedSet = used instanceof Set ? used : new Set(used ?? []);
  let index = 1;
  while (index < 10000 && usedSet.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

/** 把任意字符串压成 [a-z0-9_] 形式的 slug；没有可用字符时返回空串。 */
export function slugifyAscii(value) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 55);
  return slug;
}

/** 按声明串生成唯一的小游戏出口 id：exit_<slug>；非 ASCII 时退化为 exit_N。 */
export function makeExitIdForName(name, used) {
  const usedSet = used instanceof Set ? used : new Set(used ?? []);
  const slug = slugifyAscii(name);
  const base = slug ? `exit_${slug}` : nextPrefixedId('exit_', usedSet);
  return uniqueId(base, usedSet);
}

/** typedValue 的类型缺省值（切换类型时使用，保证 schema 合法）。 */
export function typedDefaultValue(type) {
  switch (type) {
    case 'number':
      return { type: 'number', value: 0 };
    case 'boolean':
      return { type: 'boolean', value: false };
    case 'array':
      return { type: 'array', value: [] };
    case 'object':
      return { type: 'object', value: {} };
    case 'null':
      return { type: 'null', value: null };
    case 'string':
    default:
      return { type: 'string', value: '' };
  }
}

function toPickerColor(value) {
  if (typeof value !== 'string') return '#000000';
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return value.slice(0, 7);
  return '#000000';
}

function toTextValue(value) {
  return value == null ? '' : String(value);
}

// ---------------------------------------------------------------------------
// 布局基础件
// ---------------------------------------------------------------------------

export function Hint({ kind = 'info', children, className = '' }) {
  return <p className={`vn-insp-ctl-hint vn-insp-ctl-hint--${kind} ${className}`.trim()}>{children}</p>;
}

export function Row({ label, required = false, hint, error, children, className = '' }) {
  return (
    <div className={`vn-insp-ctl-row ${className}`.trim()}>
      {label ? (
        <span className="vn-insp-ctl-label" title={label}>
          {label}
          {required ? (
            <span className="vn-insp-ctl-required" aria-hidden="true">
              *
            </span>
          ) : null}
        </span>
      ) : null}
      <div className="vn-insp-ctl-control">{children}</div>
      {hint ? <p className="vn-insp-ctl-hint">{hint}</p> : null}
      {error ? (
        <p className="vn-insp-ctl-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ReadonlyRow({ label, value, mono = false }) {
  const text = value == null || value === '' ? '—' : String(value);
  return (
    <div className="vn-insp-ctl-row vn-insp-ctl-row--readonly">
      <span className="vn-insp-ctl-label">{label}</span>
      <span className={`vn-insp-ctl-readonly ${mono ? 'vn-mono' : ''}`.trim()} title={text}>
        {text}
      </span>
    </div>
  );
}

export function Section({ title, badge, defaultOpen = true, children, className = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={`vn-insp-ctl-section ${className}`.trim()}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="vn-insp-ctl-section-head" title={title}>
        <span className="vn-insp-ctl-section-title">{title}</span>
        {badge != null && badge !== '' ? (
          <span className="vn-insp-ctl-section-badge">{badge}</span>
        ) : null}
      </summary>
      <div className="vn-insp-ctl-section-body">{children}</div>
    </details>
  );
}

export function SmallButton({
  children,
  onClick,
  disabled = false,
  variant = 'ghost',
  title,
  ariaLabel,
  type = 'button',
}) {
  return (
    <button
      type={type}
      className={`vn-insp-ctl-btn vn-insp-ctl-btn--${variant}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? title}
    >
      {children}
    </button>
  );
}

export function SubList({
  title,
  count,
  max,
  onAdd,
  addLabel = '添加',
  addDisabled = false,
  addTitle,
  hint,
  emptyText = '暂无条目',
  children,
}) {
  return (
    <div className="vn-insp-ctl-sublist">
      <div className="vn-insp-ctl-sublist-head">
        <span className="vn-insp-ctl-sublist-title">
          {title}
          <span className="vn-insp-ctl-sublist-count">
            {count}
            {max != null ? `/${max}` : ''}
          </span>
        </span>
        {onAdd ? (
          <SmallButton onClick={onAdd} disabled={addDisabled} title={addTitle ?? addLabel}>
            + {addLabel}
          </SmallButton>
        ) : null}
      </div>
      {hint ? <Hint>{hint}</Hint> : null}
      {count === 0 ? <p className="vn-insp-ctl-empty">{emptyText}</p> : null}
      <div className="vn-insp-ctl-sublist-body">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 草稿 hooks
// ---------------------------------------------------------------------------

function useTextDraft({
  value,
  onChange,
  minLength = 0,
  maxLength,
  allowNull = false,
  trim = true,
  validate,
  label,
}) {
  const notify = useFieldNotify();
  const [draft, setDraftState] = useState(() => toTextValue(value));
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraftState(toTextValue(value));
    setError(null);
  }, [value]);

  const fail = (message) => {
    setError(message);
    if (notify) notify(message, 'error');
    setDraftState(toTextValue(value));
  };

  const commit = () => {
    const next = trim ? String(draft).trim() : String(draft);
    if (validate) {
      const message = validate(next);
      if (message) {
        fail(message);
        return;
      }
    }
    if (next.length === 0) {
      if (allowNull) {
        setError(null);
        setDraftState('');
        onChange(null);
        return;
      }
      if (minLength > 0) {
        fail(`${label}不能为空`);
        return;
      }
    }
    if (next.length < minLength) {
      fail(`${label}至少 ${minLength} 个字符`);
      return;
    }
    if (maxLength != null && next.length > maxLength) {
      fail(`${label}最多 ${maxLength} 个字符`);
      return;
    }
    setError(null);
    setDraftState(next);
    onChange(next);
  };

  const setDraft = (raw) => {
    setDraftState(raw);
    if (error) setError(null);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  return { draft, error, setDraft, commit, onKeyDown };
}

function useNumberDraft({ value, onChange, min, max, integer = false, label }) {
  const notify = useFieldNotify();
  const [draft, setDraftState] = useState(() => toTextValue(value));
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraftState(toTextValue(value));
    setError(null);
  }, [value]);

  const fail = (message) => {
    setError(message);
    if (notify) notify(message, 'error');
    setDraftState(toTextValue(value));
  };

  const commit = () => {
    const raw = String(draft).trim();
    if (raw === '') {
      fail(`${label}不能为空`);
      return;
    }
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      fail(`${label}必须是数字`);
      return;
    }
    if (integer && !Number.isInteger(numeric)) {
      fail(`${label}必须是整数`);
      return;
    }
    if (min != null && numeric < min) {
      fail(`${label}不能小于 ${min}`);
      return;
    }
    if (max != null && numeric > max) {
      fail(`${label}不能大于 ${max}`);
      return;
    }
    setError(null);
    setDraftState(String(numeric));
    onChange(numeric);
  };

  const setDraft = (raw) => {
    setDraftState(raw);
    if (error) setError(null);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  return { draft, error, setDraft, commit, onKeyDown };
}

// ---------------------------------------------------------------------------
// 文本 / 数字 / 选择 / 颜色 / 开关
// ---------------------------------------------------------------------------

export function FieldText({
  label,
  value,
  onChange,
  minLength = 0,
  maxLength,
  allowNull = false,
  trim = true,
  validate,
  placeholder,
  disabled = false,
  hint,
  required = false,
  mono = false,
  action,
}) {
  const { draft, error, setDraft, commit, onKeyDown } = useTextDraft({
    value,
    onChange,
    minLength,
    maxLength,
    allowNull,
    trim,
    validate,
    label,
  });
  return (
    <Row label={label} required={required} hint={hint} error={error}>
      <div className="vn-insp-ctl-inline">
        <input
          type="text"
          className={`vn-input vn-insp-ctl-input ${mono ? 'vn-mono' : ''} ${
            error ? 'vn-insp-ctl-invalid' : ''
          }`.trim()}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={label}
          aria-invalid={Boolean(error)}
          title={hint ? `${label}（${hint}）` : label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {action}
      </div>
    </Row>
  );
}

export function FieldTextArea({
  label,
  value,
  onChange,
  minLength = 0,
  maxLength,
  allowNull = false,
  trim = true,
  placeholder,
  rows = 4,
  disabled = false,
  hint,
  required = false,
  mono = false,
}) {
  const { draft, error, setDraft, commit } = useTextDraft({
    value,
    onChange,
    minLength,
    maxLength,
    allowNull,
    trim,
    label,
  });
  return (
    <Row label={label} required={required} hint={hint} error={error}>
      <textarea
        className={`vn-textarea vn-insp-ctl-input ${mono ? 'vn-mono' : ''} ${
          error ? 'vn-insp-ctl-invalid' : ''
        }`.trim()}
        value={draft}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        aria-invalid={Boolean(error)}
        title={hint ? `${label}（${hint}）` : label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        spellCheck={false}
      />
    </Row>
  );
}

export function FieldNumber({
  label,
  value,
  onChange,
  min,
  max,
  integer = false,
  step,
  placeholder,
  disabled = false,
  hint,
  required = false,
  suffix,
  action,
}) {
  const { draft, error, setDraft, commit, onKeyDown } = useNumberDraft({
    value,
    onChange,
    min,
    max,
    integer,
    label,
  });
  const rangeText = min != null && max != null ? `范围 ${min}–${max}` : hint;
  return (
    <Row label={label} required={required} hint={hint} error={error}>
      <div className="vn-insp-ctl-inline">
        <input
          type="number"
          className={`vn-input vn-insp-ctl-input ${error ? 'vn-insp-ctl-invalid' : ''}`.trim()}
          value={draft}
          min={min}
          max={max}
          step={step ?? (integer ? 1 : 'any')}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={label}
          aria-invalid={Boolean(error)}
          title={rangeText ? `${label}（${rangeText}）` : label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {suffix ? <span className="vn-insp-ctl-suffix">{suffix}</span> : null}
        {action}
      </div>
    </Row>
  );
}

/** 可空数字：null 时显示「未启用」+ 启用按钮；有值时数字输入 + 清除按钮。 */
export function NullableNumberField({
  label,
  value,
  onChange,
  min,
  max,
  integer = false,
  enableValue,
  clearLabel = '清除',
  hint,
  suffix,
  step,
}) {
  if (value == null) {
    const fallback = enableValue != null ? enableValue : min != null ? min : 0;
    return (
      <Row label={label} hint={hint}>
        <div className="vn-insp-ctl-inline">
          <span className="vn-insp-ctl-null">未启用</span>
          <SmallButton
            onClick={() => onChange(fallback)}
            title={`启用「${label}」，默认值 ${fallback}`}
          >
            启用
          </SmallButton>
        </div>
      </Row>
    );
  }
  return (
    <FieldNumber
      label={label}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      integer={integer}
      step={step}
      hint={hint}
      suffix={suffix}
      action={
        <SmallButton
          onClick={() => onChange(null)}
          title={`清除「${label}」（设为未启用）`}
        >
          {clearLabel}
        </SmallButton>
      }
    />
  );
}

export function FieldSelect({
  label,
  value,
  onChange,
  options = [],
  allowNull = false,
  nullLabel = '（无）',
  placeholder = '请选择',
  disabled = false,
  hint,
  required = false,
  title,
}) {
  const normalized = useMemo(
    () =>
      (options ?? []).map((option) =>
        Array.isArray(option)
          ? { value: option[0], label: option[1], disabled: false }
          : { value: option.value, label: option.label ?? String(option.value), disabled: Boolean(option.disabled) },
      ),
    [options],
  );
  const current = value == null ? '' : String(value);
  const missing = current !== '' && !normalized.some((option) => String(option.value) === current);
  return (
    <Row label={label} required={required} hint={hint}>
      <select
        className="vn-select vn-insp-ctl-input"
        value={current}
        disabled={disabled}
        aria-label={label}
        title={title ?? label}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? null : raw);
        }}
      >
        {allowNull ? <option value="">{nullLabel}</option> : null}
        {!allowNull && current === '' ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {normalized.map((option) => (
          <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {missing ? <option value={current}>{`（缺失）${current}`}</option> : null}
      </select>
    </Row>
  );
}

export function FieldCheckbox({ label, value, onChange, hint, disabled = false, title }) {
  const checked = Boolean(value);
  return (
    <Row label={label} hint={hint}>
      <label className="vn-insp-ctl-check" title={title ?? label}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{checked ? '开启' : '关闭'}</span>
      </label>
    </Row>
  );
}

export function FieldColor({ label, value, onChange, hint, required = false, disabled = false }) {
  const notify = useFieldNotify();
  const [draft, setDraftState] = useState(() => toTextValue(value));
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraftState(toTextValue(value));
    setError(null);
  }, [value]);

  const fail = (message) => {
    setError(message);
    if (notify) notify(message, 'error');
    setDraftState(toTextValue(value));
  };

  const commit = () => {
    const next = String(draft).trim();
    if (!isValidColor(next)) {
      fail(`${label}必须是 #RGB / #RRGGBB / #RRGGBBAA 十六进制颜色`);
      return;
    }
    setError(null);
    setDraftState(next);
    onChange(next);
  };

  return (
    <Row label={label} required={required} hint={hint} error={error}>
      <div className="vn-insp-ctl-color">
        <input
          type="color"
          className="vn-insp-ctl-color-picker"
          value={toPickerColor(value)}
          disabled={disabled}
          aria-label={`${label} 颜色选择器`}
          title={`${label} 颜色选择器`}
          onChange={(event) => {
            const next = event.target.value;
            setError(null);
            setDraftState(next);
            onChange(next);
          }}
        />
        <input
          type="text"
          className={`vn-input vn-mono vn-insp-ctl-color-text ${
            error ? 'vn-insp-ctl-invalid' : ''
          }`.trim()}
          value={draft}
          maxLength={9}
          disabled={disabled}
          aria-label={label}
          aria-invalid={Boolean(error)}
          title={`${label}（#RGB / #RRGGBB / #RRGGBBAA）`}
          onChange={(event) => {
            setDraftState(event.target.value);
            if (error) setError(null);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// 素材选择 / 缩略图
// ---------------------------------------------------------------------------

export function AssetThumb({ projectDir, asset, size = 34, alt }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    if (!projectDir || !asset?.path) {
      setFailed(true);
      return () => {
        alive = false;
      };
    }
    assetDataUrl(projectDir, asset)
      .then((url) => {
        if (!alive) return;
        if (url) setSrc(url);
        else setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [projectDir, asset?.id, asset?.path]);

  const label = alt ?? asset?.name ?? '素材缩略图';
  return (
    <span
      className="vn-insp-ctl-thumb"
      style={{ width: size, height: size }}
      title={label}
      aria-hidden={src ? undefined : true}
    >
      {src ? (
        <img src={src} alt={label} />
      ) : (
        <span className="vn-insp-ctl-thumb-placeholder">{failed ? '无图' : '…'}</span>
      )}
    </span>
  );
}

export function AssetSelect({
  label,
  assets = [],
  value,
  onChange,
  allowNull = false,
  nullLabel = '（无）',
  placeholder = '（无可用素材）',
  disabled = false,
  hint,
  required = false,
  projectDir,
  thumbnail = false,
  emptyHint,
}) {
  const list = assets ?? [];
  const current = value == null ? '' : String(value);
  const asset = list.find((item) => item.id === current);
  const missing = current !== '' && !asset;
  const noAssets = list.length === 0;
  return (
    <Row
      label={label}
      required={required}
      hint={hint ?? (noAssets && emptyHint ? emptyHint : undefined)}
    >
      <div className="vn-insp-ctl-inline">
        {thumbnail ? <AssetThumb projectDir={projectDir} asset={asset} alt={asset?.name ?? label} /> : null}
        <select
          className="vn-select vn-insp-ctl-input"
          value={current}
          disabled={disabled || (noAssets && !missing)}
          aria-label={label}
          title={label}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === '' ? null : raw);
          }}
        >
          {allowNull ? <option value="">{nullLabel}</option> : null}
          {!allowNull && current === '' ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {list.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}（{item.id}）
            </option>
          ))}
          {missing ? <option value={current}>{`（缺失素材）${current}`}</option> : null}
        </select>
      </div>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// typedValue 编辑器
// ---------------------------------------------------------------------------

function TypedNumberEditor({ value, onChange, ariaLabel }) {
  const { draft, error, setDraft, commit, onKeyDown } = useNumberDraft({
    value,
    onChange,
    min: undefined,
    max: undefined,
    integer: false,
    label: ariaLabel,
  });
  return (
    <>
      <input
        type="number"
        step="any"
        className={`vn-input vn-insp-ctl-input ${error ? 'vn-insp-ctl-invalid' : ''}`.trim()}
        value={draft}
        aria-label={ariaLabel}
        aria-invalid={Boolean(error)}
        title={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {error ? <p className="vn-insp-ctl-error">{error}</p> : null}
    </>
  );
}

function TypedStringEditor({ value, onChange, ariaLabel }) {
  const { draft, error, setDraft, commit, onKeyDown } = useTextDraft({
    value,
    onChange,
    minLength: 0,
    allowNull: false,
    trim: false,
    label: ariaLabel,
  });
  return (
    <>
      <input
        type="text"
        className={`vn-input vn-insp-ctl-input ${error ? 'vn-insp-ctl-invalid' : ''}`.trim()}
        value={draft}
        aria-label={ariaLabel}
        aria-invalid={Boolean(error)}
        title={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {error ? <p className="vn-insp-ctl-error">{error}</p> : null}
    </>
  );
}

function TypedBooleanEditor({ value, onChange, ariaLabel }) {
  return (
    <select
      className="vn-select vn-insp-ctl-input"
      value={String(Boolean(value))}
      aria-label={ariaLabel}
      title={ariaLabel}
      onChange={(event) => onChange(event.target.value === 'true')}
    >
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
  );
}

function TypedJsonEditor({ value, onChange, kind, ariaLabel }) {
  const notify = useFieldNotify();
  const [draft, setDraftState] = useState(() => {
    try {
      return JSON.stringify(value ?? (kind === 'array' ? [] : {}), null, 2);
    } catch {
      return kind === 'array' ? '[]' : '{}';
    }
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      setDraftState(JSON.stringify(value ?? (kind === 'array' ? [] : {}), null, 2));
    } catch {
      setDraftState(kind === 'array' ? '[]' : '{}');
    }
    setError(null);
  }, [value, kind]);

  const fail = (message) => {
    setError(message);
    if (notify) notify(message, 'error');
  };

  const commit = () => {
    let parsed;
    try {
      parsed = JSON.parse(draft);
    } catch {
      fail(`${ariaLabel}不是合法 JSON，未提交`);
      return;
    }
    if (kind === 'array' && !Array.isArray(parsed)) {
      fail(`${ariaLabel}必须是 JSON 数组`);
      return;
    }
    if (kind === 'object' && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
      fail(`${ariaLabel}必须是 JSON 对象`);
      return;
    }
    setError(null);
    setDraftState(JSON.stringify(parsed, null, 2));
    onChange(parsed);
  };

  return (
    <div className="vn-insp-ctl-json">
      <textarea
        className={`vn-textarea vn-mono vn-insp-ctl-json-area ${
          error ? 'vn-insp-ctl-invalid' : ''
        }`.trim()}
        rows={4}
        value={draft}
        aria-label={`${ariaLabel} JSON`}
        aria-invalid={Boolean(error)}
        title={`${ariaLabel} JSON（失焦时校验并提交）`}
        spellCheck={false}
        onChange={(event) => {
          setDraftState(event.target.value);
          if (error) setError(null);
        }}
        onBlur={commit}
      />
      {error ? (
        <p className="vn-insp-ctl-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="vn-insp-ctl-hint">JSON 合法后失焦提交</p>
      )}
    </div>
  );
}

export function TypedValueEditor({ label = '值', value, onChange, hint }) {
  const safeType = TYPED_VALUE_TYPES.some(([type]) => type === value?.type) ? value.type : 'string';
  const safeValue = value && value.type === safeType ? value.value : undefined;
  const ariaLabel = `${label}（${safeType}）`;

  let editor = null;
  if (safeType === 'number') {
    editor = (
      <TypedNumberEditor
        value={safeValue}
        onChange={(next) => onChange({ type: 'number', value: next })}
        ariaLabel={ariaLabel}
      />
    );
  } else if (safeType === 'string') {
    editor = (
      <TypedStringEditor
        value={safeValue}
        onChange={(next) => onChange({ type: 'string', value: next })}
        ariaLabel={ariaLabel}
      />
    );
  } else if (safeType === 'boolean') {
    editor = (
      <TypedBooleanEditor
        value={safeValue}
        onChange={(next) => onChange({ type: 'boolean', value: next })}
        ariaLabel={ariaLabel}
      />
    );
  } else if (safeType === 'array' || safeType === 'object') {
    editor = (
      <TypedJsonEditor
        value={safeValue}
        kind={safeType}
        onChange={(next) => onChange({ type: safeType, value: next })}
        ariaLabel={ariaLabel}
      />
    );
  } else {
    editor = <span className="vn-insp-ctl-null">null（无值）</span>;
  }

  return (
    <div className="vn-insp-ctl-typed">
      <div className="vn-insp-ctl-typed-head">
        <span className="vn-insp-ctl-label">{label}</span>
        <select
          className="vn-select vn-insp-ctl-typed-type"
          value={safeType}
          aria-label={`${label}类型`}
          title={`${label}类型`}
          onChange={(event) => onChange(typedDefaultValue(event.target.value))}
        >
          {TYPED_VALUE_TYPES.map(([type, text]) => (
            <option key={type} value={type}>
              {text}
            </option>
          ))}
        </select>
      </div>
      <div className="vn-insp-ctl-typed-body">{editor}</div>
      {hint ? <p className="vn-insp-ctl-hint">{hint}</p> : null}
    </div>
  );
}
