/**
 * aiserver.v1.CppService — Tab 补全服务 (Cursor Prediction Provider)
 *
 * 5 方法:
 *   - AvailableModels (unary) — Tab 补全可用模型列表 (cursor-small/fast)
 *   - MarkCppForEval (unary) — 标记补全用于评估
 *   - StreamHoldCpp (server_streaming) — 持有补全流
 *   - RecordCppFate (unary) — 记录补全接受/拒绝
 *   - AddTabRequestToEval (unary) — 添加 Tab 请求到评估
 *
 * Transport: backendUrl (api2.cursor.sh)
 *   注意: 实际补全推理走 AiService.streamCpp → geoCppTransport (gcpp.cursor.sh)，
 *   CppService 仅处理配置和评估记录
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { CppService } from '../../gen/aiserver_v1_pb'

export default (router: ConnectRouter) => {
  router.service(CppService, {
    availableModels: async () => ({ models: ['fast'], defaultModel: 'fast' }),
  })
}
