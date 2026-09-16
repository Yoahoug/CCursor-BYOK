import type { ToolCall, UserMessage } from '../../gen/agent_v1_pb'
import type { ParsedRunRequest } from './protocol/types'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import {
  AgentMode,
  AssistantMessageSchema,
  ConversationStepSchema,
  ConversationTurnStructureSchema,
  SimulatedMsgReason,
  ThinkingMessageSchema,
  UserMessageSchema,
} from '../../gen/agent_v1_pb'
import { logger } from '../../logger'
import { encodeBinaryBlob } from './blob'
import { getCachedBlob } from './blobStore'

function resolveAgentMode(mode: string): AgentMode {
  const normalized = mode.replace('AGENT_MODE_', '').toLowerCase()
  switch (normalized) {
    case 'agent': return AgentMode.AGENT
    case 'ask': return AgentMode.ASK
    case 'plan': return AgentMode.PLAN
    case 'debug': return AgentMode.DEBUG
    case 'triage': return AgentMode.TRIAGE
    default: return AgentMode.AGENT
  }
}

export interface EncodedBlob {
  blobId: string
  blobData: string
}

export interface TurnBaseline {
  userMessageBlobId: string
  stepBlobIds: string[]
  requestId?: string
  dynamicToolCount?: number
}

export class ActiveTurnTracker {
  private readonly stepBlobIds: string[]

  constructor(
    readonly userMessageBlobId: string,
    stepBlobIds: string[] = [],
    readonly requestId?: string,
    private dynamicToolCount?: number,
  ) {
    this.stepBlobIds = [...stepBlobIds]
  }

  static fromTurnBlobId(turnBlobId: string): ActiveTurnTracker | null {
    const baseline = readTurnBaseline(turnBlobId)
    if (!baseline)
      return null
    return new ActiveTurnTracker(
      baseline.userMessageBlobId,
      baseline.stepBlobIds,
      baseline.requestId,
      baseline.dynamicToolCount,
    )
  }

  setDynamicToolCount(count: number): void {
    this.dynamicToolCount = count
  }

  addThinking(text: string, durationMs = 0): EncodedBlob | null {
    if (!text)
      return null
    const blob = encodeBinaryBlob(toBinary(ConversationStepSchema, create(ConversationStepSchema, {
      message: {
        case: 'thinkingMessage',
        value: create(ThinkingMessageSchema, {
          text,
          durationMs,
        }),
      },
    })))
    this.stepBlobIds.push(blob.blobId)
    return blob
  }

  addAssistantText(text: string): EncodedBlob | null {
    if (!text)
      return null
    const blob = encodeBinaryBlob(toBinary(ConversationStepSchema, create(ConversationStepSchema, {
      message: {
        case: 'assistantMessage',
        value: create(AssistantMessageSchema, {
          text,
        }),
      },
    })))
    this.stepBlobIds.push(blob.blobId)
    return blob
  }

  addCompletedToolCall(toolCall: ToolCall): EncodedBlob {
    const blob = encodeBinaryBlob(toBinary(ConversationStepSchema, create(ConversationStepSchema, {
      message: {
        case: 'toolCall',
        value: toolCall,
      },
    })))
    this.stepBlobIds.push(blob.blobId)
    return blob
  }

  materializeTurnBlob(): EncodedBlob {
    // userMessage / steps 是指向其它 blob 的引用 (blobId)。这些引用的字节必须与
    // setBlobArgs.blobId (= UTF-8 of blobId 文本) 完全一致，fork (deepCloneComposer)
    // 时 Client 才能用该引用从本地 KV store getBlob 命中。
    // (历史 bug: 曾用 Buffer.from(id,'base64') 得到 32 字节 sha256 raw, 与 44 字节的
    //  store key 不匹配, fork 时抛 "[composer] Missing user message blob")
    const encoder = new TextEncoder()
    return encodeBinaryBlob(toBinary(ConversationTurnStructureSchema, create(ConversationTurnStructureSchema, {
      turn: {
        case: 'agentConversationTurn',
        value: {
          userMessage: encoder.encode(this.userMessageBlobId),
          steps: this.stepBlobIds.map(id => encoder.encode(id)),
          ...(this.requestId ? { requestId: this.requestId } : {}),
          ...(this.dynamicToolCount !== undefined ? { dynamicToolCount: this.dynamicToolCount } : {}),
        },
      },
    })))
  }
}

export function createCurrentTurnUserMessageBlob(params: {
  parsed: ParsedRunRequest
  fallbackMessageId: string
}): { blob: EncodedBlob, messageId: string } {
  const raw = params.parsed.rawUserMessage
  const messageId = typeof raw?.messageId === 'string' && raw.messageId.length > 0
    ? raw.messageId
    : params.fallbackMessageId

  const init: Partial<UserMessage> & Record<string, unknown> = {
    text: params.parsed.userText,
    messageId,
    mode: resolveAgentMode(params.parsed.mode),
  }

  if (typeof raw?.richText === 'string' && raw.richText.length > 0)
    init.richText = raw.richText

  if (params.parsed.isBackgroundTaskCompletion) {
    init.isSimulatedMsg = true
    init.simulatedMsgReason = SimulatedMsgReason.BACKGROUND_TASK_COMPLETION
  }

  const blob = encodeBinaryBlob(toBinary(UserMessageSchema, create(UserMessageSchema, init as any)))
  return { blob, messageId }
}

export function readTurnBaseline(turnBlobId: string): TurnBaseline | null {
  const blobData = getCachedBlob(turnBlobId)
  if (!blobData)
    return null
  try {
    const turn = fromBinary(ConversationTurnStructureSchema, Buffer.from(blobData, 'base64'))
    if (turn.turn.case !== 'agentConversationTurn')
      return null
    const value = turn.turn.value
    // 与 materializeTurnBlob 对称: 引用以 UTF-8 of blobId 文本写入，这里同样按 UTF-8 还原
    return {
      userMessageBlobId: Buffer.from(value.userMessage).toString('utf-8'),
      stepBlobIds: value.steps.map(step => Buffer.from(step).toString('utf-8')),
      requestId: value.requestId,
      dynamicToolCount: value.dynamicToolCount,
    }
  }
  catch (error) {
    logger.warn({ turnBlobId, error: (error as Error).message }, '[TURN] failed to decode turn baseline')
    return null
  }
}
