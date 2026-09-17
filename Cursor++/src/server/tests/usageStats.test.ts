import type { UsageRecord } from '../../shared/usageTypes'
import { describe, expect, it } from 'vitest'
import { aggregateUsage, cacheHitRate, dayKey, normalizeUsage, renameProviderInRecords } from '../../shared/usageTypes'

function recordAt(timestamp: number, overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    ts: timestamp,
    provider: 'CPA-ant',
    model: 'deepseek-v4.1-flash',
    providerType: 'anthropic',
    promptTokens: 1000,
    nonCachedInputTokens: 200,
    cacheReadTokens: 800,
    cacheWriteTokens: 0,
    outputTokens: 50,
    ...overrides,
  }
}

describe('normalizeUsage — 协议口径归一化', () => {
  it('anthropic 的 input_tokens 不含缓存，需要补回缓存读写', () => {
    const result = normalizeUsage('anthropic', {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 900,
      cacheWriteTokens: 50,
    })
    expect(result.promptTokens).toBe(1050)
    expect(result.nonCachedInputTokens).toBe(100)
    expect(result.cacheReadTokens).toBe(900)
    expect(result.cacheWriteTokens).toBe(50)
  })

  it('openai-chat 的 prompt_tokens 已含缓存，未命中量要从中扣除', () => {
    const result = normalizeUsage('openai-chat', {
      inputTokens: 1000,
      outputTokens: 20,
      cacheReadTokens: 900,
    })
    expect(result.promptTokens).toBe(1000)
    expect(result.nonCachedInputTokens).toBe(100)
  })

  it('openai-responses 与 openai-chat 口径一致', () => {
    const result = normalizeUsage('openai-responses', {
      inputTokens: 1000,
      outputTokens: 20,
      cacheReadTokens: 900,
    })
    expect(result.promptTokens).toBe(1000)
    expect(result.nonCachedInputTokens).toBe(100)
  })

  it('gemini 无缓存字段时全部计入未命中输入', () => {
    const result = normalizeUsage('gemini', { inputTokens: 1000, outputTokens: 20 })
    expect(result.promptTokens).toBe(1000)
    expect(result.nonCachedInputTokens).toBe(1000)
    expect(result.cacheReadTokens).toBe(0)
  })

  it('openai 上报的缓存量超过 prompt 时未命中量收敛到 0，不出现负数', () => {
    const result = normalizeUsage('openai-chat', {
      inputTokens: 100,
      outputTokens: 1,
      cacheReadTokens: 500,
    })
    expect(result.nonCachedInputTokens).toBe(0)
  })

  it('缺失的缓存字段按 0 处理，不产生 NaN', () => {
    const result = normalizeUsage('anthropic', { inputTokens: 10, outputTokens: 5 })
    expect(result.promptTokens).toBe(10)
    expect(Number.isNaN(result.promptTokens)).toBe(false)
    expect(result.cacheWriteTokens).toBe(0)
  })

  it('同一份实际用量在两种协议下算出的未命中量一致', () => {
    // 真实场景：prompt 共 1000 token，其中 900 命中缓存。
    // anthropic 把未命中量放在 input_tokens；openai 放在 prompt_tokens 并内含命中量。
    const anthropic = normalizeUsage('anthropic', { inputTokens: 100, outputTokens: 0, cacheReadTokens: 900 })
    const openai = normalizeUsage('openai-chat', { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 900 })
    expect(anthropic.nonCachedInputTokens).toBe(openai.nonCachedInputTokens)
    expect(anthropic.promptTokens).toBe(openai.promptTokens)
  })
})

describe('cacheHitRate', () => {
  it('分母为 0 时返回 null，而不是 0', () => {
    expect(cacheHitRate(0, 0)).toBeNull()
  })

  it('有未命中输入但没有缓存读取时命中率为 0', () => {
    expect(cacheHitRate(0, 100)).toBe(0)
  })

  it('全部命中时为 1', () => {
    expect(cacheHitRate(100, 0)).toBe(1)
  })

  it('按 缓存读取 / (缓存读取 + 未命中) 计算', () => {
    expect(cacheHitRate(900, 100)).toBeCloseTo(0.9, 10)
  })
})

