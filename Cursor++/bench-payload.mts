/**
 * Capture / compare the exact bytes of everything the LLM sees from the tool
 * registry: names, descriptions and serialized input schemas.
 *
 * eslint --fix touches 137 files in the handler tree, including the tool
 * definitions that carry the model-facing prompts. Formatting-only changes
 * must not alter a single character of those payloads, so this harness hashes
 * them; re-running after the fix proves equivalence.
 *
 * Run through vitest so that extensionless TS imports resolve:
 *   pnpm exec vitest run --config vitest.bench.config.mts
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { listBuiltinLlmTools } from './src/server/handlers/agent/toolkit/registry'

const BASELINE_PATH = 'tool-payload-baseline.json'
const PROVIDERS = ['anthropic', 'openai-chat', 'openai-responses', 'gemini'] as const

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function buildSummary() {
  const summary: Record<string, Array<{
    name: string
    descriptionHash: string
    descriptionLength: number
    schemaHash: string
    schemaLength: number
  }>> = {}
  for (const provider of PROVIDERS) {
    const tools = listBuiltinLlmTools(provider)
    summary[provider] = tools
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: JSON.stringify(tool.inputSchema),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(tool => ({
        name: tool.name,
        descriptionHash: hash(tool.description),
        descriptionLength: tool.description.length,
        schemaHash: hash(tool.inputSchema),
        schemaLength: tool.inputSchema.length,
      }))

    const totalChars = tools.reduce(
      (sum, tool) => sum + tool.description.length + JSON.stringify(tool.inputSchema).length,
      0,
    )
    // eslint-disable-next-line no-console
    console.log(`[payload] ${provider}: ${tools.length} tools, ${totalChars} payload chars`)
  }
  return summary
}

describe('tool payload baseline', () => {
  it('records or verifies the model-facing payload', () => {
    const summary = buildSummary()
    const mode = process.env.PAYLOAD_MODE ?? 'check'

    if (mode === 'write') {
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(summary, null, 2))
      // eslint-disable-next-line no-console
      console.log(`[payload] baseline written to ${BASELINE_PATH}`)
      return
    }

    if (!fs.existsSync(BASELINE_PATH)) {
      // eslint-disable-next-line no-console
      console.log('[payload] no baseline found — skipping comparison')
      return
    }

    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
    const drift: string[] = []
    for (const provider of PROVIDERS) {
      const before = baseline[provider] ?? []
      const after = summary[provider]!
      if (before.length !== after.length) {
        drift.push(`${provider}: tool count ${before.length} → ${after.length}`)
        continue
      }
      for (let i = 0; i < after.length; i++) {
        const a = before[i]
        const b = after[i]!
        if (a.descriptionHash !== b.descriptionHash)
          drift.push(`${provider}/${b.name}: description ${a.descriptionLength} → ${b.descriptionLength} chars`)
        if (a.schemaHash !== b.schemaHash)
          drift.push(`${provider}/${b.name}: inputSchema ${a.schemaLength} → ${b.schemaLength} chars`)
      }
    }

    if (drift.length > 0) {
      // eslint-disable-next-line no-console
      console.error(`[payload] DRIFT DETECTED:\n${drift.map(line => `  ${line}`).join('\n')}`)
    }
    else {
      // eslint-disable-next-line no-console
      console.log('[payload] no drift — descriptions and schemas are byte-identical')
    }
    expect(drift).toEqual([])
  })
})
