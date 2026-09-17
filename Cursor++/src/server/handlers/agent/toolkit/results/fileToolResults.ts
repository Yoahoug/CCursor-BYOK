import type { ToolResultEnvelope } from './shared'
import {
  bool,
  envelope,
  num,
  obj,
  resultCase,
  str,
  truncate,

} from './shared'

type ReadOutputCase = 'content' | 'data' | 'dataBlobId' | 'contentBlobId'

/** base64 / Uint8Array / Buffer → Uint8Array。protobuf bytes 经 toJson() 后变成 base64 string。 */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array)
    return value
  if (Buffer.isBuffer(value))
    return new Uint8Array(value)
  if (typeof value === 'string' && value.length > 0)
    return Uint8Array.from(Buffer.from(value, 'base64'))
  return new Uint8Array(0)
}

function resolveReadOutput(success: Record<string, unknown>): { case: ReadOutputCase, value: unknown } {
  if (success.dataBlobId !== undefined)
    return { case: 'dataBlobId', value: toBytes(success.dataBlobId) }
  if (success.contentBlobId !== undefined)
    return { case: 'contentBlobId', value: toBytes(success.contentBlobId) }
  if (success.data !== undefined)
    return { case: 'data', value: toBytes(success.data) }
  return { case: 'content', value: str(success.content) }
}

function normalizeReadOutput(value: unknown): { case: ReadOutputCase, value: unknown } {
  const output = obj(value)
  if (output.case === 'dataBlobId')
    return { case: 'dataBlobId', value: toBytes(output.value) }
  if (output.case === 'contentBlobId')
    return { case: 'contentBlobId', value: toBytes(output.value) }
  if (output.case === 'data')
    return { case: 'data', value: toBytes(output.value) }
  if (output.case === 'content')
    return { case: 'content', value: str(output.value) }
  if (output.dataBlobId !== undefined)
    return { case: 'dataBlobId', value: toBytes(output.dataBlobId) }
  if (output.contentBlobId !== undefined)
    return { case: 'contentBlobId', value: toBytes(output.contentBlobId) }
  if (output.data !== undefined)
    return { case: 'data', value: toBytes(output.data) }
  if (typeof output.content === 'string')
    return { case: 'content', value: output.content }
  return { case: 'content', value: '' }
}