describe('dayKey', () => {
  it('用本地时区补零成 YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 30).getTime())).toBe('2026-01-05')
  })

  it('跨月边界的日期同样补零', () => {
    expect(dayKey(new Date(2026, 11, 31, 0, 0).getTime())).toBe('2026-12-31')
  })
})

describe('aggregateUsage', () => {
  const now = new Date(2026, 5, 20, 12, 0).getTime()
  const dayMs = 24 * 60 * 60 * 1000

  it('按天分桶并补齐窗口内的空白天', () => {
    const records = [
      recordAt(now - dayMs * 2, { promptTokens: 500, cacheReadTokens: 400, nonCachedInputTokens: 100 }),
      recordAt(now, { promptTokens: 1000, cacheReadTokens: 800, nonCachedInputTokens: 200 }),
    ]
    const summary = aggregateUsage(records, { windowDays: 5, now })
    expect(summary.byDay).toHaveLength(5)
    expect(summary.byDay[0]?.calls).toBe(0)
    expect(summary.byDay[2]?.calls).toBe(1)
    expect(summary.byDay[4]?.calls).toBe(1)
  })

  it('窗口外的记录不计入窗口口径', () => {
    const records = [recordAt(now - dayMs * 40), recordAt(now)]
    const summary = aggregateUsage(records, { windowDays: 14, now })
    expect(summary.window.calls).toBe(1)
  })

  it('汇总 prompt/输出/缓存读写并算出整体命中率', () => {
    const records = [
      recordAt(now, { promptTokens: 1000, cacheReadTokens: 900, nonCachedInputTokens: 100, outputTokens: 10 }),
      recordAt(now, { promptTokens: 1000, cacheReadTokens: 700, nonCachedInputTokens: 300, outputTokens: 20 }),
    ]
    const summary = aggregateUsage(records, { windowDays: 14, now })
    expect(summary.window.calls).toBe(2)
    expect(summary.window.promptTokens).toBe(2000)
    expect(summary.window.outputTokens).toBe(30)
    expect(summary.window.cacheReadTokens).toBe(1600)
    expect(summary.window.cacheHitRate).toBeCloseTo(1600 / 2000, 10)
  })

  it('按模型聚合，同一模型名在不同 provider 下分开统计', () => {
    const records = [
      recordAt(now, { provider: 'A', model: 'm1', promptTokens: 100 }),
      recordAt(now, { provider: 'B', model: 'm1', promptTokens: 300 }),
      recordAt(now, { provider: 'A', model: 'm1', promptTokens: 100 }),
    ]
    const summary = aggregateUsage(records, { windowDays: 14, now })
    expect(summary.byModel).toHaveLength(2)
    expect(summary.byModel[0]?.provider).toBe('B')
    expect(summary.byModel[0]?.calls).toBe(1)
    expect(summary.byModel[1]?.calls).toBe(2)
    expect(summary.byModel[1]?.promptTokens).toBe(200)
  })

  it('按模型聚合结果按 prompt tokens 降序', () => {
    const records = [
      recordAt(now, { model: 'small', promptTokens: 10 }),
      recordAt(now, { model: 'large', promptTokens: 9999 }),
      recordAt(now, { model: 'mid', promptTokens: 500 }),
    ]
    const summary = aggregateUsage(records, { windowDays: 14, now })
    expect(summary.byModel.map(row => row.model)).toEqual(['large', 'mid', 'small'])
  })

  it('空记录集时三个口径都为零且命中率为 null', () => {
    const summary = aggregateUsage([], { windowDays: 14, now })
    expect(summary.window.calls).toBe(0)
    expect(summary.today.calls).toBe(0)
    expect(summary.allTime.calls).toBe(0)
    expect(summary.window.cacheHitRate).toBeNull()
    expect(summary.today.cacheHitRate).toBeNull()
    expect(summary.allTime.cacheHitRate).toBeNull()
    expect(summary.firstRecordAt).toBeNull()
    expect(summary.lastRecordAt).toBeNull()
    expect(summary.byDay).toHaveLength(14)
  })

  it('给出最早与最晚记录时间，用于「累计」的区间说明', () => {
    const records = [recordAt(now - dayMs * 3), recordAt(now), recordAt(now - dayMs * 7)]
    const summary = aggregateUsage(records, { windowDays: 14, now })
    expect(summary.firstRecordAt).toBe(now - dayMs * 7)
    expect(summary.lastRecordAt).toBe(now)
  })

  it('最晚记录时间取的是真实最新记录，不是窗口终点', () => {
    // 窗口是 14 天，但最后一条记录在 2 天前 —— 区间右端应该是那天，
    // 显示成"今天"会让人误以为数据是新的
    const records = [recordAt(now - dayMs * 5), recordAt(now - dayMs * 2)]
    const summary = aggregateUsage(records, { windowDays: 14, now })
    expect(summary.lastRecordAt).toBe(now - dayMs * 2)
    expect(summary.lastRecordAt).not.toBe(now)
  })

  it('无任何缓存读取时整体命中率为 0 而不是 null', () => {
    const records = [recordAt(now, { cacheReadTokens: 0, nonCachedInputTokens: 100 })]
    const summary = aggregateUsage(records, { windowDays: 14, now })
    expect(summary.window.cacheHitRate).toBe(0)
  })

  describe('今日 / 窗口 / 全部 三个口径', () => {
    // 同一时刻的今天与 40 天前各一条：窗口口径只该看到今天那条，
    // 全部口径两条都该看到。
    const oldRecord = recordAt(now - dayMs * 40, { promptTokens: 700, cacheReadTokens: 600, nonCachedInputTokens: 100 })
    const todayRecord = recordAt(now, { promptTokens: 1000, cacheReadTokens: 800, nonCachedInputTokens: 200 })

    it('全部累计不受窗口限制，包含窗口外的记录', () => {
      const summary = aggregateUsage([oldRecord, todayRecord], { windowDays: 14, now })
      expect(summary.allTime.calls).toBe(2)
      expect(summary.allTime.promptTokens).toBe(1700)
      // 窗口口径只看得到窗口内的那条，两者必须能区分开
      expect(summary.window.calls).toBe(1)
    })

    it('今日只统计本地时区当天，不含昨天', () => {
      const yesterday = recordAt(now - dayMs, { promptTokens: 5555 })
      const summary = aggregateUsage([yesterday, todayRecord], { windowDays: 14, now })
      expect(summary.today.calls).toBe(1)
      expect(summary.today.promptTokens).toBe(1000)
      // 昨天那条仍然算进窗口与累计
      expect(summary.window.calls).toBe(2)
      expect(summary.allTime.calls).toBe(2)
    })

    it('今日口径与 byDay 里今天那格对得上', () => {
      const yesterday = recordAt(now - dayMs, { promptTokens: 5555 })
      const summary = aggregateUsage([yesterday, todayRecord], { windowDays: 14, now })
      const todayBucket = summary.byDay[summary.byDay.length - 1]
      expect(todayBucket?.calls).toBe(summary.today.calls)
      expect(todayBucket?.promptTokens).toBe(summary.today.promptTokens)
      expect(todayBucket?.cacheReadTokens).toBe(summary.today.cacheReadTokens)
    })

    it('当天凌晨的记录算今日 —— 跨零点按本地日期切，不按最近 24 小时', () => {
      const justAfterMidnight = new Date(now)
      justAfterMidnight.setHours(0, 5, 0, 0)
      const summary = aggregateUsage([recordAt(justAfterMidnight.getTime())], { windowDays: 14, now })
      expect(summary.today.calls).toBe(1)
    })

    it('每个口径各自算命中率，不相加也不复用别的口径的值', () => {
      // 今天：1000 prompt，900 命中 → 90%
      // 40 天前：1000 prompt，100 命中 / 900 未命中 → 10%
      const old = recordAt(now - dayMs * 40, { promptTokens: 1000, cacheReadTokens: 100, nonCachedInputTokens: 900 })
      const fresh = recordAt(now, { promptTokens: 1000, cacheReadTokens: 900, nonCachedInputTokens: 100 })
      const summary = aggregateUsage([old, fresh], { windowDays: 14, now })
      expect(summary.today.cacheHitRate).toBeCloseTo(0.9, 10)
      expect(summary.window.cacheHitRate).toBeCloseTo(0.9, 10)
      // 累计把两段合起来算：1000 / 2000
      expect(summary.allTime.cacheHitRate).toBeCloseTo(0.5, 10)
    })

    it('窗口内没有任何记录时，窗口口径为零但累计仍有数', () => {
      const summary = aggregateUsage([oldRecord], { windowDays: 14, now })
      expect(summary.window.calls).toBe(0)
      expect(summary.window.cacheHitRate).toBeNull()
      expect(summary.allTime.calls).toBe(1)
      expect(summary.allTime.cacheHitRate).toBeCloseTo(600 / 700, 10)
    })
  })
})

