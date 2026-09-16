/**
 * Context token breakdown — 按来源把一轮请求的 prompt 拆成可比较的分类。
 *
 * 从 conversationRuntime.ts 原样抽出（纯移动，无行为改动）：这部分是纯函数，
 * 与流式对话循环没有耦合，留在 1300 行的主文件里只会淹没真正的对话逻辑。
 *
 * 划分依据是**来源**而非性质:
 *   tools — 内置工具 (含 GetDynamicTools/CallDynamicTool 这两个 meta 工具)
 *   mcp   — 一切 MCP 来的东西 (dynamic_tools 段、mcp_instructions 段、
 *           legacy 扁平表里的 MCP schema、GetDynamicTools 的 discovery 结果)
 *
 * 必须这么分，否则 legacy 与 dynamic 两种模式下 "MCP 吃了多少 context" 的口径
 * 会打架：legacy 下 MCP 工具进扁平 requestTools，dynamic 下同一份 schema 走
 * GetDynamicTools 的结果进对话历史 —— 若按性质划分，切模式时数字会莫名跳动，
 * 也就没法回答"我装的 MCP 到底吃了多少 context"这个真正有决策价值的问题。
 */
import type { LLMMessage, LLMTool, LLMToolResultBlock } from '../llm/types'
import { extractPlainTextContent } from './historyManager'
import { ContextTokenTracker } from './tokenCounter'

export type BreakdownCategory = { id: string, label: string, estimatedTokens: number }

