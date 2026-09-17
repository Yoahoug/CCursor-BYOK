/**
 * aiserver.v1.InAppAdService — 应用内广告服务
 *
 * 3 方法:
 *   - HasSeenAd (unary) — 检查用户是否已看过指定广告 (如 composer_1_5_launch_ad)
 *   - MarkAdAsSeen (unary) — 标记广告已读
 *   - ResetUserAdViews (unary) — 重置广告查看记录
 *
 * Transport: backendUrl (api2.cursor.sh)
 *
 * BYOK: 返回 hasSeen=true 跳过所有广告
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { InAppAdService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(InAppAdService, {
    hasSeenAd: async () => ({ hasSeen: true }),
    markAdAsSeen: async () => ({}),
  })
}
