/**
 * mcpState exec 通道 — MCP 工具完整 schema 的唯一来源
 *
 * 背景 (实测 Cursor 3.15.6, 见 analysis/mcp-dynamic-tools.md):
 *   meta-tool 模式下客户端在 requestContext.mcpMetaToolOptions.mcpDescriptors
 *   里只发 slim 名单 —— 每个工具**只有 toolName**,没有 description / inputSchema。
 *   实测把 descriptor 的 description 填满也不会进 prompt,服务端只取 toolName。
 *
 *   所以完整 schema 只有一条路: 经 execServerMessage.mcpStateExecArgs 向客户端要,
 *   客户端回 mcpStateExecResult → McpStateSuccess { servers: McpStateServer[] },
 *   其中 McpStateServer.tools 是 McpToolDefinition[],带 description +
 *   input_schema / input_schema_json。
 *
 * 官方行为(实测,1:1 复刻):
 *   - server_identifiers 随查询模式变化:
 *       带 namespace 的查询       → ["user-ida-pro-mcp"] (包括 namespace+pattern)
 *       跨 namespace search/catalog → []                   (空数组 = 要全部)
 *   - **不做缓存**: 同一轮里 4 次 GetDynamicTools 查询实打实发了 4 次 mcpStateExecArgs。
 *     这里照此复刻,不加 session 级缓存,以免与官方行为产生偏离。
 */
import type { AgentServerMessage } from '../../gen/agent_v1_pb'
import type { AgentSession } from './session'
import { logger } from '../../logger'
import { execMessage } from './stream'
import { waitForExecClientMessageWithHeartbeat } from './wait'

/** 取 MCP state 的等待上限 — 客户端需向各 MCP server 查询,放宽于 blob 取回 */
const MCP_STATE_TIMEOUT_MS = 30_000

/** 单个 MCP 工具的完整定义 (来自 McpToolDefinition) */
export interface McpStateToolDefinition {
  /** 客户端侧完整工具名,如 user-ida-pro-mcp-decompile */
  name: string
  /** MCP server 的展示名 */
  providerIdentifier: string
  /** MCP server 内部的工具名,如 decompile */
  toolName: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpStateServerInfo {
  serverName: string
  serverIdentifier: string
  /** 3.17.8 常见 connected/error/needsAuth;渲染层把 connected 归一为 ready。 */
  status: string
  /**
   * McpStateServer.error_message (field 8) — 3.17.8 新增。
   *
   * server 起不来时客户端在此说明原因。3.17.8 渲染为 namespaceError,
   * 让模型区分"MCP server 自身故障"与"schema 没解析对"。
   */
  errorMessage?: string
  /** McpStateServer.instructions 合并后的 namespace 使用说明。 */
  instructions?: string
  tools: McpStateToolDefinition[]
}

export interface McpRoutingEntry {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  providerIdentifier: string
  toolName: string
  serverIdentifier: string
}

/** 将 discovery 的权威定义合入整轮共享的调用路由表。 */
export function mergeMcpStateIntoRoutingTable(
  routingTable: McpRoutingEntry[],
  servers: McpStateServerInfo[],
): { added: number, updated: number } {
  const keyOf = (serverIdentifier: string, toolName: string) => JSON.stringify([serverIdentifier, toolName])
  const byRoute = new Map(routingTable.map(entry => [keyOf(entry.serverIdentifier, entry.toolName), entry]))
  let added = 0
  let updated = 0

  for (const server of servers) {
    for (const tool of server.tools) {
      if (!tool.toolName)
        continue
      const key = keyOf(server.serverIdentifier, tool.toolName)
      const existing = byRoute.get(key)
      if (existing) {
        existing.description = tool.description || existing.description
        existing.inputSchema = tool.inputSchema
        existing.providerIdentifier = tool.providerIdentifier || server.serverName || existing.providerIdentifier
        updated++
        continue
      }

      const entry: McpRoutingEntry = {
        name: tool.name || (server.serverIdentifier
          ? `${server.serverIdentifier}-${tool.toolName}`
          : tool.toolName),
        description: tool.description,
        inputSchema: tool.inputSchema,
        providerIdentifier: tool.providerIdentifier || server.serverName,
        toolName: tool.toolName,
        serverIdentifier: server.serverIdentifier,
      }
      routingTable.push(entry)
      byRoute.set(key, entry)
      added++
    }
  }
  return { added, updated }
}

/**
 * 归一 inputSchema。
 *
 * McpToolDefinition 同时有 input_schema (google.protobuf.Value) 和
 * input_schema_json (string) 两个字段,客户端可能只填其中之一 ——
 * 优先用 JSON 串(无 protobuf Value 包装,解析后即为原始 JSON Schema)。
 */
function normalizeInputSchema(tool: Record<string, unknown>): Record<string, unknown> {
  const raw = tool.inputSchemaJson
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed as Record<string, unknown>
    }
    catch {
      logger.warn({ toolName: tool.toolName }, '[MCP-STATE] inputSchemaJson is not valid JSON')
    }
  }
  const value = tool.inputSchema
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>
    // 官方对无 schema 的工具也发 object 壳,保持一致避免 LLM 拒调
  return { type: 'object', properties: {} }
}