function extractXmlSection(text: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}>`))
  return match?.[0] ?? ''
}

function splitSubagentDefinitionsFromDescription(description: string): { description: string, subagentDefinitions: string } {
  const marker = 'Available subagent_types and a quick description of what they do:'
  const start = description.indexOf(marker)
  if (start < 0)
    return { description, subagentDefinitions: '' }

  const availableModelsStart = description.indexOf('\n\nAvailable models:', start)
  const nextInstructionsStart = description.indexOf('\n\nWhen speaking to the USER', start)
  const endCandidates = [availableModelsStart, nextInstructionsStart].filter(index => index > start)
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : description.length
  const subagentDefinitions = description.slice(start, end).trim()
  const cleanedDescription = `${description.slice(0, start).trimEnd()}\n\n${description.slice(end).trimStart()}`.trim()
  return { description: cleanedDescription, subagentDefinitions }
}

function splitSubagentDefinitionsFromTools(tools: LLMTool[]): { sanitizedTools: LLMTool[], subagentDefinitionsText: string } {
  const subagentDefinitions: string[] = []
  const sanitizedTools = tools.map(tool => {
    if (tool.name !== 'Task' && tool.name !== 'Subagent' && !tool.description.includes('Available subagent_types'))
      return tool

    const split = splitSubagentDefinitionsFromDescription(tool.description)
    if (!split.subagentDefinitions)
      return tool

    subagentDefinitions.push(split.subagentDefinitions)
    return { ...tool, description: split.description }
  })

  return {
    sanitizedTools,
    subagentDefinitionsText: subagentDefinitions.join('\n\n'),
  }
}

/** 工具 schema 的计数文本 — 空集不产出 "[]",免得凭空多算 token */
function toolSchemaText(tools: LLMTool[]): string {
  return tools.length > 0 ? JSON.stringify(tools) : ''
}

/**
 * 拼接分类文本,丢掉空片段。
 *
 * 直接用 `${a}\n${b}` 在全空时会得到 "\n",countTokens 记 1 —— 而
 * toBreakdownCategories() 只输出 tokens > 0 的分类,于是 UI 上会凭空
 * 多出一行 "MCP: 1 token"。
 */
function joinSections(...parts: string[]): string {
  return parts.filter(p => p && p.trim() !== '').join('\n')
}

export function buildContextBreakdown(params: {
  systemContent: string
  preambleUserContent: string
  requestMessages: LLMMessage[]
  requestTools: LLMTool[]
  /**
   * MCP 工具名集合 — 用来把 MCP schema 从内置工具里分出来。
   *
   * tools 与 mcp 两个分类按**来源**划分,不按性质:
   *   tools — 内置工具 (含 GetDynamicTools/CallDynamicTool 这两个 meta 工具)
   *   mcp   — 一切 MCP 来的东西
   *
   * 必须这么分,否则 legacy 与 dynamic 两种模式口径会打架:
   * legacy 下 MCP 工具进扁平 requestTools,dynamic 下同一份 schema 走
   * GetDynamicTools 的结果进对话历史 —— 若按性质划分,切模式时数字会莫名跳动,
   * 也就没法回答"我装的 MCP 到底吃了多少 context"这个真正有决策价值的问题。
   */
  mcpToolNames: Set<string>
}): BreakdownCategory[] {
  const tracker = new ContextTokenTracker()

  const toolsText = extractXmlSection(params.systemContent, 'tools')
  // <dynamic_tools> 取代了旧的 <mcp_file_system> 段 (Cursor 3.15.6)。
  // 两个 tag 都抓: 旧段虽已不再生成,但历史会话的 system prompt 里可能还有,
  // 漏掉会让那部分 token 被错记进 system_prompt。
  const dynamicToolsText = extractXmlSection(params.systemContent, 'dynamic_tools')
  const mcpFileSystemText = extractXmlSection(params.systemContent, 'mcp_file_system')
  const systemPromptText = params.systemContent
    .replace(toolsText, '')
    .replace(dynamicToolsText, '')
    .replace(mcpFileSystemText, '')
  const { sanitizedTools, subagentDefinitionsText } = splitSubagentDefinitionsFromTools(params.requestTools)
  // legacy 模式下 MCP 工具混在扁平 requestTools 里,按名字挑出来归 mcp,
  // 与 dynamic 模式的 discovery 结果同一口径
  const builtinToolSchemas = sanitizedTools.filter(t => !params.mcpToolNames.has(t.name))
  const mcpToolSchemas = sanitizedTools.filter(t => params.mcpToolNames.has(t.name))
  tracker.addText('system_prompt', systemPromptText)
  tracker.addText('tools', joinSections(toolsText, toolSchemaText(builtinToolSchemas)))

  const rulesText = extractXmlSection(params.preambleUserContent, 'rules')
  const manuallyAttachedRulesText = extractXmlSection(params.preambleUserContent, 'cursor_rules_context')
  const cloudInstructionsText = extractXmlSection(params.preambleUserContent, 'cloud_instructions')
  const availableSkillsText = extractXmlSection(params.preambleUserContent, 'agent_skills')
  const attachedSkillsText = extractXmlSection(params.preambleUserContent, 'manually_attached_skills')
  const mcpInstructionsText = extractXmlSection(params.preambleUserContent, 'mcp_instructions')
  const attachedSubagentsText = extractXmlSection(params.preambleUserContent, 'attached_subagents')

  tracker.addText('rules', joinSections(rulesText, manuallyAttachedRulesText, cloudInstructionsText))
  tracker.addText('skills', joinSections(availableSkillsText, attachedSkillsText))
  // dynamic_tools 段 / mcp_instructions 段 / legacy 扁平表里的 MCP schema
  // (dynamic 模式下 discovery 结果的那部分在下面按 tool_result 归入同一分类)
  tracker.addText('mcp', joinSections(dynamicToolsText, mcpFileSystemText, mcpInstructionsText, toolSchemaText(mcpToolSchemas)))
  tracker.addText('subagents', joinSections(subagentDefinitionsText, attachedSubagentsText))

  const knownPreambleSections = [
    rulesText,
    manuallyAttachedRulesText,
    cloudInstructionsText,
    availableSkillsText,
    attachedSkillsText,
    mcpInstructionsText,
    attachedSubagentsText,
  ].filter(Boolean)
  let conversationText = params.preambleUserContent
  for (const section of knownPreambleSections)
    conversationText = conversationText.replace(section, '')

  // tool 消息在下面按工具名单独归类,这里排除以免重复计数
  // (OpenAI/Gemini 形态 content 是 string,会被 extractPlainTextContent 直接返回)
  const requestConversationText = params.requestMessages
    .filter(message => message.role !== 'tool')
    .map(message => extractPlainTextContent(message))
    .filter(text => text && text !== params.systemContent && text !== params.preambleUserContent)
    .join('\n')

  // ── 工具结果 ──
  //
  // extractPlainTextContent 只保留 text/thinking block,Anthropic 形态下
  // tool_result 是 content block,整块被过滤掉 —— 实测 6000 字符的结果
  // 计出来是 0。OpenAI 形态(role:'tool' + string content)则正常计入,
  // 两家口径不一致。这里统一按 block/字符串两种形态抽取。
  //
  // GetDynamicTools 的结果本质是 MCP 工具 schema(单个 40 工具的 namespace
  // 查询约 6k tokens),归到 mcp 分类才和 legacy 模式下"工具定义"的口径可比;
  // 留在 conversation 里会让人误以为是对话在膨胀。
  const toolResultTexts: string[] = []
  const mcpDiscoveryTexts: string[] = []
  const cursorDiscoveryTexts: string[] = []
  for (const message of params.requestMessages) {
    for (const { toolName, text } of extractToolResultTexts(message)) {
      if (!text)
        continue
      if (toolName === 'GetDynamicTools') {
        if (isCursorOnlyDynamicDiscovery(text))
          cursorDiscoveryTexts.push(text)
        else
          mcpDiscoveryTexts.push(text)
      }
      else
        toolResultTexts.push(text)
    }
  }

  tracker.addText('tools', joinSections(...cursorDiscoveryTexts))
  tracker.addText('mcp', joinSections(...mcpDiscoveryTexts))
  tracker.addText('conversation', joinSections(conversationText, requestConversationText, ...toolResultTexts))
  return tracker.toBreakdownCategories()
}

/**
 * 抽取消息里的工具结果文本,连同工具名。
 *
 * 两种 provider 形态:
 *   Anthropic — tool_result 作为 user 消息的 content block
 *   OpenAI/Gemini — role:'tool' 消息,content 直接是字符串
 */
function isCursorOnlyDynamicDiscovery(text: string): boolean {
  try {
    const result = JSON.parse(text) as Record<string, unknown>
    if (result.namespace === 'cursor')
      return true
    const namespaces = Array.isArray(result.namespaces) ? result.namespaces as Array<Record<string, unknown>> : []
    if (namespaces.length > 0)
      return namespaces.every(namespace => namespace.namespace === 'cursor')
    const matches = Array.isArray(result.matches) ? result.matches as Array<Record<string, unknown>> : []
    return matches.length > 0 && matches.every(match => match.namespace === 'cursor')
  }
  catch {
    return false
  }
}

function extractToolResultTexts(message: LLMMessage): Array<{ toolName: string, text: string }> {
  if (typeof message.content === 'string') {
    return message.role === 'tool'
      ? [{ toolName: message.toolName ?? '', text: message.content }]
      : []
  }
  return message.content
    .filter((block): block is LLMToolResultBlock => block.type === 'tool_result')
    .map(block => ({ toolName: block.toolName ?? '', text: block.content }))
}
