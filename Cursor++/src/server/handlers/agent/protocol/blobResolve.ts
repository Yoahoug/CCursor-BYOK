/**
 * Blob 形态字段的二次解包
 *
 * parseRunRequest 是同步函数,只记录 blob 引用。实际从 blobStore 取回数据
 * 依赖 warmup + 同步 get,因此放到 parseRunRequest 之后、进入 hot path 之前
 * 的一次专门 resolve 阶段。
 */
import type { ParsedRunRequest } from './types'
import { logger } from '../../../logger'
import { getCachedBlob } from '../blobStore'

/** 收集 parsed 里所有需要从 blobStore 取回的 blobId (当前仅 extraContextEntries) */
export function collectExtraContextBlobIds(parsed: ParsedRunRequest): string[] {
  return parsed.extraContextEntries
    .filter(e => !e.data && !!e.blobId)
    .map(e => e.blobId!)
}

/**
 * 从 blobStore 里取回 extraContextEntries 的 blob 内容,就地替换 blobId → data。
 * 必须在调用方已经 warmupBlobsAsync 之后调用,否则会 miss。
 *
 * blobStore 里的数据以 base64 存,这里解码为 UTF-8 文本(extra context 本质是
 * 长文本片段,不做 JSON.parse 避免遇到纯文本时失败)。
 * 未命中的条目保留 blobId,让下游模板显示 pending 占位符。
 */
export function resolveExtraContextBlobs(parsed: ParsedRunRequest): { resolved: number, missed: number } {
  let resolved = 0
  let missed = 0
  for (const entry of parsed.extraContextEntries) {
    if (entry.data || !entry.blobId)
      continue
    const cached = getCachedBlob(entry.blobId)
    if (!cached) {
      missed++
      continue
    }
    try {
      entry.data = Buffer.from(cached, 'base64').toString('utf-8')
      delete entry.blobId
      resolved++
    }
    catch (err) {
      logger.warn(
        { blobId: entry.blobId, error: (err as Error).message },
        '[PROTOCOL] failed to decode extra_context blob as utf-8',
      )
      missed++
    }
  }
  if (resolved > 0 || missed > 0) {
    logger.debug({ resolved, missed }, '[PROTOCOL] resolveExtraContextBlobs')
  }
  return { resolved, missed }
}
