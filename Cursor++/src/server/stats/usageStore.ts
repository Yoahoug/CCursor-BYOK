/**
 * 用量统计落盘 —— 追加式 JSONL
 *
 * 为什么不用 cursor.db：sqlite 要在扩展宿主里加载原生模块，而这张表会被
 * 高频写入。统计是纯附加数据，丢一条不影响功能，JSONL 追加最省事也最抗损坏
 * （一行坏了只丢一行，不会像 JSON 数组那样整个文件作废）。
 *
 * 口径归一化在写入前完成（见 shared/usageTypes.ts 的 normalizeUsage）——
 * 落盘的是统一口径，聚合时不需要再关心协议差异。
 * 聚合是纯函数，住在 shared/usageTypes.ts，这里只负责文件读写。
 */
import type { UsageRecord, UsageSummary } from '../../shared/usageTypes'
import { appendFile, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { aggregateUsage, renameProviderInRecords } from '../../shared/usageTypes'
import { getCcursorDir } from '../config/paths'
import { loadProviders } from '../config/providersStore'
import { logger } from '../logger'

const USAGE_FILE_NAME = 'usage-stats.jsonl'

/** 超过这个大小就裁剪 —— 单条约 150 字节，8MB 约等于 5 万轮调用 */
const TRIM_THRESHOLD_BYTES = 8 * 1024 * 1024
const TRIM_KEEP_LINES = 20_000

let trimming = false

export function getUsageFilePath(): string {
  return join(getCcursorDir(), USAGE_FILE_NAME)
}

/**
 * 记录一轮调用。
 *
 * 刻意不 await、不抛异常：统计写失败绝不能影响正在进行的对话。
 */
export function recordUsage(record: UsageRecord): void {
  const line = `${JSON.stringify(record)}\n`
  void appendFile(getUsageFilePath(), line, 'utf8').catch((error) => {
    logger.warn({ error }, '[STATS] usage record append failed')
  })
  void trimIfTooLarge()
}

/**
 * 文件超阈值时保留最近的记录重写。
 *
 * 用 trimming 标志防重入：并发触发会让两个写入互相覆盖。
 */
async function trimIfTooLarge(): Promise<void> {
  if (trimming)
    return
  trimming = true
  try {
    const path = getUsageFilePath()
    const info = await stat(path).catch(() => null)
    if (!info || info.size <= TRIM_THRESHOLD_BYTES)
      return
    const content = await readFile(path, 'utf8')
    const lines = content.split('\n').filter(line => line.trim().length > 0)
    if (lines.length <= TRIM_KEEP_LINES)
      return
    await writeFile(path, `${lines.slice(-TRIM_KEEP_LINES).join('\n')}\n`, 'utf8')
    logger.info({ kept: TRIM_KEEP_LINES, dropped: lines.length - TRIM_KEEP_LINES }, '[STATS] usage file trimmed')
  }
  catch (error) {
    logger.warn({ error }, '[STATS] usage file trim failed')
  }
  finally {
    trimming = false
  }
}

function parseRecords(content: string): UsageRecord[] {
  const records: UsageRecord[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed)
      continue
    try {
      const parsed = JSON.parse(trimmed) as UsageRecord
      // 只做最低限度的形状校验：缺 ts 的记录无法分桶，直接丢
      if (typeof parsed?.ts === 'number' && Number.isFinite(parsed.ts))
        records.push(parsed)
    }
    catch {
      // 单行损坏（比如上次写到一半被强杀）不应让整个统计页空白
    }
  }
  return records
}

export async function readUsageRecords(): Promise<UsageRecord[]> {
  const content = await readFile(getUsageFilePath(), 'utf8').catch(() => null)
  if (!content)
    return []
  return parseRecords(content)
}

/**
 * 把记录里的显示名换成当前配置里的名字。
 *
 * 记录落盘时存的是当时的显示名，改名后统计会按名字分桶，同一个中转站因此
 * 被拆成两行、命中率也被拆散。这里在聚合前按 providerId 重新解析一遍，
 * 于是改名立刻反映到仪表盘上，不需要等历史记录被改写。
 * 老记录没有 providerId，只能沿用写入时的名字。
 */
function withCurrentProviderNames(records: UsageRecord[]): UsageRecord[] {
  const nameById = new Map(loadProviders().providers.map(provider => [provider.id, provider.name]))
  return records.map((record) => {
    if (!record.providerId)
      return record
    const currentName = nameById.get(record.providerId)
    if (!currentName || currentName === record.provider)
      return record
    return { ...record, provider: currentName }
  })
}

/**
 * 中转站改名后，把历史记录里的旧名字一并改写。
 *
 * 与 withCurrentProviderNames 是互补的两半：那个负责让带 id 的记录立刻显示新名字，
 * 这个负责把老记录（没有 id、只能按名字匹配）也追平，否则它们会永远留在旧名字下。
 *
 * 只在该 provider 的名字真的变了时由保存流程调用。
 */
export async function renameProviderInUsageFile(
  rename: { providerId: string, previousName: string, nextName: string },
): Promise<number> {
  const path = getUsageFilePath()
  const content = await readFile(path, 'utf8').catch(() => null)
  if (!content)
    return 0

  const { records, changed } = renameProviderInRecords(parseRecords(content), rename)
  if (changed === 0)
    return 0

  // 整体重写：改写要落到每一行，追加式写入做不到
  await writeFile(path, `${records.map(record => JSON.stringify(record)).join('\n')}\n`, 'utf8')
  logger.info(
    { providerId: rename.providerId, from: rename.previousName, to: rename.nextName, changed },
    '[STATS] provider renamed in usage records',
  )
  return changed
}

/** 面板一次调用拿到的完整摘要 */
export async function buildUsageSummary(options: { windowDays?: number, now?: number } = {}): Promise<UsageSummary> {
  const records = await readUsageRecords()
  return aggregateUsage(withCurrentProviderNames(records), options)
}
