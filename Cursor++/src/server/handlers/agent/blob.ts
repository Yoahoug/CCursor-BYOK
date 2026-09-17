/**
 * KV Blob Store 处理
 *
 * Agent 协议使用 KV Blob Store 传输大块数据:
 *   - Server → Client: kvServerMessage.setBlobArgs { blobId, blobData }
 *   - Client → Server: kvClientMessage.setBlobResult { id? }
 *
 * blobData 是 base64 编码的 JSON，解码后为标准 LLM 消息格式:
 *   { "role": "system", "content": "..." }
 *   { "role": "user", "content": "..." }
 *   { "role": "assistant", "content": [...] }
 */
import { createHash } from 'node:crypto'

function finalizeBlobData(blobData: string): { blobId: string, blobData: string } {
  const blobId = createHash('sha256').update(blobData).digest('base64')
  return { blobId, blobData }
}

/** 将 JSON 对象编码为 blob (base64) 并计算 blobId (sha256) */
export function encodeBlob(data: unknown): { blobId: string, blobData: string } {
  const json = JSON.stringify(data)
  return finalizeBlobData(Buffer.from(json).toString('base64'))
}

/**
 * 将 protobuf / binary 数据编码为 blob (base64) 并计算 blobId (sha256)。
 *  blobDataRaw 保留原始 bytes，供 kvMessage 直接发给客户端（fork 时客户端 fromBinary 需要 raw protobuf）。
 */
export function encodeBinaryBlob(bytes: Uint8Array): { blobId: string, blobData: string, blobDataRaw: Uint8Array } {
  const { blobId, blobData } = finalizeBlobData(Buffer.from(bytes).toString('base64'))
  return { blobId, blobData, blobDataRaw: bytes }
}

/** 解码 blob base64 → JSON */
export function decodeBlob(blobData: string): unknown {
  const json = Buffer.from(blobData, 'base64').toString('utf-8')
  return JSON.parse(json)
}

/** 构造 system prompt blob */
export function buildSystemPromptBlob(modelId: string): { blobId: string, blobData: string } {
  return encodeBlob({
    role: 'system',
    content: `You are an AI coding assistant, powered by ${modelId}.\n\nYou operate in Cursor.\n\nYou are a coding agent that helps the USER with software engineering tasks.`,
  })
}

/** 构造 user message blob */
export function buildUserMessageBlob(
  text: string,
  env?: { osVersion?: string, shell?: string, workspacePaths?: string[] },
): { blobId: string, blobData: string } {
  let content = ''

  if (env) {
    content += '<user_info>\n'
    if (env.osVersion)
      content += `OS Version: ${env.osVersion}\n`
    if (env.shell)
      content += `Shell: ${env.shell}\n`
    if (env.workspacePaths?.length)
      content += `Workspace Path: ${env.workspacePaths[0]}\n`
    content += '</user_info>\n\n'
  }

  content += `<user_query>\n${text}\n</user_query>`

  return encodeBlob({ role: 'user', content })
}
