/**
 * aiserver.v1.FileSyncService — 文件同步服务 (Tab 补全上下文)
 *
 * 9 方法:
 *   - FSIsEnabledForUser (unary) — 检查用户是否启用文件同步
 *   - FSConfig (unary) — 获取文件同步配置
 *   - FSSyncFile / FSUploadFile (unary) — 同步/上传文件内容到服务端
 *   - FSGetFileContents / FSGetMultiFileContents (unary) — 获取已同步文件
 *   - FSInternal* — 内部同步/上传/健康检查
 *
 * Transport: geoCppTransport (geoCppBackendUrl, gcpp.cursor.sh)
 *   不经过 api2，但部分配置下可能回落到 api2。
 *   FSIsEnabledForUser 返回 enabled=true 以保持 Tab 补全文件上下文正常。
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { FileSyncService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(FileSyncService, {
    fSIsEnabledForUser: async () => ({ enabled: true }),
  })
}
