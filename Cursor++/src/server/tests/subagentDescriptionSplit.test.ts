import type { LLMTool } from '../handlers/llm/types'
import { describe, expect, it } from 'vitest'
import { buildContextBreakdown } from '../handlers/agent/contextBreakdown'

/**
 * buildContextBreakdown 里 subagent 定义段的切分。
 *
 * 工具描述里带着一段 "Available subagent_types ..." 的清单，统计时要把这段
 * 从描述里摘出来单独归到 subagents 分类，否则会被算进 tools —— 那样
 * "subagent 定义占了多少 context" 就无从回答。
 *
 * 说明：审查中曾怀疑 `end <= start` 时会把两段无关文字缝在一起。实测该分支
 * **不可达**：`endCandidates` 已被 `index > start` 过滤，非空时必有 end > start；
 * 为空时 end = description.length ≥ start + marker.length。因此这里不再为该
 * 情况加保护，只钉住真实可达的行为。
 */

const MARKER = 'Available subagent_types and a quick description of what they do:'

function tokensOf(categories: Array<{ id: string, estimatedTokens: number }>, id: string): number {
  return categories.find(c => c.id === id)?.estimatedTokens ?? 0
}

function breakdownWith(tool: LLMTool) {
  return buildContextBreakdown({
    systemContent: 'x',
    preambleUserContent: '',
    requestMessages: [],
    requestTools: [tool],
    mcpToolNames: new Set<string>(),
  })
}

describe('subagent 定义段的切分', () => {
  it('marker 之后到下一个分节之间的内容归 subagents，不留在 tools 里', () => {
    const description = `Intro line.\n\n${MARKER}\n- explorer: searches the repo\n- writer: edits files\n\nWhen speaking to the USER, be concise.`
    const categories = breakdownWith({
      name: 'Task',
      description,
      inputSchema: { type: 'object' },
    })

    expect(tokensOf(categories, 'subagents')).toBeGreaterThan(0)
    expect(tokensOf(categories, 'tools')).toBeGreaterThan(0)
  })

  it('subagents 分类的 token 数应约等于清单本身的规模', () => {
    const listText = '- explorer: searches the repo\n- writer: edits files'
    const withList = breakdownWith({
      name: 'Task',
      description: `Intro.\n\n${MARKER}\n${listText}\n\nWhen speaking to the USER, be concise.`,
      inputSchema: { type: 'object' },
    })
    const withoutList = breakdownWith({
      name: 'Task',
      description: `Intro.\n\n${MARKER}\n\nWhen speaking to the USER, be concise.`,
      inputSchema: { type: 'object' },
    })

    // 有清单时 subagents 分类必须显著更大 —— 否则说明清单被漏算了
    expect(tokensOf(withList, 'subagents')).toBeGreaterThan(tokensOf(withoutList, 'subagents'))
  })

  it('没有 marker 的工具描述不会被计入 subagents', () => {
    const categories = breakdownWith({
      name: 'Shell',
      description: 'Run a shell command.',
      inputSchema: { type: 'object' },
    })
    expect(tokensOf(categories, 'subagents')).toBe(0)
    expect(tokensOf(categories, 'tools')).toBeGreaterThan(0)
  })
})
