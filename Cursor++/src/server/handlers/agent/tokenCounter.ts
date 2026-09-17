/**
 * Token 计数工具 — 基于 gpt-tokenizer (o200k_base)
 *
 * 用于 Context Window breakdown 估算。跨 provider 误差 ~10-15%，
 * 足以驱动 UI 进度条显示。不用于计费。
 */
import { encode } from 'gpt-tokenizer/encoding/o200k_base'

/**
 * 计数缓存 —— 有界 LRU。
 *
 * 为什么要缓存：buildContextBreakdown 对 **system prompt**、**每个工具 schema**、
 * preamble 的每一段分别调 countTokens，而这些内容在同一会话的每一轮之间
 * **逐字节相同**（同一份 system prompt、同一套工具表）。实测一份 44KB 的
 * system prompt 单次 encode 约 0.9ms，整个 breakdown 约 13.8ms —— 全部落在
 * 扩展宿主进程的同步路径上，直接表现为编辑器卡顿。
 *
 * 为什么必须有界：文本来自对话历史，长度与内容都不可控；无上限的 Map 会随着
 * 会话推进吃掉内存。上限取 500 条足以覆盖"一轮里被重复计数的那些段"
 * （system + tools + rules + skills + mcp + subagents 各一条，加上若干工具结果），
 * 超出后按插入顺序淘汰最早的一条。
 */
const COUNT_CACHE_LIMIT = 500
const countCache = new Map<string, number>()

export function countTokens(text: string): number {
  if (!text)
    return 0
  const cached = countCache.get(text)
  if (cached !== undefined) {
    // 重新插入使其变成"最近使用"，实现 LRU 而非 FIFO
    countCache.delete(text)
    countCache.set(text, cached)
    return cached
  }
  const count = encode(text, { allowedSpecial: 'all' }).length
  countCache.set(text, count)
  if (countCache.size > COUNT_CACHE_LIMIT) {
    const oldest = countCache.keys().next()
    if (!oldest.done)
      countCache.delete(oldest.value)
  }
  return count
}

/** 仅供测试：清空计数缓存 */
export function resetTokenCountCacheForTests(): void {
  countCache.clear()
}

export function getTokenCountCacheSizeForTests(): number {
  return countCache.size
}

export type ContextCategory
  = | 'system_prompt'
    | 'tools'
    | 'rules'
    | 'skills'
    | 'mcp'
    | 'subagents'
    | 'conversation'
    | 'summarized_conversation'

const CATEGORY_LABELS: Record<ContextCategory, string> = {
  system_prompt: 'System prompt',
  tools: 'Tool definitions',
  rules: 'Rules',
  skills: 'Skills',
  mcp: 'MCP & dynamic tools',
  subagents: 'Subagent definitions',
  conversation: 'Conversation',
  summarized_conversation: 'Summarized conversation',
}

export class ContextTokenTracker {
  private counts = new Map<ContextCategory, number>()

  add(category: ContextCategory, tokens: number): void {
    this.counts.set(category, (this.counts.get(category) ?? 0) + tokens)
  }

  addText(category: ContextCategory, text: string): void {
    if (text)
      this.add(category, countTokens(text))
  }

  get(category: ContextCategory): number {
    return this.counts.get(category) ?? 0
  }

  get total(): number {
    let sum = 0
    for (const v of this.counts.values()) sum += v
    return sum
  }

  toBreakdownCategories(): Array<{ id: string, label: string, estimatedTokens: number }> {
    const out: Array<{ id: string, label: string, estimatedTokens: number }> = []
    for (const [id, tokens] of this.counts) {
      if (tokens > 0)
        out.push({ id, label: CATEGORY_LABELS[id] ?? id, estimatedTokens: tokens })
    }
    return out
  }
}
