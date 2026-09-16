import type Anthropic from '@anthropic-ai/sdk'
import type { Content, Part, Tool } from '@google/genai'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions'
import type { ProviderType } from '../../data/defaults'
import type { SemanticTurn } from './semanticConversation'
import type { StoredMessage } from './storedTranscript'
import type { LLMContentBlock, LLMMessage, LLMTool } from './types'
import { normalizeStoredTranscript as normalizeSemanticTranscript } from './semanticConversation'

export interface ProviderConversationCodec {
  readonly provider: ProviderType
  readonly name: string
  normalizeMessages: (messages: LLMMessage[]) => LLMMessage[]
  normalizeStoredTranscript: (messages: StoredMessage[]) => SemanticTurn[]
  normalizeSemanticTurns: (turns: SemanticTurn[]) => SemanticTurn[]
}

abstract class BaseConversationCodec implements ProviderConversationCodec {
  constructor(
    readonly provider: ProviderType,
    readonly name: string,
  ) {}

  normalizeMessages(messages: LLMMessage[]): LLMMessage[] {
    return messages
      .map(message => this.normalizeMessage(message))
      .filter((message): message is LLMMessage => message !== null)
  }

  normalizeStoredTranscript(messages: StoredMessage[]): SemanticTurn[] {
    return this.normalizeSemanticTurns(normalizeSemanticTranscript(messages))
  }

  normalizeSemanticTurns(turns: SemanticTurn[]): SemanticTurn[] {
    return turns
  }

  protected abstract normalizeMessage(message: LLMMessage): LLMMessage | null
}

class AnthropicConversationCodec extends BaseConversationCodec {
  constructor() {
    super('anthropic', 'anthropic')
  }

  protected normalizeMessage(message: LLMMessage): LLMMessage | null {
    if (typeof message.content === 'string')
      return message
    const content = message.content.filter(block => (
      block.type === 'text'
      || block.type === 'image'
      || block.type === 'thinking'
      || block.type === 'tool_use'
      || block.type === 'tool_result'
    ))
    return {
      ...message,
      content,
    }
  }
}

class OpenAIChatConversationCodec extends BaseConversationCodec {
  constructor() {
    super('openai-chat', 'openai-chat')
  }

  normalizeSemanticTurns(turns: SemanticTurn[]): SemanticTurn[] {
    const normalized: SemanticTurn[] = []
    for (const turn of turns) {
      if (turn.kind === 'assistant') {
        normalized.push({
          ...turn,
          reasoningBlocks: [],
        })
        continue
      }
      if (turn.kind === 'tool_results' && turn.results.length > 1) {
        for (const result of turn.results) {
          normalized.push({
            kind: 'tool_results',
            results: [result],
          })
        }
        continue
      }
      normalized.push(turn)
    }
    return normalized
  }

  protected normalizeMessage(message: LLMMessage): LLMMessage | null {
    if (message.role === 'system') {
      return {
        ...message,
        content: collapseTextContent(message.content),
      }
    }

    if (message.role === 'tool') {
      return {
        ...message,
        content: collapseToolContent(message.content),
      }
    }

    if (typeof message.content === 'string')
      return message

    if (message.role === 'assistant') {
      const textBlocks = message.content.filter(block => block.type === 'text')
      const toolUses = message.content.filter((block): block is Extract<LLMContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
      if (textBlocks.length === 0 && toolUses.length === 0)
        return null
      return {
        ...message,
        content: [
          ...textBlocks,
          ...toolUses,
        ],
      }
    }

    // user 消息：含图片时保留 image + text blocks，否则合并为纯文本
    const hasImages = message.content.some(block => block.type === 'image')
    if (hasImages) {
      return {
        ...message,
        content: message.content.filter(block => block.type === 'text' || block.type === 'image'),
      }
    }

    return {
      ...message,
      content: collapseTextContent(message.content),
    }
  }
}

class GeminiConversationCodec extends BaseConversationCodec {
  constructor() {
    super('gemini', 'gemini-native')
  }

