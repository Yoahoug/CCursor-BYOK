/**
 * editToolCall 运行时
 *
 * 编辑类工具的权威执行流：
 *   1. toolCallStarted → EditArgs { path, streamContent? }
 *   2. readArgs exec → Client 读取真实 workspace 文件
 *   3. Server 基于 client readResult 应用 EditPlan
 *   4. writeArgs exec → Client 写入真实 workspace 文件
 *   5. toolCallCompleted → { success/error }
 *
 * Server 不再用本地 fs 预读/预计算。文件内容以 Client readResult 为准。
 */

import type { AgentServerMessage } from '../../gen/agent_v1_pb'
import type { ProviderRoundContext } from '../llm/providerRuntime'
import type { LLMMessage } from '../llm/types'
import type { AgentSession } from './session'
import type { ParsedPatch } from './toolkit/definitions/ApplyPatch'
import type { EditPlan } from './toolkit/editPlans'
import { logger } from '../../logger'
import {
  execMessage,
  heartbeat,
  toolCallStarted,
} from './stream'
import { applyPatchToContent, computeDiffFromContents } from './toolkit/definitions/ApplyPatch'
import { applyStringEditToContent } from './toolkit/definitions/Edit'
import { applyNotebookEditToContent } from './toolkit/definitions/EditNotebook'
import { finalizeToolCall } from './toolLifecycle'
import {
  waitForExecClientMessageWithHeartbeat,
  waitForExecStreamCloseWithHeartbeat,
} from './wait'

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeTextForCursorWrite(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

interface NewlineStats {
  chars: number
  crlf: number
  lfOnly: number
  crOnly: number
  crcrlf: number
  mixed: boolean
  trailingNewline: boolean
  maxConsecutiveBlankLines: number
}

function newlineStats(text: string): NewlineStats {
  let crlf = 0
  let lfOnly = 0
  let crOnly = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\r') {
      if (text[i + 1] === '\n') {
        crlf++
        i++
      }
      else {
        crOnly++
      }
    }
    else if (ch === '\n') {
      lfOnly++
    }
  }

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  let currentBlankRun = 0
  let maxConsecutiveBlankLines = 0
  for (const line of normalized.split('\n')) {
    if (line.trim().length === 0) {
      currentBlankRun++
      maxConsecutiveBlankLines = Math.max(maxConsecutiveBlankLines, currentBlankRun)
    }
    else {
      currentBlankRun = 0
    }
  }

  return {
    chars: text.length,
    crlf,
    lfOnly,
    crOnly,
    crcrlf: (text.match(/\r\r\n/g) ?? []).length,
    mixed: crlf > 0 && (lfOnly > 0 || crOnly > 0),
    trailingNewline: text.endsWith('\n') || text.endsWith('\r'),
    maxConsecutiveBlankLines,
  }
}

function planNewlineStats(plan: EditPlan): Record<string, NewlineStats | string> {
  switch (plan.kind) {
    case 'write':
      return { kind: plan.kind, contents: newlineStats(plan.contents), streamContent: newlineStats(plan.streamContent) }
    case 'stringReplace':
      return { kind: plan.kind, oldString: newlineStats(plan.oldString), newString: newlineStats(plan.newString), streamContent: newlineStats(plan.streamContent) }
    case 'applyPatch':
      return { kind: plan.kind, patchText: newlineStats(plan.patchText), streamContent: newlineStats(plan.streamContent) }
    case 'editNotebook':
      return { kind: plan.kind, oldString: newlineStats(plan.oldString), newString: newlineStats(plan.newString), streamContent: newlineStats(plan.streamContent) }
  }
}

type ClientReadOutcome
  = | { case: 'success', content: string }
    | { case: 'fileNotFound', message: string }
    | { case: 'error', message: string }

function resultOneof(value: Record<string, unknown>): { caseName: string, value: Record<string, unknown> } | null {
  const result = obj(value.result)
  if (typeof result.case === 'string')
    return { caseName: result.case, value: obj(result.value) }
  for (const [caseName, caseValue] of Object.entries(value)) {
    if (caseValue && typeof caseValue === 'object')
      return { caseName, value: obj(caseValue) }
  }
  return null
}

