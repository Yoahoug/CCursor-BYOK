/**
 * aiserver.v1.ToolCallEventService — 工具调用事件上报
 *
 * 1 方法:
 *   - SubmitToolCallEvents (unary) — 提交工具调用事件 (shell, edit, grep 等)
 *
 * Transport: backendUrl (api2.cursor.sh)
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { ToolCallEventService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(ToolCallEventService, {})
}