  normalizeSemanticTurns(turns: SemanticTurn[]): SemanticTurn[] {
    const normalized: SemanticTurn[] = []
    for (const turn of turns) {
      if (turn.kind === 'tool_results' && turn.results.length > 1) {
        for (const result of turn.results) {
          normalized.push({
            kind: 'tool_results',
            results: [result],
          })
        }
        continue
      }
      normalized.push(turn)
    }
    return normalized
  }

  protected normalizeMessage(message: LLMMessage): LLMMessage | null {
    if (message.role === 'system') {
      return {
        ...message,
        content: collapseTextContent(message.content),
      }
    }

    if (message.role === 'tool') {
      return {
        ...message,
        content: collapseToolContent(message.content),
      }
    }

    if (typeof message.content === 'string')
      return message

    if (message.role === 'assistant') {
      const content = message.content.filter(block => (
        block.type === 'text'
        || block.type === 'thinking'
        || block.type === 'tool_use'
        || block.type === 'tool_result'
      ))
      if (content.length === 0)
        return null
      return {
        ...message,
        content,
      }
    }

    // user 消息：保留 image + text/thinking blocks
    return {
      ...message,
      content: message.content.filter(block => block.type === 'text' || block.type === 'thinking' || block.type === 'image'),
    }
  }
}

function collapseTextContent(content: string | LLMContentBlock[]): string {
  if (typeof content === 'string')
    return content
  return content
    .filter((block): block is Extract<LLMContentBlock, { type: 'text' | 'thinking' }> => block.type === 'text' || block.type === 'thinking')
    .map(block => block.text)
    .join('')
}

function collapseToolContent(content: string | LLMContentBlock[]): string {
  if (typeof content === 'string')
    return content
  return content
    .filter((block): block is Extract<LLMContentBlock, { type: 'tool_result' | 'text' }> => block.type === 'tool_result' || block.type === 'text')
    .map(block => block.type === 'tool_result' ? block.content : block.text)
    .join('\n')
}

export function encodeAnthropicRequestMessages(messages: LLMMessage[]): {
  system: Anthropic.MessageCreateParamsStreaming['system'] | undefined
  messages: Anthropic.MessageParam[]
} {
  const systemMessage = messages.find(m => m.role === 'system')
  return {
    system: systemMessage ? toAnthropicSystem(systemMessage.content) : undefined,
    messages: messages
      .filter(m => m.role !== 'system')
      .map(m => toAnthropicMessage(m)),
  }
}

/**
 * 规范化工具 schema — 确保顶层是 {type: "object"}
 *
 * MCP 工具的 inputSchema 可能不标准:
 *   - Zod union → {anyOf: [{type:"object",...}, ...]} 顶层无 type
 *   - 空 schema → {} 或 null
 *
 * Anthropic 原生 API 宽容, 但 DeepSeek 等兼容 API 严格要求 type:"object"。
 * 此函数在进入任何 provider 编码前统一处理。
 */
function normalizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== 'object')
    return { type: 'object', properties: {} }

  if (schema.type === 'object')
    return schema

  // anyOf / oneOf: 合并所有子 schema 的 properties (都设为可选)
  const branches = (schema.anyOf ?? schema.oneOf) as Record<string, unknown>[] | undefined
  if (Array.isArray(branches) && branches.length > 0) {
    const merged: Record<string, unknown> = {}
    for (const branch of branches) {
      if (typeof branch === 'object' && branch?.properties) {
        Object.assign(merged, branch.properties)
      }
    }
    return { type: 'object', properties: merged }
  }

  // 其他情况: 补 type
  return { ...schema, type: 'object', properties: schema.properties ?? {} }
}

export function encodeAnthropicTools(tools: LLMTool[] | undefined): Anthropic.MessageCreateParamsStreaming['tools'] | undefined {
  if (!tools?.length)
    return undefined
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: normalizeToolSchema(tool.inputSchema) as Anthropic.Tool['input_schema'],
  }))
}