export function buildFileExecToolResult(
  cursorToolType: string,
  execClientMsg: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolResultEnvelope | null {
  switch (cursorToolType) {
    case 'readToolCall': {
      const rr = obj(execClientMsg.readResult)
      if (rr.success) {
        const success = obj(rr.success)
        const output = resolveReadOutput(success)
        return {
          result: {
            case: 'success',
            value: {
              path: str(success.path, str(input.path)),
              totalLines: num(success.totalLines),
              fileSize: num(success.fileSize),
              truncated: bool(success.truncated),
              rangeApplied: bool(success.rangeApplied),
              ...(success.outputBlobId ? { outputBlobId: success.outputBlobId } : {}),
              ...(success.readRange ? { readRange: obj(success.readRange) } : {}),
              ...(Array.isArray(success.relatedCursorRulePaths) ? { relatedCursorRulePaths: success.relatedCursorRulePaths } : {}),
              ...(Array.isArray(success.relatedCursorRules) ? { relatedCursorRules: success.relatedCursorRules } : {}),
              output,
            },
          },
        }
      }
      const rc = resultCase(rr)
      return rc ? { result: rc } : { result: { case: 'error', value: { path: str(input.path), error: 'no result' } } }
    }
    case 'editToolCall': {
      const wr = obj(execClientMsg.writeResult)
      if (wr.success) {
        const success = obj(wr.success)
        const after = str(success.fileContentAfterWrite, str(input.streamContent))
        return {
          result: {
            case: 'success',
            value: {
              path: str(success.path, str(input.path)),
              afterFullFileContent: after,
              beforeFullFileContent: undefined,
              linesAdded: num(success.linesCreated),
              linesRemoved: 0,
              message: after ? undefined : 'write completed',
            },
          },
        }
      }
      if (wr.permissionDenied) {
        const denied = obj(wr.permissionDenied)
        return {
          result: {
            case: 'writePermissionDenied',
            value: {
              path: str(denied.path, str(input.path)),
              error: str(denied.error, 'write permission denied'),
              isReadonly: bool(denied.isReadonly),
            },
          },
        }
      }
      if (wr.rejected) {
        return { result: { case: 'rejected', value: { reason: str(obj(wr.rejected).reason, 'rejected') } } }
      }
      if (wr.error) {
        const error = obj(wr.error)
        return {
          result: {
            case: 'error',
            value: {
              path: str(error.path, str(input.path)),
              error: str(error.error, 'write error'),
            },
          },
        }
      }
      return { result: { case: 'error', value: { path: str(input.path), error: 'no result' } } }
    }
    case 'deleteToolCall': {
      const dr = obj(execClientMsg.deleteResult)
      const dc = resultCase(dr)
      return dc ? { result: dc } : { result: { case: 'error', value: { path: str(input.path), error: 'no result' } } }
    }
    default:
      return null
  }
}

export function normalizeFileToolResult(
  cursorToolType: string,
  resultCaseName: string,
  value: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolResultEnvelope | null {
  switch (cursorToolType) {
    case 'readToolCall': {
      if (resultCaseName === 'success') {
        const normalizedOutput = normalizeReadOutput(
          value.output ?? (value.dataBlobId !== undefined
            ? { dataBlobId: value.dataBlobId }
            : value.contentBlobId !== undefined
              ? { contentBlobId: value.contentBlobId }
              : value.data !== undefined ? { data: value.data } : { content: value.content }),
        )
        return envelope('success', {
          path: str(value.path, str(input.path)),
          totalLines: num(value.totalLines),
          fileSize: num(value.fileSize),
          truncated: bool(value.truncated),
          rangeApplied: bool(value.rangeApplied),
          ...(value.outputBlobId ? { outputBlobId: value.outputBlobId } : {}),
          output: normalizedOutput,
          ...(value.readRange ? { readRange: obj(value.readRange) } : {}),
          ...(Array.isArray(value.relatedCursorRulePaths) ? { relatedCursorRulePaths: value.relatedCursorRulePaths } : {}),
          ...(Array.isArray(value.relatedCursorRules) ? { relatedCursorRules: value.relatedCursorRules } : {}),
        })
      }
      return envelope(resultCaseName || 'error', value)
    }
    case 'editToolCall':
      if (resultCaseName === 'success') {
        return envelope('success', {
          path: str(value.path, str(input.path)),
          afterFullFileContent: str(value.afterFullFileContent),
          ...(typeof value.beforeFullFileContent === 'string' ? { beforeFullFileContent: value.beforeFullFileContent } : {}),
          ...(typeof value.message === 'string' ? { message: value.message } : {}),
          ...(typeof value.diffString === 'string' ? { diffString: value.diffString } : {}),
          ...(value.linesAdded !== undefined ? { linesAdded: num(value.linesAdded) } : {}),
          ...(value.linesRemoved !== undefined ? { linesRemoved: num(value.linesRemoved) } : {}),
        })
      }
      return envelope(resultCaseName || 'error', value)
    case 'deleteToolCall':
      if (resultCaseName === 'success') {
        return envelope('success', {
          path: str(value.path, str(input.path)),
          deletedFile: str(value.deletedFile, str(input.path)),
          fileSize: value.fileSize ?? 0,
          prevContent: str(value.prevContent),
        })
      }
      return envelope(resultCaseName || 'error', value)
    default:
      return null
  }
}

export function buildFileToolResultText(
  cursorToolType: string,
  resultCaseName: string,
  value: Record<string, unknown>,
  input: Record<string, unknown>,
): string | null {
  switch (cursorToolType) {
    case 'readToolCall': {
      if (resultCaseName === 'success') {
        const output = obj(value.output)
        if (output.case === 'content' && typeof output.value === 'string')
          return truncate(output.value, 12000)
        if (typeof output.content === 'string')
          return truncate(output.content, 12000)
        if (output.case === 'data' || output.case === 'dataBlobId' || output.case === 'contentBlobId')
          return `[Binary file: ${str(value.path, str(input.path))} (${num(value.fileSize)} bytes)]`
        return truncate(JSON.stringify(value))
      }
      return `Read ${resultCaseName || 'error'}: ${JSON.stringify(value)}`
    }
    case 'editToolCall': {
      if (resultCaseName === 'success') {
        return truncate([
          `Edited file: ${str(value.path, str(input.path))}`,
          typeof value.afterFullFileContent === 'string' ? `after_content:\n${value.afterFullFileContent}` : '',
        ].filter(Boolean).join('\n\n'), 12000)
      }
      return `Edit ${resultCaseName || 'error'}: ${JSON.stringify(value)}`
    }
    case 'deleteToolCall':
      return resultCaseName === 'success'
        ? `Deleted file: ${str(value.path, str(input.path))}`
        : `Delete ${resultCaseName || 'error'}: ${JSON.stringify(value)}`
    default:
      return null
  }
}
