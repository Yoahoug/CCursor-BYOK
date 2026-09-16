/**
 * 模型连通性测试的**结果契约**。
 *
 * 刻意放在 shared/ 而不是 modelTest.ts：结果类型需要被 webview 消费，而
 * modelTest.ts 会 import 各家 SDK —— 如果 webview 直接引用它，esbuild 会把
 * anthropic / openai / genai 三个 SDK 一起打进浏览器产物。这里只放纯类型与
 * 文案，保证 webview 侧零 SDK 依赖。
 */
import type { ProviderType } from '../server/data/defaults'

/**
 * 失败归类 —— 光有错误字符串不足以让用户判断下一步做什么。
 * 分类之后 UI 才能说清"是 key 错了还是地址错了还是被限流了"。
 */
export type ModelTestErrorKind
  = | 'auth'
    | 'not-found'
    | 'rate-limit'
    | 'timeout'
    | 'network'
    | 'protocol'
    | 'cancelled'
    | 'unknown'

export const MODEL_TEST_ERROR_LABEL: Record<ModelTestErrorKind, string> = {
  'auth': 'Authentication failed',
  'not-found': 'Endpoint or model not found',
  'rate-limit': 'Rate limited / quota exhausted',
  'timeout': 'Timed out',
  'network': 'Network unreachable',
  'protocol': 'Request rejected (bad params or protocol mismatch)',
  'cancelled': 'Cancelled',
  'unknown': 'Unknown error',
}

/** 每种失败最可能的下一步动作 —— 直接展示，省得用户去猜 */
export const MODEL_TEST_ERROR_HINT: Record<ModelTestErrorKind, string> = {
  'auth': 'Check the API key and whether it has access to this model',
  'not-found': 'Check the Base URL and model name; is /v1 missing or is there an extra version segment',
  'rate-limit': 'Retry later, or check whether your plan quota is used up',
  'timeout': 'Endpoint is too slow or blocked; try configuring a Proxy URL',
  'network': 'Wrong address, DNS failure, or a proxy is required',
  'protocol': 'This endpoint may not support the current protocol; try Responses / Chat Completions',
  'cancelled': 'The test was cancelled manually',
  'unknown': 'Check the raw error message to narrow it down',
}

export interface ModelTestUsage {
  inputTokens: number
  outputTokens: number
}

export interface ModelTestSuccess {
  status: 'success'
  /** 整体耗时 (ms) */
  durationMs: number
  /**
   * 首个**正文** token 的延迟 (ms) —— 用户实际感受到的等待时间。
   * 思考型模型的首个事件往往是思考 token，那不是用户等的正文，故单列。
   */
  firstTextMs: number | null
  /** 首个有效响应事件的延迟 (ms) —— 含思考 token，用于区分"服务端已开始工作" */
  firstValidResponseMs: number | null
  outputTokens: number
  /** true 表示 outputTokens 是从文本长度估算的，不是接口返回的真实用量 */
  tokensEstimated: boolean
  tokensPerSecond: number
  output: string
  stopReason: string
  usage: ModelTestUsage | null
}

export interface ModelTestFailure {
  status: 'error'
  errorKind: ModelTestErrorKind
  message: string
  durationMs: number
}

export interface ModelTestCancelled {
  status: 'cancelled'
  durationMs: number
}

export type ModelTestResult = ModelTestSuccess | ModelTestFailure | ModelTestCancelled

/** 协议探测里的一次尝试 —— 失败的那些也保留，排错时"各自报了什么错"比"只有一种能通"有用 */
export interface ProtocolAttempt {
  type: ProviderType
  result: ModelTestResult
}

/**
 * 协议探测结果。
 *
 * 放在 shared/ 而不是 modelTest.ts 的原因同上：webview 要用它，但不能因此
 * 把各家 SDK 拖进浏览器产物。
 */
export interface ProtocolDetection {
  /** 探测到的可用协议；全部打不通时为 null */
  detected: ProviderType | null
  /** 探测前该模型生效的协议 —— 用于判断"是否真的需要改写配置" */
  previous: ProviderType
  /** 是否连原本那套协议都打不通 —— true 说明问题多半不在协议上 */
  previousFailed: boolean
  attempts: ProtocolAttempt[]
}