function toAnthropicSystem(content: LLMMessage['content']): Anthropic.MessageCreateParamsStreaming['system'] {
  if (typeof content === 'string')
    return content
  return content
    .filter((block): block is Extract<LLMContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => ({ type: 'text' as const, text: block.text }))
}

function toAnthropicMessage(msg: LLMMessage): Anthropic.MessageParam {
  if (msg.role === 'tool') {
    return {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: msg.toolCallId ?? '',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        ...(typeof msg.isError === 'boolean' ? { is_error: msg.isError } : {}),
      }],
    }
  }

  if (typeof msg.content === 'string') {
    return { role: msg.role as 'user' | 'assistant', content: msg.content }
  }

  const blocks: Anthropic.ContentBlockParam[] = []
  for (const block of msg.content) {
    switch (block.type) {
      case 'text':
        blocks.push({ type: 'text', text: block.text })
        break
      case 'image':
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: block.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: block.data,
          },
        })
        break
      case 'tool_use':
        blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
        break
      case 'thinking':
        // 有 signature → 带签名回传（Anthropic Claude）
        // 无 signature 但有 text → 降级为 text
        // 无 signature + 空 text → 仍编码为 thinking（DeepSeek 要求空 reasoning_content 回传）
        // transformMessages 已对跨 model 做了降级，到此处的 thinking 块都是同 model 的
        if (block.signature) {
          blocks.push({ type: 'thinking', thinking: block.text, signature: block.signature } as any)
        }
        else {
          blocks.push({ type: 'thinking', thinking: block.text ?? '', signature: '' } as any)
        }
        break
      case 'tool_result':
        blocks.push({
          type: 'tool_result',
          tool_use_id: block.toolUseId,
          content: block.content,
          ...(typeof block.isError === 'boolean' ? { is_error: block.isError } : {}),
        })
        break
      default:
        break
    }
  }

  return { role: msg.role as 'user' | 'assistant', content: blocks }
}

export function encodeOpenAIRequestMessages(messages: LLMMessage[]): ChatCompletionMessageParam[] {
  return messages.map(message => toOpenAIMessage(message))
}

export function encodeOpenAITools(tools: LLMTool[] | undefined): ChatCompletionCreateParamsStreaming['tools'] | undefined {
  if (!tools?.length)
    return undefined
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: normalizeToolSchema(tool.inputSchema),
    },
  }))
}

function toOpenAIMessage(msg: LLMMessage): ChatCompletionMessageParam {
  if (msg.role === 'system') {
    return { role: 'system', content: typeof msg.content === 'string' ? msg.content : '' }
  }

  if (msg.role === 'tool') {
    const toolMessage: ChatCompletionToolMessageParam = {
      role: 'tool',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      tool_call_id: msg.toolCallId ?? '',
    }
    return toolMessage
  }

  if (typeof msg.content === 'string') {
    return { role: msg.role as 'user' | 'assistant', content: msg.content }
  }

  if (msg.role === 'assistant') {
    const textParts = msg.content
      .filter((block): block is Extract<LLMContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('')
    const toolUses = msg.content.filter((block): block is Extract<LLMContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')

    if (toolUses.length > 0) {
      const assistantMessage: ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: textParts || null,
        tool_calls: toolUses.map(block => ({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        } satisfies ChatCompletionMessageToolCall)),
      }
      return assistantMessage
    }

    return { role: 'assistant', content: textParts }
  }

  // user 消息：含图片时构建 content parts 数组
  const hasImages = msg.content.some(block => block.type === 'image')
  if (hasImages) {
    const parts: Array<{ type: 'text', text: string } | { type: 'image_url', image_url: { url: string, detail: 'high' } }> = []
    for (const block of msg.content) {
      if (block.type === 'image') {
        parts.push({
          type: 'image_url',
          image_url: {
            url: `data:${block.mimeType};base64,${block.data}`,
            detail: 'high',
          },
        })
      }
      else if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text })
      }
    }
    return { role: 'user', content: parts }
  }

  return {
    role: 'user',
    content: msg.content
      .filter((block): block is Extract<LLMContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join(''),
  }
}

