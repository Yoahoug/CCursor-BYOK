import type { ToolResultEnvelope } from './shared'
import {
  arr,
  bigintLike,
  bool,
  envelope,
  obj,
  str,

} from './shared'

function normalizeConversationStep(value: unknown): Record<string, unknown> {
  const step = obj(value)
  const message = obj(step.message)
  if (typeof message.case === 'string')
    return { message }
  if (step.assistantMessage) {
    return { message: { case: 'assistantMessage', value: obj(step.assistantMessage) } }
  }
  if (step.toolCall) {
    return { message: { case: 'toolCall', value: obj(step.toolCall) } }
  }
  if (step.thinkingMessage) {
    return { message: { case: 'thinkingMessage', value: obj(step.thinkingMessage) } }
  }
  return { message: { case: 'assistantMessage', value: { text: '' } } }
}

function extractConversationStepText(value: unknown): string {
  const step = obj(value)

  // Normalized protobuf oneof shape used by our ToolResultEnvelope:
  //   { message: { case: 'assistantMessage', value: { text } } }
  const message = obj(step.message)
  if (message.case === 'assistantMessage')
    return str(obj(message.value).text)

  // protobuf JSON / Cursor client expanded shape:
  //   { assistantMessage: { text } }
  if (step.assistantMessage)
    return str(obj(step.assistantMessage).text)

  return ''
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (typeof value === 'bigint') {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : undefined
  }
  return undefined
}

function optionalSubagentBackgroundReason(value: unknown): number | undefined {
  const numeric = optionalNumber(value)
  if (numeric !== undefined)
    return numeric
  if (typeof value !== 'string')
    return undefined

  switch (value.trim()) {
    case 'SUBAGENT_BACKGROUND_REASON_UNSPECIFIED':
    case 'UNSPECIFIED':
      return 0
    case 'SUBAGENT_BACKGROUND_REASON_AGENT_REQUEST':
    case 'AGENT_REQUEST':
      return 1
    case 'SUBAGENT_BACKGROUND_REASON_USER_REQUEST':
    case 'USER_REQUEST':
      return 2
    case 'SUBAGENT_BACKGROUND_REASON_QUEUED_FOLLOW_UP':
    case 'QUEUED_FOLLOW_UP':
      return 3
    default:
      return undefined
  }
}

/** SubagentBackgroundReason 数值 → 可读名 (gen: agent.v1.SubagentBackgroundReason)。 */
function subagentBackgroundReasonName(reason: number): string {
  switch (reason) {
    case 1: return 'AGENT_REQUEST'
    case 2: return 'USER_REQUEST'
    case 3: return 'QUEUED_FOLLOW_UP'
    default: return 'UNSPECIFIED'
  }
}

export function buildTaskExecToolResult(execClientMsg: Record<string, unknown>): ToolResultEnvelope | null {
  const sr = obj(execClientMsg.subagentResult)
  const success = obj(sr.success)
  if (sr.success) {
    const finalMessage = str(success.finalMessage)
    const durationMs = bigintLike(success.durationMs)
    const backgroundReason = optionalSubagentBackgroundReason(success.backgroundReason)
    const toolCallCount = optionalNumber(success.toolCallCount)
    // SubagentSuccess (gen: agent.v1.SubagentSuccess) 无 isBackground 字段,
    // 只有 background_reason(4)。原 bool(success.isBackground) 恒 false 是死代码。
    // isBackground 应由 backgroundReason != 0 推导 —— 这才是"是否转后台"的原始语义。
    const isBackground = backgroundReason !== undefined && backgroundReason !== 0
    return {
      result: {
        case: 'success',
        value: {
          conversationSteps: finalMessage
            ? [{ message: { case: 'assistantMessage', value: { text: finalMessage } } }]
            : [],
          ...(typeof success.agentId === 'string' ? { agentId: success.agentId } : {}),
          isBackground,
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(typeof success.resultSuffix === 'string' ? { resultSuffix: success.resultSuffix } : {}),
          ...(backgroundReason !== undefined ? { backgroundReason } : {}),
          ...(typeof success.transcriptPath === 'string' ? { transcriptPath: success.transcriptPath } : {}),
          ...(toolCallCount !== undefined ? { toolCallCount } : {}),
        },
      },
    }
  }
  const error = obj(sr.error)
  if (sr.error) {
    return {
      result: {
        case: 'error',
        value: {
          error: str(error.error, 'subagent error'),
          ...(typeof error.agentId === 'string' ? { agentId: error.agentId } : {}),
        },
      },
    }
  }
  return { result: { case: 'error', value: { error: 'no result' } } }
}

export function normalizeTaskToolResult(resultCaseName: string, value: Record<string, unknown>): ToolResultEnvelope | null {
  if (resultCaseName === 'success') {
    const backgroundReason = optionalSubagentBackgroundReason(value.backgroundReason)
    const toolCallCount = optionalNumber(value.toolCallCount)
    // isBackground 同 buildTaskExecToolResult: 由 backgroundReason 推导,
    // 同时兼容已经显式带了 isBackground 的归一化输入(取或值)。
    const isBackground = bool(value.isBackground) || (backgroundReason !== undefined && backgroundReason !== 0)
    return envelope('success', {
      conversationSteps: arr(value.conversationSteps).map(normalizeConversationStep),
      ...(typeof value.agentId === 'string' ? { agentId: value.agentId } : {}),
      isBackground,
      ...(value.durationMs !== undefined ? { durationMs: value.durationMs } : {}),
      ...(typeof value.resultSuffix === 'string' ? { resultSuffix: value.resultSuffix } : {}),
      ...(backgroundReason !== undefined ? { backgroundReason } : {}),
      ...(typeof value.transcriptPath === 'string' ? { transcriptPath: value.transcriptPath } : {}),
      ...(toolCallCount !== undefined ? { toolCallCount } : {}),
    })
  }
  if (resultCaseName)
    return envelope(resultCaseName, value)
  return null
}

export function buildTaskToolResultText(resultCaseName: string, value: Record<string, unknown>): string | null {
  if (resultCaseName === 'success') {
    const texts = arr<Record<string, unknown>>(value.conversationSteps)
      .map(extractConversationStepText)
      .filter(Boolean)

    const parts = texts.length > 0 ? [...texts] : []
    const resultSuffix = str(value.resultSuffix).trim()
    const transcriptPath = str(value.transcriptPath).trim()
    if (resultSuffix)
      parts.push(resultSuffix)
    if (transcriptPath)
      parts.push(`[Subagent transcript: ${transcriptPath}]`)

    // backgroundReason != 0 → subagent 已转后台,而非真正完成。必须明确告诉 LLM 去轮询,
    // 否则会被误读成 "Subagent completed"。agentId 即 AwaitShell 的 task_id。
    const backgroundReason = optionalSubagentBackgroundReason(value.backgroundReason)
    if (backgroundReason !== undefined && backgroundReason !== 0) {
      const agentId = typeof value.agentId === 'string' ? value.agentId : ''
      parts.push(
        `[Task moved to background: ${subagentBackgroundReasonName(backgroundReason)}.${
          agentId ? ` Use AwaitShell with task_id="${agentId}" to poll for completion.` : ' Use AwaitShell with the agent id to poll for completion.'
        }]`,
      )
    }

    const body = parts.join('\n\n').trim()
    if (body)
      return body
    return `Subagent completed${typeof value.agentId === 'string' ? `: ${value.agentId}` : ''}`
  }
  if (resultCaseName)
    return `Task ${resultCaseName || 'error'}: ${JSON.stringify(value)}`
  return null
}
