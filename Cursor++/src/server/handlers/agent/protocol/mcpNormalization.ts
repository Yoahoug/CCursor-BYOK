/**
 * MCP 归一化 —— 把客户端下发的 MCP 工具元数据整理成 LLM / 路由层能直接用的形状。
 *
 * 从 protocol/parseRunRequest.ts 原样抽出（纯移动，无行为改动）。这几个函数
 * 只吃原始 protobuf JSON、吐规范化的结构，与"解析整个 runRequest"没有耦合；
 * 它们同时被 requestContextParts.ts（blob 分片路径）复用，独立成文件后
 * 两条路径共用同一份归一化逻辑，不会各自漂移。
 */
import type { ParsedRunRequest } from './types'

/** 将 requestContext/RequestContextMcpsPart 中的 meta-tool 目录归一成同一形态。 */
export function parseMcpMetaToolOptions(raw: unknown): ParsedRunRequest['mcpMetaTool'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return undefined
  const options = raw as Record<string, unknown>
  if (options.enabled !== true)
    return undefined

  const descriptors = (options.mcpDescriptors as Array<Record<string, unknown>> | undefined) ?? []
  return {
    enabled: true,
    descriptors: descriptors.map(d => ({
      serverName: typeof d.serverName === 'string' ? d.serverName : '',
      serverIdentifier: typeof d.serverIdentifier === 'string' ? d.serverIdentifier : '',
      ...(typeof d.serverUseInstructions === 'string' && d.serverUseInstructions
        ? { serverUseInstructions: d.serverUseInstructions }
        : {}),
      tools: ((d.tools as Array<Record<string, unknown>> | undefined) ?? [])
        .map(t => ({
          toolName: typeof t.toolName === 'string' ? t.toolName : '',
          ...(typeof t.description === 'string' && t.description ? { description: t.description } : {}),
          ...(t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
            ? { inputSchema: t.inputSchema as Record<string, unknown> }
            : {}),
          ...(typeof t.inputSchemaJson === 'string' && t.inputSchemaJson
            ? { inputSchemaJson: t.inputSchemaJson }
            : {}),
          ...(typeof t.annotationsJson === 'string' ? { annotationsJson: t.annotationsJson } : {}),
        }))
        .filter(t => t.toolName.length > 0),
    })),
  }
}

/**
 * 解析 MCP 工具归属 server 的 identifier,用于回填 McpArgs.server_identifier。
 *
 * 客户端构造工具定义时 (workbench q1f):
 *   name               = `${serverIdentifier}-${toolName}`
 *   providerIdentifier = serverName        ← 注意是显示名,不是 identifier
 *
 * 因此优先从 rawName 剥掉 `-${toolName}` 后缀拿到精确 identifier;这条路径不依赖
 * mcpFileSystemOptions,在 requestContext 走 blob 分片(ref_only)时依然可用。
 * 剥离失败再退回 serverName → serverIdentifier 反查表。
 */
export function resolveMcpServerIdentifier(
  rawName: string,
  toolName: string,
  providerIdentifier: string,
  byName: Map<string, string>,
): string {
  if (rawName && toolName) {
    const suffix = `-${toolName}`
    if (rawName.endsWith(suffix) && rawName.length > suffix.length)
      return rawName.slice(0, -suffix.length)
  }
  return byName.get(providerIdentifier) ?? ''
}

/**
 * 规范化 MCP 工具名以匹配 Anthropic tools 的 name pattern: ^[a-zA-Z0-9_-]+$
 *
 * MCP server 下发的工具名经常带 `.` / `:` / `/` / 空格 / 非 ASCII,会触发
 * provider 400 "tools[N].name: string does not match pattern"。
 *
 * 这里把所有非法字符替换为 `_`,合并连续下划线、修剪首尾下划线;空或首字符被
 * 修没的回退到 `mcp_tool`;冲突时追加 _2 / _3 / ... 保证一批工具内唯一。
 *
 * 注意:只 normalize 用作 LLM tools schema 的 name;providerIdentifier 与
 * toolName 保持原样,因为那两个字段用来把 tool_call 回路回客户端 mcpService
 * 做真实路由。
 */
export function normalizeMcpToolName(raw: string, seen: Set<string>): string {
  let base = raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  if (!base)
    base = 'mcp_tool'
  if (!seen.has(base))
    return base
  let i = 2
  while (seen.has(`${base}_${i}`))
    i++
  return `${base}_${i}`
}

/**
 * 把 McpToolDefinition.inputSchema 规范成标准 JSON Schema object。
 *
 * 客户端 (@bufbuild/protobuf) 在 toJson 后 google.protobuf.Value 常见为普通 JSON,
 * 但偶尔仍会以 Value-wrapped 形态下发 (如 { structValue: { fields: {...} } }),
 * 这时 LLM 的 tools schema 会报无效 JSON Schema。
 *
 * 防御性地 unwrap 一层,并确保输出至少是 object 形态以通过 provider 侧校验。
 */
export function normalizeMcpInputSchema(raw: unknown, rawJson?: unknown): Record<string, unknown> {
  if (typeof rawJson === 'string' && rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed as Record<string, unknown>
    }
    catch {
      // 回退到 protobuf Value 字段;调用方仍能得到可诊断的 schema。
    }
  }
  if (raw == null || typeof raw !== 'object')
    return { type: 'object' }
  const obj = raw as Record<string, unknown>

  // 已是标准 JSON Schema: { type, properties?, ... }
  if (typeof obj.type === 'string' || obj.properties || obj.$schema)
    return obj

  // google.protobuf.Value 形态: { structValue: { fields: { ... } } }
  const structValue = obj.structValue as Record<string, unknown> | undefined
  if (structValue) {
    const fields = (structValue.fields as Record<string, unknown> | undefined) ?? structValue
    return { type: 'object', properties: unwrapProtoValueFields(fields) }
  }

  // google.protobuf.Struct 形态: { fields: { ... } }
  if (obj.fields && typeof obj.fields === 'object')
    return { type: 'object', properties: unwrapProtoValueFields(obj.fields as Record<string, unknown>) }

  // 其他未知形态直接返回,让 provider 报错 (比伪造 schema 更可诊断)
  return obj
}

/** 把 google.protobuf.Struct.fields 中每个 Value 递归 unwrap 为裸值 */
function unwrapProtoValueFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields))
    out[k] = unwrapProtoValue(v)
  return out
}

function unwrapProtoValue(v: unknown): unknown {
  if (v == null || typeof v !== 'object')
    return v
  const obj = v as Record<string, unknown>
  if ('stringValue' in obj) return obj.stringValue
  if ('numberValue' in obj) return obj.numberValue
  if ('boolValue' in obj) return obj.boolValue
  if ('nullValue' in obj) return null
  if (obj.listValue && typeof obj.listValue === 'object') {
    const values = (obj.listValue as Record<string, unknown>).values as unknown[] | undefined
    return Array.isArray(values) ? values.map(unwrapProtoValue) : []
  }
  if (obj.structValue && typeof obj.structValue === 'object') {
    const fields = (obj.structValue as Record<string, unknown>).fields as Record<string, unknown> | undefined
    return fields ? unwrapProtoValueFields(fields) : {}
  }
  return v
}
