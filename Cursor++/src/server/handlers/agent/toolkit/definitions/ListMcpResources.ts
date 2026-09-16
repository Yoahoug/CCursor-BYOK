import type { ToolRegistryEntry } from '../types'
import { str } from '../shared'

const ANTHROPIC = {
  name: 'ListMcpResources',
  description: `List available resources from configured MCP servers. Each returned resource will include all standard MCP resource fields plus a 'server' field indicating which server the resource belongs to. MCP resources are _not_ the same as tools, so don't call this function to discover MCP tools.`,
  inputSchema: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'Optional server identifier to filter resources by. If not provided, resources from all servers will be returned.',
      },
    },
  },
}

const OPENAI = {
  name: 'ListMcpResources',
  description: `List available resources from configured MCP servers. Each returned resource will include all standard MCP resource fields plus a 'server' field indicating which server the resource belongs to. MCP resources are _not_ the same as tools, so don't call this function to discover MCP tools.`,
  inputSchema: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'Optional server identifier to filter resources by. If not provided, resources from all servers will be returned.',
      },
    },
  },
}

const GEMINI = {
  name: 'ListMcpResources',
  description: `List available resources from configured MCP servers. Each returned resource will include all standard MCP resource fields plus a 'server' field indicating which server the resource belongs to. MCP resources are _not_ the same as tools, so don't call this function to discover MCP tools.`,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      server: {
        type: 'STRING',
        description: 'Optional server identifier to filter resources by. If not provided, resources from all servers will be returned.',
      },
    },
  },
}

export const ListMcpResourcesTool: ToolRegistryEntry = {
  canonicalName: 'ListMcpResources',
  aliases: ['ListMcpResources'],
  cursorToolType: 'listMcpResourcesToolCall',
  execArgsType: 'listMcpResourcesExecArgs',
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: input => ({
    ...(str(input.server) ? { server: str(input.server) } : {}),
  }),
  buildExecArgs: input => ({
    ...(input.server ? { server: input.server } : {}),
  }),
}
