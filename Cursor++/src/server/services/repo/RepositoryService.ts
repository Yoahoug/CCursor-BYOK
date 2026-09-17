/**
 * aiserver.v1.RepositoryService — 代码仓库索引服务
 *
 * 19 方法:
 *   - FastRepoInitHandshake (unary) — 仓库初始化握手
 *   - SemSearchFast (unary) — 语义搜索 (→ http2RepoTransport)
 *   - TriggerReindex (unary) — 触发重新索引
 *   - GetRepoInfo, GetRepoSyncStatus — 仓库状态
 *   - StreamRegisterRepos (server_streaming) — 注册仓库流
 *   - StreamFastRepoInit (server_streaming) — 快速初始化流
 *   - ListRepoFiles, GetFileMetadata — 文件列表/元数据
 *   - 等等
 *
 * Transport: repoTransport (repoBackendUrl, repo42.cursor.sh)
 *   不经过 api2，BYOK 不拦截。注册为 fallback。
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { RepositoryService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(RepositoryService, {})
}
