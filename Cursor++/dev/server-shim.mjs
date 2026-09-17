/**
 * `src/server` 的替身（dev-only）
 *
 * panel-provider 与 state 各自只从 `../server` 取一个符号：
 *   panel-provider → bumpRefreshSignal
 *   state          → isServerRunning
 *
 * 而 `src/server/index.ts` 会拉起 Fastify + 27 个 ConnectRPC 服务 + SQLite，
 * 对一个纯前端预览来说既没必要、又会和本机正在运行的 Cursor++ 抢 39831 端口。
 * 所以这里只提供这两个符号，其余保持真实（配置 store、用量统计、模型测试
 * 都是真代码，见 dev/dev.mjs 的模块别名，只命中这两个 importer）。
 */

/** 预览里的 Server 状态开关，由预览控制台切换 */
let serverRunning = true

export function isServerRunning() {
  return serverRunning
}

export function bumpRefreshSignal() {
  // 真实实现是通知 renderer 里的 inject-patch 刷新模型列表；
  // 预览里没有那个 renderer 补丁，无需通知。
}

export function setPreviewServerRunning(value) {
  serverRunning = Boolean(value)
}
