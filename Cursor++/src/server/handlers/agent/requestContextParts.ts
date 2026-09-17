import type { AgentServerMessage } from '../../gen/agent_v1_pb'
import type { ParsedRunRequest } from './protocol/types'
import type { AgentSession } from './session'
/**
 * requestContextParts blob 取回 — Cursor 3.13+ ref_only 传输模式补偿
 *
 * 背景 (agent-client/request-context-blob.ts):
 *   3.13 起 requestContext 支持分片投递,模式由 Statsig
 *   `nal_request_context_blob_transport_config` 下发,内置 fallback 为 legacy:
 *
 *     legacy   → requestContext 内联,无 parts
 *     dual     → requestContext 内联 + parts (双写)
 *     ref_only → requestContext = undefined,只发 parts
 *
 *   客户端拆分函数 (workbench GM_) 把 requestContext 切成 5 份,其中
 *   rules / skills / subagents / mcps 四组序列化后按内容哈希存入
 *   **客户端本地** transient blob map (seedAll),请求里只带 blobId;
 *   其余字段留在 parts.dynamic_context 内联下发。
 *
 *   注意 ref_only 有一条首轮降级: 会话第一轮 (turns.length === 0 且
 *   userMessageAction) 强制走 dual,第二轮起才是真 ref_only。这解释了
 *   "首条消息 MCP 正常、后续消息 MCP 消失" 的现象。
 *
 * 实测 (2-Cometixy.log, 2026-08-07):
 *   ref_only 下 requestContext 与顶层 mcp_tools **同时缺席**,
 *   parseRunRequest 两条数据源全落空 → mcpToolsCount: 0,
 *   LLM 只剩内置的 ListMcpResources / FetchMcpResource / CallMcpTool,
 *   动态 MCP 工具(decompile / list_funcs …)全部消失。
 *
 * 本模块负责: 严格串行取回四个引用并分别解码为 Rules / Skills /
 * Subagents / Mcps Part，再合回同一个 ParsedRunRequest。dual/legacy 模式
 * 不暴露引用，因此不会重复拉取或影响旧客户端。
 */
import { fromBinary } from '@bufbuild/protobuf'
import {
  RequestContextMcpsPartSchema,
  RequestContextRulesPartSchema,
  RequestContextSkillsPartSchema,
  RequestContextSubagentsPartSchema,
} from '../../gen/agent_v1_pb'
import { logger } from '../../logger'
import {
  applyRuleContext,
  mergeAgentSkills,
  normalizeAgentSkill,
  normalizeCustomSubagent,
} from './contextCatalog'
import {
  normalizeMcpInputSchema,
  normalizeMcpToolName,
  parseMcpMetaToolOptions,
  resolveMcpServerIdentifier,
} from './protocol/parseRunRequest'
import { toBytes } from './protocol/shared'
import { kvGetBlob } from './stream'
import { waitForMessageMatchingWithHeartbeat } from './wait'

/** 取 blob 的等待上限 — 客户端本地内存命中,正常是毫秒级 */
const BLOB_FETCH_TIMEOUT_MS = 10_000

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length)
    return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i])
      return false
  }
  return true
}

/**
 * 从 kvClientMessage.getBlobResult 中取出 blob 内容。
 *
 * proto: GetBlobResult { bytes blob_data = 1; Error error = 2 }
 * 3.13 起新增 error 字段,失败时该字段有值、blob_data 为空。
 */
function extractBlobData(msg: Record<string, unknown>): Uint8Array | null {
  const kv = msg.kvClientMessage as Record<string, unknown> | undefined
  const result = kv?.getBlobResult as Record<string, unknown> | undefined
  if (!result)
    return null
  if (result.error) {
    logger.warn({ error: result.error }, '[PROTOCOL] getBlobResult returned error')
    return null
  }
  // JSON transport 会把 proto bytes 编成 base64 string;统一归一后再解码 protobuf。
  return toBytes(result.blobData) ?? null
}

export interface FetchedRulesPart {
  rules: Array<Record<string, unknown>>
  nonFileRules: Array<Record<string, unknown>>
  cloudRule?: string
}

