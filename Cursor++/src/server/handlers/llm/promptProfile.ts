import type { ProviderType } from '../../data/defaults'
import type { ProviderToolCatalog } from './toolCatalog'
import { resolveModel } from '../models/mapper'
import { getProviderToolCatalog } from './toolCatalog'

export interface ProviderPromptProfile {
  readonly provider: ProviderType
  readonly variant: 'main' | 'fallback'
  readonly systemPromptStyle: 'anthropic-main' | 'openai-main' | 'gemini-main' | 'composer-fallback'
  readonly observedSystemPromptHashes: string[]
  readonly promptVocabulary: string[]
  readonly toolCatalog: ProviderToolCatalog
  /** 实际 API 模型名 (如 gpt-5.4, claude-sonnet-4-5), 用于 system prompt 注入 */
  readonly apiModel: string
  /** 是否为 thinking 模型 — 来自 providers.json 显式配置,不靠模型名猜测 */
  readonly thinking: boolean
}

const OPENAI_HASHES = ['3d7cc5e99085', '777e9a50a600', 'b91ffbc687c5']
const GEMINI_HASHES = ['c105cc31867c', 'b91ffbc687c5']
const ANTHROPIC_HASHES = ['official-hook-sample']

export function resolvePromptProfile(modelId: string): ProviderPromptProfile {
  // composer-* 是 Cursor 客户端内部的 "fallback 路由名" (composer-2-fast / composer-2-low 等),
  // 不对应任何具体 provider 模型,也不要求登记到 providers.json。
  // 这里单独走 fallback 路径, 避免 resolveModel() 对未登记 modelId 抛 ModelNotFoundError。
  if (modelId.startsWith('composer-')) {
    const provider: ProviderType = 'anthropic'
    const toolCatalog = getProviderToolCatalog(provider, 'fallback')
    return {
      provider,
      variant: 'fallback',
      systemPromptStyle: 'composer-fallback',
      observedSystemPromptHashes: ['b91ffbc687c5'],
      promptVocabulary: toolCatalog.promptVocabulary,
      toolCatalog,
      apiModel: modelId,
      thinking: false,
    }
  }

  const resolved = resolveModel(modelId)
  switch (resolved.provider) {
    case 'openai-chat':
    case 'openai-responses': {
      const toolCatalog = getProviderToolCatalog('openai-chat', 'main')
      return {
        provider: resolved.provider,
        variant: 'main',
        systemPromptStyle: 'openai-main',
        observedSystemPromptHashes: OPENAI_HASHES,
        promptVocabulary: toolCatalog.promptVocabulary,
        toolCatalog,
        apiModel: resolved.apiModel,
        thinking: resolved.thinking,
      }
    }
    case 'gemini': {
      const toolCatalog = getProviderToolCatalog('gemini', 'main')
      return {
        provider: 'gemini',
        variant: 'main',
        systemPromptStyle: 'gemini-main',
        observedSystemPromptHashes: GEMINI_HASHES,
        promptVocabulary: toolCatalog.promptVocabulary,
        toolCatalog,
        apiModel: resolved.apiModel,
        thinking: resolved.thinking,
      }
    }
    case 'anthropic':
    default: {
      const toolCatalog = getProviderToolCatalog('anthropic', 'main')
      return {
        provider: 'anthropic',
        variant: 'main',
        systemPromptStyle: 'anthropic-main',
        observedSystemPromptHashes: ANTHROPIC_HASHES,
        promptVocabulary: toolCatalog.promptVocabulary,
        toolCatalog,
        apiModel: resolved.apiModel,
        thinking: resolved.thinking,
      }
    }
  }
}
