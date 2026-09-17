/**
 * 用量统计的共享契约与纯计算
 *
 * 放在 shared/ 而不是 server/：webview 要按这个形状消费统计结果，
 * 但不该为了几个类型把 fs / SDK 拖进浏览器包。这里只有类型和纯函数。
 */
import type { ProviderType } from '../server/data/defaults'

/** LLM 层原样上报的 usage（各协议字段语义不一致，见 normalizeUsage） */
export interface RawUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/**
 * 归一化后的用量。
 *
 * 存在的唯一理由是：四种协议的 inputTokens 口径不同，不归一化就算不出
 * 可比较的缓存命中率 —— 见 normalizeUsage 的注释。
 */
export interface NormalizedUsage {
  /** 完整 prompt 规模（包含命中缓存的那部分），跨协议可直接比较 */
  promptTokens: number
  /** 未命中缓存的 prompt tokens —— 缓存命中率的分母 */
  nonCachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

/**
 * 把某个协议上报的 usage 折算成统一口径。
 *
 * 各协议对"输入 token"的定义并不一致：
 *   - anthropic        : input_tokens 不含缓存读写，缓存量在独立字段里
 *   - openai-chat      : prompt_tokens 已包含 cached_tokens（是它的子集）
 *   - openai-responses : input_tokens  已包含 cached_tokens（是它的子集）
 *   - gemini           : promptTokenCount 已包含隐式缓存命中
 * 直接相加会把 anthropic 的 prompt 少算、把 openai 的缓存重复计入。
 */
export function normalizeUsage(type: ProviderType, usage: RawUsage): NormalizedUsage {
  const cacheReadTokens = usage.cacheReadTokens ?? 0
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const cacheCountedSeparately = type === 'anthropic'

  const promptTokens = cacheCountedSeparately
    ? usage.inputTokens + cacheReadTokens + cacheWriteTokens
    : usage.inputTokens

  // 缓存写入是"为后续命中付的费"，不属于命中，但确实是非缓存输入成本，
  // 因此只从 input 里扣掉 cacheRead。
  const nonCachedInputTokens = cacheCountedSeparately
    ? usage.inputTokens
    : Math.max(0, usage.inputTokens - cacheReadTokens)

  return { promptTokens, nonCachedInputTokens, cacheReadTokens, cacheWriteTokens, outputTokens }
}

/**
 * 缓存命中率 = 缓存读取 / (缓存读取 + 未命中输入)。
 *
 * 分母为 0 时返回 null 而不是 0 —— "没有数据"和"命中率为零"是两回事，
 * UI 上要能区分（前者显示 —，后者显示 0%）。
 */
export function cacheHitRate(cacheReadTokens: number, nonCachedInputTokens: number): number | null {
  const denominator = cacheReadTokens + nonCachedInputTokens
  if (denominator <= 0)
    return null
  return cacheReadTokens / denominator
}

/** 本地时区的 YYYY-MM-DD —— 按天分桶要和用户看到的日期一致，不能用 UTC */
export function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 落盘的用量记录 —— 一条记录 = 一轮完成的 LLM 调用
 *
 * provider 存的是**写入时的显示名**：统计是给人看的，而记录是追加写，
 * 改名之后无法从名字反推回 id。为了改名不让同一个中转站被拆成两行，
 * providerId 也一并落盘 —— 显示名可以按 id 重新解析（见 usageStore 的
 * withCurrentProviderNames），只有老记录没有这个字段时才退回按名字匹配。
 */
export interface UsageRecord extends NormalizedUsage {
  ts: number
  provider: string
  providerId?: string
  model: string
  providerType: ProviderType
}

/**
 * 把一个中转站的新名字应用到历史记录上。
 *
 * 纯函数，便于单测；文件读写留在 server/stats/usageStore.ts。
 *
 * 匹配分两种，因为记录里不一定有 id：
 *   - 有 providerId 的记录：按 id 精确匹配，改多少次都不会错位
 *   - 老记录（无 providerId）：退回按旧名字匹配
 * 后者理论上会误伤"曾经同名"的另一个中转站，但老记录本来就没有 id，
 * 这是能拿到的最好的判据。
 */
export function renameProviderInRecords(
  records: UsageRecord[],
  rename: { providerId: string, previousName: string, nextName: string },
): { records: UsageRecord[], changed: number } {
  let changed = 0
  const next = records.map((record) => {
    const matchesById = record.providerId === rename.providerId
    const matchesLegacyName = record.providerId === undefined && record.provider === rename.previousName
    if (!matchesById && !matchesLegacyName)
      return record
    // 已经是对齐过的记录不用再动，避免无谓的重写
    if (record.provider === rename.nextName && record.providerId === rename.providerId)
      return record
    changed += 1
    return { ...record, provider: rename.nextName, providerId: rename.providerId }
  })
  return { records: next, changed }
}

export interface UsageTotals extends NormalizedUsage {
  calls: number
  cacheHitRate: number | null
}

export interface UsageDay extends UsageTotals {
  date: string
}

export interface UsageModelRow extends UsageTotals {
  provider: string
  model: string
}

export interface UsageSummary {
  generatedAt: number
  /** 统计窗口天数 */
  windowDays: number
  /**
   * 窗口（最近 windowDays 天）内的合计 —— 趋势图与「按模型」表用的就是这个口径。
   *
   * 刻意不叫 total：面板上还有一个「全部累计」的口径，两个都叫 total 会分不清。
   */
  window: UsageTotals
  /** 今日（本地时区当天）合计 —— 和 byDay 的分桶口径一致 */
  today: UsageTotals
  /**
   * 全部记录合计，不受 windowDays 限制。
   *
   * 注意它不是「开天辟地以来」：用量文件超过裁剪阈值时会丢最旧的记录
   * （见 usageStore 的 trimIfTooLarge），所以这是「文件里还在的最全口径」。
   */
  allTime: UsageTotals
  /** 按天升序，含窗口内没有任何调用的空白天（趋势图需要连续时间轴） */
  byDay: UsageDay[]
  /** 按 prompt tokens 降序 */
  byModel: UsageModelRow[]
  /** 最早一条记录的时间 —— 「全部累计」用它说明统计起点 */
  firstRecordAt: number | null
  /**
   * 最晚一条记录的时间。
   *
   * 和 firstRecordAt 配对给出「累计」的真实覆盖区间。刻意不拿"今天"当区间终点：
   * 那样在几天没用之后会显示成截止到今天，看起来像是有数据，实际没有。
   */
  lastRecordAt: number | null
}

export const USAGE_SUMMARY_WINDOW_DAYS = 14

export function emptyUsageTotals(): UsageTotals {
  return {
    calls: 0,
    promptTokens: 0,
    nonCachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    cacheHitRate: null,
  }
}

function finalizeTotals(totals: UsageTotals): UsageTotals {
  return { ...totals, cacheHitRate: cacheHitRate(totals.cacheReadTokens, totals.nonCachedInputTokens) }
}

/** 把一条记录累加进合计对象。三处口径（窗口/今日/全部）共用，避免逐字段重复。 */
function accumulate(totals: UsageTotals, record: UsageRecord): void {
  totals.calls += 1
  totals.promptTokens += record.promptTokens
  totals.nonCachedInputTokens += record.nonCachedInputTokens
  totals.cacheReadTokens += record.cacheReadTokens
  totals.cacheWriteTokens += record.cacheWriteTokens
  totals.outputTokens += record.outputTokens
}

/**
 * 聚合出面板需要的统计摘要。
 *
 * 纯函数：不碰 fs，便于单测。读写文件的部分在 server/stats/usageStore.ts。
 *
 * 一次遍历同时算出三个口径，而不是过滤三遍：
 *   window  —— 最近 windowDays 天，趋势图与「按模型」表用
 *   today   —— 本地时区当天，与 byDay 的分桶口径一致
 *   allTime —— 全部记录，不受窗口限制
 * byDay 会补齐窗口内没有调用的空白天 —— 趋势图的横轴必须连续，
 * 否则"某天没用"会看起来像"那天不存在"。
 */
export function aggregateUsage(
  records: UsageRecord[],
  options: { windowDays?: number, now?: number } = {},
): UsageSummary {
  const windowDays = options.windowDays ?? USAGE_SUMMARY_WINDOW_DAYS
  const now = options.now ?? Date.now()
  const windowStart = now - windowDays * 24 * 60 * 60 * 1000
  // 今日用 dayKey 而不是"最近 24 小时"：面板上的「今日」要和趋势图那天
  // 对得上，否则同一批数据在两处会显示成不同的量。
  const todayKey = dayKey(now)

  const windowTotals = emptyUsageTotals()
  const todayTotals = emptyUsageTotals()
  const allTimeTotals = emptyUsageTotals()
  const dayBuckets = new Map<string, UsageTotals>()
  const modelBuckets = new Map<string, UsageTotals & { provider: string, model: string }>()

  for (const record of records) {
    accumulate(allTimeTotals, record)

    const recordDayKey = dayKey(record.ts)
    if (recordDayKey === todayKey)
      accumulate(todayTotals, record)

    // 窗口外要跳过但**不能提前 continue** —— allTime 已经累加过了
    if (record.ts < windowStart)
      continue

    accumulate(windowTotals, record)

    const day = dayBuckets.get(recordDayKey) ?? emptyUsageTotals()
    accumulate(day, record)
    dayBuckets.set(recordDayKey, day)

    // provider 与 model 一起做键：不同家的同名模型（比如都在转发 gpt-5）要分开看，
    // 否则命中率会被两家不同的缓存策略平均掉，反而看不出问题
    const modelBucketKey = `${record.provider}\u0000${record.model}`
    const row = modelBuckets.get(modelBucketKey) ?? { ...emptyUsageTotals(), provider: record.provider, model: record.model }
    accumulate(row, record)
    modelBuckets.set(modelBucketKey, row)
  }

  const byDay: UsageDay[] = []
  for (let offset = windowDays - 1; offset >= 0; offset--) {
    const bucketKey = dayKey(now - offset * 24 * 60 * 60 * 1000)
    const bucket = dayBuckets.get(bucketKey) ?? emptyUsageTotals()
    byDay.push({ date: bucketKey, ...finalizeTotals(bucket) })
  }

  const byModel = [...modelBuckets.values()]
    .map(row => finalizeTotals(row) as UsageTotals & { provider: string, model: string })
    .sort((a, b) => b.promptTokens - a.promptTokens)

  // 记录不保证有序（追加写是按时间来的，但手动改过或裁剪后就说不准），
  // 所以一次遍历同时取最小与最大，不假设首尾
  let firstRecordAt: number | null = null
  let lastRecordAt: number | null = null
  for (const record of records) {
    if (firstRecordAt === null || record.ts < firstRecordAt)
      firstRecordAt = record.ts
    if (lastRecordAt === null || record.ts > lastRecordAt)
      lastRecordAt = record.ts
  }

  return {
    generatedAt: now,
    windowDays,
    window: finalizeTotals(windowTotals),
    today: finalizeTotals(todayTotals),
    allTime: finalizeTotals(allTimeTotals),
    byDay,
    byModel,
    firstRecordAt,
    lastRecordAt,
  }
}