describe('renameProviderInRecords — 改名后同步历史记录', () => {
  const now = new Date(2026, 5, 20, 12, 0).getTime()

  it('老记录没有 providerId，按旧名字改写', () => {
    const records = [recordAt(now, { provider: 'CPA-ant' }), recordAt(now, { provider: 'CPA-ant' })]
    const result = renameProviderInRecords(records, {
      providerId: 'provider-eacddd',
      previousName: 'CPA-ant',
      nextName: 'CPA',
    })
    expect(result.changed).toBe(2)
    expect(result.records.every(record => record.provider === 'CPA')).toBe(true)
    // 顺便补上 id，之后改名就能精确匹配了
    expect(result.records.every(record => record.providerId === 'provider-eacddd')).toBe(true)
  })

  it('带 providerId 的记录按 id 匹配，与记录里存的名字无关', () => {
    // 这条记录的显示名已经不是 previousName（比如被改过两次），但 id 对得上
    const records = [recordAt(now, { provider: 'old-name', providerId: 'p1' })]
    const result = renameProviderInRecords(records, { providerId: 'p1', previousName: 'whatever', nextName: 'new-name' })
    expect(result.changed).toBe(1)
    expect(result.records[0]?.provider).toBe('new-name')
  })

  it('id 不匹配且名字不匹配的记录原样保留', () => {
    const other = recordAt(now, { provider: 'OTHER', providerId: 'p2' })
    const result = renameProviderInRecords([other], { providerId: 'p1', previousName: 'CPA-ant', nextName: 'CPA' })
    expect(result.changed).toBe(0)
    expect(result.records[0]).toEqual(other)
  })

  it('名字相同但 id 不同的记录不会被误改', () => {
    // 老记录按名字匹配有误伤风险，这里明确 id 不同的不应被命中
    const records = [recordAt(now, { provider: 'CPA-ant', providerId: 'p2' })]
    const result = renameProviderInRecords(records, { providerId: 'p1', previousName: 'CPA-ant', nextName: 'CPA' })
    expect(result.changed).toBe(0)
    expect(result.records[0]?.provider).toBe('CPA-ant')
  })

  it('已经对齐的记录不重复计数', () => {
    const records = [recordAt(now, { provider: 'CPA', providerId: 'p1' })]
    const result = renameProviderInRecords(records, { providerId: 'p1', previousName: 'CPA-ant', nextName: 'CPA' })
    expect(result.changed).toBe(0)
  })

  it('只改命中范围内的记录，其余统计口径不受影响', () => {
    const records = [
      recordAt(now, { provider: 'CPA-ant', providerId: 'p1', promptTokens: 100 }),
      recordAt(now, { provider: 'OTHER', providerId: 'p2', promptTokens: 300 }),
    ]
    const result = renameProviderInRecords(records, { providerId: 'p1', previousName: 'CPA-ant', nextName: 'CPA' })
    const summary = aggregateUsage(result.records, { windowDays: 14, now })
    expect(summary.byModel.map(row => row.provider).sort()).toEqual(['CPA', 'OTHER'])
    expect(summary.window.calls).toBe(2)
  })
})
