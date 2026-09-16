/**
 * aiserver.v1.AuthService — 认证服务
 *
 * 13 方法:
 *   - GetEmail, GetUserMeta, EmailValid — 用户信息
 *   - MarkPrivacy, SetPrivacyMode — 隐私设置
 *   - GetSessionToken, CheckSessionToken — Session 管理
 *   - ListActiveSessions, RevokeSession — 多设备管理
 *   - GetCustomerId — Stripe 客户 ID
 *   - SwitchCmdKFraction — CmdK A/B 测试
 *   - DownloadUpdate — 更新下载
 *   - ListJwtPublicKeys — JWT 公钥
 *
 * Transport: backendUrl (api2.cursor.sh)
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { AuthService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(AuthService, {
    markPrivacy: async () => ({}),
  })
}