function extractReadOutcome(execClientFrame: Record<string, unknown> | null): ClientReadOutcome {
  if (!execClientFrame)
    return { case: 'error', message: 'read failed: no exec client message' }
  const execClientMsg = obj(execClientFrame.execClientMessage)
  const rr = obj(execClientMsg.readResult)
  const oneof = resultOneof(rr)
  if (!oneof)
    return { case: 'error', message: 'read failed: no readResult' }

  if (oneof.caseName === 'success') {
    const success = oneof.value
    const output = obj(success.output)
    if (output.case === 'content')
      return { case: 'success', content: normalizeTextForCursorWrite(str(output.value)) }
    if (typeof output.content === 'string')
      return { case: 'success', content: normalizeTextForCursorWrite(output.content) }
    if (typeof success.content === 'string')
      return { case: 'success', content: normalizeTextForCursorWrite(success.content) }
    return { case: 'success', content: '' }
  }

  if (oneof.caseName === 'fileNotFound') {
    const path = str(oneof.value.path)
    return { case: 'fileNotFound', message: path ? `File not found: ${path}` : 'File not found' }
  }

  const message = str(oneof.value.error, str(oneof.value.message, str(oneof.value.reason, `read ${oneof.caseName}`)))
  return { case: 'error', message }
}

function extractWriteError(execClientFrame: Record<string, unknown> | null): string | null {
  if (!execClientFrame)
    return 'write failed: no exec client message'
  const execClientMsg = obj(execClientFrame.execClientMessage)
  const wr = obj(execClientMsg.writeResult)
  const oneof = resultOneof(wr)
  if (!oneof)
    return 'write failed: no writeResult'
  if (oneof.caseName === 'success')
    return null
  return str(oneof.value.error, str(oneof.value.message, str(oneof.value.reason, `write ${oneof.caseName}`)))
}

function applyEditPlan(plan: EditPlan, read: ClientReadOutcome): { beforeContent: string, fileText: string, streamContent: string, message: string } {
  if (plan.kind === 'write') {
    if (read.case !== 'success' && read.case !== 'fileNotFound')
      throw new Error(read.message)
    const beforeContent = read.case === 'success' ? read.content : ''
    return {
      beforeContent,
      fileText: plan.contents,
      streamContent: plan.streamContent,
      message: beforeContent ? `The file ${plan.path} has been updated.` : `Wrote contents to ${plan.path}`,
    }
  }

  if (plan.kind === 'stringReplace') {
    if (read.case !== 'success')
      throw new Error(read.message)
    const result = applyStringEditToContent({
      path: plan.path,
      beforeContent: read.content,
      oldString: plan.oldString,
      newString: plan.newString,
      replaceAll: plan.replaceAll,
    })
    return {
      beforeContent: read.content,
      fileText: result.fileText,
      streamContent: result.streamContent,
      message: `The file ${plan.path} has been updated.`,
    }
  }

  if (plan.kind === 'applyPatch') {
    const parsed = plan.parsedPatch as ParsedPatch
    if (parsed.action === 'delete') {
      throw new Error('ApplyPatch Delete File is not supported by editToolCall; use the Delete tool instead')
    }
    if (parsed.movePath) {
      throw new Error('Move/Rename is not supported by ApplyPatch in BYOK yet')
    }
    if (parsed.action === 'add') {
      if (read.case === 'success')
        throw new Error(`ApplyPatch Add File target already exists: ${plan.path}`)
      if (read.case !== 'fileNotFound')
        throw new Error(read.message)
      return {
        beforeContent: '',
        fileText: applyPatchToContent(parsed, ''),
        streamContent: plan.streamContent,
        message: `Success. Updated the following files:\nA ${plan.path}`,
      }
    }
    if (read.case !== 'success')
      throw new Error(read.message)
    return {
      beforeContent: read.content,
      fileText: applyPatchToContent(parsed, read.content),
      streamContent: plan.streamContent,
      message: `Success. Updated the following files:\nM ${plan.path}`,
    }
  }

  if (plan.kind === 'editNotebook') {
    if (read.case !== 'success')
      throw new Error(read.message)
    return {
      beforeContent: read.content,
      fileText: applyNotebookEditToContent(
        read.content,
        plan.cellIdx,
        plan.isNewCell,
        plan.cellLanguage,
        plan.oldString,
        plan.newString,
      ),
      streamContent: plan.streamContent,
      message: `The notebook ${plan.path} has been updated.`,
    }
  }

  const unreachable: never = plan
  throw new Error(`Unsupported edit plan: ${JSON.stringify(unreachable)}`)
}

function finalizeEditResult(params: {
  roundContext: Pick<ProviderRoundContext, 'createToolResult' | 'recordToolResult'>
  messages: LLMMessage[]
  toolName: string
  callId: string
  startedArgs: Record<string, unknown>
  input: Record<string, unknown>
  modelCallId: string
  rawToolResult: { result: { case: string, value: Record<string, unknown> } }
}): AgentServerMessage {
  return finalizeToolCall({
    roundContext: params.roundContext,
    messages: params.messages,
    cursorToolType: 'editToolCall',
    toolName: params.toolName,
    callId: params.callId,
    startedArgs: params.startedArgs,
    rawToolResult: params.rawToolResult,
    input: params.input,
    modelCallId: params.modelCallId,
  }).frame
}

