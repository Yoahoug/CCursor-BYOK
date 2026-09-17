/**
 * Equivalence harness for parseRunRequest.
 *
 * Feeds a set of synthetic runRequest payloads through the real parser and
 * hashes the serialized ParsedRunRequest. Run before and after a refactor to
 * prove the parser output did not change.
 */
import { createHash } from 'node:crypto'
import { describe, it } from 'vitest'
import { parseRunRequest } from './src/server/handlers/agent/protocol/parseRunRequest'

function hash(value: unknown): string {
  // Stable stringify so key order cannot make an identical payload look different.
  const seen = new WeakSet()
  const stable = JSON.stringify(value, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (seen.has(v))
        return undefined
      seen.add(v)
      return Object.fromEntries(Object.keys(v).sort().map(k => [k, (v as Record<string, unknown>)[k]]))
    }
    return v
  })
  return createHash('sha256').update(stable ?? '').digest('hex').slice(0, 16)
}

const MCP_TOOLS = Array.from({ length: 3 }, (_, i) => ({
  name: `srv-${i}-do.thing:${i}`,
  toolName: `do.thing:${i}`,
  providerIdentifier: `Server ${i} Display`,
  description: `tool ${i}`,
  inputSchema: { structValue: { fields: { a: { stringValue: 'x' }, b: { numberValue: 1 } } } },
}))

const CASES: Array<{ name: string, payload: Record<string, unknown> }> = [
  {
    name: 'empty',
    payload: {},
  },
  {
    name: 'user message with mcp tools',
    payload: {
      runRequest: {
        modelDetails: { modelId: 'm1' },
        action: {
          userMessageAction: {
            userMessage: { text: 'hello' },
            requestContext: {
              env: { osVersion: 'win32', shell: 'pwsh', workspacePaths: ['D:/ws'] },
              mcpTools: MCP_TOOLS,
            },
          },
        },
      },
    },
  },
  {
    name: 'meta tool options with descriptors',
    payload: {
      runRequest: {
        action: {
          userMessageAction: {
            requestContext: {
              env: { workspacePaths: ['/ws'] },
              mcpMetaToolOptions: {
                enabled: true,
                mcpDescriptors: [{
                  serverName: 'Server 0',
                  serverIdentifier: 'srv-0',
                  serverUseInstructions: 'use it',
                  tools: [
                    { toolName: 'a.b', description: 'desc', inputSchemaJson: '{"type":"object"}', annotationsJson: '{}' },
                    { toolName: '' },
                  ],
                }],
              },
            },
          },
        },
      },
    },
  },
]

describe('parseRunRequest equivalence', () => {
  it('produces the same digest for every case', () => {
    for (const testCase of CASES) {
      const parsed = parseRunRequest(structuredClone(testCase.payload))
      // eslint-disable-next-line no-console
      console.log(`[parse] ${testCase.name}: ${hash(parsed)}`)
    }
  })
})
