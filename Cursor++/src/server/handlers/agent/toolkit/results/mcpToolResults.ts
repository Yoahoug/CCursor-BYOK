import type { ToolResultEnvelope } from './shared'
import {
  arr,
  bool,
  envelope,
  obj,
  resultCase,
  str,
  truncate,

} from './shared'

/**
 * MCP image data 防御性处理: proto McpImageContent.data 是 bytes,
 * 如果 MCP server 返回 undefined / base64 string / 非 bytes → proto 序列化 crash:
 *   "cannot encode field agent.v1.McpImageContent.data to binary: invalid uint32: undefined"
 * 导致 SSE stream 断开 + 客户端 checkpoint corrupt + 历史消息丢失。
 */
export function normalizeImageData(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array)
    return raw
  if (Buffer.isBuffer(raw))
    return new Uint8Array(raw)
  if (typeof raw === 'string') {
    try { return new Uint8Array(Buffer.from(raw, 'base64')) }
    catch { return new Uint8Array(Buffer.from(raw, 'utf-8')) }
  }
  return new Uint8Array(0)
}

/**
 * 渲染客户端溢写到文件的 MCP 输出。
 *
 * 客户端 (cursor-agent-exec) 在 MCP 工具响应超过 40000 bytes 时,会把内容写到
 * {projectDir}/agent-tools/{uuid}.txt,然后把该 content item 的 text 置空、
 * 改带 output_location {file_path, size_bytes, line_count} 回传。
 *
 * 若只读 text,这里会得到空串并被 filter 掉,LLM 只看到
 * "MCP tool completed successfully." —— 以为工具没有输出,实际结果在文件里。
 *
 * 文案 1:1 复刻客户端渲染函数 (main.unminify.js:25866 附近):
 *   `${leadText ?? 'Content'} written to file: ${filePath}`
 *   `Size: ${1024 以上按 KB 一位小数,否则 bytes}, ${lineCount} lines`
 */
function formatOutputLocation(location: Record<string, unknown>): string {
  const filePath = str(location.filePath)
  if (!filePath)
    return ''
  const sizeBytes = Number(location.sizeBytes ?? 0)
  const lineCount = Number(location.lineCount ?? 0)
  const size = sizeBytes >= 1024 ? `${(sizeBytes / 1024).toFixed(1)} KB` : `${sizeBytes} bytes`
  return `Content written to file: ${filePath}\nSize: ${size}, ${lineCount} lines`
}

function normalizeMcpContentItem(value: unknown): Record<string, unknown> {
  const item = obj(value)
  const content = obj(item.content)

  if (typeof content.case === 'string') {
    if (content.case === 'text') {
      const textValue = obj(content.value)
      return {
        content: {
          case: 'text',
          value: {
            text: str(textValue.text),
            ...(textValue.outputLocation ? { outputLocation: obj(textValue.outputLocation) } : {}),
          },
        },
      }
    }
    if (content.case === 'image') {
      const imageValue = obj(content.value)
      return {
        content: {
          case: 'image',
          value: {
            data: normalizeImageData(imageValue.data),
            mimeType: str(imageValue.mimeType),
          },
        },
      }
    }
  }

  if (item.text) {
    const textValue = obj(item.text)
    return {
      content: {
        case: 'text',
        value: {
          text: str(textValue.text),
          ...(textValue.outputLocation ? { outputLocation: obj(textValue.outputLocation) } : {}),
        },
      },
    }
  }
  if (item.image) {
    const imageValue = obj(item.image)
    return {
      content: {
        case: 'image',
        value: {
          data: normalizeImageData(imageValue.data),
          mimeType: str(imageValue.mimeType),
        },
      },
    }
  }

  return {
    content: {
      case: 'text',
      value: {
        text: '',
      },
    },
  }
}