/**
 * 向客户端索取 MCP server 的完整工具定义。
 *
 * 作为 async generator: yield 出去的是要发给客户端的帧与心跳,return 的才是结果。
 * 取不到时返回 null —— 调用方应把它渲染成 namespaceStatus 异常而非中断对话。
 */
export async function* fetchMcpState(params: {
  session: AgentSession | null
  serverIdentifiers: string[]
  allocateExecId: () => number
}): AsyncGenerator<AgentServerMessage, McpStateServerInfo[] | null, void> {
  if (!params.session) {
    logger.warn('[MCP-STATE] cannot fetch MCP state without a session')
    return null
  }

  const execId = params.allocateExecId()
  // 发出侧 —— 与下方 "<- mcpStateExecResult" 用 execId 配对,
  // 空 serverIdentifiers 表示"要全部"(search / catalog 查询)
  logger.info({
    execId,
    serverIdentifiers: params.serverIdentifiers,
    scope: params.serverIdentifiers.length > 0 ? 'scoped' : 'all',
  }, '[MCP-STATE] -> mcpStateExecArgs')
  const startedAt = Date.now()
  yield execMessage(execId, String(execId), 'mcpStateExecArgs', {
    serverIdentifiers: params.serverIdentifiers,
    kickOnly: false,
  })

  const msg = yield* waitForExecClientMessageWithHeartbeat(
    params.session,
    execId,
    MCP_STATE_TIMEOUT_MS,
  )

  if (!msg) {
    logger.warn({ execId, serverIdentifiers: params.serverIdentifiers, elapsedMs: Date.now() - startedAt }, '[MCP-STATE] <- timed out waiting for mcpStateExecResult')
    return null
  }

  const exec = msg.execClientMessage as Record<string, unknown> | undefined
  const result = exec?.mcpStateExecResult as Record<string, unknown> | undefined
  if (!result) {
    logger.warn({ execId, elapsedMs: Date.now() - startedAt }, '[MCP-STATE] <- reply carried no mcpStateExecResult')
    return null
  }
  if (result.error) {
    logger.warn({ execId, elapsedMs: Date.now() - startedAt, error: result.error }, '[MCP-STATE] <- client returned error')
    return null
  }
  if (result.rejected) {
    logger.warn({ execId, elapsedMs: Date.now() - startedAt, rejected: result.rejected }, '[MCP-STATE] <- client rejected the request')
    return null
  }

  const success = result.success as Record<string, unknown> | undefined
  const rawServers = (success?.servers as Array<Record<string, unknown>> | undefined) ?? []

  const servers: McpStateServerInfo[] = rawServers.map((s) => {
    const rawTools = (s.tools as Array<Record<string, unknown>> | undefined) ?? []
    const instructions = ((s.instructions as Array<Record<string, unknown>> | undefined) ?? [])
      .map(item => typeof item.instructions === 'string' ? item.instructions.trim() : '')
      .filter(Boolean)
      .join('\n')
    return {
      serverName: (s.serverName as string) ?? '',
      serverIdentifier: (s.serverIdentifier as string) ?? '',
      // 3.17.8 客户端通常填 connected;渲染层统一转换为模型侧的 ready。
      status: (s.status as string) || 'ready',
      ...(typeof s.errorMessage === 'string' && s.errorMessage
        ? { errorMessage: s.errorMessage }
        : {}),
      ...(instructions ? { instructions } : {}),
      tools: rawTools.map(t => ({
        name: (t.name as string) ?? '',
        providerIdentifier: (t.providerIdentifier as string) ?? '',
        toolName: (t.toolName as string) ?? '',
        description: (t.description as string) ?? '',
        inputSchema: normalizeInputSchema(t),
      })),
    }
  })

  logger.info({
    execId,
    elapsedMs: Date.now() - startedAt,
    requested: params.serverIdentifiers,
    servers: servers.map(s => ({
      id: s.serverIdentifier,
      status: s.status,
      tools: s.tools.length,
      toolNames: s.tools.map(t => t.toolName),
      hasInstructions: !!s.instructions,
      // schema 缺失是"查得到但调不动"的元凶,单独标出来
      withoutSchema: s.tools.filter(t => Object.keys(t.inputSchema).length === 0).length,
      // 3.17.8 起客户端会说明 server 起不来的原因
      ...(s.errorMessage ? { errorMessage: s.errorMessage } : {}),
    })),
  }, '[MCP-STATE] <- mcpStateExecResult')

  return servers
}
