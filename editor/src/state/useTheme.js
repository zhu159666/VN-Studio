import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'vn-studio-theme';
const THEMES = new Set(['dark', 'light']);

export function getInitialTheme() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (THEMES.has(saved)) return saved;
  } catch {
    /* localStorage 不可用时回退默认值 */
  }
  return 'dark';
}

export function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

/** 编辑器明/暗模式：持久化到 localStorage，并同步 <html data-theme>。 */
export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return [theme, toggleTheme, setTheme];
}

export { STORAGE_KEY };
