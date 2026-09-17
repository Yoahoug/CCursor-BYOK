import type { StoredBlock, StoredMessage } from './storedTranscript'

export type SemanticTurn
  = | { kind: 'system', text: string }
    | { kind: 'user', blocks: Array<{ type: 'text', text: string }> }
    | {
      kind: 'assistant'
      textBlocks: string[]
      reasoningBlocks: Array<{ text: string, signature?: string, providerOptions?: Record<string, unknown> }>
      toolCalls: Array<{ callId: string, toolName: string, args: Record<string, unknown> }>
    }
    | {
      kind: 'tool_results'
      results: Array<{ callId: string, toolName?: string, content: string, isError: boolean, structured?: unknown }>
    }

export function normalizeStoredTranscript(messages: StoredMessage[]): SemanticTurn[] {
  const turns: SemanticTurn[] = []

  for (const message of messages) {
    switch (message.role) {
      case 'system':
        turns.push({
          kind: 'system',
          text: typeof message.content === 'string' ? message.content : extractText(message.content),
        })
        break
      case 'user':
        turns.push({
          kind: 'user',
          blocks: typeof message.content === 'string'
            ? [{ type: 'text', text: message.content }]
            : extractUserBlocks(message.content),
        })
        break
      case 'assistant':
        turns.push(normalizeAssistantMessage(message))
        break
      case 'tool':
        turns.push(normalizeToolMessage(message))
        break
    }
  }

  return turns
}

function normalizeAssistantMessage(message: StoredMessage): Extract<SemanticTurn, { kind: 'assistant' }> {
  if (typeof message.content === 'string') {
    return {
      kind: 'assistant',
      textBlocks: message.content ? [message.content] : [],
      reasoningBlocks: [],
      toolCalls: [],
    }
  }

  const textBlocks: string[] = []
  const reasoningBlocks: Array<{ text: string, signature?: string, providerOptions?: Record<string, unknown> }> = []
  const toolCalls: Array<{ callId: string, toolName: string, args: Record<string, unknown> }> = []

  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        if (block.text)
          textBlocks.push(block.text)
        break
      case 'reasoning':
        reasoningBlocks.push({
          text: block.text,
          ...(block.signature ? { signature: block.signature } : {}),
          ...(block.providerOptions ? { providerOptions: block.providerOptions } : {}),
        })
        break
      case 'tool-call':
        toolCalls.push({
          callId: block.toolCallId,
          toolName: block.toolName,
          args: block.args,
        })
        break
      default:
        break
    }
  }

  return { kind: 'assistant', textBlocks, reasoningBlocks, toolCalls }
}

function normalizeToolMessage(message: StoredMessage): Extract<SemanticTurn, { kind: 'tool_results' }> {
  const blocks = typeof message.content === 'string'
    ? [{ type: 'tool-result', toolCallId: message.toolCallId ?? '', toolName: message.toolName, result: message.content, ...(message.isError ? { isError: true } : {}) } satisfies StoredBlock]
    : message.content.filter((block): block is Extract<StoredBlock, { type: 'tool-result' }> => block.type === 'tool-result')

  return {
    kind: 'tool_results',
    results: blocks.map(block => ({
      callId: block.toolCallId,
      toolName: block.toolName,
      content: block.result,
      isError: !!block.isError,
      ...(block.structured !== undefined ? { structured: block.structured } : {}),
    })),
  }
}

function extractText(blocks: StoredBlock[]): string {
  return blocks
    .filter((block): block is Extract<StoredBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function extractUserBlocks(blocks: StoredBlock[]): Array<{ type: 'text', text: string }> {
  return blocks
    .filter((block): block is Extract<StoredBlock, { type: 'text' }> => block.type === 'text')
    .map(block => ({ type: 'text', text: block.text }))
}
