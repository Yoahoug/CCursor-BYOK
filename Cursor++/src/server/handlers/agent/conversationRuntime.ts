import { SimulatedMsgReason, type AgentServerMessage } from '../../gen/agent_v1_pb'
import type { LLMContentBlock, LLMMessage, LLMTool } from '../llm/types'
import type { ParsedRunRequest } from './protocol'
import type { AgentSession } from './session'
import type { ToolCallInfo } from './tools'
import { resolveExecutionToolName } from './tools'
import { clearDraftCheckpoint, persistConversationCheckpoint } from '../../database/checkpoints'
import { logger } from '../../logger'
import { resolveProviderRuntime } from '../llm'
import { decodeBlob } from './blob'
import { cacheBlob, getCachedBlob } from './blobStore'
import { emitFinalCheckpoint, emitRollingCheckpoint } from './checkpointManager'
import { buildContextBreakdown, type BreakdownCategory } from './contextBreakdown'
import { editNewlineStats, editToolTargetStats, type EditStreamDiagnostics } from './editStreamDiagnostics'
import { detectEditPathFromToolInput, EditDeltaExtractor, normalizeDetectedEditPath } from './editStreamExtractor'
import { createCompactionArtifacts, estimateMessagesTokens, formatMessageForSummary, planCompaction } from './compactionStrategy'
import { flushMessageBlobs, hydrateHistoryEntries, rebuildConversationHistory, repairHistoryEntries, sendAndCacheBlob } from './historyManager'
import { buildMessages, workspaceUris } from './protocol'
import { checkpoint, editToolCallStreamDelta, heartbeat, kvMessage, partialToolCall, summary, summaryCompleted, summaryStarted, translateStream, userMessageAppended } from './stream'
import { buildSummaryUserMessage, SUMMARY_SYSTEM_PROMPT } from './summaryPrompt'
import { finalizeTaskResult, launchTaskTool, runToolCall, type TaskLaunchContext } from './toolRuntime'
import { awaitExecResultAndClose, waitForPromiseWithHeartbeat } from './wait'
import { restoreBlobMessageToLLMMessage } from './transcript'
import { ActiveTurnTracker, createCurrentTurnUserMessageBlob, readTurnBaseline } from './turnTracker'
import { contextualizeDynamicMetaTools, partitionCursorBuiltinTools, shouldEnableBuiltinDynamicProfile } from './dynamicTools'
import { contextualizeSubagentTools } from './subagentCatalog'
import { addUsage, clampTokenDetails, emptyUsageTotals, estimateContextTokens, getAutoCompactThreshold, shouldTriggerCompaction } from './usage'
import { recordUsage } from '../../stats/usageStore'
import { normalizeUsage } from '../../../shared/usageTypes'
import { isAgentRunAbortedError, throwIfSessionCancelled } from './wait'
import { isSessionCancelled } from './session'
import { makeProviderError, makeToolError } from '../errors'
import { createRepairDiagnostics, hasRepairMutations, repairConversationHistory } from '../llm/transformMessages'

/**
 * 重新导出拆出去的模块，保持本文件原有公开 API 不变。
 *
 * 测试与外部（`contextBreakdown.test.ts` / `editPathDetection.test.ts`）一直从
 * 这里导入这些符号；拆分是内部结构调整，不应该逼调用方改路径。
 */
export { buildContextBreakdown, type BreakdownCategory } from './contextBreakdown'
export { detectEditPathFromToolInput, EditDeltaExtractor, normalizeDetectedEditPath } from './editStreamExtractor'

const LEADING_DASH_RE = /^-\s*/

const EDIT_TOOL_NAMES = new Set(['ApplyPatch', 'Edit', 'Write', 'EditNotebook'])

function cacheAndBuildKvBlob(id: number, blob: { blobId: string; blobData: string; blobDataRaw?: Uint8Array }): AgentServerMessage {
  cacheBlob(blob.blobId, blob.blobData)
  return kvMessage(id, blob.blobId, blob.blobData, blob.blobDataRaw)
}

function recordAssistantBlocksIntoTurn(turn: ActiveTurnTracker | null, blocks: LLMContentBlock[]): Array<{ blobId: string, blobData: string }> {
  if (!turn)
    return []
  const emitted: Array<{ blobId: string, blobData: string }> = []
  for (const block of blocks) {
    if (block.type === 'thinking') {
      const blob = turn.addThinking(block.text)
      if (blob)
        emitted.push(blob)
      continue
    }
    if (block.type === 'text') {
      const blob = turn.addAssistantText(block.text)
      if (blob)
        emitted.push(blob)
    }
  }
  return emitted
}

function extractCompletedToolCall(frame: AgentServerMessage) {
  if (frame.message.case !== 'interactionUpdate')
    return undefined
  const msg = frame.message.value.message
  if (msg.case !== 'toolCallCompleted')
    return undefined
  return msg.value.toolCall
}

const editExtractors = new Map<string, EditDeltaExtractor>()
const editPathSent = new Set<string>()
const editStreamDiagnostics = new Map<string, EditStreamDiagnostics>()

// Auto-summarize 阈值: 不再用百分比，改为绝对 buffer 模式 (对齐 Claude Code):
//   threshold = (contextTokenLimit - 20K outputReserve) - 13K buffer
// 效果: 200K 模型 ~83.5% 触发, 1M 模型 ~96.7% 触发

function flushPendingAssistantPrefix(params: {
  roundAssistantBlocks: LLMContentBlock[]
  currentThinking: string
  currentText: string
}): {
  currentThinking: string
  currentText: string
} {
  const { roundAssistantBlocks } = params
  let { currentThinking, currentText } = params

  if (currentThinking) {
    roundAssistantBlocks.push({ type: 'thinking', text: currentThinking })
    currentThinking = ''
  }

  if (currentText) {
    roundAssistantBlocks.push({ type: 'text', text: currentText })
    currentText = ''
  }

  return { currentThinking, currentText }
}

/**
 * 在 Agent Run 流内执行 inline auto-summarize。
 *
 * 对应客户端分析中的链路①：服务端在 BiDi 流中自主决定 summarize，
 * 客户端通过 summaryStarted/summaryCompleted 消息被动响应。
 *
 * 流程：
 * 1. yield summaryStarted — 通知客户端开始 summarize
 * 2. 根据当前 allBlobIds 规划 compaction（planCompaction）
 * 3. 调用 LLM 生成摘要文本
 * 4. 生成 compaction artifacts（summary blob + archive）
 * 5. 通过 kv 消息发送新 blob 到客户端
 * 6. yield checkpoint — 回写 compacted ConversationState
 * 7. yield summaryCompleted — 通知客户端 summarize 完成
 * 8. 返回 compacted 状态供后续 round 继续使用
 */
