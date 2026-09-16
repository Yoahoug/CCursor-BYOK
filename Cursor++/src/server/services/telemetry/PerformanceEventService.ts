/**
 * aiserver.v1.PerformanceEventService — 性能事件上报
 *
 * 1 方法:
 *   - SubmitPerformanceEvents (unary) — 提交性能事件 (启动时间、渲染延迟等)
 *
 * Transport: backendUrl (api2.cursor.sh)
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { PerformanceEventService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(PerformanceEventService, {})
}
