import type { AgentServerMessage } from '../../gen/agent_v1_pb'
import type { AgentSession } from './session'
import { randomUUID } from 'node:crypto'
import { execMessage } from './stream'
import { waitForExecClientMessageWithHeartbeat } from './wait'

export async function* executePreCompactHook(params: {
  session: AgentSession | null
  conversationId: string
  generationId: string
  modelId: string
  contextUsagePercent: number
  contextTokens: number
  contextWindowSize: number
  messageCount: number
  messagesToCompact: number
  isFirstCompaction: boolean
  execMessageId: number
}): AsyncGenerator<AgentServerMessage, string | undefined, void> {
  if (!params.session)
    return undefined

  const execId = `hook-precompact-${randomUUID()}`
  yield execMessage(params.execMessageId, execId, 'executeHookArgs', {
    request: {
      preCompact: {
        trigger: 'manual',
        contextUsagePercent: params.contextUsagePercent,
        contextTokens: String(params.contextTokens),
        contextWindowSize: String(params.contextWindowSize),
        messageCount: params.messageCount,
        messagesToCompact: params.messagesToCompact,
        isFirstCompaction: params.isFirstCompaction,
        conversationId: params.conversationId,
        generationId: params.generationId,
        model: params.modelId,
      },
    },
  })

  const response = yield* waitForExecClientMessageWithHeartbeat(params.session, params.execMessageId, 15_000)
  const execClientMessage = response?.execClientMessage as Record<string, unknown> | undefined
  const executeHookResult = execClientMessage?.executeHookResult as Record<string, unknown> | undefined
  const hookResponse = executeHookResult?.response as Record<string, unknown> | undefined
  const preCompact = hookResponse?.preCompact as Record<string, unknown> | undefined
  return typeof preCompact?.userMessage === 'string' ? preCompact.userMessage : undefined
}
