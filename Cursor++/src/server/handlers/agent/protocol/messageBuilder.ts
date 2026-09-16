import type { ProviderPromptProfile } from '../../llm/promptProfile'
import type { LLMContentBlock, LLMMessage } from '../../llm/types'
import type { ParsedAgentSkill, ParsedRunRequest } from './types'
import { resolvePromptProfile } from '../../llm/promptProfile'
import { isAutoAttachedRule, ruleWorkspaceRoot } from '../contextCatalog'
import { buildDynamicToolCatalogEntries, buildDynamicToolsSection } from '../dynamicTools'
import { buildAnthropicSystemPrompt } from './prompts/anthropicSystem'
import { buildComposerFallbackSystemPrompt } from './prompts/composerFallback'
import { buildModeReminder } from './prompts/modeReminders'
import { buildOpenAISystemPrompt } from './prompts/openaiSystem'
import { escapeXml } from './shared'

const SKILL_CATALOG_BUDGET_PERCENT = 0.02
const DEFAULT_AGENT_TOKEN_LIMIT = 200_000
const MAX_SKILL_DESCRIPTION_CHARS = 480
const MIN_SKILL_DESCRIPTION_CHARS = 24
const MAX_MANUALLY_ATTACHED_SKILL_CHARS = 100_000
const PROTECTED_SKILL_NAMES = new Set(['canvas', 'env-setup'])

function estimateTokens(text: string): number {
  return Math.round(text.length / 4)
}

function skillName(fullPath: string): string {
  const segments = fullPath.replace(/\\/g, '/').split('/').filter(Boolean)
  const skillIndex = segments.lastIndexOf('SKILL.md')
  return skillIndex > 0 ? segments[skillIndex - 1] : segments.at(-1) ?? 'Skill'
}

function skillDirectory(fullPath: string): string {
  const normalized = fullPath.replace(/\\/g, '/')
  const markers = [
    '/.cursor/skills/',
    '/.cursor/skills-cursor/',
    '/.agents/skills/',
    '/.claude/skills/',
    '/.codex/skills/',
    '/.claude/plugins/',
  ]
  for (const marker of markers) {
    const index = normalized.indexOf(marker)
    if (index >= 0)
      return normalized.slice(0, index + marker.length - 1)
  }
  const pluginCache = normalized.indexOf('/.cursor/plugins/cache/')
  if (pluginCache >= 0) {
    const skills = normalized.indexOf('/skills/', pluginCache)
    if (skills >= 0)
      return normalized.slice(0, skills + '/skills'.length)
  }
  const slash = normalized.lastIndexOf('/')
  return slash >= 0 ? normalized.slice(0, slash) : normalized
}

function shortenSkillDescription(description: string, maxLength: number): string {
  const normalized = description.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength)
    return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function renderAgentSkillsSection(
  skills: Array<{ fullPath: string, description?: string }>,
  omitted?: { count: number, directories: string[] },
): string {
  const entries = skills.map((skill) => {
    const description = skill.description ? escapeXml(skill.description) : ''
    return `<agent_skill fullPath="${escapeXml(skill.fullPath)}">${description}</agent_skill>`
  })
  const hasOmittedSkills = !!omitted && omitted.count > 0
  const omittedNotice = hasOmittedSkills
    ? `\nAdditional skills omitted from this initial list (${omitted.count}). Directories containing omitted skills: ${omitted.directories.join(', ')}.`
    : ''
  const scopeGuidance = hasOmittedSkills
    ? 'Use the skills listed below. If a later task specifically requires discovering more skills, additional skills may exist in the directories shown in this section.'
    : 'Only use skills listed below.'
  return `<agent_skills>
Skills the agent can use. Use the Read tool with the provided absolute path to fetch full contents.
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. To use a skill, read the skill file at the provided absolute path using the Read tool, then follow the instructions within. When a skill is relevant, read and follow it IMMEDIATELY as your first action. ${scopeGuidance}

${entries.join('\n')}${omittedNotice}
</agent_skills>`
}

