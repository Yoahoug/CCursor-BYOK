import type { ToolResultEnvelope } from './shared'
import {
  arr,
  bool,
  enumLike,
  envelope,
  obj,
  resultCase,
  str,
  truncate,

} from './shared'

export function buildLocalInteractionToolResult(cursorToolType: string, input: Record<string, unknown>): ToolResultEnvelope | null {
  switch (cursorToolType) {
    case 'updateTodosToolCall': {
      const todos = arr<Record<string, unknown>>(input.todos)
      return {
        result: {
          case: 'success',
          value: {
            todos,
            totalCount: todos.length,
            wasMerge: bool(input.merge),
          },
        },
      }
    }
    case 'webSearchToolCall':
      return { result: { case: 'error', value: { error: 'web search is not implemented yet' } } }
    case 'webFetchToolCall':
      return { result: { case: 'error', value: { error: 'web fetch is not implemented yet', url: str(input.url) } } }
    case 'askQuestionToolCall':
      return { result: { case: 'error', value: { errorMessage: 'ask question response missing' } } }
    default:
      return null
  }
}

export function buildAskQuestionResultFromInteractionResponse(response: Record<string, unknown> | null): ToolResultEnvelope {
  const result = obj(obj(response).askQuestionInteractionResponse).result
  const rc = resultCase(result)
  return rc ? { result: rc } : { result: { case: 'error', value: { errorMessage: 'missing ask question response' } } }
}

export function buildWebSearchApprovalResultFromInteractionResponse(
  response: Record<string, unknown> | null,
): { approved: boolean, result?: ToolResultEnvelope } {
  const payload = obj(obj(response).webSearchRequestResponse)
  if (payload.approved)
    return { approved: true }
  if (payload.rejected)
    return { approved: false, result: { result: { case: 'rejected', value: { reason: str(obj(payload.rejected).reason, 'rejected') } } } }
  return { approved: false, result: { result: { case: 'error', value: { error: 'missing approval response' } } } }
}

export function buildWebFetchApprovalResultFromInteractionResponse(
  response: Record<string, unknown> | null,
): { approved: boolean, result?: ToolResultEnvelope } {
  const payload = obj(obj(response).webFetchRequestResponse)
  if (payload.approved)
    return { approved: true }
  if (payload.rejected)
    return { approved: false, result: { result: { case: 'rejected', value: { reason: str(obj(payload.rejected).reason, 'rejected') } } } }
  return { approved: false, result: { result: { case: 'error', value: { error: 'missing approval response', url: '' } } } }
}

export function normalizeInteractionToolResult(
  cursorToolType: string,
  resultCaseName: string,
  value: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolResultEnvelope | null {
  switch (cursorToolType) {
    case 'webSearchToolCall':
      if (resultCaseName === 'success') {
        return envelope('success', {
          references: arr<Record<string, unknown>>(value.references).map(reference => ({
            title: str(reference.title),
            url: str(reference.url),
            chunk: str(reference.chunk),
          })),
        })
      }
      return envelope(resultCaseName || 'error', value)
    case 'webFetchToolCall':
      if (resultCaseName === 'success') {
        return envelope('success', {
          url: str(value.url, str(input.url)),
          markdown: str(value.markdown),
          ...(value.outputLocation ? { outputLocation: obj(value.outputLocation) } : {}),
        })
      }
      if (resultCaseName === 'error') {
        return envelope('error', {
          url: str(value.url, str(input.url)),
          error: str(value.error, 'web fetch error'),
        })
      }
      return envelope(resultCaseName || 'error', value)
    case 'updateTodosToolCall':
      if (resultCaseName === 'success') {
        const todos = arr<Record<string, unknown>>(value.todos).map(todo => ({
          ...todo,
          id: str(todo.id),
          content: str(todo.content),
          status: enumLike(todo.status, 0),
        }))
        return envelope('success', {
          todos,
          totalCount: value.totalCount ?? todos.length,
          wasMerge: bool(value.wasMerge),
        })
      }
      return envelope(resultCaseName || 'error', value)
    default:
      return null
  }
}

export function buildInteractionToolResultText(
  cursorToolType: string,
  toolResult: ToolResultEnvelope,
  resultCaseName: string,
  value: Record<string, unknown>,
): string | null {
  switch (cursorToolType) {
    case 'updateTodosToolCall': {
      if (resultCaseName === 'success') {
        const todos = arr<Record<string, unknown>>(value.todos)
        return truncate(todos.map(todo => `- [${String(enumLike(todo.status, ''))}] ${str(todo.content)} (${str(todo.id)})`).join('\n') || 'Updated todos')
      }
      return `Update todos ${resultCaseName || 'error'}: ${JSON.stringify(value)}`
    }
    case 'webSearchToolCall':
    case 'webFetchToolCall':
    case 'askQuestionToolCall':
      return truncate(JSON.stringify(toolResult, null, 2), 12000)
    default:
      return null
  }
}
