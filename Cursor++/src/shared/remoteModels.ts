/**
 * 上游「列出模型」响应的归一化
 *
 * 各家 /models 的字段名不一致，而且中转站还会额外加料，所以解析必须宽容：
 *   - OpenAI 风格   : { data: [{ id, created, owned_by }] }
 *   - Anthropic 风格: { data: [{ id, display_name, created_at }] }
 *   - Gemini        : { models: [{ name: "models/gemini-2.5-flash", ... }] }
 *
 * 最容易踩的坑是**大小写风格**：Anthropic 的 display_name / created_at 是
 * snake_case，而面板内部按 camelCase 消费。只读 camelCase 会让这个字段静默
 * 变成空串 —— 列表里就只能显示 id。
 *
 * 这一点在本项目里格外要紧：部分中转站会故意把 id 混淆成不可读的串
 * （比如把 flash 倒写成 hsalf），此时 display_name 是**唯一**能给用户看的名字。
 * 丢了这个字段，用户面对的就是一列乱码。
 */

/** 上游一条模型（归一化后） */
export interface RemoteModelEntry {
  /** 填进 apiModel 的值 —— 请求时真正发给端点的这个名字 */
  id: string
  /** 上游给的可读名。混淆过 id 的中转站靠它才认得出模型；可能为空 */
  displayName: string
  /** 归属方，仅展示用 */
  ownedBy: string
  /** 排序用的毫秒时间戳；上游没给就是 0 */
  createdAt: number
}

function firstNonEmptyString(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim())
      return candidate.trim()
  }
  return ''
}

/**
 * 把各种时间写法折成毫秒时间戳。
 *
 * OpenAI 的 created 是**秒**（10 位），有些网关直接给毫秒（13 位），
 * Anthropic 的 created_at 是 ISO 字符串 —— 三种都要认，否则排序静默失效。
 */
function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // 10 位当成秒。用 1e12 做界：现在(2026)的毫秒值约 1.7e12，秒值约 1.7e9
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed))
      return parsed
  }
  return 0
}

/**
 * 从响应体里取出模型数组。
 *
 * 三种形状都要认：`{data: []}`、`{models: []}`、以及直接就是数组。
 * 拿不到数组时返回空数组 —— 调用方据此报"没有模型"，而不是崩在 .map 上。
 */
function extractArray(payload: unknown): unknown[] {
  if (Array.isArray(payload))
    return payload
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data))
      return record.data
    if (Array.isArray(record.models))
      return record.models
  }
  return []
}

/**
 * 归一化上游返回的模型列表。
 *
 * 纯函数，便于单测。按 createdAt 降序（新的在前）；没有时间信息时**保持上游顺序**
 * —— JS 的 sort 是稳定的，全为 0 时不会打乱，所以上游怎么给就怎么显示。
 */
export function normalizeRemoteModels(payload: unknown): RemoteModelEntry[] {
  const entries: RemoteModelEntry[] = []

  for (const raw of extractArray(payload)) {
    if (!raw || typeof raw !== 'object')
      continue
    const record = raw as Record<string, unknown>

    // Gemini 的 name 形如 "models/gemini-2.5-flash"：去掉前缀才是可用的模型名
    const rawName = typeof record.name === 'string' ? record.name.replace(/^models\//, '') : ''
    const id = firstNonEmptyString(record.id, rawName, record.model)
    if (!id)
      continue

    entries.push({
      id,
      // 只在 id 被混淆时 display_name 才真正救命，但字段名两种写法都得认
      displayName: firstNonEmptyString(record.display_name, record.displayName),
      ownedBy: firstNonEmptyString(record.owned_by, record.ownedBy),
      createdAt: parseTimestamp(record.created ?? record.created_at ?? record.createdAt),
    })
  }

  return entries.sort((a, b) => b.createdAt - a.createdAt)
}

/** 面板里展示用的名字：优先可读名，没有才退回 id */
export function remoteModelLabel(entry: RemoteModelEntry): string {
  return entry.displayName || entry.id
}
