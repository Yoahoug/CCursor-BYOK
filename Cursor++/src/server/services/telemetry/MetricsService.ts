/**
 * aiserver.v1.MetricsService — 指标上报服务
 *
 * 4 方法:
 *   - ReportIncrement / ReportDecrement (unary) — 计数器增减
 *   - ReportDistribution (unary) — 分布上报
 *   - ReportGauge (unary) — Gauge 指标上报
 *
 * Transport: backendUrl (api2.cursor.sh)
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { MetricsService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(MetricsService, {})
}
