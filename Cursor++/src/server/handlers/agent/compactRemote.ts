import type { CompactedResponse, ResponseCompactParams, ResponseOutputItem } from 'openai/resources/responses/responses'
import type { ProviderEntry } from '../../data/defaults'
import type { LLMMessage } from '../llm/types'
/**
 * Remote Compact — OpenAI Responses API /responses/compact
 *
 * 对标 Codex (codex-rs/core/src/compact_remote.rs):
 *   1. 调用 /responses/compact 端点，服务端生成语义摘要
 *   2. 从返回结果中过滤掉所有 tool 相关条目 (对标 should_keep_compacted_history_item)
 *   3. 只保留 user message / assistant message / compaction item
 *
 * 失败时返回 null，由调用方 fallback 到本地摘要。
 */
import OpenAI from 'openai'
import { logger } from '../../logger'
import { encodeResponsesInput } from '../llm/conversationCodec'
import { createProxiedFetch } from '../llm/proxyFetch'

export interface RemoteCompactResult {
  summaryText: string
  compactedMessages: LLMMessage[]
}

export async function tryRemoteCompact(params: {
  provider: ProviderEntry
  model: string
  messages: LLMMessage[]
}): Promise<RemoteCompactResult | null> {
  try {
    const opts: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: params.provider.auth.value,
    }
    if (params.provider.baseUrl) {
      opts.baseURL = params.provider.baseUrl
    }
    const proxiedFetch = createProxiedFetch(params.provider.proxyUrl)
    if (proxiedFetch) {
      opts.fetch = proxiedFetch
    }
    const client = new OpenAI(opts)
    const encoded = encodeResponsesInput(params.messages)

    const compactParams: ResponseCompactParams = {
      model: params.model,
      input: encoded.items,
    }
    if (encoded.instructions) {
      compactParams.instructions = encoded.instructions
    }

    logger.info({ model: params.model, inputItems: encoded.items.length }, '[COMPACT] calling /responses/compact')
    const response: CompactedResponse = await client.responses.compact(compactParams)

    const filtered = response.output.filter(shouldKeepCompactedItem)
    const compactedMessages = outputItemsToLLMMessages(filtered)
    const summaryText = extractSummaryText(response.output, compactedMessages)

    logger.info({
      outputItems: response.output.length,
      filteredItems: filtered.length,
      summaryLen: summaryText.length,
      usage: response.usage,
    }, '[COMPACT] /responses/compact succeeded')

    return { summaryText, compactedMessages }
  }
  catch (err) {
    logger.warn({ error: (err as Error).message }, '[COMPACT] /responses/compact failed, will fallback to local')
    return null
  }
}

/**
 * 对标 Codex should_keep_compacted_history_item (compact_remote.rs:205-230)
 */
function shouldKeepCompactedItem(item: ResponseOutputItem): boolean {
  // assistant message → 保留
  if (item.type === 'message')
    return true
  // compaction summary → 保留
  if (item.type === 'compaction')
    return true
  // 其他 (function_call, function_call_output, reasoning, tool_search 等) → 丢弃
  return false
}

function outputItemsToLLMMessages(items: ResponseOutputItem[]): LLMMessage[] {
  const messages: LLMMessage[] = []
  for (const item of items) {
    if (item.type === 'message') {
      const text = item.content
        .filter(c => c.type === 'output_text')
        .map(c => c.type === 'output_text' ? c.text : '')
        .join('')
      if (text) {
        messages.push({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: text,
        })
      }
    }
  }
  return messages
}

function extractSummaryText(output: ResponseOutputItem[], compactedMessages: LLMMessage[]): string {
  for (const item of output) {
    if (item.type === 'compaction' && item.encrypted_content) {
      return `[compacted: ${item.encrypted_content.slice(0, 100)}...]`
    }
  }
  const assistants = compactedMessages.filter(m => m.role === 'assistant')
  const last = assistants.length > 0 ? assistants[assistants.length - 1] : undefined
  return typeof last?.content === 'string' ? last.content : ''
}
