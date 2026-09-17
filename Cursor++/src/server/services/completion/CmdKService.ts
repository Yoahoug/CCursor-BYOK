/**
 * aiserver.v1.CmdKService — Cmd+K 内联编辑服务
 *
 * 6 方法:
 *   - StreamCmdK (server_streaming) — Cmd+K 代码编辑流
 *   - StreamHypermode (server_streaming) — Hypermode 编辑
 *   - RerankCmdKContext (unary) — CmdK 上下文重排序
 *   - StreamTerminalCmdK (server_streaming) — 终端 CmdK
 *   - RerankTerminalCmdKContext (unary) — 终端上下文重排序
 *   - GetRelevantChunks (unary) — 获取相关代码块
 *
 * Transport: cmdkTransport (cmdkBackendUrl, api3.cursor.sh)
 *   不经过 api2，BYOK 不拦截。注册为 fallback。
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { CmdKService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(CmdKService, {})
}
