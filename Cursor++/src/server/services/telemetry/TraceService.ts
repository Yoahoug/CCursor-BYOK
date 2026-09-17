/**
 * aiserver.v1.TraceService — 分布式追踪上报
 *
 * 1 方法:
 *   - SubmitSpans (unary) — 提交 OpenTelemetry spans
 *
 * Transport: backendUrl (api2.cursor.sh)
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { TraceService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(TraceService, {})
}
