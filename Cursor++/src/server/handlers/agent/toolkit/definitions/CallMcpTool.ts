import type { ToolRegistryEntry } from '../types'
import { toProtoValueMap } from '../../protoValue'
import { obj, str } from '../shared'

/**
 * CallDynamicTool — 按 namespace + toolName 调用 dynamic namespace 里的工具
 *
 * 两种使用形态:
 *
 * 1. **逐工具注册 (legacy)**: 客户端把每个 MCP 工具作为独立 LLM 工具下发
 *    (requestContext.tools[]),LLM 直接按工具名调用,由 resolveToolCall 依
 *    availableMcpTools 路由到 mcpToolCall。此时本工具不必对 LLM 可见。
 *
 * 2. **dynamic namespace 模式 (Cursor 3.15.6)**: 第三方 MCP 工具不再进扁平
 *    tools[],而是收进 namespace。LLM 先用 GetDynamicTools 取得 schema,
 *    再用本工具调用。实测官方 LLM 侧工具名为 CallDynamicTool,参数
 *    namespace / toolName / arguments (analysis/mcp-dynamic-tools.md)。
 *
 * 历史遗留: 旧版本(及本项目早期实现)用名 CallMcpTool、参数 server;
 * 两者都保留为别名,避免会话中途升级时正在进行的调用失配。
 */

const DESCRIPTION = `Invoke a single tool from a dynamic namespace (e.g. an MCP server).

IMPORTANT: Always inspect the tool's schema with GetDynamicTools BEFORE calling it, so the arguments match.

Example:
{
  "namespace": "my-mcp-server",
  "toolName": "search",
  "arguments": { "query": "example", "limit": 10 }
}`

const PROPERTIES = {
  namespace: {
    type: 'string',
    description: 'Identifier of the dynamic tool namespace hosting the tool.',
  },
  toolName: {
    type: 'string',
    description: 'Name of the tool to invoke.',
  },
  arguments: {
    type: 'object',
    description: 'Arguments to pass to the tool, matching the schema from GetDynamicTools.',
  },
}

const ANTHROPIC = {
  name: 'CallDynamicTool',
  description: DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: PROPERTIES,
    required: ['namespace', 'toolName'],
  },
}

const OPENAI = {
  name: 'CallDynamicTool',
  description: DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: PROPERTIES,
    required: ['namespace', 'toolName'],
  },
}

const GEMINI = {
  name: 'CallDynamicTool',
  description: DESCRIPTION,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      namespace: { type: 'STRING', description: PROPERTIES.namespace.description },
      toolName: { type: 'STRING', description: PROPERTIES.toolName.description },
      arguments: { type: 'OBJECT', description: PROPERTIES.arguments.description },
    },
    required: ['namespace', 'toolName'],
  },
}

export const CallMcpToolTool: ToolRegistryEntry = {
  canonicalName: 'CallDynamicTool',
  aliases: ['CallDynamicTool', 'call_dynamic_tool', 'CallMcpTool', 'call_mcp_tool'],
  cursorToolType: 'mcpToolCall',
  execArgsType: 'mcpArgs',
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  buildStartedArgs: (input, callId) => ({
    name: str(input.name),
    args: toProtoValueMap(obj(input.args)),
    toolCallId: callId,
    providerIdentifier: str(input.providerIdentifier ?? input.provider),
    toolName: str(input.toolName ?? input.tool_name),
    serverIdentifier: str(input.serverIdentifier ?? input.server_identifier),
  }),
  buildExecArgs: (input, callId) => ({
    name: input.name || '',
    args: toProtoValueMap((input.args as Record<string, unknown>) || {}),
    toolCallId: callId,
    providerIdentifier: input.providerIdentifier || input.provider || '',
    toolName: input.toolName || input.tool_name || '',
    serverIdentifier: input.serverIdentifier || input.server_identifier || '',
  }),
}
