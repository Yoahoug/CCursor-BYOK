/**
 * aiserver.v1.AnalyticsService — 分析/遥测服务
 *
 * 7 方法:
 *   - Batch (unary) — 批量事件上报
 *   - BootstrapStatsig (unary) — 获取 Statsig feature flag 配置 (239KB JSON)
 *   - TrackEvents (unary) — 事件追踪
 *   - TrackMachineEvents (unary) — 机器级事件
 *   - SubmitClientLogBatch (unary) — 客户端日志批量提交
 *   - BatchNonAuth (unary) — 未认证批量上报
 *   - GetStatsigClientKey (unary) — 获取 Statsig 客户端密钥
 *
 * Transport: backendUrl (api2.cursor.sh)
 *
 * BYOK: Batch 返回空确认，BootstrapStatsig 返回空配置 (所有 feature flag 使用默认值)
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { AnalyticsService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(AnalyticsService, {
    batch: async () => ({}),
    bootstrapStatsig: async () => ({ config: '{}' }),
  })
}