export function encodeGeminiRequestMessages(messages: LLMMessage[]): {
  systemInstruction: string | undefined
  contents: Content[]
} {
  const systemMessage = messages.find(m => m.role === 'system')
  const rawContents = messages
    .filter(m => m.role !== 'system')
    .map(m => toGeminiContent(m))

  // Gemini 要求: model turn 含 N 个 functionCall → 紧接的 user turn 必须含恰好 N 个 functionResponse。
  // BYOK 上游(normalizeSemanticTurns)把多 tool_results 拆成独立 LLMMessage(Anthropic/OpenAI 需要),
  // 但 Gemini 需要合并——相邻的 role:user + 全 functionResponse 的 Content 合为一个。
  const contents: Content[] = []
  for (const c of rawContents) {
    const prev = contents[contents.length - 1]
    const cParts = c.parts ?? []
    const prevParts = prev?.parts ?? []
    const isAllFuncResp = c.role === 'user' && cParts.length > 0 && cParts.every(p => 'functionResponse' in p)
    const prevIsAllFuncResp = prev?.role === 'user' && prevParts.length > 0 && prevParts.every(p => 'functionResponse' in p)
    if (isAllFuncResp && prevIsAllFuncResp && prev) {
      prev.parts = [...prevParts, ...cParts]
    } else {
      contents.push(c)
    }
  }

  return {
    systemInstruction: systemMessage ? collapseTextContent(systemMessage.content) : undefined,
    contents,
  }
}

export function encodeGeminiTools(tools: LLMTool[] | undefined): Tool[] | undefined {
  if (!tools?.length)
    return undefined
  return [{ functionDeclarations: tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: normalizeToolSchema(t.inputSchema),
  })) }]
}

function toGeminiContent(msg: LLMMessage): Content {
  if (msg.role === 'tool') {
    return {
      role: 'user',
      parts: [{
        functionResponse: {
          name: msg.toolName ?? '',
          response: {
            toolUseId: msg.toolCallId ?? '',
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            isError: msg.isError ?? false,
          },
        },
      }],
    }
  }

  const role = msg.role === 'assistant' ? 'model' : 'user'

  if (typeof msg.content === 'string') {
    return { role, parts: [{ text: msg.content }] }
  }

  const parts: Part[] = msg.content.map((block) => {
    if (block.type === 'text')
      return { text: block.text }
    if (block.type === 'thinking')
      return { text: block.text, thought: true, ...(block.signature ? { thoughtSignature: block.signature } : {}) } as Part
    if (block.type === 'image') {
      return {
        inlineData: {
          mimeType: block.mimeType,
          data: block.data,
        },
      }
    }
    if (block.type === 'tool_result') {
      return {
        functionResponse: {
          name: block.toolName ?? '',
          response: {
            toolUseId: block.toolUseId,
            content: block.content,
            isError: block.isError ?? false,
          },
        },
      }
    }
    if (block.type === 'tool_use')
      // Gemini SDK FunctionCall 定义含 id?(optional), 但 API 后端当前不接受此字段
      // (传 id → 400 INVALID_ARGUMENT "Unknown name 'id' at function_call")。
      // 仅发 name + args; 待 API 支持后可恢复 id 透传。
      return { functionCall: { name: block.name, args: block.input } }
    return { text: '' }
  })

  return { role, parts }
}

// ── OpenAI Responses API Codec ──
//
// Responses API 与 Chat Completions 的消息规范化差异:
//   - reasoning blocks 保留 (Responses API 返回 reasoning items, 多轮时需回传)
//   - tool_results 不需要拆分 (Responses API 的 function_call_output 是独立 input item)
//   - system messages 保留在 normalizeMessages 里但编码时提取到 instructions

class OpenAIResponsesConversationCodec extends BaseConversationCodec {
  constructor() {
    super('openai-responses', 'openai-responses')
  }

