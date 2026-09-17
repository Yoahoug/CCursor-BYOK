import type { ToolExecBuildOptions } from './toolkit/types'
import { buildRegisteredToolArgs } from './toolRegistry'

export type CursorToolType
  = | 'readToolCall'
    | 'editToolCall'
    | 'shellToolCall'
    | 'grepToolCall'
    | 'globToolCall'
    | 'deleteToolCall'
    | 'readLintsToolCall'
    | 'webSearchToolCall'
    | 'webFetchToolCall'
    | 'askQuestionToolCall'
    | 'taskToolCall'
    | 'mcpToolCall'
    | 'listMcpResourcesToolCall'
    | 'readMcpResourceToolCall'
    | 'updateTodosToolCall'
    | 'readTodosToolCall'
    | 'awaitToolCall'
    | 'editNotebookToolCall'
    | 'generateImageToolCall'
    | 'switchModeToolCall'
    | 'createPlanToolCall'
    | 'semSearchToolCall'

/**
 * 按 LLM 工具名查找并构建 toolCallStarted 帧的 args。
 * 第一参数是 LLM tool name（alias），不是 cursorToolType。
 */
export function buildToolArgs(
  llmToolName: string,
  input: Record<string, unknown>,
  callId: string,
  options: ToolExecBuildOptions = {},
): Record<string, unknown> {
  return buildRegisteredToolArgs(llmToolName, input, callId, options) ?? input
}

export type { ToolResultEnvelope } from './toolResults'
export {
  buildAskQuestionResultFromInteractionResponse,
  buildExecToolResult,
  buildLocalToolResult,
  buildShellToolResult,
  buildToolResultText,
  buildWebFetchApprovalResultFromInteractionResponse,
  buildWebSearchApprovalResultFromInteractionResponse,
  isToolResultError,
  normalizeToolResult,
} from './toolResults'
