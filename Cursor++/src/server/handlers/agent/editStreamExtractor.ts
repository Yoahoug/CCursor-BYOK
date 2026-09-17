/**
 * Edit 工具流式参数提取 — 从 LLM 的 tool_use JSON chunks 中增量取出目标字段。
 *
 * 从 conversationRuntime.ts 原样抽出（纯移动，无行为改动）。这部分与对话循环
 * 完全解耦 —— 它只吃字符串、吐字符串，是最典型的纯逻辑，单独成文件后
 * 也可以被直接测。
 */

const EDIT_TARGET_FIELD: Record<string, string> = {
  ApplyPatch: 'patch',
  Write: 'contents',
  Edit: 'new_string',
  EditNotebook: 'new_string',
}

/**
 * 从累积的 JSON 参数文本里抽 path。
 *
 * 正则提到模块级：feed() 每收到一个流式 chunk 都会调它一次，且传入的是
 * **已累积的完整 buffer** —— 在模块内 `new RegExp` 等于每个 chunk 重新编译
 * 一次，整个流下来是几十次无谓的编译。
 *
 * 两个字段名各编译一份，与原先「按 pathKey 构造正则」的语义**逐字等价**：
 * 只看目标字段，不会被同一条 JSON 里另一个字段抢先命中。
 *
 * 其中的 `\s*` 后面紧跟字面量 `:`，字符集不相交，不构成共享量词，无需豁免。
 */
const PATH_VALUE_PATTERNS: Record<string, RegExp> = {
  path: /"path"\s*:\s*"((?:\\.|[^"\\])*)"/,
  target_notebook: /"target_notebook"\s*:\s*"((?:\\.|[^"\\])*)"/,
}

/**
 * patch header 里的目标文件名。
 *
 * **刻意保持 `\s+` 原样** —— 曾被改成 `[^\S\n]+`（形状上更像安全的写法），
 * 但那会**收窄接受的语言**：`\s` 含 `\n`，所以 `File:` 后面直接换行时原写法
 * 仍能匹配到下一行的路径，改后则整体不匹配。400k 条结构感知随机输入里
 * 两者在消费点（`p[1].trim()`）上有 53428 条不同，全部是「原来能取到路径、
 * 改后取不到」。
 *
 * 保留 `\s+` 的性能代价也确实存在，但实测**改不改一样**（8192 空格的最坏
 * 输入：原 17.07ms / 改 16.49ms，同量级），说明真正的开销来自 `(.+?)` 的
 * 线性回溯而非 `\s` 的重叠，所以这次改动**只带来回归、不带来收益**。
 * 输入又是模型自己流出的 tool_use 参数（不是不可信文件内容），
 * 因此选择保留原语义并在此局部豁免该规则。
 */
// eslint-disable-next-line regexp/no-super-linear-backtracking -- 见上：改法会收窄接受语言且无性能收益
const PATCH_FILE_HEADER_PATTERN = /\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+?)(?:\\n|\n)/

export function detectEditPathFromToolInput(toolName: string, rawInput: string): string {
  const pathKey = toolName === 'EditNotebook' ? 'target_notebook' : 'path'
  const m = rawInput.match(PATH_VALUE_PATTERNS[pathKey]!)
  if (m?.[1])
    return decodeJsonStringFragment(m[1])
  if (toolName === 'ApplyPatch') {
    const p = rawInput.match(PATCH_FILE_HEADER_PATTERN)
    if (p?.[1])
      return p[1].trim()
  }
  return ''
}

export function normalizeDetectedEditPath(rawPath: string): string {
  return rawPath || ''
}

function decodeJsonStringFragment(value: string): string {
  return value.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})/g, (_match, esc: string) => {
    if (esc === 'b')
      return '\b'
    if (esc === 'f')
      return '\f'
    if (esc === 'n')
      return '\n'
    if (esc === 'r')
      return '\r'
    if (esc === 't')
      return '\t'
    if (esc.startsWith('u'))
      return String.fromCharCode(Number.parseInt(esc.slice(1), 16))
    return esc
  })
}

