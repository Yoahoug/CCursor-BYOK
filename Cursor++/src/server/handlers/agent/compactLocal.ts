/**
 * Local Compact — 用模型自身生成摘要
 *
 * 两种策略:
 *
 * 1. OpenAI 风格 (对标 Codex compact.rs):
 *    - 用模型生成摘要文本
 *    - 压缩后只保留 user messages + summary
 *    - 丢弃所有 tool call/result 条目
 *    - user messages 按 token 限额从最近向前截取 (≤20K tokens)
 *
 * 2. Anthropic 风格 (对标 Claude Code, 未来实施):
 *    - 用模型生成摘要文本
 *    - 保留 keepTail 中完整的 tool 交互 turn
 *    - 切分边界保证 tool 配对完整性
 */
import type { LLMMessage } from '../llm/types'
import type { HistoryEntry } from './historyManager'
import { logger } from '../../logger'
import { estimateTextTokens, formatMessageForSummary } from './compactionStrategy'
import { isPreambleUserMessage } from './historyManager'

// 对标 Codex COMPACT_USER_MESSAGE_MAX_TOKENS
const USER_MESSAGE_MAX_TOKENS = 20_000

export interface LocalCompactPlan {
  /** 保持不变的 leading 消息 (system + preamble) */
  leading: LLMMessage[]
  /** 需要被摘要替换的消息文本 */
  summarizeText: string
  /** 压缩后保留的 user messages (从最近向前截取) */
  retainedUserMessages: string[]
}

/**
 * OpenAI 风格 local compact plan (对标 Codex):
 * 提取全部历史为摘要源文本，收集 user messages 作为保留项。
 * 不保留任何 tool call/result — 全部融入摘要语义。
 */
export function planLocalCompactOpenAI(entries: HistoryEntry[]): LocalCompactPlan {
  const leading: LLMMessage[] = []
  let index = 0

  if (entries[index]?.message.role === 'system') {
    leading.push(entries[index].message)
    index++
  }
  if (entries[index] && isPreambleUserMessage(entries[index].message)) {
    leading.push(entries[index].message)
    index++
  }

  const body = entries.slice(index)

  // 摘要源: 全部 body 格式化为文本
  const summarizeText = body
    .map(e => formatMessageForSummary(e.message))
    .filter(t => t.length > 0)
    .join('\n\n')

  // 保留的 user messages: 从最近向前截取，限 USER_MESSAGE_MAX_TOKENS
  const userTexts: string[] = []
  let remaining = USER_MESSAGE_MAX_TOKENS
  for (let i = body.length - 1; i >= 0 && remaining > 0; i--) {
    const msg = body[i].message
    if (msg.role !== 'user')
      continue
    const text = typeof msg.content === 'string'
      ? msg.content
      : msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n')
    if (!text.trim())
      continue
    const tokens = estimateTextTokens(text)
    if (tokens <= remaining) {
      userTexts.unshift(text)
      remaining -= tokens
    }
    else {
      // 截断最老的那条以适应预算
      const ratio = remaining / tokens
      userTexts.unshift(text.slice(0, Math.floor(text.length * ratio)))
      break
    }
  }

  return { leading, summarizeText, retainedUserMessages: userTexts }
}

/**
 * 从 OpenAI local compact plan + summary text 构建压缩后的 LLMMessage[]。
 * 对标 Codex build_compacted_history:
 *   [...retained user messages, summary as user message]
 */
export function buildCompactedMessagesOpenAI(
  plan: LocalCompactPlan,
  summaryText: string,
): LLMMessage[] {
  const messages: LLMMessage[] = [...plan.leading]

  for (const text of plan.retainedUserMessages) {
    messages.push({ role: 'user', content: text })
  }

  // 摘要作为 assistant message 注入 (与现有 compactionStrategy 一致)
  const summary = summaryText.trim() || '(no summary available)'
  messages.push({
    role: 'assistant',
    content: `Previous conversation summary:\n${summary}`,
  })

  logger.info({
    leadingCount: plan.leading.length,
    retainedUserCount: plan.retainedUserMessages.length,
    summaryLen: summary.length,
  }, '[COMPACT] OpenAI local compact built')

  return messages
}

/**
 * Anthropic 风格 local compact plan (对标 Claude Code).
 * TODO: 从 ClaudeCodeRev/rebuild 源码实施。
 * 暂时复用现有 planCompaction + tool 配对安全切分。
 */
export function planLocalCompactAnthropic(_entries: HistoryEntry[]): LocalCompactPlan {
  // Placeholder — 后续从 Claude Code 源码对标实施
  throw new Error('Anthropic local compact not yet implemented')
}
