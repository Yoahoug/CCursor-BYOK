import type { ToolRegistryEntry } from '../types'
import { str } from '../shared'

const ANTHROPIC = {
  name: 'WebSearch',
  description: `Search the web for real-time information about any topic. Returns summarized information from search results and relevant URLs.

Use this tool when you need up-to-date information that might not be available or correct in your training data, or when you need to verify current facts.
This includes queries about:
- Libraries, frameworks, and tools whose APIs, best practices, or usage instructions are frequently updated. ("How do I run Postgres in a container?")
- Current events or technology news. ("Which AI model is best for coding?")
- Informational queries similar to what you might Google ("kubernetes operator for mysql")

IMPORTANT - Use the correct year in search queries:
- Today's date is {{currentDate}}. You MUST use this year when searching for recent information, documentation, or current events.
- Example: If today is 2026-07-15 and the user asks for "latest React docs", search for "React documentation 2026", NOT "React documentation 2025"`,
  inputSchema: {
    type: 'object',
    required: [
      'search_term',
    ],
    properties: {
      search_term: {
        type: 'string',
        description: 'The search term to look up on the web. Be specific and include relevant keywords for better results. For technical queries, include version numbers or dates if relevant.',
      },
      explanation: {
        type: 'string',
        description: 'One sentence explanation as to why this tool is being used, and how it contributes to the goal.',
      },
    },
  },
}

const OPENAI = {
  name: 'WebSearch',
  description: `Search web for real-time info on any topic; use for up-to-date facts not in training data, like current events or tech updates. Results include snippets and URLs.`,
  inputSchema: {
    type: 'object',
    properties: {
      search_term: {
        type: 'string',
        description: 'The search term to look up on the web. Be specific and include relevant keywords for better results. For technical queries, include version numbers or dates if relevant.',
      },
      explanation: {
        type: 'string',
        description: 'One sentence explanation as to why this tool is being used, and how it contributes to the goal.',
      },
    },
    required: [
      'search_term',
    ],
  },
}

const GEMINI = {
  name: 'WebSearch',
  description: `Search the web for real-time information about any topic. Returns summarized information from search results and relevant URLs.

Use this tool when you need up-to-date information that might not be available or correct in your training data, or when you need to verify current facts.
This includes queries about:
- Libraries, frameworks, and tools whose APIs, best practices, or usage instructions are frequently updated. ("How do I run Postgres in a container?")
- Current events or technology news. ("Which AI model is best for coding?")
- Informational queries similar to what you might Google ("kubernetes operator for mysql")

IMPORTANT - Use the correct year in search queries:
- Today's date is 2026-04-12. You MUST use this year when searching for recent information, documentation, or current events.
- Example: If today is 2026-07-15 and the user asks for "latest React docs", search for "React documentation 2026", NOT "React documentation 2025"`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      explanation: {
        type: 'STRING',
        description: 'One sentence explanation as to why this tool is being used, and how it contributes to the goal.',
      },
      search_term: {
        type: 'STRING',
        description: 'The search term to look up on the web. Be specific and include relevant keywords for better results. For technical queries, include version numbers or dates if relevant.',
      },
    },
    required: [
      'search_term',
    ],
  },
}

export const WebSearchTool: ToolRegistryEntry = {
  canonicalName: 'WebSearch',
  aliases: ['WebSearch'],
  cursorToolType: 'webSearchToolCall',
  execArgsType: null,
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: (input, callId) => ({
    searchTerm: str(input.search_term ?? input.searchTerm),
    ...(typeof input.explanation === 'string' ? { explanation: input.explanation } : {}),
    toolCallId: callId,
  }),
}