export interface FetchedSkillsPart {
  agentSkills: Array<Record<string, unknown>>
  skillOptions?: Record<string, unknown>
}

export interface FetchedSubagentsPart {
  customSubagents: Array<Record<string, unknown>>
}

export interface FetchedMcpsPart {
  tools: Array<Record<string, unknown>>
  mcpInstructions: Array<Record<string, unknown>>
  mcpFileSystemOptions?: Record<string, unknown>
  mcpMetaToolOptions?: Record<string, unknown>
}

interface FetchPartParams {
  session: AgentSession | null
  blobId: Uint8Array
  allocateBlobId: () => number
}

/** 四类 Part 共用同一个严格串行 KV fetch，避免无 response id 的旧客户端串包。 */
async function* fetchPartBytes(
  params: FetchPartParams,
  partName: 'rules' | 'skills' | 'subagents' | 'mcps',
): AsyncGenerator<AgentServerMessage, Uint8Array | null, void> {
  if (!params.session) {
    logger.warn({ partName }, '[PROTOCOL] cannot fetch request-context blob without a session')
    return null
  }

  const requestId = params.allocateBlobId()
  yield kvGetBlob(requestId, params.blobId)
  const msg = yield* waitForMessageMatchingWithHeartbeat(
    params.session,
    (message) => {
      const kv = message.kvClientMessage as Record<string, unknown> | undefined
      if (!kv?.getBlobResult)
        return false
      const id = kv.id
      return id === undefined || id === requestId
    },
    BLOB_FETCH_TIMEOUT_MS,
  )
  if (!msg) {
    logger.warn({ requestId, partName }, '[PROTOCOL] request-context blob fetch timed out')
    return null
  }
  const blobData = extractBlobData(msg)
  if (!blobData) {
    logger.warn({ requestId, partName }, '[PROTOCOL] request-context blob fetch returned no data')
    return null
  }
  return blobData
}

export async function* fetchRulesPart(params: FetchPartParams): AsyncGenerator<AgentServerMessage, FetchedRulesPart | null, void> {
  const blobData = yield* fetchPartBytes(params, 'rules')
  if (!blobData)
    return null
  try {
    const part = fromBinary(RequestContextRulesPartSchema, blobData)
    const result = {
      rules: part.rules as unknown as Array<Record<string, unknown>>,
      nonFileRules: part.nonFileRules as unknown as Array<Record<string, unknown>>,
      ...(part.cloudRule !== undefined ? { cloudRule: part.cloudRule } : {}),
    }
    logger.info({ bytes: blobData.length, rules: result.rules.length, nonFileRules: result.nonFileRules.length, hasCloudRule: result.cloudRule !== undefined }, '[PROTOCOL] rules blob decoded')
    return result
  }
  catch (error) {
    logger.warn({ error: (error as Error).message, bytes: blobData.length }, '[PROTOCOL] failed to decode RequestContextRulesPart')
    return null
  }
}

export async function* fetchSkillsPart(params: FetchPartParams): AsyncGenerator<AgentServerMessage, FetchedSkillsPart | null, void> {
  const blobData = yield* fetchPartBytes(params, 'skills')
  if (!blobData)
    return null
  try {
    const part = fromBinary(RequestContextSkillsPartSchema, blobData)
    const result = {
      agentSkills: part.agentSkills as unknown as Array<Record<string, unknown>>,
      ...(part.skillOptions ? { skillOptions: part.skillOptions as unknown as Record<string, unknown> } : {}),
    }
    logger.info({ bytes: blobData.length, skills: result.agentSkills.length, hasSkillOptions: !!result.skillOptions }, '[PROTOCOL] skills blob decoded')
    return result
  }
  catch (error) {
    logger.warn({ error: (error as Error).message, bytes: blobData.length }, '[PROTOCOL] failed to decode RequestContextSkillsPart')
    return null
  }
}

