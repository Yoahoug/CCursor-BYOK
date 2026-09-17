import type { ToolRegistryEntry } from '../types'
import { str } from '../shared'

const ANTHROPIC = {
  name: 'FetchMcpResource',
  description: `Reads a specific resource from an MCP server, identified by server name and resource URI. Optionally, set downloadPath (relative to the workspace) to save the resource to disk; when set, the resource will be downloaded and not returned to the model.`,
  inputSchema: {
    type: 'object',
    required: [
      'server',
      'uri',
    ],
    properties: {
      server: {
        type: 'string',
        description: 'The MCP server identifier',
      },
      uri: {
        type: 'string',
        description: 'The resource URI to read',
      },
      downloadPath: {
        type: 'string',
        description: 'Optional relative path in the workspace to save the resource to. When set, the resource is written to disk and is not returned to the model.',
      },
    },
  },
}

const OPENAI = {
  name: 'FetchMcpResource',
  description: `Reads a specific resource from an MCP server, identified by server name and resource URI. Optionally, set downloadPath (relative to the workspace) to save the resource to disk; when set, the resource will be downloaded and not returned to the model.`,
  inputSchema: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'The MCP server identifier',
      },
      uri: {
        type: 'string',
        description: 'The resource URI to read',
      },
      downloadPath: {
        type: 'string',
        description: 'Optional relative path in the workspace to save the resource to. When set, the resource is written to disk and is not returned to the model.',
      },
    },
    required: [
      'server',
      'uri',
    ],
  },
}

const GEMINI = {
  name: 'FetchMcpResource',
  description: `Reads a specific resource from an MCP server, identified by server name and resource URI. Optionally, set downloadPath (relative to the workspace) to save the resource to disk; when set, the resource will be downloaded and not returned to the model.`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      downloadPath: {
        type: 'STRING',
        description: 'Optional relative path in the workspace to save the resource to. When set, the resource is written to disk and is not returned to the model.',
      },
      server: {
        type: 'STRING',
        description: 'The MCP server identifier',
      },
      uri: {
        type: 'STRING',
        description: 'The resource URI to read',
      },
    },
    required: [
      'server',
      'uri',
    ],
  },
}

export const FetchMcpResourceTool: ToolRegistryEntry = {
  canonicalName: 'FetchMcpResource',
  aliases: ['FetchMcpResource'],
  cursorToolType: 'readMcpResourceToolCall',
  execArgsType: 'readMcpResourceExecArgs',
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: input => ({
    server: str(input.server),
    uri: str(input.uri),
    ...(str(input.downloadPath) ? { downloadPath: str(input.downloadPath) } : {}),
  }),
  buildExecArgs: input => ({
    server: input.server || '',
    uri: input.uri || '',
    ...(input.downloadPath ? { downloadPath: input.downloadPath } : {}),
  }),
}
