import type Anthropic from '@anthropic-ai/sdk'

function equalIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function assertValidAnthropicToolUseContract(messages: Anthropic.MessageParam[]): void {
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.role !== 'assistant' || typeof message.content === 'string')
      continue

    const firstToolUseIndex = message.content.findIndex(block => block.type === 'tool_use')
    if (firstToolUseIndex < 0)
      continue

    const trailingBlocks = message.content.slice(firstToolUseIndex)
    const nonToolUseBlock = trailingBlocks.find(block => block.type !== 'tool_use')
    if (nonToolUseBlock) {
      throw new Error(
        `[ANTHROPIC CONTRACT] assistant message ${index} contains ${nonToolUseBlock.type} after tool_use`,
      )
    }

    const expectedToolUseIds = trailingBlocks
      .filter((block): block is Anthropic.ToolUseBlockParam => block.type === 'tool_use')
      .map(block => block.id)

    const nextMessage = messages[index + 1]
    if (!nextMessage) {
      throw new Error(
        `[ANTHROPIC CONTRACT] assistant message ${index} with tool_use is missing the following user tool_result message`,
      )
    }

    if (nextMessage.role !== 'user') {
      throw new Error(
        `[ANTHROPIC CONTRACT] assistant message ${index} with tool_use must be followed by a user message, got ${nextMessage.role}`,
      )
    }

    if (typeof nextMessage.content === 'string') {
      throw new TypeError(
        `[ANTHROPIC CONTRACT] user message ${index + 1} after tool_use must use structured content blocks`,
      )
    }

    const leadingToolResultIds: string[] = []
    let seenNonToolResult = false
    for (const block of nextMessage.content) {
      if (block.type === 'tool_result') {
        if (seenNonToolResult) {
          throw new Error(
            `[ANTHROPIC CONTRACT] user message ${index + 1} contains tool_result after non-tool_result content`,
          )
        }
        leadingToolResultIds.push(block.tool_use_id)
        continue
      }
      seenNonToolResult = true
    }

    if (!equalIds(leadingToolResultIds, expectedToolUseIds)) {
      throw new Error(
        `[ANTHROPIC CONTRACT] tool_result order mismatch after assistant message ${index}: expected [${expectedToolUseIds.join(', ')}], got [${leadingToolResultIds.join(', ')}]`,
      )
    }
  }
}