/** 对齐 3.17 rX(): 2% token 预算，依次缩描述、去描述、最后省略目录项。 */
export function buildAgentSkillsSection(
  allSkills: ParsedAgentSkill[],
  agentTokenLimit?: number,
): string | null {
  const skills = allSkills
    .filter(skill => !skill.disableModelInvocation && !skill.parseError && !!skill.fullPath)
  if (skills.length === 0)
    return null
  const budget = Math.floor((agentTokenLimit && agentTokenLimit > 0 ? agentTokenLimit : DEFAULT_AGENT_TOKEN_LIMIT)
    * SKILL_CATALOG_BUDGET_PERCENT)
  const render = (items: Array<{ fullPath: string, description?: string }>, omitted?: { count: number, directories: string[] }) =>
    renderAgentSkillsSection(items, omitted)
  const original = skills.map(skill => ({ fullPath: skill.fullPath, description: skill.description || undefined }))
  const originalSection = render(original)
  if (estimateTokens(originalSection) <= budget)
    return originalSection

  const isProtected = (skill: { fullPath: string }) => PROTECTED_SKILL_NAMES.has(skillName(skill.fullPath))
  const longestDescription = original.reduce((maximum, skill) => isProtected(skill)
    ? maximum
    : Math.max(maximum, skill.description?.length ?? 0), 0)
  if (longestDescription > 80) {
    let best: string | undefined
    let low = MIN_SKILL_DESCRIPTION_CHARS
    let high = Math.min(longestDescription - 1, MAX_SKILL_DESCRIPTION_CHARS)
    while (low <= high) {
      const candidateLength = Math.floor((low + high) / 2)
      const candidate = original.map(skill => isProtected(skill)
        ? skill
        : { ...skill, description: shortenSkillDescription(skill.description ?? '', candidateLength) || undefined })
      const section = render(candidate)
      if (estimateTokens(section) <= budget) {
        best = section
        low = candidateLength + 1
      }
      else {
        high = candidateLength - 1
      }
    }
    if (best)
      return best
  }

  const pathOnly = original.map(skill => isProtected(skill) ? skill : { fullPath: skill.fullPath })
  const pathOnlySection = render(pathOnly)
  if (estimateTokens(pathOnlySection) <= budget)
    return pathOnlySection

  const optionalIndices = original.flatMap((skill, index) => isProtected(skill) ? [] : [index])
  for (let retainedOptional = optionalIndices.length; retainedOptional >= 0; retainedOptional--) {
    const retained = new Set(optionalIndices.slice(0, retainedOptional))
    const listed = pathOnly.filter((skill, index) => isProtected(skill) || retained.has(index))
    const omittedSkills = original.filter((skill, index) => !isProtected(skill) && !retained.has(index))
    const directories = [...new Set(omittedSkills.map(skill => skillDirectory(skill.fullPath)))].slice(0, 5)
    const section = render(listed, { count: omittedSkills.length, directories })
    if (estimateTokens(section) <= budget || retainedOptional === 0)
      return section
  }
  return pathOnlySection
}

/**
 * 从 ParsedRunRequest 构造官方风格的首轮 messages 数组。
 *
 * 目前按官方抓包对齐为三段:
 *   1) system
 *   2) preamble user (<user_info>/<agent_transcripts>/<rules>/<agent_skills>)
 *   3) current-turn user (<user_query>)
 */
