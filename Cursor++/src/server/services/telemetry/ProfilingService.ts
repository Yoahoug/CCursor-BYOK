/**
 * aiserver.v1.ProfilingService — 性能剖析上报
 *
 * 1 方法:
 *   - SubmitProfile (unary) — 提交性能剖析数据
 *
 * Transport: backendUrl (api2.cursor.sh)
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { ProfilingService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(ProfilingService, {})
}
