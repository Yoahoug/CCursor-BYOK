import type { ToolResultEnvelope } from './shared'
import {
  arr,
  bool,
  envelope,
  num,
  obj,
  resultCase,
  str,
  truncate,

} from './shared'

function normalizeGrepUnionResult(value: unknown): Record<string, unknown> {
  const union = obj(value)
  if (union.result)
    return union
  if (union.count)
    return { result: { case: 'count', value: obj(union.count) } }
  if (union.files)
    return { result: { case: 'files', value: obj(union.files) } }
  if (union.content)
    return { result: { case: 'content', value: obj(union.content) } }
  return { result: { case: 'files', value: { files: [] } } }
}

function normalizeGrepSuccess(value: unknown): Record<string, unknown> {
  const success = obj(value)
  const workspaceResults = obj(success.workspaceResults)
  const normalizedWorkspaceResults: Record<string, unknown> = {}
  for (const [workspace, unionValue] of Object.entries(workspaceResults)) {
    normalizedWorkspaceResults[workspace] = normalizeGrepUnionResult(unionValue)
  }

  const activeEditorResult = success.activeEditorResult
    ? normalizeGrepUnionResult(success.activeEditorResult)
    : undefined

  return {
    ...success,
    workspaceResults: normalizedWorkspaceResults,
    ...(activeEditorResult ? { activeEditorResult } : {}),
  }
}

function unwrapGrepUnionResult(value: unknown): Record<string, unknown> {
  const union = obj(value)
  const wrapped = obj(union.result)
  if (typeof wrapped.case === 'string') {
    return { [wrapped.case]: obj(wrapped.value) }
  }
  return union
}

export function buildSearchExecToolResult(
  cursorToolType: string,
  execClientMsg: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolResultEnvelope | null {
  switch (cursorToolType) {
    case 'globToolCall': {
      const gr = obj(execClientMsg.grepResult)
      const success = obj(gr.success)
      if (!gr.success)
        return { result: { case: 'error', value: { error: 'no result' } } }

      const workspaceResults = obj(success.workspaceResults)
      const files: string[] = []
      let clientTruncated = false
      let ripgrepTruncated = false

      for (const ws of Object.values(workspaceResults)) {
        const wsObj = obj(ws)
        const filesUnion = obj(wsObj.files)
        const nestedFiles = arr<string>(filesUnion.files)
        files.push(...nestedFiles.map(String))
        clientTruncated = clientTruncated || bool(filesUnion.clientTruncated)
        ripgrepTruncated = ripgrepTruncated || bool(filesUnion.ripgrepTruncated)
      }

      return {
        result: {
          case: 'success',
          value: {
            pattern: str(input.globPattern ?? input.pattern),
            path: str(input.targetDirectory ?? input.path),
            files,
            totalFiles: files.length,
            clientTruncated,
            ripgrepTruncated,
          },
        },
      }
    }
    case 'grepToolCall': {
      const gr = obj(execClientMsg.grepResult)
      if (gr.success)
        return { result: { case: 'success', value: normalizeGrepSuccess(gr.success) } }
      if (gr.error)
        return { result: { case: 'error', value: obj(gr.error) } }
      return { result: { case: 'error', value: { error: 'no result' } } }
    }
    case 'readLintsToolCall': {
      const dr = obj(execClientMsg.diagnosticsResult)
      const dc = resultCase(dr)
      return dc ? { result: dc } : { result: { case: 'error', value: { errorMessage: 'no result' } } }
    }
    default:
      return null
  }
}

export function normalizeSearchToolResult(
  cursorToolType: string,
  resultCaseName: string,
  value: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolResultEnvelope | null {
  switch (cursorToolType) {
    case 'grepToolCall':
      return resultCaseName === 'success'
        ? envelope('success', normalizeGrepSuccess(value))
        : envelope(resultCaseName || 'error', value)
    case 'globToolCall':
      if (resultCaseName === 'success') {
        const files = arr<string>(value.files).map(v => String(v))
        return envelope('success', {
          pattern: str(value.pattern, str(input.globPattern ?? input.pattern)),
          path: str(value.path, str(input.targetDirectory ?? input.path)),
          files,
          totalFiles: num(value.totalFiles, files.length),
          clientTruncated: bool(value.clientTruncated),
          ripgrepTruncated: bool(value.ripgrepTruncated),
        })
      }
      return envelope(resultCaseName || 'error', value)
    case 'readLintsToolCall':
      if (resultCaseName === 'success') {
        const fileDiagnostics = arr<Record<string, unknown>>(value.fileDiagnostics).map(file => ({
          path: str(file.path),
          diagnostics: arr<Record<string, unknown>>(file.diagnostics).map(diagnostic => ({
            message: str(diagnostic.message),
            source: str(diagnostic.source),
            severity: diagnostic.severity ?? 0,
            ...(diagnostic.range ? { range: obj(diagnostic.range) } : {}),
          })),
        }))
        return envelope('success', {
          fileDiagnostics,
          totalFiles: num(value.totalFiles, fileDiagnostics.length),
          totalDiagnostics: num(
            value.totalDiagnostics,
            fileDiagnostics.reduce((sum, file) => sum + arr<Record<string, unknown>>(file.diagnostics).length, 0),
          ),
        })
      }
      return envelope(resultCaseName || 'error', value)
    default:
      return null
  }
}

export function buildSearchToolResultText(
  cursorToolType: string,
  resultCaseName: string,
  value: Record<string, unknown>,
  input: Record<string, unknown>,
): string | null {
  switch (cursorToolType) {
    case 'globToolCall': {
      if (resultCaseName === 'success') {
        const files = arr<string>(value.files).map(String)
        return files.length > 0
          ? truncate(`Matched ${files.length} file(s):\n${files.join('\n')}`)
          : `Matched 0 files for glob ${str(value.pattern, str(input.globPattern ?? input.pattern))}`
      }
      return `Glob ${resultCaseName || 'error'}: ${JSON.stringify(value)}`
    }
    case 'grepToolCall': {
      if (resultCaseName === 'success') {
        const workspaceResults = obj(value.workspaceResults)
        const lines: string[] = []
        for (const [workspace, unionValue] of Object.entries(workspaceResults)) {
          const unionObj = unwrapGrepUnionResult(unionValue)
          if (unionObj.content) {
            const content = obj(unionObj.content)
            const matches = arr<Record<string, unknown>>(content.matches)
            for (const fileMatch of matches.slice(0, 20)) {
              const file = str(fileMatch.file)
              for (const match of arr<Record<string, unknown>>(fileMatch.matches).slice(0, 5)) {
                lines.push(`[${workspace}] ${file}:${num(match.lineNumber)} ${str(match.content)}`)
              }
            }
          }
          else if (unionObj.files) {
            const files = arr<string>(obj(unionObj.files).files).map(String)
            for (const file of files.slice(0, 20)) lines.push(`[${workspace}] ${file}`)
          }
          else if (unionObj.count) {
            const count = obj(unionObj.count)
            lines.push(`[${workspace}] total_matches=${num(count.totalMatches)} total_files=${num(count.totalFiles)}`)
          }
        }
        return lines.length > 0
          ? truncate(lines.join('\n'))
          : `grep returned success but no formatted matches for pattern ${str(input.pattern ?? input.query)}`
      }
      return `Grep ${resultCaseName || 'error'}: ${JSON.stringify(value)}`
    }
    default:
      return null
  }
}
