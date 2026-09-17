/**
 * aiserver.v1.MCPRegistryService — MCP 服务器注册表
 *
 * 1 方法:
 *   - GetKnownServers (unary) — 获取已知 MCP 服务器列表
 *     Cursor 用于发现和展示可用的 MCP (Model Context Protocol) 服务器
 *
 * Transport: backendUrl (api2.cursor.sh)
 *
 * BYOK: 返回空列表 (用户通过本地 .cursor/mcp.json 配置 MCP 服务器)
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { MCPRegistryService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(MCPRegistryService, {
    getKnownServers: async () => ({}),
  })
}
