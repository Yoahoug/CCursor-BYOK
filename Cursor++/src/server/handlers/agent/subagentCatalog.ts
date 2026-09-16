import type { LLMTool } from '../llm/types'
import type { ParsedCustomSubagent } from './protocol/types'

function cloneSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
}

function appendEnumValue(schema: Record<string, unknown>, propertyName: string, values: string[]): void {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties))
    return
  const property = (properties as Record<string, unknown>)[propertyName]
  if (!property || typeof property !== 'object' || Array.isArray(property))
    return
  const descriptor = property as Record<string, unknown>
  const existing = Array.isArray(descriptor.enum)
    ? descriptor.enum.filter((value): value is string => typeof value === 'string')
    : []
  descriptor.enum = [...new Set([...existing, ...values])]
}

/**
 * Task/Subagent 的 schema 是 provider-specific 静态定义；客户端自定义 Subagent
 * 来自 RequestContext blob。这里按轮生成副本，把名称加入 enum/description，既不
 * 污染全局 registry，也让 cursor namespace discovery 返回完整的当前轮 schema。
 */
export function contextualizeSubagentTools(
  tools: LLMTool[],
  customSubagents: ParsedCustomSubagent[],
): LLMTool[] {
  const available = customSubagents
    .filter(subagent => subagent.name.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name))
  if (available.length === 0)
    return tools

  const names = available.map(subagent => subagent.name)
  const catalog = available.map((subagent) => {
    const mode = subagent.permissionMode === 'readonly' ? ' (read-only)' : ''
    return `- ${subagent.name}${mode}: ${subagent.description || 'Custom subagent.'}`
  }).join('\n')

  return tools.map((tool) => {
    if (tool.name !== 'Task' && tool.name !== 'Subagent')
      return tool
    const inputSchema = cloneSchema(tool.inputSchema)
    appendEnumValue(inputSchema, 'subagent_type', names)
    appendEnumValue(inputSchema, 'subagentType', names)
    return {
      ...tool,
      description: `${tool.description}\n\nAdditional workspace subagent_types:\n${catalog}`,
      inputSchema,
    }
  })
}
