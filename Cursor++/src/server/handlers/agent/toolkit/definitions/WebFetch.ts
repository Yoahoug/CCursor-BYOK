import type { ToolRegistryEntry } from '../types'
import { str } from '../shared'

const ANTHROPIC = {
  name: 'WebFetch',
  description: `Fetch content from a specified URL and return its contents in a readable markdown format. Use this tool when you need to retrieve and analyze webpage content.

- The URL must be a fully-formed, valid URL.
- This tool is read-only and will not work for requests intended to have side effects.
- This fetch tries to return live results but may return previously cached content.
- Authentication is not supported, and an error will be returned if the URL requires authentication.
- If the URL is returning a non-200 status code, e.g. 404, the tool will not return the content and will instead return an error message.
- This fetch runs from an isolated server. Hosts like localhost or private IPs will not work.
- This tool does not support fetching binary content, e.g. media or PDFs.
- For static assets and non-webpage URLs, use the \`Shell\` tool instead.`,
  inputSchema: {
    type: 'object',
    required: [
      'url',
    ],
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch. The content will be converted to a readable markdown format.',
      },
    },
  },
}

const OPENAI = {
  name: 'WebFetch',
  description: `Fetch content from a specified URL and return its contents in a readable markdown format. Use this tool when you need to retrieve and analyze webpage content.

- The URL must be a fully-formed, valid URL.
- This fetch tries to return live results but may return previously cached content.
- Authentication is not supported, and an error will be returned if the URL requires authentication.
- If the URL is returning a non-200 status code, e.g. 404, the tool will not return the content and will instead return an error message.
- This fetch runs from an isolated server. Hosts like localhost or private IPs will not work.
- This tool does not support fetching binary content, e.g. media or PDFs.
- For static assets and non-webpage URLs, use the \`Shell\` tool instead.`,
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch. The content will be converted to a readable markdown format.',
      },
    },
    required: [
      'url',
    ],
  },
}

const GEMINI = {
  name: 'WebFetch',
  description: `Fetch content from a specified URL and return its contents in a readable markdown format. Use this tool when you need to retrieve and analyze webpage content.

- The URL must be a fully-formed, valid URL.
- This tool is read-only and will not work for requests intended to have side effects.
- This fetch tries to return live results but may return previously cached content.
- Authentication is not supported, and an error will be returned if the URL requires authentication.
- If the URL is returning a non-200 status code, e.g. 404, the tool will not return the content and will instead return an error message.
- This fetch runs from an isolated server. Hosts like localhost or private IPs will not work.
- This tool does not support fetching binary content, e.g. media or PDFs.
- For static assets and non-webpage URLs, use the \`Shell\` tool instead.
`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      url: {
        type: 'STRING',
        description: 'The URL to fetch. The content will be converted to a readable markdown format.',
      },
    },
    required: [
      'url',
    ],
  },
}

export const WebFetchTool: ToolRegistryEntry = {
  canonicalName: 'WebFetch',
  aliases: ['WebFetch'],
  cursorToolType: 'webFetchToolCall',
  execArgsType: null,
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: (input, callId) => ({
    url: str(input.url),
    toolCallId: callId,
  }),
}