async function* performInlineAutoSummarize(params: {
  parsed: ParsedRunRequest
  allBlobIds: string[]
  summaryArchiveIds: string[]
  usedTokensEstimate: number
  contextTokenLimit: number
  messages: LLMMessage[]
  route: ReturnType<typeof resolveProviderRuntime>
  readPaths: string[]
}): AsyncGenerator<AgentServerMessage, {
  newBlobIds: string[]
  newSummaryArchiveIds: string[]
  newUsedTokens: number
  newMessages: LLMMessage[]
} | null> {
  const { parsed, allBlobIds, summaryArchiveIds, usedTokensEstimate, contextTokenLimit, route } = params

  const historyEntries = repairHistoryEntries(hydrateHistoryEntries(allBlobIds))
  if (historyEntries.length === 0)
    return null

  const compactionPlan = planCompaction(historyEntries)
  if (compactionPlan.summarizeEntries.length === 0) {
    logger.info({ conversationId: parsed.conversationId }, '[AGENT] auto-summarize: nothing to compact')
    return null
  }

  logger.info({
    conversationId: parsed.conversationId,
    totalEntries: historyEntries.length,
    summarizeCount: compactionPlan.summarizeEntries.length,
    keepTailCount: compactionPlan.keepTail.length,
    leadingCount: compactionPlan.leading.length,
    usedTokensEstimate,
    contextTokenLimit,
  }, '[AGENT] auto-summarize: starting inline compaction')

  yield summaryStarted()

  const summarySourceText = compactionPlan.summarizeEntries
    .map(entry => formatMessageForSummary(entry.message))
    .filter(text => text.length > 0)
    .join('\n\n')

  let summaryText = ''
  try {
    const llmStream = route.provider.stream({
      model: route.model,
      thinking: false,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: buildSummaryUserMessage(summarySourceText) },
      ],
    })

    for await (const event of llmStream) {
      if (event.type === 'text_delta') {
        summaryText += event.text
        yield summary(event.text)
      }
    }
  }
  catch (error) {
    logger.warn({ error: (error as Error).message }, '[AGENT] auto-summarize: LLM failed, using local fallback')
  }

  summaryText = summaryText.trim()
  if (!summaryText) {
    summaryText = summarySourceText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map(line => `- ${line.replace(LEADING_DASH_RE, '')}`)
      .join('\n')
      .slice(0, 4000)
  }
  if (!summaryText) {
    summaryText = '- Prior conversation compacted.'
  }

  const artifacts = createCompactionArtifacts({
    plan: compactionPlan,
    summaryText,
    previousSummaryArchiveIds: summaryArchiveIds,
  })

  yield kvMessage(1, artifacts.summaryBlobId, artifacts.summaryBlobData)
  for (const [index, archiveBlob] of artifacts.archiveBlobs.entries()) {
    yield kvMessage(2 + index, archiveBlob.blobId, archiveBlob.blobData, archiveBlob.blobDataRaw)
  }

  const compactedTokenDetails = clampTokenDetails(
    estimateMessagesTokens([
      ...compactionPlan.leading.map(entry => entry.message),
      { role: 'assistant', content: `Previous conversation summary:\n${artifacts.summaryText}` },
      ...compactionPlan.keepTail.map(entry => entry.message),
    ]),
    contextTokenLimit,
  )

  persistConversationCheckpoint({ kind: 'committed',
    conversationId: parsed.conversationId,
    rootBlobIds: artifacts.nextRootBlobIds,
    turnBlobIds: parsed.historyTurnBlobIds,
    summaryArchiveIds: artifacts.nextSummaryArchiveIds,
    tokenDetails: compactedTokenDetails,
    mode: parsed.mode,
    updatedAt: Date.now(),
  })

  yield checkpoint(
    artifacts.nextRootBlobIds,
    compactedTokenDetails.usedTokens,
    compactedTokenDetails.maxTokens,
    parsed.mode,
    undefined,
    {
      turnBlobIds: parsed.historyTurnBlobIds,
      summaryArchiveIds: artifacts.nextSummaryArchiveIds,
      workspaceUris: workspaceUris(parsed),
      readPaths: params.readPaths,
      modelName: route.model,
      gitRepos: parsed.gitRepos?.map(r => ({ path: r.path, branchName: r.branchName })),
    },
  )

  yield summaryCompleted('Chat context summarized.')

  // 重建 compacted 后的 messages 数组供后续 round 使用
  const newMessages: LLMMessage[] = []
  let undecodableBlobs = 0
  for (const blobId of artifacts.nextRootBlobIds) {
    const blobData = getCachedBlob(blobId)
    if (!blobData)
      continue
    try {
      const decoded = decodeBlob(blobData)
      if (decoded && typeof decoded === 'object') {
        const restored = restoreBlobMessageToLLMMessage(decoded as Record<string, unknown>)
        if (restored)
          newMessages.push(restored)
      }
    }
    catch (error) {
      // 压缩后的历史若有一条 blob 解不开，它会被静默跳过 —— 而表现只是
      // 「模型好像忘了刚才说过的话」，从日志上完全看不出来。这里留痕。
      undecodableBlobs++
      logger.warn(
        { conversationId: parsed.conversationId, blobId, error: (error as Error).message },
        '[AGENT] auto-summarize: skipped undecodable root blob',
      )
    }
  }
  const repairDiagnostics = createRepairDiagnostics(newMessages.length)
  const repairedNewMessages = repairConversationHistory(newMessages, repairDiagnostics)
  if (hasRepairMutations(repairDiagnostics)) {
    logger.debug({
      stage: 'performInlineAutoSummarize:newMessages',
      conversationId: parsed.conversationId,
      ...repairDiagnostics,
    }, '[HISTORY_REPAIR] canonicalized conversation history')
  }

  logger.info({
    conversationId: parsed.conversationId,
    previousBlobCount: allBlobIds.length,
    newBlobCount: artifacts.nextRootBlobIds.length,
    previousUsedTokens: usedTokensEstimate,
    newUsedTokens: compactedTokenDetails.usedTokens,
    newMessageCount: repairedNewMessages.length,
    // 非 0 表示压缩后的历史有内容丢失，post-mortem 时这是唯一的线索
    undecodableBlobs,
  }, '[AGENT] auto-summarize: compaction complete')

  return {
    newBlobIds: artifacts.nextRootBlobIds,
    newSummaryArchiveIds: artifacts.nextSummaryArchiveIds,
    newUsedTokens: compactedTokenDetails.usedTokens,
    newMessages: repairedNewMessages,
  }
}