export async function* fetchSubagentsPart(params: FetchPartParams): AsyncGenerator<AgentServerMessage, FetchedSubagentsPart | null, void> {
  const blobData = yield* fetchPartBytes(params, 'subagents')
  if (!blobData)
    return null
  try {
    const part = fromBinary(RequestContextSubagentsPartSchema, blobData)
    const result = { customSubagents: part.customSubagents as unknown as Array<Record<string, unknown>> }
    logger.info({ bytes: blobData.length, subagents: result.customSubagents.length }, '[PROTOCOL] subagents blob decoded')
    return result
  }
  catch (error) {
    logger.warn({ error: (error as Error).message, bytes: blobData.length }, '[PROTOCOL] failed to decode RequestContextSubagentsPart')
    return null
  }
}

export async function* fetchMcpsPart(params: FetchPartParams): AsyncGenerator<AgentServerMessage, FetchedMcpsPart | null, void> {
  const blobData = yield* fetchPartBytes(params, 'mcps')
  if (!blobData)
    return null
  try {
    const part = fromBinary(RequestContextMcpsPartSchema, blobData)
    const tools = part.tools as unknown as Array<Record<string, unknown>>
    logger.info({
      bytes: blobData.length,
      toolCount: tools.length,
      instructionCount: part.mcpInstructions.length,
      hasFsOptions: !!part.mcpFileSystemOptions,
      hasMetaToolOptions: !!part.mcpMetaToolOptions,
    }, '[PROTOCOL] mcps blob decoded')
    return {
      tools,
      mcpInstructions: part.mcpInstructions as unknown as Array<Record<string, unknown>>,
      mcpFileSystemOptions: part.mcpFileSystemOptions as unknown as Record<string, unknown> | undefined,
      mcpMetaToolOptions: part.mcpMetaToolOptions as unknown as Record<string, unknown> | undefined,
    }
  }
  catch (error) {
    logger.warn({ error: (error as Error).message, bytes: blobData.length }, '[PROTOCOL] failed to decode RequestContextMcpsPart')
    return null
  }
}

export function applyRulesPart(parsed: ParsedRunRequest, part: FetchedRulesPart): void {
  applyRuleContext({
    parsed,
    rules: part.rules,
    nonFileRules: part.nonFileRules,
    cloudRule: part.cloudRule,
    preserveExistingUserRules: true,
  })
  logger.info({ alwaysRules: parsed.alwaysRules.length, requestableRules: parsed.projectRules.length, userRules: parsed.userRules.length }, '[PROTOCOL] Rule context restored from rules blob')
}

export function applySkillsPart(parsed: ParsedRunRequest, part: FetchedSkillsPart): void {
  parsed.agentSkills = mergeAgentSkills(parsed.agentSkills, part.agentSkills.map(normalizeAgentSkill))
  if (part.skillOptions)
    parsed.skillOptions = part.skillOptions
  logger.info({ agentSkills: parsed.agentSkills.length, hasSkillOptions: !!parsed.skillOptions }, '[PROTOCOL] Skill context restored from skills blob')
}

export function applySubagentsPart(parsed: ParsedRunRequest, part: FetchedSubagentsPart): void {
  const byName = new Map(parsed.customSubagents.map(subagent => [subagent.name, subagent]))
  for (const raw of part.customSubagents) {
    const subagent = normalizeCustomSubagent(raw)
    if (subagent.name)
      byName.set(subagent.name, subagent)
  }
  parsed.customSubagents = [...byName.values()]
  logger.info({ customSubagents: parsed.customSubagents.length }, '[PROTOCOL] Subagent context restored from subagents blob')
}

/**
 * 把取回的 mcps Part 合入 ParsedRunRequest。
 *
 * 复用 parseRunRequest 的同一套规范化逻辑(工具名清洗 / inputSchema 归一 /
 * serverIdentifier 解析),避免两条路径产出不一致的工具表。
 */