export function buildMessages(
  parsed: ParsedRunRequest,
  promptProfile: ProviderPromptProfile = resolvePromptProfile(parsed.modelId),
): [LLMMessage, LLMMessage, LLMMessage] {
  const userQueryText = buildCurrentUserTurn(parsed)

  // 当用户附带图片时,构建 LLMContentBlock[] 而非纯文本
  let currentUserContent: string | LLMContentBlock[]
  if (parsed.selectedImages.length > 0) {
    const imageBlocks: LLMContentBlock[] = parsed.selectedImages.map(img => ({
      type: 'image' as const,
      mimeType: img.mimeType,
      data: img.data,
    }))
    currentUserContent = [...imageBlocks, { type: 'text' as const, text: userQueryText }]
  }
  else {
    currentUserContent = userQueryText
  }

  return [
    { role: 'system', content: buildSystemPrompt(parsed, promptProfile) },
    { role: 'user', content: buildPreambleUserMessage(parsed) },
    { role: 'user', content: currentUserContent },
  ]
}

/**
 * 组装 system prompt
 *
 * 按 promptProfile 分发到三套模板:
 * - composer-fallback  → Composer 轻量 prompt
 * - openai-chat / openai-responses → GPT 专用架构
 * - 其他 (Anthropic / Gemini) → 主模板
 */
function buildSystemPrompt(parsed: ParsedRunRequest, promptProfile: ProviderPromptProfile): string {
  let base: string
  if (promptProfile.systemPromptStyle === 'composer-fallback') {
    base = buildComposerFallbackSystemPrompt()
    const dynamicCatalog = buildDynamicToolCatalogEntries(parsed)
    if (dynamicCatalog.length > 0) {
      base += `\n\n${buildDynamicToolsSection(dynamicCatalog, parsed.supportsMcpAuth === true)}`
    }
  }
  else if (promptProfile.provider === 'openai-chat' || promptProfile.provider === 'openai-responses') {
    base = buildOpenAISystemPrompt(parsed, promptProfile)
  }
  else {
    base = buildAnthropicSystemPrompt(parsed, promptProfile)
  }

  const mode = parsed.mode.replace('AGENT_MODE_', '').toLowerCase()
  if (mode === 'plan') {
    base += `\n\n<plan_mode_guardrails>\n- In plan mode, only edit markdown files.\n- If the user is refining the plan, stay in plan mode and keep edits in markdown.\n- If the user explicitly asks you to build, implement, or write the code now, switch to agent mode before making non-markdown edits.\n</plan_mode_guardrails>`
  }

  return base
}

/**
 * 组装 preamble user message。
 *
 * 承载官方前置 user scaffold。块顺序:
 *   <user_info>
 *   <agent_transcripts>
 *   <ide_state>              ← Step 2
 *   <rules>
 *   <agent_skills>           精简 Skill catalog（2% token budget）
 *   <manually_attached_skills> 用户手动 @ 的 Skill 完整正文
 *   <attached_docs>          ← Step 2
 *   <cursor_commands>        ← Step 2 用户触发的 /command
 *   <mcp_instructions>       ← Step 2
 *   <extra_context>          ← Step 2 (blob 分支待 Step 4)
 *   <code_selections>        ← 用户框选代码 (Past Chats 除外) — selectedContext 通道
 *   <past_chats>             ← @ 历史对话 (拆自 codeSelections) — selectedContext 通道
 *   <terminal_selections>    ← 用户框选终端输出 — selectedContext 通道
 *   <attached_files>         ← @ 整个文件 — requestContext.file_contents 通道 (map)
 *   <attached_folders>       ← @ Folder 目录树 — requestContext.project_layouts 通道
 *   <external_links>         ← @ 链接/PDF — selectedContext 通道
 *   <attached_subagents>     ← @ subagent — selectedContext 通道
 *   <attached_browsers>      ← @ 浏览器页面 — selectedContext 通道
 *   <recent_agents>          ← 最近对话摘要 — selectedContext 通道
 *
 * 已刻意跳过的 git 字段 (gitDiff / gitDiffFromBranchToMain / gitCommits /
 *   gitPrDiffSelections / selectedPullRequests): 见 types.ts 里的说明,
 *   改由 LLM 主动用 Shell tool 跑 git 命令获取。
 */
