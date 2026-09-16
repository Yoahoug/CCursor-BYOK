/**
 * aiserver.v1.ReplayChatService — 对话回放服务
 *
 * 仅 1 个方法:
 *   - StreamReplayChat — 调试用, 用历史 conversationId 重放整段对话
 *
 * Transport: backendUrl (api2.cursor.sh)
 * 我们不实现任何方法 — 整服务通过 routes.json 白名单外放行到官方直通。
 * 此处保留空注册只为维持 services 目录结构完整。
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { ReplayChatService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(ReplayChatService, {})
}
