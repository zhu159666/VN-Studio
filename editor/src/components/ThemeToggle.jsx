import { useTheme } from '../state/useTheme';

const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

function SunIcon() {
  return (
    <svg {...stroke} width="15" height="15">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg {...stroke} width="15" height="15">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

/** 明/暗模式切换按钮：点击立即切换并持久化。 */
export default function ThemeToggle({ compact = false }) {
  const [theme, toggleTheme] = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? '切换到明亮模式' : '切换到暗色模式';

  return (
    <button
      type="button"
      className={`vn-theme-toggle${compact ? ' is-compact' : ''}`}
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      aria-pressed={!isDark}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
      {compact ? null : <span>{isDark ? '明亮模式' : '暗色模式'}</span>}
    </button>
  );
}
