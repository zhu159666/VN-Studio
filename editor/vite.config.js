import path from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      // 渲染层需要 import 仓库根目录的 runtime/ 源码（纯浏览器 ESM）。
      allow: [path.resolve(import.meta.dirname, '..')],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
  },
});