function buildPreambleUserMessage(parsed: ParsedRunRequest): string {
  const parts: string[] = []

  // ── <user_info> ──
  const infoLines: string[] = []
  if (parsed.env.osVersion)
    infoLines.push(`OS Version: ${parsed.env.osVersion}`)
  if (parsed.env.shell)
    infoLines.push(`Shell: ${parsed.env.shell}`)
  if (parsed.env.workspacePaths?.length)
    infoLines.push(`Workspace Path: ${parsed.env.workspacePaths[0]}`)
  infoLines.push(`Is directory a git repo: ${parsed.isGitRepo ? 'Yes' : 'No'}`)
  const now = new Date()
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  infoLines.push(`Today's date: ${dayNames[now.getDay()]} ${monthNames[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`)
  if (parsed.env.terminalsFolder)
    infoLines.push(`Terminals folder: ${parsed.env.terminalsFolder}`)

  parts.push(`<user_info>\n${infoLines.join('\n\n')}\n</user_info>`)

  // ── <agent_transcripts> ──
  if (parsed.env.agentTranscriptsFolder) {
    parts.push(`<agent_transcripts>
Agent transcripts (past chats) live in ${parsed.env.agentTranscriptsFolder}. They have names like <uuid>.jsonl, cite them to the user as [<title for chat <=6 words>](<uuid excluding .jsonl>). NEVER cite subagent transcripts/IDs; you can only cite parent uuids. Don't discuss the folder structure.
</agent_transcripts>`)
  }

  // ── <ide_state> ── (来自 selectedContext.invocation_context.ide_state)
  const ideSection = buildIdeStateSection(parsed)
  if (ideSection)
    parts.push(ideSection)

  // ── <rules> — always eager / agentFetched lazy / fileGlobbed 随 Read 注入 ──
  const requestableRules = parsed.projectRules.filter(rule => !isAutoAttachedRule(rule, parsed.env.workspacePaths ?? []))
  if (parsed.userRules.length > 0 || parsed.alwaysRules.length > 0 || requestableRules.length > 0) {
    let rulesSection = `<rules>
The rules section has a number of possible rules/memories/context that you should consider. In each subsection, we provide instructions about what information the subsection contains and how you should consider/follow the contents of the subsection.\n\n`

    if (parsed.alwaysRules.length > 0) {
      rulesSection += `<always_applied_workspace_rules description="These are workspace-level rules that the agent must always follow.">\n`
      for (const rule of parsed.alwaysRules) {
        const globNote = rule.globs.length > 0
          ? `, glob pattern(s) for applicable files: ${rule.globs.join(', ')}`
          : ''
        rulesSection += `<always_applied_workspace_rule name="${escapeXml(rule.fullPath)}">${rule.content}${globNote}</always_applied_workspace_rule>\n`
      }
      rulesSection += `</always_applied_workspace_rules>\n`
    }

    if (requestableRules.length > 0) {
      rulesSection += `<agent_requestable_workspace_rules description="These are workspace-level rules that the agent should follow. Use the Read tool to fetch full contents from the provided absolute path. Read each rule file using the Read tool when it is relevant to your work.">\n`
      for (const rule of requestableRules) {
        const description = rule.description
          || (rule.kind === 'global'
            ? `Applicable for all files within ${ruleWorkspaceRoot(rule.fullPath)}`
            : rule.globs.length > 0 ? `Glob pattern(s): ${rule.globs.join(', ')}` : '')
        rulesSection += `<agent_requestable_workspace_rule fullPath="${escapeXml(rule.fullPath)}">${escapeXml(description)}</agent_requestable_workspace_rule>\n`
      }
      rulesSection += `</agent_requestable_workspace_rules>\n`
    }

    if (parsed.userRules.length > 0) {
      rulesSection += `<user_rules description="These are rules set by the user that you should follow if appropriate.">\n`
      for (const rule of parsed.userRules)
        rulesSection += `<user_rule>${rule}</user_rule>\n`
      rulesSection += `</user_rules>\n`
    }

    rulesSection += `</rules>`
    parts.push(rulesSection)
  }

  if (parsed.cloudRule?.trim()) {
    parts.push(`<cloud_instructions description="Instructions pulled from AGENTS.md">
AGENTS.md contents:

${parsed.cloudRule.trim()}
</cloud_instructions>`)
  }

  // ── <agent_skills> — 官方 2% catalog budget，正文由 Read 按需获取 ──
  const skillsSection = buildAgentSkillsSection(parsed.agentSkills, parsed.contextTokenLimit)
  if (skillsSection)
    parts.push(skillsSection)

  // ── 手动 @ Skill：完整 SKILL.md 正文直接内联，不要求再次 Read ──
  if (parsed.selectedSkills.length > 0) {
    const selected = parsed.selectedSkills.filter(skill => skill.content.trim().length > 0)
    if (selected.length > 0) {
      const body = selected.map(skill => `Skill Name: ${skillName(skill.fullPath)}
Path: ${skill.fullPath}
SKILL.md content:
${skill.content.trim().slice(0, MAX_MANUALLY_ATTACHED_SKILL_CHARS)}`).join('\n\n---\n\n')
      parts.push(`<manually_attached_skills>
The user has manually attached the following skills to their message.
These skills contain specific instructions or workflows that the user wants you to follow for this request.
Only read the files if needed, the full skill content is inlined here.

${body}
</manually_attached_skills>`)
    }
  }

  if (parsed.selectedCursorRules.length > 0) {
    const body = parsed.selectedCursorRules.map(rule => `Rule Name: ${rule.fullPath.split(/[\\/]/).pop()?.replace(/\.mdc$/i, '') || 'Cursor Rule'}
Description: ${rule.content.slice(0, MAX_MANUALLY_ATTACHED_SKILL_CHARS)}`).join('\n\n')
    parts.push(`<cursor_rules_context>
Cursor Rules are extra documentation provided by the user to help the AI understand the codebase.
Use them if they seem useful to the users most recent query, but do not use them if they seem unrelated.

${body}
</cursor_rules_context>`)
  }

  // ── <attached_docs> ── (用户 @ 的 @Docs 引用,只含 docId + name)
  if (parsed.documentations.length > 0) {
    let docsSection = `<attached_docs description="Documentation references the user attached. Fetch their content with the appropriate doc tool before relying on them.">\n`
    for (const doc of parsed.documentations) {
      docsSection += `<attached_doc docId="${escapeXml(doc.docId)}" name="${escapeXml(doc.name)}" />\n`
    }
    docsSection += `</attached_docs>`
    parts.push(docsSection)
  }

  // ── <cursor_commands> ── (用户触发的 /command 定义)
  if (parsed.cursorCommands.length > 0) {
    let cmdSection = `<cursor_commands description="Commands the user invoked via /<name>. Follow each command's content as an instruction for this turn.">\n`
    for (const cmd of parsed.cursorCommands) {
      cmdSection += `<cursor_command name="${escapeXml(cmd.name)}">${escapeXml(cmd.content)}</cursor_command>\n`
    }
    cmdSection += `</cursor_commands>`
    parts.push(cmdSection)
  }

  // ── <mcp_instructions> ── (每个 MCP server 的 use instructions)
  // 合并 requestContext.mcp_instructions 与 mcp_file_system_options.mcpDescriptors.serverUseInstructions,
  // 按 serverName 去重,前者优先。
  const mcpInstrMap = new Map<string, string>()
  for (const ins of parsed.mcpInstructions) {
    if (ins.serverName && ins.instructions)
      mcpInstrMap.set(ins.serverName, ins.instructions)
  }
  for (const srv of parsed.mcpServers) {
    if (srv.serverName && srv.serverUseInstructions && !mcpInstrMap.has(srv.serverName))
      mcpInstrMap.set(srv.serverName, srv.serverUseInstructions)
  }
  if (mcpInstrMap.size > 0) {
    let mcpSection = `<mcp_instructions description="Usage notes provided by the MCP servers connected to this workspace. Follow them when calling the corresponding tools.">\n`
    for (const [serverName, instructions] of mcpInstrMap) {
      mcpSection += `<mcp_instruction server="${escapeXml(serverName)}">\n${escapeXml(instructions)}\n</mcp_instruction>\n`
    }
    mcpSection += `</mcp_instructions>`
    parts.push(mcpSection)
  }

  // ── <extra_context> ── (inline data 条目;blob 分支等 Step 4 通过 blob store 取回)
  const extraInlineEntries = parsed.extraContextEntries.filter(e => typeof e.data === 'string' && e.data.length > 0)
  const extraBlobCount = parsed.extraContextEntries.filter(e => e.blobId).length
  if (extraInlineEntries.length > 0 || extraBlobCount > 0) {
    let extraSection = `<extra_context description="Additional context the client attached alongside the user message.">\n`
    for (const entry of extraInlineEntries) {
      extraSection += `<extra_context_entry>${escapeXml(entry.data!)}</extra_context_entry>\n`
    }
    if (extraBlobCount > 0) {
      // 暂以占位的形式保留痕迹,真正取回数据待 Step 4
      extraSection += `<extra_context_pending blob_count="${extraBlobCount}" />\n`
    }
    extraSection += `</extra_context>`
    parts.push(extraSection)
  }

  // ── <code_selections> ── (编辑器框选 + ⌘+L 产生的代码片段)
  // Past Chats 不走 codeSelections 通道 (实测:Past Chats 是 @ agent-transcripts/*.jsonl 文件,
  // 走 requestContext.fileContents map,下方 <attached_files> 块里按 path 识别拆分)
  if (parsed.codeSelections.length > 0) {
    let section = `<code_selections description="Code the user framed as relevant to this request. Treat each selection as the exact region the user wants you to focus on.">\n`
    for (const sel of parsed.codeSelections) {
      const attrs = [`path="${escapeXml(sel.path)}"`]
      if (sel.relativePath)
        attrs.push(`relativePath="${escapeXml(sel.relativePath)}"`)
      if (sel.range) {
        // 注: proto 的 line/column 通常是 0-based,注入时 +1 换算为人类可读
        attrs.push(`lines="${sel.range.startLine + 1}-${sel.range.endLine + 1}"`)
      }
      section += `<code_selection ${attrs.join(' ')}>${escapeXml(sel.content)}</code_selection>\n`
    }
    section += `</code_selections>`
    parts.push(section)
  }

  // ── <terminal_selections> ── (用户框选的终端输出片段)
  if (parsed.terminalSelections.length > 0) {
    let section = `<terminal_selections description="Terminal output the user highlighted. The content is literal shell output; do not reinterpret as source code.">\n`
    for (const sel of parsed.terminalSelections) {
      const attrs: string[] = []
      if (sel.title)
        attrs.push(`title="${escapeXml(sel.title)}"`)
      if (sel.path)
        attrs.push(`path="${escapeXml(sel.path)}"`)
      if (sel.range)
        attrs.push(`lines="${sel.range.startLine + 1}-${sel.range.endLine + 1}"`)
      section += `<terminal_selection${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}>${escapeXml(sel.content)}</terminal_selection>\n`
    }
    section += `</terminal_selections>`
    parts.push(section)
  }

  // ── <attached_files> + <past_chats> ──
  // 来自 requestContext.file_contents (map<path,content>)。按 path 分流:
  //   - path 含 "agent-transcripts" 视为 Past Chat (Cursor 把 @ Past Chat 渲染为 @ transcript 文件)
  //   - 其他路径为正常 @ 文件
  // 拆成两个 XML 块让 LLM 区分"当前代码文件"和"历史对话记录"的语义。
  const fileEntries = Object.entries(parsed.fileContents).filter(([p, c]) => p && c)
  if (fileEntries.length > 0) {
    const pastChatEntries = fileEntries.filter(([p]) => p.includes('agent-transcripts'))
    const normalFileEntries = fileEntries.filter(([p]) => !p.includes('agent-transcripts'))

    if (normalFileEntries.length > 0) {
      // 不注入文件全文 — 只告知 LLM 用户引用了哪些文件,由 LLM 按需用 ReadFile 读取。
      // 官方 server 走 retrieval 索引服务做摘要,BYOK 简化为路径+大小提示。
      const inlineThreshold = 2000
      let section = `<attached_files description="Files the user referenced via @File. Read them with the ReadFile tool to see their contents.">\n`
      for (const [path, content] of normalFileEntries) {
        if (content.length <= inlineThreshold) {
          section += `<attached_file path="${escapeXml(path)}">${escapeXml(content)}</attached_file>\n`
        }
        else {
          const lines = content.split('\n').length
          section += `<attached_file path="${escapeXml(path)}" size="${content.length}" lines="${lines}">Use ReadFile to view this file.</attached_file>\n`
        }
      }
      section += `</attached_files>`
      parts.push(section)
    }

    if (pastChatEntries.length > 0) {
      let section = `<past_chats description="Prior agent transcripts (JSONL) the user attached. Reference them when the user asks about earlier conversations.">\n`
      for (const [path, content] of pastChatEntries)
        section += `<past_chat path="${escapeXml(path)}">${escapeXml(content)}</past_chat>\n`
      section += `</past_chats>`
      parts.push(section)
    }
  }

  // ── <attached_folders> ── (@ Folder — 来自 requestContext.project_layouts)
  // repeated LsDirectoryTreeNode,递归目录结构,JSON 化压入 XML 让 LLM 自行理解布局。
  // 避免 server 端手展开树 (会膨胀 token),LLM 对 JSON 树结构有较好理解能力。
  if (parsed.projectLayouts.length > 0) {
    let section = `<attached_folders description="Folders the user attached. Each node is a LsDirectoryTreeNode JSON — use Read / Glob to dive into specific files.">\n`
    for (const node of parsed.projectLayouts) {
      const path = typeof (node as { path?: unknown }).path === 'string' ? (node as { path: string }).path : ''
      const treeJson = JSON.stringify(node)
      section += `<attached_folder${path ? ` path="${escapeXml(path)}"` : ''}>${escapeXml(treeJson)}</attached_folder>\n`
    }
    section += `</attached_folders>`
    parts.push(section)
  }

  // ── <external_links> ── (用户 @ 的 URL/PDF;pdfContent 已是解析后的文本)
  if (parsed.externalLinks.length > 0) {
    let section = `<external_links description="External resources the user attached. Fetch or consult each as needed for this turn.">\n`
    for (const link of parsed.externalLinks) {
      const attrs = [`url="${escapeXml(link.url)}"`]
      if (link.filename)
        attrs.push(`filename="${escapeXml(link.filename)}"`)
      if (link.isPdf)
        attrs.push(`type="pdf"`)
      // PDF 已有正文时 inline 内容供 LLM 直接阅读;否则只留链接(LLM 可用 webFetch 取)
      const inner = link.isPdf && link.pdfContent ? escapeXml(link.pdfContent) : ''
      section += `<external_link ${attrs.join(' ')}>${inner}</external_link>\n`
    }
    section += `</external_links>`
    parts.push(section)
  }

  // ── <attached_subagents> ── (用户 @ 的 subagent;只有 name,具体能力注册表由 server 解析)
  if (parsed.selectedSubagents.length > 0) {
    let section = `<attached_subagents description="Subagents the user requested for this task. Consider delegating the appropriate work to them via the task tool.">\n`
    for (const sa of parsed.selectedSubagents)
      section += `<attached_subagent name="${escapeXml(sa.name)}" />\n`
    section += `</attached_subagents>`
    parts.push(section)
  }

  // ── <attached_browsers> ── (Cursor 浏览器集成中用户 @ 的页面)
  if (parsed.selectedBrowsers.length > 0) {
    let section = `<attached_browsers description="Browser pages the user attached. Use webFetch to read full content if relevant.">\n`
    for (const br of parsed.selectedBrowsers) {
      const attrs = [`url="${escapeXml(br.url)}"`]
      if (br.pageTitle)
        attrs.push(`title="${escapeXml(br.pageTitle)}"`)
      section += `<attached_browser ${attrs.join(' ')} />\n`
    }
    section += `</attached_browsers>`
    parts.push(section)
  }

  // ── <recent_agents> ── (最近对话列表,用户可能想引用其中某个历史对话;
  // 只含元数据, 如需正文 LLM 应用 Read tool 读 agentTranscriptsFolder/<uuid>.jsonl)
  if (parsed.recentAgentsContext.length > 0) {
    let section = `<recent_agents description="Recent prior agent conversations in this workspace. Read the transcript file when the user references one.">\n`
    for (const agent of parsed.recentAgentsContext) {
      const attrs = [`name="${escapeXml(agent.name)}"`, `path="${escapeXml(agent.path)}"`]
      const inner = agent.overview ? escapeXml(agent.overview) : ''
      section += `<recent_agent ${attrs.join(' ')}>${inner}</recent_agent>\n`
    }
    section += `</recent_agents>`
    parts.push(section)
  }

  return parts.join('\n\n')
}

