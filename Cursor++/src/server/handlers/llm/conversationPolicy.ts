import type { ProviderStateStrategy } from './stateStrategy'
import {
  anthropicStateStrategy,
  geminiStateStrategy,
  openAIStateStrategy,
} from './stateStrategy'

export type LLMConversationAdapter = ProviderStateStrategy
export type LLMConversationPolicy = ProviderStateStrategy

export const anthropicConversationPolicy: LLMConversationPolicy = anthropicStateStrategy
export const openAIConversationPolicy: LLMConversationPolicy = openAIStateStrategy
export const geminiConversationPolicy: LLMConversationPolicy = geminiStateStrategy
