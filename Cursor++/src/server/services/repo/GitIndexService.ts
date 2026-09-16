/**
 * aiserver.v1.GitIndexService — Git 索引服务
 *
 * 6 方法:
 *   - GitIndexExchange, GitIndexRepoStatus — Git 索引交换/状态
 *   - GitIndexPushChanges, GitIndexGetTrackedRepos — 推送变更/获取跟踪仓库
 *   - GitIndexRegisterRepos, GitIndexUnregisterRepos — 注册/注销仓库
 *
 * Transport: repoTransport (repoBackendUrl, repo42.cursor.sh)
 *   不经过 api2，BYOK 不拦截。注册为 fallback。
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { GitIndexService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(GitIndexService, {})
}
