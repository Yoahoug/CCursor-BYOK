import type { AgentServerMessage } from '../../gen/agent_v1_pb'
import type { ProviderRoundContext } from '../llm/providerRuntime'
import type { LLMMessage } from '../llm/types'
import type { AgentSession } from './session'
import type { ToolResultEnvelope } from './toolResults'
import { interactionQuery } from './stream'
import { finalizeToolCall } from './toolLifecycle'
import { waitForInteractionResponseWithHeartbeat } from './wait'

export async function* finalizeInteractionTool(params: {
  session: AgentSession | null
  interactionId?: number
  queryCase?: string
  queryValue?: Record<string, unknown>
  expectedResponseCase?: string
  buildRawToolResult: (interactionResponse: Record<string, unknown> | null) => ToolResultEnvelope
  roundContext: Pick<ProviderRoundContext, 'createToolResult' | 'recordToolResult'>
  messages: LLMMessage[]
  cursorToolType: string
  toolName: string
  callId: string
  startedArgs: Record<string, unknown>
  input: Record<string, unknown>
  modelCallId: string
}): AsyncGenerator<AgentServerMessage, AgentServerMessage, void> {
  let interactionResponse: Record<string, unknown> | null = null

  if (
    params.session
    && typeof params.interactionId === 'number'
    && typeof params.queryCase === 'string'
    && params.queryValue
    && typeof params.expectedResponseCase === 'string'
  ) {
    yield interactionQuery(params.interactionId, params.queryCase, params.queryValue)
    const response = yield* waitForInteractionResponseWithHeartbeat(
      params.session,
      params.interactionId,
      params.expectedResponseCase,
      null,
    )
    interactionResponse = response
      ? (response.interactionResponse as Record<string, unknown>)
      : null
  }

  const finalized = finalizeToolCall({
    roundContext: params.roundContext,
    messages: params.messages,
    cursorToolType: params.cursorToolType,
    toolName: params.toolName,
    callId: params.callId,
    startedArgs: params.startedArgs,
    rawToolResult: params.buildRawToolResult(interactionResponse),
    input: params.input,
    modelCallId: params.modelCallId,
  })

  yield finalized.frame
  return finalized.frame
}
