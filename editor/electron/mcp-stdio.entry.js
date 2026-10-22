// 独立 MCP stdio 入口：用 ELECTRON_RUN_AS_NODE 或 Node 运行，不启动 GUI。
// MCP 客户端配置示例见 README「MCP 接入」。
import mcpServer from './lib/mcp-server.cjs';

const { startMcpServer } = mcpServer;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

const version = typeof __VN_VERSION__ === 'string' ? __VN_VERSION__ : '0.0.0';

startMcpServer({
  defaultProjectPath: argValue('--project'),
  version,
  onClose: () => process.exit(0),
});
