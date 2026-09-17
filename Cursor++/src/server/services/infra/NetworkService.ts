/**
 * aiserver.v1.NetworkService — 网络状态服务
 *
 * 2 方法:
 *   - IsConnected (unary) — 检查与服务器的连接状态
 *   - GetPublicIp (unary) — 获取客户端公网 IP
 *
 * Transport: backendUrl (api2.cursor.sh)
 *
 * BYOK: IsConnected 返回空消息 (proto3 默认值即 connected)
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { NetworkService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(NetworkService, {
    isConnected: async () => ({}),
  })
}
