/**
 * 对话历史管理 — KV Blob Store 协议
 *
 * 遵循 Cursor 官方协议，通过 KV Blob Store 与客户端交互维护对话历史：
 *
 * 第一轮 (conversationState.turns = []):
 *   Server 构造 system/user blob → 发送 setBlobArgs → Client 存储 → 回复 setBlobResult
 *   LLM 响应后 Server 构造 assistant blob → 发送 setBlobArgs → Client 存储
 *   Server 在 checkpoint 中返回所有 blobIds 作为 rootPromptMessagesJson
 *
 * 第二轮+ (conversationState.turns = [blobId1, blobId2, ...]):
 *   Server 发送 getBlobArgs 请求取回每个 blob
 *   Client 通过 getBlobResult 返回 blob 内容
 *   Server 解码所有 blob → 重建 messages 数组
 *   追加当前用户消息 → 调用 LLM
 *
 * Blob 格式 (base64 编码的 JSON):
 *   { "role": "system", "content": "..." }
 *   { "role": "user", "content": "..." }
 *   { "role": "assistant", "content": [...] | "..." }
 */
import type { LLMContentBlock, LLMMessage } from '../llm/types'
import { logger } from '../../logger'

/** 从 blob JSON 解码为 LLMMessage */
export function blobToMessage(blobData: Uint8Array): LLMMessage | null {
  try {
    const json = Buffer.from(blobData).toString('utf-8')
    const obj = JSON.parse(json)
    return {
      role: obj.role,
      content: obj.content,
    }
  }
  catch (e) {
    logger.warn({ error: (e as Error).message }, '[SESSION] failed to decode blob to message')
    return null
  }
}

/** 将 LLMMessage 编码为 blob data */
export function messageToBlob(msg: { role: string, content: string | LLMContentBlock[] }): Uint8Array {
  const json = JSON.stringify(msg)
  return new TextEncoder().encode(json)
}

/**
 * 从 blob 列表重建对话 messages 数组
 *
 * @param blobs - Client 返回的 getBlobResult 内容，按 turns 顺序
 * @returns LLMMessage 数组
 */
export function rebuildMessagesFromBlobs(blobs: Uint8Array[]): LLMMessage[] {
  const messages: LLMMessage[] = []
  for (const blobData of blobs) {
    const msg = blobToMessage(blobData)
    if (msg) {
      messages.push(msg)
    }
  }
  logger.debug({ count: messages.length, roles: messages.map(m => m.role) }, '[SESSION] rebuilt messages from blobs')
  return messages
}
