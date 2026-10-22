import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

// 把 command bus 打成主进程可 require 的单文件 CJS（含 ajv），供 MCP server 使用。
// 这是独立构建，不影响渲染层 vite.config。
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    target: 'node20',
    outDir: 'electron/generated',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    lib: {
      entry: 'src/commands/index.js',
      formats: ['cjs'],
      fileName: () => 'command-bus.cjs',
    },
    rollupOptions: {
      output: {
        exports: 'named',
      },
    },
  },
});