  normalizeSemanticTurns(turns: SemanticTurn[]): SemanticTurn[] {
    // Responses API 支持 reasoning, 不需要丢弃 reasoningBlocks
    return turns
  }

  protected normalizeMessage(message: LLMMessage): LLMMessage | null {
    if (message.role === 'system') {
      return {
        ...message,
        content: collapseTextContent(message.content),
      }
    }

    if (message.role === 'tool') {
      return {
        ...message,
        content: collapseToolContent(message.content),
      }
    }

    if (typeof message.content === 'string')
      return message

    if (message.role === 'assistant') {
      // 保留 text + tool_use + thinking (reasoning) blocks
      const kept = message.content.filter(block =>
        block.type === 'text' || block.type === 'tool_use' || block.type === 'thinking',
      )
      return kept.length > 0 ? { ...message, content: kept } : null
    }

    // user: 含图片时保留 image + text, 否则合并纯文本
    const hasImages = message.content.some(block => block.type === 'image')
    if (hasImages) {
      return {
        ...message,
        content: message.content.filter(block => block.type === 'text' || block.type === 'image'),
      }
    }

    return {
      ...message,
      content: collapseTextContent(message.content),
    }
  }
}

export const anthropicConversationCodec: ProviderConversationCodec = new AnthropicConversationCodec()
export const openAIChatConversationCodec: ProviderConversationCodec = new OpenAIChatConversationCodec()
export const openAIResponsesConversationCodec: ProviderConversationCodec = new OpenAIResponsesConversationCodec()
export const geminiConversationCodec: ProviderConversationCodec = new GeminiConversationCodec()

// ── Responses API 编码 ──

import type { ResponseInput, ResponseInputItem } from 'openai/resources/responses/responses'

export interface ResponsesEncodedInput {
  instructions: string | undefined
  items: ResponseInput
}

/**
 * LLMMessage[] → Responses API 的 instructions + input items
 *
 * 编码规则:
 *   - system messages → 合并为 instructions 字符串
 *   - user/assistant messages → EasyInputMessage items
 *   - assistant tool_use blocks → function_call items (独立 item, 不嵌套在 message 里)
 *   - tool messages → function_call_output items (call_id 关联)
 *   - assistant thinking blocks → ResponseReasoningItem (encrypted_content 用于无状态多轮推理上下文保留)
 */
export function encodeResponsesInput(messages: LLMMessage[]): ResponsesEncodedInput {
  let instructions: string | undefined
  const items: ResponseInput = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n')
      instructions = instructions ? `${instructions}\n${text}` : text
      continue
    }

    if (msg.role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: msg.toolCallId ?? '',
        output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      } as ResponseInputItem.FunctionCallOutput)
      continue
    }

    if (msg.role === 'assistant' && typeof msg.content !== 'string') {
      const textParts = msg.content
        .filter((b): b is Extract<LLMContentBlock, { type: 'text' }> => b.type === 'text')
        .map(b => b.text)
        .join('')
      const toolUses = msg.content
        .filter((b): b is Extract<LLMContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      const thinkingBlocks = msg.content
        .filter((b): b is Extract<LLMContentBlock, { type: 'thinking' }> => b.type === 'thinking')

      // thinking → ResponseReasoningItem (仅限同 provider 回传)
      // Pi 方式: signature 是完整 ResponseReasoningItem JSON，直接还原。
      // 跨 provider 的 thinking 块无有效 signature → 跳过（已由 transformMessages 降级为 text）。
      for (const tb of thinkingBlocks) {
        if (tb.signature) {
          try {
            const reasoningItem = JSON.parse(tb.signature)
            if (reasoningItem?.type === 'reasoning' && reasoningItem?.id) {
              items.push(reasoningItem as unknown as ResponseInputItem)
            }
          }
          catch { /* 非合法 JSON（跨 provider signature）→ 跳过 */ }
        }
      }

      if (textParts) {
        items.push({ role: 'assistant', content: textParts })
      }
      for (const tu of toolUses) {
        items.push({
          type: 'function_call',
          call_id: tu.id,
          name: tu.name,
          arguments: JSON.stringify(tu.input),
        } as unknown as ResponseInputItem)
      }
      continue
    }

    // user / assistant 纯文本
    if (typeof msg.content === 'string') {
      items.push({ role: msg.role as 'user' | 'assistant', content: msg.content })
      continue
    }

    // user 含图片
    const hasImages = msg.content.some(b => b.type === 'image')
    if (hasImages) {
      const parts: Array<{ type: 'input_text', text: string } | { type: 'input_image', image_url: string, detail: 'high' }> = []
      for (const block of msg.content) {
        if (block.type === 'image') {
          parts.push({ type: 'input_image', image_url: `data:${block.mimeType};base64,${block.data}`, detail: 'high' })
        }
        else if (block.type === 'text') {
          parts.push({ type: 'input_text', text: block.text })
        }
      }
      items.push({ role: 'user', content: parts as any })
      continue
    }

    // user 纯文本 content blocks
    const text = msg.content
      .filter((b): b is Extract<LLMContentBlock, { type: 'text' }> => b.type === 'text')
      .map(b => b.text)
      .join('')
    items.push({ role: msg.role as 'user' | 'assistant', content: text })
  }

  return { instructions, items }
}

