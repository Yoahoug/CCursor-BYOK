/**
 * Webview 侧的值比较与错误文案工具。
 *
 * 从 webview/app.ts 原样抽出（纯移动，无行为改动）。这些函数与 Alpine store
 * 的状态无关 —— 它们只做「把某个值规范化后比较」「把错误分类转成文案」，
 * 是纯粹的叶子逻辑。放在 app.ts 顶部会挤占 store 的阅读空间，而 store 才是
 * 这个文件的主题。
 */
import type { ModelTestErrorKind, ModelTestResult } from '../../shared/modelTestTypes'
import { MODEL_TEST_ERROR_HINT, MODEL_TEST_ERROR_LABEL } from '../../shared/modelTestTypes'

/** 生成一个短随机 id —— 用于关联请求与响应 */
export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

function sortedRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const v = value[key]
    if (v !== undefined)
      out[key] = canonicalValue(v)
  }
  return out
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonicalValue)
  if (value && typeof value === 'object')
    return sortedRecord(value as Record<string, unknown>)
  return value
}

function canonicalProvider(provider: any): any {
  if (!provider)
    return {}
  const headers = provider.headers && typeof provider.headers === 'object' && !Array.isArray(provider.headers)
    ? sortedRecord(provider.headers)
    : undefined
  return {
    id: provider.id,
    name: provider.name ?? provider.id,
    type: provider.type,
    baseUrl: provider.baseUrl ?? '',
    auth: canonicalValue(provider.auth ?? { kind: 'apiKey', value: '' }),
    models: canonicalValue(Array.isArray(provider.models) ? provider.models : []),
    ...(provider.proxyUrl ? { proxyUrl: provider.proxyUrl } : {}),
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

/**
 * 比较两个 provider 草稿是否等价。
 *
 * 归一化后比较：字段顺序、undefined 与缺失、headers 的键序都不应让两个
 * 语义相同的草稿被判为"有改动"（那会让面板一直显示未保存状态）。
 */
export function providersEqual(a: any, b: any): boolean {
  return stableStringify(canonicalProvider(a)) === stableStringify(canonicalProvider(b))
}

/**
 * store 上的字段是 any（Alpine proxy 无法静态推断），直接把 any 当索引去查
 * Record<ModelTestErrorKind, string> 会报隐式 any。这里集中做一次收窄与兜底，
 * 也顺便保证后端将来新增错误分类时 UI 不会显示 undefined。
 */
export function errorLabelFor(kind: unknown): string {
  return MODEL_TEST_ERROR_LABEL[kind as ModelTestErrorKind] ?? MODEL_TEST_ERROR_LABEL.unknown
}

export function errorHintFor(kind: unknown): string {
  return MODEL_TEST_ERROR_HINT[kind as ModelTestErrorKind] ?? MODEL_TEST_ERROR_HINT.unknown
}

/** 探测时每种协议失败原因的简短描述 —— 全部打不通时拼给用户看 */
export function describeAttempt(result: ModelTestResult): string {
  if (result.status === 'success')
    return 'OK'
  if (result.status === 'cancelled')
    return 'Cancelled'
  return errorLabelFor(result.errorKind)
}