export async function* finalizeEditToolCall(params: {
  session: AgentSession
  toolName: string
  callId: string
  modelCallId: string
  startedArgs: Record<string, unknown>
  input: Record<string, unknown>
  plan: EditPlan
  roundContext: Pick<ProviderRoundContext, 'createToolResult' | 'recordToolResult'>
  messages: LLMMessage[]
  allocateExecMessageId: () => number
}): AsyncGenerator<AgentServerMessage, void, void> {
  const { callId, modelCallId, plan } = params
  const path = plan.path
  const startedStreamContent = plan.kind === 'applyPatch' ? '' : plan.streamContent
  const editArgs = {
    path,
    ...(startedStreamContent ? { streamContent: startedStreamContent } : {}),
  }

  logger.debug({ callId, path, modelCallId }, '[EDIT_T] 4.toolCallStarted')
  yield toolCallStarted(callId, 'editToolCall', editArgs, modelCallId)

  const readExecMsgId = params.allocateExecMessageId()
  yield execMessage(readExecMsgId, `${callId}-read`, 'readArgs', { path, toolCallId: callId })
  const readFrame = yield* waitForExecClientMessageWithHeartbeat(params.session, readExecMsgId, null)
  yield* waitForExecStreamCloseWithHeartbeat(params.session, readExecMsgId, null)
  yield heartbeat()

  const readOutcome = extractReadOutcome(readFrame)
  logger.debug({
    tool: params.toolName,
    callId,
    path,
    planKind: plan.kind,
    readCase: readOutcome.case,
    read: readOutcome.case === 'success' ? newlineStats(readOutcome.content) : { message: readOutcome.message },
    plan: planNewlineStats(plan),
  }, '[EDIT_NL] readResult newline diagnostics')

  let applied: { beforeContent: string, fileText: string, streamContent: string, message: string }
  try {
    applied = applyEditPlan(plan, readOutcome)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn({ tool: params.toolName, callId, path, error: message }, '[EDIT] apply plan failed')
    yield finalizeEditResult({
      ...params,
      startedArgs: editArgs,
      rawToolResult: { result: { case: 'error', value: { path, message } } },
    })
    return
  }

  logger.debug({
    tool: params.toolName,
    callId,
    path,
    planKind: plan.kind,
    beforeContent: newlineStats(applied.beforeContent),
    fileText: newlineStats(applied.fileText),
    streamContent: newlineStats(applied.streamContent),
    suspicious: {
      fileTextHasCrCrLf: /\r\r\n/.test(applied.fileText),
      fileTextMixedLineEndings: newlineStats(applied.fileText).mixed,
      fileTextHasLargeBlankRun: newlineStats(applied.fileText).maxConsecutiveBlankLines >= 3,
    },
  }, '[EDIT_NL] writeArgs newline diagnostics')

  const clientFileText = normalizeTextForCursorWrite(applied.fileText)
  const writeExecMsgId = params.allocateExecMessageId()
  yield execMessage(writeExecMsgId, `${callId}-write`, 'writeArgs', {
    path,
    fileText: clientFileText,
    toolCallId: callId,
    ...(plan.kind === 'editNotebook' ? { returnFileContentAfterWrite: true, fileBytes: new Uint8Array() } : {}),
  })
  const writeFrame = yield* waitForExecClientMessageWithHeartbeat(params.session, writeExecMsgId, null)
  yield* waitForExecStreamCloseWithHeartbeat(params.session, writeExecMsgId, null)

  const writeError = extractWriteError(writeFrame)
  if (writeError) {
    logger.warn({ tool: params.toolName, callId, path, error: writeError }, '[EDIT] write failed')
    yield finalizeEditResult({
      ...params,
      startedArgs: editArgs,
      rawToolResult: { result: { case: 'error', value: { path, message: writeError } } },
    })
    return
  }

  const { diffString, linesAdded, linesRemoved } = computeDiffFromContents(applied.beforeContent, applied.fileText)
  const editResult = {
    result: {
      case: 'success',
      value: {
        path,
        linesAdded,
        linesRemoved,
        diffString,
        ...(applied.beforeContent ? { beforeFullFileContent: applied.beforeContent } : {}),
        afterFullFileContent: applied.fileText,
        message: applied.message,
      },
    },
  }

  yield finalizeEditResult({
    ...params,
    startedArgs: editArgs,
    rawToolResult: editResult,
  })
  logger.info({ tool: params.toolName, path, linesAdded, linesRemoved }, '[EDIT] completed')
}
