import type { ProviderType } from '../../data/defaults'
/**
 * Cursor Agent 内置工具定义
 *
 * 统一从 tool registry 导出，按 provider 分化返回不同的工具列表。
 * 避免 LLM schema、名称别名、Cursor tool type 在多个文件中重复维护。
 */
import type { LLMTool } from '../llm/types'
import { listBuiltinLlmTools } from './toolRegistry'

export function getCursorAgentTools(provider: ProviderType): LLMTool[] {
  return listBuiltinLlmTools(provider)
}
