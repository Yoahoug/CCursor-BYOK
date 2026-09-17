/**
 * aiserver.v1.UploadService — 文档/文件上传服务
 *
 * 9 方法:
 *   - UploadDocumentation, DeleteDocumentation — 文档索引上传/删除
 *   - UploadDocumentationFile — 单文件上传
 *   - GetUploadStatus, GetUploadedStatus — 上传状态查询
 *   - ListUploadedDocumentations — 已上传文档列表
 *   - UploadTextFile, UploadSitemapFile — 文本/站点地图上传
 *   - UploadUserAsset — 用户资产上传
 *
 * Transport: repoTransport (repoBackendUrl, repo42.cursor.sh)
 *   不经过 api2，BYOK 不拦截。注册为 fallback。
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { UploadService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(UploadService, {})
}
