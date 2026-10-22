// 独立 MCP stdio 入口：用 ELECTRON_RUN_AS_NODE 或 Node 运行，不启动 GUI。
// MCP 客户端配置示例见 README「MCP 接入」。
import mcpServer from './lib/mcp-server.cjs';

const { startMcpServer, startHttpMcpServer } = mcpServer;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

const version = typeof __VN_VERSION__ === 'string' ? __VN_VERSION__ : '0.0.0';
const defaultProjectPath = argValue('--project');

if (process.argv.includes('--http')) {
  const port = Number(argValue('--port') || process.env.VN_STUDIO_MCP_HTTP_PORT || 38123);
  startHttpMcpServer({
    port,
    defaultProjectPath,
    version,
    log: (line) => process.stderr.write(`${line}\n`),
  })
    .then((server) => process.stderr.write(`[mcp-http] ready: ${server.url}\n`))
    .catch((error) => {
      process.stderr.write(`[mcp-http] 启动失败：${error && error.message ? error.message : error}\n`);
      process.exit(1);
    });
} else {
  startMcpServer({
    defaultProjectPath,
    version,
    onClose: () => process.exit(0),
  });
}