export function encodeResponsesTools(
  tools: LLMTool[] | undefined,
): Array<{ type: 'function', name: string, description: string, parameters: Record<string, unknown>, strict: boolean }> | undefined {
  if (!tools?.length)
    return undefined
  return tools.map(t => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    parameters: normalizeToolSchema(t.inputSchema),
    strict: false,
  }))
}

// ── Anthropic Prompt Caching ──
//
// 对齐 Claude Code 策略 (HAR 实证):
//   - system: 所有 text block 标记 cache_control
//   - messages: 最后一条 user 消息的最后一个 content block 标记
//   - tools: 不标记 (前缀缓存自动覆盖)
//
// Anthropic 按前缀匹配缓存: tools → system → messages
// cache_control 断点标记 "缓存到此处" 的边界，断点之前的内容被缓存。
// 每个请求最多 4 个显式断点; 最小可缓存块大小 1024~4096 tokens (按模型)。

const CACHE_CONTROL_EPHEMERAL = { type: 'ephemeral' as const }

export function applyAnthropicCacheBreakpoints(
  system: Anthropic.MessageCreateParamsStreaming['system'] | undefined,
  messages: Anthropic.MessageParam[],
): {
  system: Anthropic.MessageCreateParamsStreaming['system'] | undefined
  messages: Anthropic.MessageParam[]
} {
  // system: 所有 block 标记 (system prompt 几乎不变，缓存命中率最高)
  let cachedSystem = system
  if (typeof system === 'string' && system) {
    cachedSystem = [{ type: 'text' as const, text: system, cache_control: CACHE_CONTROL_EPHEMERAL }]
  }
  else if (Array.isArray(system)) {
    cachedSystem = system.map(block => ({ ...block, cache_control: CACHE_CONTROL_EPHEMERAL }))
  }

  // messages: 最后一条 user 消息的最后一个 content block 标记 (滑动窗口)
  const cachedMessages = [...messages]
  for (let i = cachedMessages.length - 1; i >= 0; i--) {
    const msg = cachedMessages[i]
    if (msg.role !== 'user')
      continue

    if (typeof msg.content === 'string') {
      cachedMessages[i] = {
        ...msg,
        content: [{ type: 'text' as const, text: msg.content, cache_control: CACHE_CONTROL_EPHEMERAL }],
      }
    }
    else if (Array.isArray(msg.content) && msg.content.length > 0) {
      const content = [...msg.content]
      content[content.length - 1] = { ...content[content.length - 1], cache_control: CACHE_CONTROL_EPHEMERAL } as any
      cachedMessages[i] = { ...msg, content }
    }
    break
  }

  return { system: cachedSystem, messages: cachedMessages }
}