export async function* handleConversationRun(
  parsed: ParsedRunRequest,
  session: AgentSession | null,
): AsyncIterable<AgentServerMessage> {
  const route = resolveProviderRuntime(parsed.modelId)
  const requestedContextTokenLimit = parsed.contextTokenLimit
  if (parsed.contextTokenLimit === undefined) {
    parsed.contextTokenLimit = route.contextTokenLimit
  }
  const contextTokenLimit = parsed.contextTokenLimit ?? route.contextTokenLimit
  logger.debug({
    conversationId: parsed.conversationId,
    modelId: parsed.modelId,
    routeContextTokenLimit: route.contextTokenLimit,
    requestedContextTokenLimit,
    effectiveContextTokenLimit: contextTokenLimit,
    source: requestedContextTokenLimit !== undefined ? 'requestedModel.parameters.context' : 'route.contextTokenLimit',
  }, '[AGENT] context token limit resolved')

  const disabledToolsForRun = new Set<string>()
  if (!parsed.webFetchEnabled)
    disabledToolsForRun.add('WebFetch')
  if (!parsed.webSearchEnabled)
    disabledToolsForRun.add('WebSearch')
  if (!parsed.readLintsEnabled)
    disabledToolsForRun.add('ReadLints')

  const previousDynamicToolCount = [...parsed.historyTurnBlobIds]
    .reverse()
    .map(turnBlobId => readTurnBaseline(turnBlobId)?.dynamicToolCount)
    .find(count => count !== undefined)
  // 官方 dynamicToolProfile 缺省 all-static；显式 capability、meta-MCP 或同一
  // 会话已经启用过 dynamic profile 时继续 final。后两者覆盖不带 context 的
  // background-completion/resume 请求，避免工具集在相邻轮间来回抖动。
  const clientSupportsDynamicProfile = shouldEnableBuiltinDynamicProfile({
    clientSupportsDynamicTools: parsed.clientSupportsDynamicTools,
    mcpMetaToolEnabled: parsed.mcpMetaTool?.enabled === true,
    previousDynamicToolCount,
    isSubagent: parsed.isSubagent,
  })
  const contextualizedBuiltinTools = contextualizeSubagentTools(
    route.toolCatalog.listBuiltins(),
    parsed.customSubagents,
  )
  const modeFilteredBuiltins = route.listRuntimeTools(
    [],
    parsed.mode,
    parsed.isSubagent,
    disabledToolsForRun,
    contextualizedBuiltinTools,
  )
  const cursorPartition = partitionCursorBuiltinTools(
    modeFilteredBuiltins,
    clientSupportsDynamicProfile,
  )
  parsed.cursorDynamicTools = cursorPartition.dynamicTools
  parsed.dynamicToolCount = cursorPartition.dynamicTools.length
  const runtimeBuiltinTools = contextualizeDynamicMetaTools(
    contextualizedBuiltinTools,
    parsed.cursorDynamicTools,
  )
  for (const tool of cursorPartition.dynamicTools)
    disabledToolsForRun.add(tool.tool)

  const hasMcpDynamicNamespaces = parsed.mcpMetaTool?.enabled === true
    && parsed.mcpMetaTool.descriptors.length > 0
  const hasAnyDynamicNamespaces = hasMcpDynamicNamespaces || parsed.cursorDynamicTools.length > 0
  if (!hasAnyDynamicNamespaces) {
    disabledToolsForRun.add('GetDynamicTools')
    disabledToolsForRun.add('CallDynamicTool')
  }

  // 旧 Cursor++ turn 没写 field 5；已有历史时把 undefined 视作 rollout 前的 0，
  // 只在首个 dynamic turn 提醒一次，随后 checkpoint 会持久化真实计数。
  const effectivePreviousDynamicToolCount = previousDynamicToolCount
    ?? (parsed.historyTurnBlobIds.length > 0 ? 0 : undefined)
  parsed.dynamicToolTransitionReminder = !parsed.isBackgroundTaskCompletion
    && parsed.dynamicToolCount > 0
    && effectivePreviousDynamicToolCount === 0

  logger.info({
    conversationId: parsed.conversationId,
    transport: parsed.requestContextTransport,
    clientSupportsDynamicProfile,
    profile: parsed.cursorDynamicTools.length > 0 ? 'final' : 'all-static',
    cursorDynamicToolCount: parsed.cursorDynamicTools.length,
    cursorDynamicToolNames: parsed.cursorDynamicTools.map(tool => tool.tool),
    previousDynamicToolCount,
    effectivePreviousDynamicToolCount,
    transitionReminder: parsed.dynamicToolTransitionReminder,
  }, '[DYNAMIC-TOOLS] builtin profile resolved')

  const [systemMessage, preambleUserMessage, currentUserMessage] = buildMessages(parsed, route.promptProfile)
  const systemContent = typeof systemMessage.content === 'string' ? systemMessage.content : ''
  const preambleUserContent = typeof preambleUserMessage.content === 'string' ? preambleUserMessage.content : ''
  // currentUserMessage.content 可能是 string 或 LLMContentBlock[]（当含图片时）
  const currentUserContentRaw = currentUserMessage.content
  const currentUserText = typeof currentUserContentRaw === 'string'
    ? currentUserContentRaw
    : currentUserContentRaw
        .filter((b): b is Extract<LLMContentBlock, { type: 'text' }> => b.type === 'text')
        .map(b => b.text)
        .join('')
  const currentUserImageCount = typeof currentUserContentRaw === 'string'
    ? 0
    : currentUserContentRaw.filter(b => b.type === 'image').length

  logger.info({
    promptProvider: route.promptProfile.provider,
    promptVariant: route.promptProfile.variant,
    promptStyle: route.promptProfile.systemPromptStyle,
    observedSystemPromptHashes: route.promptProfile.observedSystemPromptHashes,
    promptVocabulary: route.promptProfile.promptVocabulary,
    systemPromptLength: systemContent.length,
    preambleUserMessageLength: preambleUserContent.length,
    currentUserMessageLength: currentUserText.length,
    currentUserImageCount,
    hasRulesSection: preambleUserContent.includes('<rules>'),
    hasAgentSkillsSection: preambleUserContent.includes('<agent_skills>'),
    hasAgentTranscriptsSection: preambleUserContent.includes('<agent_transcripts>'),
    hasUserQuerySection: currentUserText.includes('<user_query>'),
    hasMcpSection: systemContent.includes('<mcp_file_system>'),
    hasLinterSection: systemContent.includes('<linter_errors>'),
    hasTerminalSection: systemContent.includes('<terminal_files_information>'),
  }, '[AGENT] built prompt')

  // 后台 job 注册表需要 env.terminalsFolder 构造后台 shell 的终端文件路径
  // ({terminalsFolder}/{shellId}.txt)。在 run 起始把它挂到 session,供 AwaitShell 分流时取用。
  if (session && parsed.env.terminalsFolder)
    session.terminalsFolder = parsed.env.terminalsFolder

  const readContext = {
    cursorRules: parsed.cursorRules,
    agentSkills: parsed.agentSkills,
    workspacePaths: parsed.env.workspacePaths ?? [],
    readPaths: new Set(parsed.readPaths),
  }

  // MCP 模式判定 —— 每轮一条,用来回答"这次会话到底走的哪条路"。
  // 没有它,"客户端没开 meta 模式"和"我们把工具弄丢了"在日志上长得一样。
  //
  // 内置工具侧同理: profile 一开,那批工具就从 LLM 可见表移进 cursor namespace,
  // 现象与"工具被弄丢"完全一致。故把分区结果与触发来源一并打出 ——
  // profileTrigger 三条路径行为不同(capability 来自 3.17 客户端字段、
  // mcp_meta 跟随 MCP 开关、previous_turn 是跨轮防抖),出问题要先分清是哪条。
  logger.info({
    conversationId: parsed.conversationId,
    mcpMode: parsed.mcpMetaTool?.enabled ? 'dynamic_namespace' : 'legacy_flat',
    namespaces: parsed.mcpMetaTool?.descriptors.map(d => ({
      name: d.serverIdentifier,
      tools: d.tools.length,
    })) ?? [],
    routingTableSize: parsed.mcpTools.length,
    supportsMcpAuth: parsed.supportsMcpAuth === true,
    // ── 内置工具 dynamic profile (cursor namespace) ──
    builtinDynamicProfile: clientSupportsDynamicProfile,
    profileTrigger: !clientSupportsDynamicProfile
      ? 'off'
      : parsed.clientSupportsDynamicTools
          ? 'capability'
          : parsed.mcpMetaTool?.enabled
            ? 'mcp_meta'
            : 'previous_turn',
    // staticToolCount 是模型直接可见的内置工具数;骤降说明分区把不该动的工具
    // (Shell / Read / Edit 等)划进了 dynamic,而那类故障没有其它痕迹。
    staticToolCount: cursorPartition.staticTools.length,
    dynamicToolCount: parsed.dynamicToolCount,
    cursorDynamicTools: parsed.cursorDynamicTools.map(t => t.tool),
  }, '[DYNAMIC-TOOLS] MCP mode resolved')

  let breakdownCategories: BreakdownCategory[] | undefined

  let blobCounter = 0
  let interactionIdCounter = 1
  let blobIds: string[] = []
  let turnBlobIds = [...parsed.historyTurnBlobIds]
  let messages: LLMMessage[] = []
  let currentSummaryArchiveIds = [...parsed.historySummaryArchiveIds]
  // 连续失败熔断 (对齐 Claude Code MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3)
  // 不再用 autoSummarizePerformed 一次性限制——每轮都可重复触发,直至连续失败 3 次停止
  let autoCompactConsecutiveFailures = 0
  const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3
  const syntheticUserMessageId = parsed.isBackgroundTaskCompletion
    ? `background-completion-${Date.now()}`
    : parsed.rawUserMessage?.messageId && typeof parsed.rawUserMessage.messageId === 'string'
      ? parsed.rawUserMessage.messageId
      : `turn-${Date.now()}`
  let activeTurn: ActiveTurnTracker | null = null

  const sendSystemScaffoldBlob = function* (
    data: { role: string, content: unknown, toolCallId?: string, toolName?: string, isError?: boolean },
  ): Generator<AgentServerMessage, void, void> {
    yield* sendAndCacheBlob(kvMessage, 0, data, blobIds)
  }

  const sendOrderedBlob = function* (
    data: { role: string, content: unknown, toolCallId?: string, toolName?: string, isError?: boolean },
  ): Generator<AgentServerMessage, void, void> {
    yield* sendAndCacheBlob(kvMessage, ++blobCounter, data, blobIds)
  }

  yield heartbeat()

  if (parsed.isBackgroundTaskCompletion) {
    const completion = parsed.backgroundTaskCompletions[0]
    logger.info({
      conversationId: parsed.conversationId,
      completionCount: parsed.backgroundTaskCompletions.length,
      completions: parsed.backgroundTaskCompletions.map(c => ({
        taskId: c.taskId,
        kind: c.kind,
        status: c.status,
        title: c.title,
        hasDetail: !!c.detail,
        detailLen: c.detail?.length ?? 0,
        hasOutputPath: !!c.outputPath,
        hasThreadId: !!c.threadId,
      })),
      simulatedUserTextLen: parsed.userText.length,
    }, '[AGENT] background task completion: appending simulated user message')
    yield userMessageAppended({
      text: parsed.userText,
      messageId: syntheticUserMessageId,
      mode: parsed.mode,
      simulatedMsgReason: SimulatedMsgReason.BACKGROUND_TASK_COMPLETION,
      simulatedMessageMetadata: completion
        ? {
            ...(completion.title ? { title: completion.title } : {}),
            ...(completion.taskId ? { taskId: completion.taskId } : {}),
          }
        : undefined,
    })
  }

  if (parsed.isResume) {
    if (turnBlobIds.length > 0) {
      const resumed = ActiveTurnTracker.fromTurnBlobId(turnBlobIds[turnBlobIds.length - 1]!)
      if (resumed) {
        resumed.setDynamicToolCount(parsed.dynamicToolCount)
        activeTurn = resumed
        turnBlobIds = turnBlobIds.slice(0, -1)
      }
      else {
        logger.warn({ conversationId: parsed.conversationId, lastTurnBlobId: turnBlobIds[turnBlobIds.length - 1] }, '[TURN] failed to resume last turn baseline; future checkpoints will omit turns for this resume')
      }
    }
  }
  else {
    const { blob, messageId } = createCurrentTurnUserMessageBlob({
      parsed,
      fallbackMessageId: syntheticUserMessageId,
    })
    activeTurn = new ActiveTurnTracker(blob.blobId, [], messageId, parsed.dynamicToolCount)
    yield cacheAndBuildKvBlob(++blobCounter, blob)
  }

  const rebuiltHistory = yield* rebuildConversationHistory({
    historyBlobIds: parsed.historyBlobIds,
    prependUserMessages: parsed.prependUserMessages,
    systemMessage,
    preambleUserMessage,
    currentUserMessage,
    systemContent,
    preambleUserContent,
    sendSystemScaffoldBlob,
    sendOrderedBlob,
  })
  messages = rebuiltHistory.messages

  for (const text of rebuiltHistory.insertedPrependUserTexts) {
    yield* sendOrderedBlob({ role: 'user', content: text })
  }

  yield* sendOrderedBlob({ role: 'user', content: currentUserContentRaw })
  let nextBlobbedMessageIndex = messages.length

  const userPreview = parsed.isExecutePlan && parsed.executePlanContent
    ? `[ExecutePlan] ${parsed.executePlanContent.match(/^---\s*\nname:\s*(.+)/m)?.[1]?.trim() ?? parsed.executePlanFileUri ?? 'plan'}`
    : parsed.userText.length > 80 ? `${parsed.userText.slice(0, 80)}...` : parsed.userText
  logger.info(`[AGENT] → [${route.provider.name}/${route.model}] "${userPreview}" (${messages.length} msgs)`)

  const usageTotals = emptyUsageTotals()
  let usedTokensEstimate = Math.max(
    parsed.historyTokenDetails?.usedTokens ?? 0,
    estimateMessagesTokens(messages),
  )
  let lastAssistantContent: LLMContentBlock[] | undefined
  let stepCounter = 0

  for (let round = 0; ; round++) {
    // 轮次边界的中断检查 —— 上一轮工具刚跑完时客户端可能已经中断,
    // 此处拦下可避免白发一次 LLM 请求
    if (session && isSessionCancelled(session)) {
      logger.info({
        conversationId: parsed.conversationId,
        round,
        reason: session.cancelledReason,
      }, '[CANCEL] run cancelled at round boundary')
      return
    }

    const pendingToolCalls: ToolCallInfo[] = []
    const inflightToolCalls = new Map<string, { name: string, input: string }>()
    const roundAssistantBlocks: LLMContentBlock[] = []
    let currentThinking = ''
    let currentText = ''

    try {
      // dynamic namespace 模式 (Cursor 3.15.6): MCP 工具**不进** LLM 可见工具表,
      // 改由 GetDynamicTools 按需发现。parsed.mcpTools 仍保持全量 —— 它是**路由表**,
      // CallDynamicTool 要靠它把 namespace + toolName 映射成 McpArgs。
      //
      // 这两张表此前是同一张,legacy 模式下恰好重合所以没暴露问题;meta 模式下
      // 客户端只发 slim 名单(仅 toolName,无 inputSchema),摊平下发等于给 LLM
      // 一堆没有参数说明的工具。见 analysis/mcp-dynamic-tools.md。
      const llmVisibleMcpTools = parsed.mcpMetaTool?.enabled ? [] : parsed.mcpTools
      const preparedRequest = route.prepareStreamRequest(messages, llmVisibleMcpTools, undefined, parsed.mode, {
        thinking: parsed.clientThinking,
        level: parsed.clientThinkingLevel,
        budget: parsed.clientThinkingBudget,
      }, parsed.conversationId, parsed.isSubagent, parsed.clientFast,
      disabledToolsForRun.size > 0 ? disabledToolsForRun : undefined,
      contextTokenLimit,
      runtimeBuiltinTools)

      if (!breakdownCategories) {
        breakdownCategories = buildContextBreakdown({
          systemContent,
          preambleUserContent,
          requestMessages: preparedRequest.request.messages,
          requestTools: preparedRequest.request.tools ?? [],
          // 路由表(全量)而非 LLM 可见表 —— legacy 模式下要靠它把扁平
          // requestTools 里的 MCP 工具认出来
          mcpToolNames: new Set(parsed.mcpTools.map(t => t.name)),
        })
      }

      logger.info({
        round,
        codec: route.conversationCodec.name,
        semanticTurns: preparedRequest.conversation.semanticTurns.map(turn => turn.kind),
        toolCatalogProvider: route.toolCatalog.provider,
        toolCatalogVariant: route.toolCatalog.variant,
        builtinsCount: route.toolCatalog.listBuiltins().length,
        runtimeToolsCount: preparedRequest.request.tools?.length ?? 0,
        // 路由表规模 vs 实际下发给 LLM 的规模 — meta 模式下后者恒为 0
        mcpToolsCount: parsed.mcpTools.length,
        mcpToolNames: parsed.mcpTools.map(t => t.name),
        mcpMetaToolEnabled: parsed.mcpMetaTool?.enabled === true,
        llmVisibleMcpToolsCount: llmVisibleMcpTools.length,
      }, '[AGENT] prepared provider conversation')

      const llmStream = route.provider.stream(preparedRequest.request)

      const translatedFrames = translateStream(llmStream, String(++stepCounter), (event) => {
        switch (event.type) {
          case 'thinking_delta':
            currentThinking += event.text
            break
          case 'thinking_done':
            // 即使 currentThinking 为空也要保存 — DeepSeek 要求空 reasoning_content 原样回传
            roundAssistantBlocks.push({ type: 'thinking', text: currentThinking, signature: event.signature, sourceModel: `${route.promptProfile.provider}:${route.model}` })
            currentThinking = ''
            break
          case 'text_delta':
            currentText += event.text
            break
          case 'tool_use_start': {
            ({ currentThinking, currentText } = flushPendingAssistantPrefix({
              roundAssistantBlocks,
              currentThinking,
              currentText,
            }))
            inflightToolCalls.set(event.id, { name: event.name, input: '' })
            if (EDIT_TOOL_NAMES.has(event.name)) {
              editExtractors.set(event.id, new EditDeltaExtractor(event.name))
              editStreamDiagnostics.set(event.id, { deltaCount: 0, streamContent: '' })
              logger.debug({ callId: event.id, tool: event.name }, '[EDIT_T] 1.tool_use_start → extractor created')
            }
            break
          }
          case 'tool_use_delta': {
            const current = inflightToolCalls.get(event.id) ?? { name: '', input: '' }
            const accumulatedInput = current.input + event.input
            inflightToolCalls.set(event.id, { ...current, input: accumulatedInput })
            const extractor = editExtractors.get(event.id)
            if (extractor) {
              const content = extractor.feed(event.input)
              const mcid = `${parsed.conversationId}-${round}-${event.id.slice(-4)}`
              const frames: AgentServerMessage[] = []
              if (extractor.detectedPath && !editPathSent.has(event.id)) {
                editPathSent.add(event.id)
                const normalizedPath = normalizeDetectedEditPath(extractor.detectedPath)
                frames.push(partialToolCall(event.id, 'editToolCall', mcid, { path: normalizedPath }))
                logger.debug({ callId: event.id, path: normalizedPath, rawPath: extractor.detectedPath, mcid }, '[EDIT_T] 2.partialToolCall{path}')
                const streamDiag = editStreamDiagnostics.get(event.id)
                logger.debug({
                  callId: event.id,
                  tool: current.name,
                  path: normalizedPath,
                  rawPath: extractor.detectedPath,
                  streamedBeforePath: streamDiag ? {
                    deltaCount: streamDiag.deltaCount,
                    streamContent: editNewlineStats(streamDiag.streamContent),
                  } : undefined,
                  currentDelta: editNewlineStats(event.input),
                  accumulatedInput: editNewlineStats(accumulatedInput),
                  mcid,
                }, '[EDIT_NL] edit path detected during stream')
              }
              if (content) {
                const streamDiag = editStreamDiagnostics.get(event.id)
                if (streamDiag) {
                  streamDiag.deltaCount++
                  streamDiag.streamContent += content
                }
                frames.push(editToolCallStreamDelta(event.id, content, mcid))
                logger.debug({ callId: event.id, contentLen: content.length, hasPath: editPathSent.has(event.id), mcid }, '[EDIT_T] 3.editToolCallDelta')
              }
              if (frames.length > 0) return frames.length === 1 ? frames[0] : frames
            }
            break
          }
          case 'tool_use_done': {
            editExtractors.delete(event.id)
            const pathWasSent = editPathSent.has(event.id)
            const streamDiag = editStreamDiagnostics.get(event.id)
            const current = inflightToolCalls.get(event.id)
            if (current) {
              // 权威参数: done 事件携带的完整 arguments > delta 累积
              const rawArgs = event.arguments ?? current.input ?? ''
              let input: Record<string, unknown> = {}
              try { input = JSON.parse(rawArgs) } catch {}
              if (EDIT_TOOL_NAMES.has(current.name)) {
                logger.debug({
                  callId: event.id,
                  tool: current.name,
                  pathWasSentDuringStream: pathWasSent,
                  rawArgs: editNewlineStats(rawArgs),
                  targetFields: editToolTargetStats(current.name, input),
                  streamedContent: streamDiag ? {
                    deltaCount: streamDiag.deltaCount,
                    stats: editNewlineStats(streamDiag.streamContent),
                    suspicious: {
                      hasCrCrLf: /\r\r\n/.test(streamDiag.streamContent),
                      mixedLineEndings: editNewlineStats(streamDiag.streamContent).mixed,
                      hasLargeBlankRun: editNewlineStats(streamDiag.streamContent).maxConsecutiveBlankLines >= 3,
                    },
                  } : undefined,
                }, '[EDIT_NL] final edit tool arguments newline diagnostics')
              }
              pendingToolCalls.push({ callId: event.id, name: current.name, input })
              roundAssistantBlocks.push({ type: 'tool_use', id: event.id, name: current.name, input })
              inflightToolCalls.delete(event.id)
              editPathSent.delete(event.id)
              editStreamDiagnostics.delete(event.id)
            }
            else {
              editPathSent.delete(event.id)
              editStreamDiagnostics.delete(event.id)
            }
            break
          }
          case 'done':
            ({ currentThinking, currentText } = flushPendingAssistantPrefix({
              roundAssistantBlocks,
              currentThinking,
              currentText,
            }))
            Object.assign(usageTotals, addUsage(usageTotals, event.usage))
            usedTokensEstimate = Math.max(usedTokensEstimate, estimateContextTokens(event.usage))
            // 用量统计落盘。逐协议归一化后再写 —— 四种协议的 inputTokens 口径不同，
            // 原样记录会让缓存命中率跨协议不可比（见 shared/usageTypes.ts）。
            // route.model 是 apiModel（发给端点的真实模型名），不是 UI 上的显示名，
            // 这样统计行能和端点日志对上。
            recordUsage({
              ts: Date.now(),
              provider: route.providerName,
              providerId: route.providerId,
              model: route.model,
              providerType: route.providerType,
              ...normalizeUsage(route.providerType, event.usage),
            })
            break
        }
      }, undefined, (event) => {
        if (event.type === 'tool_use_start')
          return `${parsed.conversationId}-${round}-${event.id.slice(-4)}`
      })

      for await (const frame of translatedFrames) {
        // LLM 流是一轮里最长的一段停留,中断多半落在这里。逐帧检查把中断
        // 粒度收敛到单个事件 (thinking_delta 级,毫秒量级)。抛出后由下方
        // catch 的 isAgentRunAbortedError 分支干净收尾,半截的
        // roundAssistantBlocks 一并丢弃,不污染历史。
        if (session)
          throwIfSessionCancelled(session)
        yield frame
      }
    }
    catch (e) {
      // 客户端主动中断不是错误 —— 必须先于 makeProviderError 拦下,
      // 否则会被包成 ErrorDetails,在客户端渲染出一条 retry banner:
      // 用户只是发了新消息抢占当前生成,却看到"上一条失败了"。
      if (isAgentRunAbortedError(e)) {
        logger.info({
          conversationId: parsed.conversationId,
          round,
          reason: session?.cancelledReason,
        }, '[CANCEL] LLM stream aborted by client')
        return
      }

      // 关键: 不再往对话流 yield textDelta('[BYOK Error] ...') —— 那会让错误文本
      // 伪装成 assistant 的"正常回复", 同时被写进 roundAssistantBlocks 污染历史,
      // 下一轮 LLM 会看到自己刚刚回复了 [BYOK Error] 导致状态错乱。
      //
      // 现在直接抛 ConnectError, 让 AgentService.runSSE 的顶层 catch 把 error
      // 序列化到 SSE trailer。客户端 @connectrpc 解包 aiserver.v1.ErrorDetails
      // 后, composer.maybeThrowErrorAndRetry 会写入 ComposerData.submitErrorDetails,
      // Glass Composer 的 Lzv 组件渲染成 input 正上方的 retry banner。
      logger.error({ error: (e as Error).message, stack: (e as Error).stack }, '[LLM] stream error')
      clearDraftCheckpoint(parsed.conversationId).catch(() => {})
      throw makeProviderError(e, {
        conversationId: parsed.conversationId,
        modelId: parsed.modelId,
        round: String(round),
      })
    }

    if (pendingToolCalls.length === 0) {
      const transition = route.transitionRound(messages, roundAssistantBlocks)
      if (transition.assistantAdded) {
        lastAssistantContent = roundAssistantBlocks
        const turnBlobs = recordAssistantBlocksIntoTurn(activeTurn, roundAssistantBlocks)
        for (const blob of turnBlobs)
          yield cacheAndBuildKvBlob(++blobCounter, blob)
      }
      break
    }

    logger.info({ round, toolCalls: pendingToolCalls.map(t => t.name) }, '[AGENT] processing tool calls')
    let flushedToolResults = 0
    try {
      const assistantContent = roundAssistantBlocks
      lastAssistantContent = assistantContent
      const turnBlobs = recordAssistantBlocksIntoTurn(activeTurn, assistantContent)
      for (const blob of turnBlobs)
        yield cacheAndBuildKvBlob(++blobCounter, blob)

      const roundContext = route.createRoundContext()
      const roundImageBlocks: LLMContentBlock[] = []

      // ── Phase 1: 批量发送 Task tool 的 started + exec（不等待结果） ──
      const taskLaunches: TaskLaunchContext[] = []
      const nonTaskCalls: typeof pendingToolCalls = []
      for (const tc of pendingToolCalls) {
        // dynamic profile 下 Task 落在 cursor namespace,LLM 侧名字是
        // CallDynamicTool,真实身份藏在 arguments 里。按 tc.name 分流会让
        // Task 掉进 Phase 2 串行路径,丢掉并发启动与 subagent 模型解析。
        const executionToolName = resolveExecutionToolName(tc.name, tc.input, parsed.cursorDynamicTools)
        if ((executionToolName === 'Task' || executionToolName === 'Subagent') && session) {
          const ctx = yield* launchTaskTool({
            toolCall: tc,
            availableMcpTools: parsed.mcpTools,
            conversationId: parsed.conversationId,
            currentModelId: parsed.modelId,
            subagentModelOverrides: parsed.subagentModelOverrides,
            round,
            allocateExecMessageId: () => ++blobCounter,
            cursorDynamicTools: parsed.cursorDynamicTools,
          })
          if (ctx)
            taskLaunches.push(ctx)
        }
        else {
          nonTaskCalls.push(tc)
        }
      }

      if (taskLaunches.length > 1)
        logger.info({ count: taskLaunches.length, callIds: taskLaunches.map(t => t.tc.callId) }, '[AGENT] task tools launched concurrently')

      // ── Phase 2: 串行执行非 Task 工具（edit, shell, glob 等） ──
      for (const tc of nonTaskCalls) {
        const toolFrames = runToolCall({
          toolCall: tc,
          availableMcpTools: parsed.mcpTools,
          conversationId: parsed.conversationId,
          currentModelId: parsed.modelId,
          subagentModelOverrides: parsed.subagentModelOverrides,
          round,
          session,
          roundContext,
          messages,
          allocateExecMessageId: () => ++blobCounter,
          allocateInteractionId: () => interactionIdCounter++,
          imageCollector: roundImageBlocks,
          readContext,
          // GetDynamicTools 需要据此决定取哪些 server、是否补 mcp_auth
          mcpMetaTool: parsed.mcpMetaTool,
          supportsMcpAuth: parsed.supportsMcpAuth,
          cursorDynamicTools: parsed.cursorDynamicTools,
          projectDir: parsed.env.projectFolder ?? parsed.env.workspacePaths?.[0],
        })
        for await (const frame of toolFrames) {
          const completedToolCall = extractCompletedToolCall(frame)
          if (activeTurn && completedToolCall) {
            const toolBlob = activeTurn.addCompletedToolCall(completedToolCall)
            yield cacheAndBuildKvBlob(++blobCounter, toolBlob)
          }
          yield frame
        }
      }

      // ── Phase 3: 并发等待所有 Task 结果 ──
      if (taskLaunches.length > 0 && session) {
        const resultPromises = taskLaunches.map(ctx =>
          awaitExecResultAndClose(session, ctx.execMessageId),
        )
        const results = yield* waitForPromiseWithHeartbeat(Promise.all(resultPromises))
        for (let i = 0; i < taskLaunches.length; i++) {
          const frame = finalizeTaskResult(taskLaunches[i], results[i], roundContext, messages, session)
          const completedToolCall = extractCompletedToolCall(frame)
          if (activeTurn && completedToolCall) {
            const toolBlob = activeTurn.addCompletedToolCall(completedToolCall)
            yield cacheAndBuildKvBlob(++blobCounter, toolBlob)
          }
          yield frame
        }
      }

      // SwitchMode 成功后立即切换 mode,让下一轮 LLM 用新工具集
      // (例如 Agent→Plan 切换后 CreatePlan 工具才会出现在列表里)
      for (const tr of roundContext.pendingToolResults) {
        if (!tr.isError && tr.content.includes('toModeId')) {
          try {
            const parsed_result = JSON.parse(tr.content)
            const toMode = parsed_result?.toModeId as string | undefined
            if (toMode) {
              const newMode = `AGENT_MODE_${toMode.toUpperCase()}`
              logger.info({ from: parsed.mode, to: newMode }, '[AGENT] mode switched mid-session')
              parsed.mode = newMode
            }
          }
          catch {}
        }
      }

      if (roundContext.pendingToolResults.length > 0) {
        logger.info({
          round,
          stateStrategy: route.stateStrategy.name,
          toolResults: roundContext.pendingToolResults.map(block => ({
            toolUseId: block.toolUseId,
            isError: !!block.isError,
            contentLen: block.content.length,
          })),
        }, '[AGENT] tool results pending provider-state flush')
      }
      const transition = roundContext.transition(messages, assistantContent)
      flushedToolResults = transition.flushedToolResults;

      if (roundImageBlocks.length > 0) {
        messages.push({ role: 'user', content: roundImageBlocks })
        logger.info({ count: roundImageBlocks.length }, '[AGENT] injected image blocks from Read tool results')
      }

      ({ nextIndex: nextBlobbedMessageIndex, blobCounter } = yield* flushMessageBlobs(
        kvMessage,
        messages,
        nextBlobbedMessageIndex,
        blobCounter,
        blobIds,
      ))

      usedTokensEstimate = Math.max(usedTokensEstimate, estimateMessagesTokens(messages))

      const allBlobIdsForCheckpoint = [...parsed.historyBlobIds, ...blobIds]
      const materializedTurnBlob = activeTurn?.materializeTurnBlob()
      if (materializedTurnBlob)
        yield cacheAndBuildKvBlob(++blobCounter, materializedTurnBlob)
      yield emitRollingCheckpoint({
        conversationId: parsed.conversationId,
        round,
        nextBlobbedMessageIndex,
        allBlobIds: allBlobIdsForCheckpoint,
        turnBlobIds: materializedTurnBlob ? [...turnBlobIds, materializedTurnBlob.blobId] : turnBlobIds,
        summaryArchiveIds: currentSummaryArchiveIds,
        usedTokensEstimate,
        contextTokenLimit,
        mode: parsed.mode,
        lastAssistantContent,
        usageTotals,
        workspaceUris: workspaceUris(parsed),
        modelName: route.model,
        readPaths: [...readContext.readPaths],
        gitRepos: parsed.gitRepos?.map(r => ({ path: r.path, branchName: r.branchName })),
        breakdownCategories,
      })

      // 链路①: 服务端 Agent Run 内自动 summarize
      // 每轮都检查——超阈值就触发 compaction,可重复触发,连续失败 3 次才熔断
      // (对齐 Claude Code autoCompactIfNeeded 的 consecutiveFailures 熔断机制)
      if (autoCompactConsecutiveFailures < MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
        && shouldTriggerCompaction(usedTokensEstimate, contextTokenLimit)) {
        logger.info({
          conversationId: parsed.conversationId,
          round,
          usedTokensEstimate,
          contextTokenLimit,
          threshold: getAutoCompactThreshold(contextTokenLimit),
          consecutiveFailures: autoCompactConsecutiveFailures,
        }, '[AGENT] auto-summarize: threshold exceeded, triggering inline compaction')

        const compactionResult = yield* performInlineAutoSummarize({
          parsed,
          allBlobIds: allBlobIdsForCheckpoint,
          summaryArchiveIds: currentSummaryArchiveIds,
          usedTokensEstimate,
          contextTokenLimit,
          messages,
          route,
          readPaths: [...readContext.readPaths],
        })

        if (compactionResult) {
          // 用 compacted 后的状态替换当前状态，继续后续 round
          messages = compactionResult.newMessages
          parsed.historyBlobIds = compactionResult.newBlobIds
          currentSummaryArchiveIds = compactionResult.newSummaryArchiveIds
          usedTokensEstimate = compactionResult.newUsedTokens
          // 重置 blob 追踪：compaction 后 blobIds 都已合并到 parsed.historyBlobIds
          blobIds = []
          blobCounter = 0
          nextBlobbedMessageIndex = messages.length
          autoCompactConsecutiveFailures = 0 // 成功后重置

          logger.info({
            conversationId: parsed.conversationId,
            newMessageCount: messages.length,
            newUsedTokens: usedTokensEstimate,
          }, '[AGENT] auto-summarize: state replaced, continuing agent loop')
        } else {
          autoCompactConsecutiveFailures++
          logger.warn({
            conversationId: parsed.conversationId,
            consecutiveFailures: autoCompactConsecutiveFailures,
            maxFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
          }, '[AGENT] auto-summarize: compaction failed, incrementing failure counter')
        }
      }
    }
    catch (e) {
      if (isAgentRunAbortedError(e)) {
        logger.info({
          conversationId: parsed.conversationId,
          round,
          execMessageId: e.execMessageId,
          error: e.message,
        }, '[AGENT] tool call wait aborted by client; ending current run')
        return
      }

      // Tool call 抛错 (非用户 abort) —— 同样改为 throw ConnectError, 不再伪装
      // 成正常消息写入对话流。当前 round 的 roundAssistantBlocks 里可能含有
      // 半构造的 tool_use block, 我们让它和 error 一起丢弃, 保证客户端点 retry
      // 后从干净状态重发最后一条 human bubble。
      logger.error({ error: (e as Error).message, stack: (e as Error).stack }, '[AGENT] tool call processing error')
      clearDraftCheckpoint(parsed.conversationId).catch(() => {})
      throw makeToolError(e)
    }

    logger.info({ round: round + 1, messages: messages.length, flushedToolResults }, '[AGENT] continuing LLM with tool results')
  }

  ({ nextIndex: nextBlobbedMessageIndex, blobCounter } = yield* flushMessageBlobs(
    kvMessage,
    messages,
    nextBlobbedMessageIndex,
    blobCounter,
    blobIds,
  ))

  usedTokensEstimate = Math.max(usedTokensEstimate, estimateMessagesTokens(messages))

  const finalTurnBlob = activeTurn?.materializeTurnBlob()
  if (finalTurnBlob)
    yield cacheAndBuildKvBlob(++blobCounter, finalTurnBlob)

  yield emitFinalCheckpoint({
    conversationId: parsed.conversationId,
    allBlobIds: [...parsed.historyBlobIds, ...blobIds],
    turnBlobIds: finalTurnBlob ? [...turnBlobIds, finalTurnBlob.blobId] : turnBlobIds,
    summaryArchiveIds: currentSummaryArchiveIds,
    usedTokensEstimate,
    contextTokenLimit,
    mode: parsed.mode,
    lastAssistantContent,
    usageTotals,
    workspaceUris: workspaceUris(parsed),
    modelName: route.model,
    readPaths: [...readContext.readPaths],
    gitRepos: parsed.gitRepos?.map(r => ({ path: r.path, branchName: r.branchName })),
    breakdownCategories,
  })

  // SSE transport 在 response stream 结束后立即关闭底层 WritableIterable,
  // 而客户端 ControlledKvManager 异步处理 setBlobArgs (setBlob + write setBlobResult)
  // 可能还没完成, 导致 "WritableIterable already closed" 错误。
  // 尾部 heartbeat 延长 stream 存活时间, 让客户端处理完最后一批 blob ACK。
  yield heartbeat()
}