/** 组装 <ide_state> XML 块;当 ideState 为空或无文件时返回 null */
function buildIdeStateSection(parsed: ParsedRunRequest): string | null {
  const ide = parsed.ideState
  if (!ide)
    return null
  if (ide.visibleFiles.length === 0 && ide.recentlyViewedFiles.length === 0)
    return null

  let section = `<ide_state description="A snapshot of the user's IDE at the moment this message was sent. The first visible file is typically what they are looking at right now.">\n`

  if (ide.visibleFiles.length > 0) {
    section += `<visible_files>\n`
    for (const f of ide.visibleFiles) {
      const attrs = [`path="${escapeXml(f.path)}"`]
      if (f.relativePath)
        attrs.push(`relativePath="${escapeXml(f.relativePath)}"`)
      if (f.totalLines > 0)
        attrs.push(`totalLines="${f.totalLines}"`)
      if (f.cursorLine !== undefined)
        attrs.push(`cursorLine="${f.cursorLine}"`)
      if (f.activeCommand)
        attrs.push(`activeCommand="${escapeXml(f.activeCommand)}"`)
      const inner = f.cursorText ? escapeXml(f.cursorText) : ''
      section += `<file ${attrs.join(' ')}>${inner}</file>\n`
    }
    section += `</visible_files>\n`
  }

  if (ide.recentlyViewedFiles.length > 0) {
    section += `<recently_viewed_files>\n`
    for (const f of ide.recentlyViewedFiles) {
      const attrs = [`path="${escapeXml(f.path)}"`]
      if (f.relativePath)
        attrs.push(`relativePath="${escapeXml(f.relativePath)}"`)
      if (f.totalLines > 0)
        attrs.push(`totalLines="${f.totalLines}"`)
      section += `<file ${attrs.join(' ')} />\n`
    }
    section += `</recently_viewed_files>\n`
  }

  section += `</ide_state>`
  return section
}

function buildCurrentUserTurn(parsed: ParsedRunRequest): string {
  const reminders = [buildModeReminder(parsed)]
  if (parsed.dynamicToolTransitionReminder) {
    reminders.push(`<system_reminder>
Dynamic tools have been enabled for this conversation. Some tools that appeared as direct tool calls in earlier turns must now be called through CallDynamicTool. Discover tool schemas with GetDynamicTools.
</system_reminder>`)
  }
  const query = `<user_query>\n${parsed.userText}\n</user_query>`
  const prefix = reminders.filter(Boolean).join('\n')
  return prefix ? `${prefix}\n${query}` : query
}
