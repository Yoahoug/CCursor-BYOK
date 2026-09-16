/**
 * aiserver.v1.WebProfilingService — Web 端性能剖析上报
 *
 * 1 方法:
 *   - SubmitInteractionWindow (unary) — 提交交互窗口性能数据
 *
 * Transport: backendUrl (api2.cursor.sh)
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { WebProfilingService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(WebProfilingService, {})
}
