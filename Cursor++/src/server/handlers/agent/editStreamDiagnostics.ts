/**
 * Edit 流式诊断 — 换行符与目标字段的统计。
 *
 * 从 conversationRuntime.ts 原样抽出（纯移动）。这些只服务于 debug 日志：
 * 用来回答"模型流出来的换行符到底长什么样"这类问题（CRLF/CR/混合换行曾
 * 造成过 Edit 工具内容错乱）。与对话循环无耦合。
 */

export interface EditNewlineStats {
  chars: number
  crlf: number
  lfOnly: number
  crOnly: number
  crcrlf: number
  mixed: boolean
  trailingNewline: boolean
  maxConsecutiveBlankLines: number
}

const CRCRLF_PATTERN = /\r\r\n/g
const CRLF_PATTERN = /\r\n/g
const CR_PATTERN = /\r/g

export function editNewlineStats(text: string): EditNewlineStats {
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

  const normalized = text.replace(CRLF_PATTERN, '\n').replace(CR_PATTERN, '\n')
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
    crcrlf: (text.match(CRCRLF_PATTERN) ?? []).length,
    mixed: crlf > 0 && (lfOnly > 0 || crOnly > 0),
    trailingNewline: text.endsWith('\n') || text.endsWith('\r'),
    maxConsecutiveBlankLines,
  }
}

export function editToolTargetStats(toolName: string, input: Record<string, unknown>): Record<string, EditNewlineStats> {
  const stats: Record<string, EditNewlineStats> = {}
  const add = (key: string) => {
    const value = input[key]
    if (typeof value === 'string')
      stats[key] = editNewlineStats(value)
  }
  if (toolName === 'Write') {
    add('contents')
  }
  else if (toolName === 'ApplyPatch') {
    add('patch')
  }
  else {
    add('old_string')
    add('new_string')
  }
  return stats
}

/** 流式诊断累积 — 记录一条流上收到多少个 delta、拼出了多少内容 */
export interface EditStreamDiagnostics {
  deltaCount: number
  streamContent: string
}
