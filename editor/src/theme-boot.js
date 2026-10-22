try {
  const saved = window.localStorage.getItem('vn-studio-theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved;
    document.documentElement.style.colorScheme = saved;
  }
} catch {
  /* localStorage 不可用时保持默认暗色 */
}
