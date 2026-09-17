import type { ToolRegistryEntry } from '../types'
import { str } from '../shared'

/**
 * GetDynamicTools — dynamic namespace 的 discovery meta 工具
 *
 * 1:1 复刻 Cursor 3.15.6 (analysis/mcp-dynamic-tools.md)。LLM 侧参数名
 * namespace / toolName / pattern,对应 proto GetMcpToolsArgs 的
 * server / tool_name / pattern 三个 optional 字段。
 *
 * **服务端自执行**: 不经客户端 exec 通道产出结果 —— 服务端自己经
 * mcpStateExecArgs 取回完整 schema、渲染成 JSON 后直接喂回 LLM,
 * 另发一帧 getMcpToolsToolCall 供客户端做 UI 展示。
 */

const DESCRIPTION = `Discover tools available through dynamic namespaces (e.g. MCP servers).

Modes:
1. {"namespace":"<id>"}: returns schemas and full descriptions for every tool in that namespace.
2. {"namespace":"<id>","toolName":"<name>"}: returns one tool schema with its full description.
3. {"pattern":"<regex>"}: searches namespace and tool names.
4. {"namespace":"<id>","pattern":"<regex>"}: searches tools within one namespace.
5. No arguments: returns the full catalog.

Pattern-search and catalog results shorten long descriptions; namespace and single-tool lookups always return the complete description. Always inspect a tool's schema here before invoking it with CallDynamicTool.`

const PROPERTIES = {
  namespace: {
    type: 'string',
    description: 'Identifier of the dynamic tool namespace to inspect.',
  },
  toolName: {
    type: 'string',
    description: 'Name of a single tool to look up within the namespace.',
  },
  pattern: {
    type: 'string',
    maxLength: 256,
    description: 'Regular expression (max 256 characters) used to search namespace and tool names.',
  },
}

// 五种模式全部合法,包括无参数调用 —— 故 required 为空
const ANTHROPIC = {
  name: 'GetDynamicTools',
  description: DESCRIPTION,
  inputSchema: { type: 'object', properties: PROPERTIES, required: [] as string[] },
}

const OPENAI = {
  name: 'GetDynamicTools',
  description: DESCRIPTION,
  inputSchema: { type: 'object', properties: PROPERTIES, required: [] as string[] },
}

const GEMINI = {
  name: 'GetDynamicTools',
  description: DESCRIPTION,
  inputSchema: {
    type: 'OBJECT',
    properties: {
      namespace: { type: 'STRING', description: PROPERTIES.namespace.description },
      toolName: { type: 'STRING', description: PROPERTIES.toolName.description },
      pattern: { type: 'STRING', description: PROPERTIES.pattern.description },
    },
    required: [] as string[],
  },
}

export const GetDynamicToolsTool: ToolRegistryEntry = {
  canonicalName: 'GetDynamicTools',
  aliases: ['GetDynamicTools', 'get_dynamic_tools', 'GetMcpTools', 'get_mcp_tools'],
  cursorToolType: 'getMcpToolsToolCall',
  // 结果由服务端自产,不下发 exec args —— 真正的取数走 mcpStateExecArgs,
  // 见 handlers/agent/mcpState.ts。
  execArgsType: null,
  llmToolByProvider: {
    anthropic: ANTHROPIC,
    openai: OPENAI,
    gemini: GEMINI,
  },
  // proto GetMcpToolsArgs { server, tool_name, pattern, tool_call_id }
  buildStartedArgs: (input, callId) => ({
    server: str(input.namespace ?? input.server),
    toolName: str(input.toolName ?? input.tool_name),
    pattern: str(input.pattern),
    toolCallId: callId,
  }),
  buildExecArgs: (input, callId) => ({
    server: str(input.namespace ?? input.server),
    toolName: str(input.toolName ?? input.tool_name),
    pattern: str(input.pattern),
    toolCallId: callId,
  }),
}
