/**
 * AUDIT BENCH v7 — measures the effect of the tokenizer cache.
 *
 * Simulates the real access pattern: the same system prompt and tool schemas are
 * re-counted on every round of the conversation, while the history grows.
 */
import { describe, it } from 'vitest'
import { buildContextBreakdown } from './src/server/handlers/agent/contextBreakdown'
import { countTokens, resetTokenCountCacheForTests } from './src/server/handlers/agent/tokenCounter'
import { listBuiltinLlmTools } from './src/server/handlers/agent/toolkit/registry'
import type { LLMMessage } from './src/server/handlers/llm/types'

const SYSTEM_PROMPT = 'You are a coding agent. '.repeat(2000)
const PREAMBLE = '<rules>\nrule body\n</rules>\n<agent_skills>\nskill body\n</agent_skills>\n'.repeat(300)
const TOOLS = listBuiltinLlmTools('anthropic')

function makeHistory(rounds: number): LLMMessage[] {
  return Array.from({ length: rounds }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i} `.repeat(300),
  })) as LLMMessage[]
}

function timeIt(label: string, iterations: number, fn: () => void) {
  fn()
  const started = performance.now()
  for (let i = 0; i < iterations; i++)
    fn()
  const elapsed = performance.now() - started
  // eslint-disable-next-line no-console
  console.log(`[bench] ${label}: ${(elapsed / iterations).toFixed(3)} ms/call`)
}

function breakdown(history: LLMMessage[]) {
  return buildContextBreakdown({
    systemContent: SYSTEM_PROMPT,
    preambleUserContent: PREAMBLE,
    requestMessages: history,
    requestTools: TOOLS,
    mcpToolNames: new Set(['mcp-tool-a']),
  })
}

describe('audit bench v7 — tokenizer cache', () => {
  it('countTokens on the same text', () => {
    resetTokenCountCacheForTests()
    const text = SYSTEM_PROMPT.repeat(8)
    timeIt('countTokens(200KB) cold cache', 1, () => {
      resetTokenCountCacheForTests()
      countTokens(text)
    })
    timeIt('countTokens(200KB) warm cache', 2000, () => {
      countTokens(text)
    })
  })

  it('buildContextBreakdown — cold vs steady state', () => {
    // Cold: first round of a conversation, nothing cached yet.
    resetTokenCountCacheForTests()
    timeIt('buildContextBreakdown cold (first round)', 5, () => {
      resetTokenCountCacheForTests()
      breakdown(makeHistory(120))
    })

    // Steady state: the system prompt / preamble / tool schemas are unchanged,
    // only the tail of the history is new. This is exactly what round N looks like.
    resetTokenCountCacheForTests()
    const history = makeHistory(120)
    breakdown(history)
    timeIt('buildContextBreakdown steady (unchanged prefix cached)', 50, () => {
      breakdown(history)
    })
  })

  it('cache stays bounded', async () => {
    resetTokenCountCacheForTests()
    const { getTokenCountCacheSizeForTests } = await import('./src/server/handlers/agent/tokenCounter')
    for (let i = 0; i < 5000; i++)
      countTokens(`unique text number ${i}`)
    const size = getTokenCountCacheSizeForTests()
    // eslint-disable-next-line no-console
    console.log(`[bench] cache size after 5000 distinct inputs: ${size}`)
  })
})
