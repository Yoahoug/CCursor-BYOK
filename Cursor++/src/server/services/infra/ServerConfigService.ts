/**
 * aiserver.v1.ServerConfigService — 服务器配置服务
 *
 * 1 方法:
 *   - GetServerConfig (unary) — 获取服务器配置
 *     返回: BugConfig, IndexingConfig, ChatConfig, Http2Config, ProfilingConfig,
 *           MetricsConfig, BackgroundComposerConfig, AutoContextConfig,
 *           ModelMigrations, MemoryMonitorConfig, FolderSizeLimit 等
 *
 * Transport: backendUrl (api2.cursor.sh)
 *
 * 配置内容参照官方服务器实际返回值，由 handlers/server/config.ts 构造。
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { ServerConfigService } from '../../gen/aiserver_v1_pb'
import { buildServerConfig } from '../../handlers/server/config'

export default (router: ConnectRouter) => {
  router.service(ServerConfigService, {
    getServerConfig: async () => buildServerConfig(),
  })
}
