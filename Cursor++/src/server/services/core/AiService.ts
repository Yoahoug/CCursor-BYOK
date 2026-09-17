/**
 * aiserver.v1.AiService — 核心 AI 服务
 *
 * Cursor 最大的服务 (183 方法)，承载几乎所有 AI 能力：
 *   - 模型管理: AvailableModels, GetDefaultModel, CheckQueuePosition
 *   - 对话: StreamChat, StreamChatTryReallyHard, StreamComposer, StreamEdit
 *   - 补全: StreamCpp, StreamNextCursorPrediction, CppConfig, CppAppend
 *   - Agent: InterfaceAgentInit, StreamInterfaceAgentStatus
 *   - 任务: TaskInit, TaskInfo, TaskStreamLog, TaskSendMessage
 *   - 知识库: KnowledgeBaseList, KnowledgeBaseAdd, AvailableDocs
 *   - 配置: ServerTime, HealthCheck, CppConfig, CppEditHistoryStatus
 *   - 遥测: ReportClientNumericMetrics, UpdateVscodeProfile, ReportFeedback
 *
 * Transport: backendUrl (api2.cursor.sh)
 *   部分方法有独立 transport 覆盖:
 *     - streamNextCursorPrediction, getCppEditClassification, streamCpp → geoCppTransport
 *     - cppConfig → cppConfigTransport
 *     - cppEditHistoryAppend, cppAppend → telemTransport
 *     - streamStt, streamBugBotAgentic, streamUiBestOfNJudge → agenticComposerTransport
 *
 * 拦截策略 (与 ~/.ccursor/routes.json redirect 白名单配合):
 *   - AvailableModels: 双源合并 (上游官方订阅 + 本地 BYOK providers.json)
 *   - StreamChat / StreamUiApply / 其他被白名单覆盖的方法: 由各 stream 实现处理
 *   - 未列入白名单的方法: 不会到我们这里, 直通官方
 */
import type { ConnectRouter } from '@connectrpc/connect'
import { create } from '@bufbuild/protobuf'
import {
  addKnowledgeItem,
  listKnowledgeItems,
  removeKnowledgeItem,
  updateKnowledgeItem,
} from '../../config/knowledgeBaseStore'
import { flattenModels } from '../../config/providersStore'
import {
  AiService,
  AvailableModelsResponse_FeatureModelConfigSchema,
  AvailableModelsResponse_ModelPickerDisplayConfiguration_RoutedModelViewConfigSchema,
  AvailableModelsResponse_ModelPickerDisplayConfigurationSchema,
  AvailableModelsResponseSchema,
} from '../../gen/aiserver_v1_pb'
import { buildByokAvailableModels } from '../../handlers/models/byokModelBuilder'
import { logger } from '../../logger'

/**
 * BYOK ON 模式下,客户端能命中我们这里就说明白名单生效中。
 * 直接返回 providers.json 整合后的本地 BYOK 模型列表,不再合并上游。
 *
 * BYOK OFF 模式下,白名单不含 AvailableModels,这个 handler 根本不会被调用 ——
 * 客户端直接拿到官方真实订阅列表。
 */
async function handleAvailableModels() {
  const byok = buildByokAvailableModels()
  logger.info({ count: byok.length }, '[MODEL] availableModels (BYOK only)')
  return create(AvailableModelsResponseSchema, {
    models: byok,
    modelNames: byok.map(m => m.name),
    // feature config 给空 stub,Cursor 客户端遇到空 config 会用内置默认行为
    composerModelConfig: create(AvailableModelsResponse_FeatureModelConfigSchema, {}),
    cmdKModelConfig: create(AvailableModelsResponse_FeatureModelConfigSchema, {}),
    backgroundComposerModelConfig: create(AvailableModelsResponse_FeatureModelConfigSchema, {}),
    // subagentModelConfigs: map<string, FeatureModelConfig>
    // 提供 explore 条目让 Settings > Subagents 显示 "Explore subagent model" 选择器
    subagentModelConfigs: {
      explore: create(AvailableModelsResponse_FeatureModelConfigSchema, {}),
    },
    // displayConfiguration — 覆盖客户端 localStorage 缓存的官方配置:
    //   routedModelViewConfig.hideRoutedModelView = true
    //     → Auto toggle 不显示 (routedModelViewToNamedViewToggle 不存在)
    //     → 即使 modelName="default" (Auto), picker 也回退到 named-model 列表
    //   BYOK OFF 时此 handler 不被调用, 官方 server 返回含 Auto 的配置, 自动恢复。
    displayConfiguration: create(AvailableModelsResponse_ModelPickerDisplayConfigurationSchema, {
      routedModelViewConfig: create(AvailableModelsResponse_ModelPickerDisplayConfiguration_RoutedModelViewConfigSchema, {
        hideRoutedModelView: true,
      }),
    }),
    useModelParameters: true,
  })
}

export default (router: ConnectRouter) => {
  router.service(AiService, {
    serverTime: async () => ({
      receiveTimestamp: Date.now(),
      transmitTimestamp: Date.now(),
    }),

    availableModels: handleAvailableModels,

    // GetDefaultModel — 从 providers.json 推送 BYOK 默认模型到 Composer + Cmd+K
    // 客户端逻辑: nextDefaultSetDate > lastDefaultModelSetDate → setDefaultModel(model)
    // 返回空 {} = 不推送(客户端保留上次选择)
    getDefaultModel: async () => {
      const all = flattenModels().filter(x => x.model.defaultOn !== false)
      const first = all[0]
      if (!first)
        return {}
      const thinkingModel = all.find(x => x.model.thinking)
      return {
        model: first.model.id,
        thinkingModel: thinkingModel?.model.id ?? '',
        maxMode: false,
        nextDefaultSetDate: String(Date.now()),
      }
    },
    getDefaultModelNudgeData: async () => ({ nudgeDate: '0' }),
    cppConfig: async () => ({
      isOn: true,
      isGhostText: true,
      shouldLetUserEnableCppEvenIfNotPro: true,
    }),
    cppEditHistoryStatus: async () => ({ on: true, onlyIfExplicit: true }),
    availableDocs: async () => ({ docs: [] }),

    // ── KnowledgeBase (设置页 "User Rules") ──
    // 官方服务端把 items 存在用户账户云端,BYOK 用本地 knowledge-base.json 替代。
    // parseRunRequest 侧会在每次 Agent 请求时把这些 items 合入 userRules,
    // 让客户端设置页填的规则真正作用到 Agent。
    knowledgeBaseList: async () => {
      const items = listKnowledgeItems()
      return {
        success: true,
        allResults: items.map(it => ({
          id: it.id,
          knowledge: it.knowledge,
          title: it.title,
          createdAt: it.createdAt,
          isGenerated: it.isGenerated,
        })),
      }
    },
    knowledgeBaseAdd: async (req) => {
      const item = await addKnowledgeItem({
        knowledge: req.knowledge ?? '',
        title: req.title ?? '',
      })
      return { success: true, id: item.id }
    },
    knowledgeBaseUpdate: async (req) => {
      const ok = await updateKnowledgeItem(req.id ?? '', {
        knowledge: req.knowledge ?? undefined,
        title: req.title ?? undefined,
      })
      return { success: ok }
    },
    knowledgeBaseRemove: async (req) => {
      const ok = await removeKnowledgeItem(req.id ?? '')
      return { success: ok }
    },

    reportClientNumericMetrics: async () => ({}),
    updateVscodeProfile: async () => ({}),
  })
}
