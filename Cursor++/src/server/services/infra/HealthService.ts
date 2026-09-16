/**
 * aiserver.v1.HealthService — 健康检查/心跳服务
 *
 * 7 方法:
 *   - Ping (unary) — 简单 ping
 *   - PingAuth (unary) — 认证 ping
 *   - StreamBidi (bidi) — 双向流心跳 (连接保活)
 *   - StreamBidiSSE / StreamBidiPoll — SSE/轮询降级
 *   - StreamTimingTest (server_streaming) — 延迟测试
 *   - ReportTimingTest (unary) — 上报延迟测试结果
 *
 * Transport: agentBidiTransport (*.api5.cursor.sh)
 *   不经过 api2，注册为 fallback。
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { HealthService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(HealthService, {})
}