export function applyMcpsPart(parsed: ParsedRunRequest, part: FetchedMcpsPart): void {
  // mcpServers / mcpBasePath — 来自 mcp_file_system_options
  const fsOpts = part.mcpFileSystemOptions
  const descriptors = (fsOpts?.mcpDescriptors as Array<Record<string, unknown>> | undefined) ?? []
  if (descriptors.length > 0) {
    parsed.mcpServers = descriptors.map(d => ({
      serverName: (d.serverName as string) ?? '',
      serverIdentifier: (d.serverIdentifier as string) ?? '',
      folderPath: (d.folderPath as string) ?? '',
      serverUseInstructions: (d.serverUseInstructions as string) ?? '',
    }))
    const basePath = (fsOpts?.workspaceProjectDir as string) ?? ''
    if (basePath)
      parsed.mcpBasePath = `${basePath}/mcps`
  }

  // mcpInstructions
  if (part.mcpInstructions.length > 0) {
    parsed.mcpInstructions = part.mcpInstructions.map(m => ({
      serverName: (m.serverName as string) ?? '',
      instructions: (m.instructions as string) ?? '',
      serverIdentifier: (m.serverIdentifier as string) ?? '',
    }))
  }

  // ref_only 下 mcp_meta_tool_options 只存在于 mcps blob,不在 dynamic_context。
  // 漏掉它会把本轮误判成 legacy_flat,从而既不注入 namespace 目录也不暴露 meta tools。
  const recoveredMetaTool = parseMcpMetaToolOptions(part.mcpMetaToolOptions)
  if (recoveredMetaTool)
    parsed.mcpMetaTool = recoveredMetaTool

  // serverName → serverIdentifier 反查表 (与 parseRunRequest 同构)。meta descriptor
  // 同样是权威来源,尤其在 mcpFileSystemOptions 未启用时不能只依赖 fs descriptors。
  const serverIdentifierByName = new Map<string, string>()
  for (const src of [...parsed.mcpServers, ...parsed.mcpInstructions, ...(parsed.mcpMetaTool?.descriptors ?? [])]) {
    if (src.serverName && src.serverIdentifier && !serverIdentifierByName.has(src.serverName))
      serverIdentifierByName.set(src.serverName, src.serverIdentifier)
  }

  // mcpTools: 先恢复完整/白名单工具,再从 slim meta descriptor 补齐路由条目。
  // 后者即使没有 schema,也具备 CallDynamicTool 所需的 serverIdentifier + toolName。
  const seenNames = new Set<string>()
  parsed.mcpTools = part.tools.map((t) => {
    const rawName = (t.name as string) ?? ''
    const normalizedName = normalizeMcpToolName(rawName, seenNames)
    seenNames.add(normalizedName)
    const providerIdentifier = (t.providerIdentifier as string) ?? ''
    const toolName = (t.toolName as string) ?? ''
    return {
      name: normalizedName,
      description: (t.description as string) ?? '',
      inputSchema: normalizeMcpInputSchema(t.inputSchema, t.inputSchemaJson),
      providerIdentifier,
      toolName,
      serverIdentifier: resolveMcpServerIdentifier(rawName, toolName, providerIdentifier, serverIdentifierByName),
    }
  })

  const routed = new Set(parsed.mcpTools.map(t => `${t.serverIdentifier}\u0000${t.toolName}`))
  for (const descriptor of parsed.mcpMetaTool?.descriptors ?? []) {
    for (const tool of descriptor.tools) {
      const routeKey = `${descriptor.serverIdentifier}\u0000${tool.toolName}`
      if (routed.has(routeKey))
        continue
      routed.add(routeKey)
      const rawName = descriptor.serverIdentifier
        ? `${descriptor.serverIdentifier}-${tool.toolName}`
        : tool.toolName
      const name = normalizeMcpToolName(rawName, seenNames)
      seenNames.add(name)
      parsed.mcpTools.push({
        name,
        description: tool.description ?? '',
        inputSchema: normalizeMcpInputSchema(tool.inputSchema, tool.inputSchemaJson),
        providerIdentifier: descriptor.serverName,
        toolName: tool.toolName,
        serverIdentifier: descriptor.serverIdentifier,
      })
    }
  }

  logger.info({
    mcpTools: parsed.mcpTools.length,
    mcpServers: parsed.mcpServers.length,
    mcpInstructions: parsed.mcpInstructions.length,
    mcpMetaToolEnabled: parsed.mcpMetaTool?.enabled === true,
    namespaces: parsed.mcpMetaTool?.descriptors.map(d => ({
      name: d.serverIdentifier,
      tools: d.tools.length,
    })) ?? [],
  }, '[PROTOCOL] MCP context restored from mcps blob')
}

export { bytesEqual }
