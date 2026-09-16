/**
 * aiserver.v1.ChatRequestEventService — 对话请求事件上报
 *
 * 1 方法:
 *   - SubmitChatRequestEvents (unary) — 提交对话请求事件 (延迟、模型、状态等)
 *
 * Transport: backendUrl (api2.cursor.sh)
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { ChatRequestEventService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(ChatRequestEventService, {})
}
