import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

// 把 MCP server + command bus + schema 校验打成单个 CJS，供 stdio 启动器使用。
const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  root,
  define: {
    __VN_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'node20',
    outDir: 'electron/resources/mcp',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      entry: 'electron/mcp-stdio.entry.js',
      formats: ['cjs'],
      fileName: () => 'mcp-stdio.cjs',
    },
    rollupOptions: {
      external: ['electron', /^node:/, 'fs', 'fs/promises', 'path', 'os', 'child_process', 'crypto'],
      output: {
        exports: 'named',
      },
    },
  },
});