export function buildMcpExecToolResult(
  cursorToolType: string,
  execClientMsg: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolResultEnvelope | null {
  switch (cursorToolType) {
    case 'mcpToolCall': {
      const mr = obj(execClientMsg.mcpResult)
      const mc = resultCase(mr)
      return mc ? { result: mc } : { result: { case: 'error', value: { error: 'no result' } } }
    }
    case 'listMcpResourcesToolCall': {
      const lr = obj(execClientMsg.listMcpResourcesExecResult)
      const lc = resultCase(lr)
      return lc ? { result: lc } : { result: { case: 'error', value: { error: 'no result' } } }
    }
    case 'readMcpResourceToolCall': {
      const rr = obj(execClientMsg.readMcpResourceExecResult)
      const rc = resultCase(rr)
      return rc ? { result: rc } : { result: { case: 'error', value: { error: 'no result', uri: str(input.uri) } } }
    }
    default:
      return null
  }
}

export function normalizeMcpToolResult(
  cursorToolType: string,
  resultCaseName: string,
  value: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolResultEnvelope | null {
  switch (cursorToolType) {
    case 'getMcpToolsToolCall':
      if (resultCaseName === 'success') {
        return envelope('success', {
          content: str(value.content),
          ...(typeof value.outputFilePath === 'string'
            ? { outputFilePath: value.outputFilePath }
            : {}),
        })
      }
      return envelope(resultCaseName || 'error', value)
    case 'mcpToolCall':
      if (resultCaseName === 'success') {
        return envelope('success', {
          content: arr<Record<string, unknown>>(value.content).map(normalizeMcpContentItem),
          isError: bool(value.isError),
          ...(value.structuredContent ? { structuredContent: obj(value.structuredContent) } : {}),
        })
      }
      return envelope(resultCaseName || 'error', value)
    case 'listMcpResourcesToolCall':
      if (resultCaseName === 'success') {
        return envelope('success', {
          resources: arr<Record<string, unknown>>(value.resources).map(resource => ({
            uri: str(resource.uri),
            server: str(resource.server),
            ...(typeof resource.name === 'string' ? { name: resource.name } : {}),
            ...(typeof resource.description === 'string' ? { description: resource.description } : {}),
            ...(typeof resource.mimeType === 'string' ? { mimeType: resource.mimeType } : {}),
            annotations: Object.fromEntries(
              Object.entries(obj(resource.annotations)).map(([key, v]) => [key, str(v)]),
            ),
          })),
        })
      }
      return envelope(resultCaseName || 'error', value)
    case 'readMcpResourceToolCall':
      if (resultCaseName === 'success') {
        const annotations = Object.fromEntries(
          Object.entries(obj(value.annotations)).map(([key, v]) => [key, str(v)]),
        )
        const content = obj(value.content)
        const normalizedContent = typeof content.case === 'string'
          ? content
          : (typeof value.text === 'string'
              ? { case: 'text', value: value.text }
              : { case: 'blob', value: value.blob })
        return envelope('success', {
          uri: str(value.uri, str(input.uri)),
          ...(typeof value.name === 'string' ? { name: value.name } : {}),
          ...(typeof value.description === 'string' ? { description: value.description } : {}),
          ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
          annotations,
          ...(typeof value.downloadPath === 'string' ? { downloadPath: value.downloadPath } : {}),
          content: normalizedContent,
        })
      }
      return envelope(resultCaseName || 'error', value)
    default:
      return null
  }
}

export function buildMcpToolResultText(
  cursorToolType: string,
  resultCaseName: string,
  value: Record<string, unknown>,
): string | null {
  switch (cursorToolType) {
    case 'getMcpToolsToolCall':
      if (resultCaseName === 'success')
        return str(value.content) || 'No dynamic tools matched the query.'
      return `Get dynamic tools ${resultCaseName || 'error'}: ${JSON.stringify(value)}`
    case 'mcpToolCall':
      if (resultCaseName === 'success') {
        const items = arr<Record<string, unknown>>(value.content)
        const lines = items.map((item) => {
          const content = obj(item.content)
          if (content.case === 'text') {
            const textValue = obj(content.value)
            const text = str(textValue.text)
            // 溢写的 item: text 为空,真正内容在 outputLocation 指向的文件里
            if (!text && textValue.outputLocation)
              return formatOutputLocation(obj(textValue.outputLocation))
            return text
          }
          if (content.case === 'image')
            return `[image ${str(obj(content.value).mimeType, 'unknown')}]`
          return JSON.stringify(item)
        }).filter(Boolean)
        if (lines.length > 0)
          return truncate(lines.join('\n\n'), 12000)
        if (value.structuredContent)
          return truncate(JSON.stringify(value.structuredContent, null, 2), 12000)
        return 'MCP tool completed successfully.'
      }
      return `MCP ${resultCaseName || 'error'}: ${JSON.stringify(value)}\n<system_reminder>\nThe MCP server rejected these arguments as invalid. Before retrying, inspect this MCP tool's input schema/tool definition and rebuild the arguments from that schema.\n</system_reminder>`
    case 'listMcpResourcesToolCall':
      if (resultCaseName === 'success') {
        const resources = arr<Record<string, unknown>>(value.resources)
        return resources.length > 0
          ? truncate(resources.map(resource => `${str(resource.server)} ${str(resource.uri)}${str(resource.name) ? ` — ${str(resource.name)}` : ''}`).join('\n'))
          : 'No MCP resources available.'
      }
      return `List MCP resources ${resultCaseName || 'error'}: ${JSON.stringify(value)}`
    case 'readMcpResourceToolCall':
      if (resultCaseName === 'success') {
        const content = obj(value.content)
        if (content.case === 'text')
          return truncate(str(content.value), 12000)
        if (content.case === 'blob')
          return `Read MCP resource ${str(value.uri)} (binary blob).`
        return truncate(JSON.stringify(value), 12000)
      }
      return `Read MCP resource ${resultCaseName || 'error'}: ${JSON.stringify(value)}`
    default:
      return null
  }
}