function decodeEscape(ch: string): string {
  switch (ch) {
    case 'n': return '\n'
    case 't': return '\t'
    case '\\': return '\\'
    case '"': return '"'
    case '/': return '/'
    case 'r': return '\r'
    default: return `\\${ch}`
  }
}

/**
 * 增量 JSON 值提取器 — flat scanner。
 *
 * 从 LLM 流式 tool_use 参数（JSON chunks）中提取:
 * 1. path（通过 regex 在累积文本上匹配）
 * 2. 目标字段值（通过状态机扫描 key/value string pairs）
 *
 * 不做完整 JSON parse。忽略 {/[/]/} 结构字符，只关注 "key":"value"。
 * 对嵌套结构（如旧 edits[] 内的 newText）也能自然工作。
 */
export class EditDeltaExtractor {
  private state: 'SCAN' | 'IN_KEY' | 'COLON' | 'IN_VAL' | 'SKIP_VAL' | 'DONE' = 'SCAN'
  private key = ''
  private esc = false
  private buf = ''
  private readonly target: string
  private pendingOutputCR = false
  detectedPath = ''

  constructor(private readonly toolName: string) {
    this.target = EDIT_TARGET_FIELD[toolName] ?? 'patch'
  }

  feed(delta: string): string | null {
    this.buf += delta
    if (!this.detectedPath)
      this.detectedPath = detectEditPathFromToolInput(this.toolName, this.buf)
    if (this.state === 'DONE')
      return null

    let out = ''
    for (let i = 0; i < delta.length; i++) {
      const c = delta[i]

      if (this.esc) {
        this.esc = false
        if (this.state === 'IN_VAL')
          out += decodeEscape(c)
        else if (this.state === 'IN_KEY')
          this.key += c
        continue
      }

      switch (this.state) {
        case 'SCAN':
          if (c === '"') {
            this.state = 'IN_KEY'
            this.key = ''
          }
          break

        case 'IN_KEY':
          if (c === '\\')
            this.esc = true
          else if (c === '"')
            this.state = 'COLON'
          else
            this.key += c
          break

        case 'COLON':
          if (c === ':' || c === ' ' || c === '\t')
            break
          if (c === '"')
            this.state = this.key === this.target ? 'IN_VAL' : 'SKIP_VAL'
          else
            this.state = 'SCAN'
          break

        case 'IN_VAL':
          if (c === '\\') {
            // 转义序列可能被切成两个 chunk，末尾的孤立反斜杠留到下一轮
            if (i + 1 < delta.length)
              out += decodeEscape(delta[++i])
            else
              this.esc = true
          }
          else if (c === '"') {
            this.state = 'DONE'
          }
          else {
            out += c
          }
          break

        case 'SKIP_VAL':
          if (c === '\\') {
            if (i + 1 < delta.length)
              i++
            else
              this.esc = true
          }
          else if (c === '"') {
            this.state = 'SCAN'
          }
          break
      }

      if (this.state === 'DONE')
        break
    }

    const normalizedOut = this.normalizeOutputDelta(out, this.state === 'DONE')
    return normalizedOut || null
  }

  private normalizeOutputDelta(text: string, flushPendingCR: boolean): string {
    if (!text) {
      if (flushPendingCR && this.pendingOutputCR) {
        this.pendingOutputCR = false
        return '\n'
      }
      return ''
    }

    let value = text
    let prefix = ''
    if (this.pendingOutputCR) {
      this.pendingOutputCR = false
      if (value.startsWith('\n'))
        value = value.slice(1)
      prefix = '\n'
    }

    if (!flushPendingCR && value.endsWith('\r')) {
      this.pendingOutputCR = true
      value = value.slice(0, -1)
    }

    return prefix + value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  }
}
