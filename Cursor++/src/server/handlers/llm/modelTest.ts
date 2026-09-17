import type { ModelTestErrorKind, ModelTestResult, ProtocolAttempt, ProtocolDetection } from '../../../shared/modelTestTypes'
/**
 * 模型连通性测试 —— 用**真实协议路径**发一次最小请求并测量。
 *
 * 三个刻意的设计选择
 * ────────────────
 * 1. 提示词是为**测量**设计的，不是 "ping"：
 *    "输出 1 到 120" 能产生长度稳定、非平凡（约 600 token）的输出。
 *    纯 ping 只有一两个 token，算出来的 tokens/s 会被首字延迟完全淹没，
 *    既不可比也没有参考价值。
 *
 * 2. 复用 provider 实现而不是另写一套 fetch：
 *    所以测的就是真实请求路径 —— 地址拼接、鉴权方式、参数装配、SSE 解析
 *    全都会走到。测通了基本就等于能用了，而不是"端口开着"。
 *
 * 3. 双首字指标（对齐上游项目的做法）：
 *    thinking 模型的第一个事件是思考 token，不是正文。只记"第一个字节"
 *    会得到一个好看但毫无意义的首字延迟，所以正文首字与首事件分开记。
 */
import type { ProviderEntry, ProviderModel, ProviderType } from '../../data/defaults'
import type { LLMProvider, LLMStreamEvent, LLMStreamRequest } from './types'
import { buildProviderBaseUrl } from '../../../shared/providerProtocol'
import { effectiveProviderType, PROVIDER_TYPES } from '../../data/defaults'
import { countTokens } from '../agent/tokenCounter'
import { AnthropicProvider } from './anthropic'
import { GeminiProvider } from './gemini'
import { OpenAIChatProvider } from './openai-chat'
import { OpenAIResponsesProvider } from './openai-responses'

export const MODEL_TEST_PROMPT
  = 'Output the numbers 1 through 120 separated by a single space. No commas, no newlines, no explanation.'

export const MODEL_TEST_TIMEOUT_MS = 45_000

/** 流空闲时最长等待。保证取消与超时能在 250ms 内被感知，不会卡在等事件上。 */
const IDLE_POLL_MS = 250

const IDLE = Symbol('idle')

function createProvider(entry: ProviderEntry): LLMProvider {
  switch (entry.type) {
    case 'anthropic': return new AnthropicProvider(entry)
    case 'openai-chat': return new OpenAIChatProvider(entry)
    case 'openai-responses': return new OpenAIResponsesProvider(entry)
    case 'gemini': return new GeminiProvider(entry)
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (typeof error === 'string')
    return error
  try {
    // JSON.stringify 对 undefined 返回 undefined、对函数返回 undefined，
    // 直接用会让后面的 .toLowerCase() 崩掉 —— 必须兜到 String()
    return JSON.stringify(error) ?? String(error)
  }
  catch {
    return String(error)
  }
}

/**
 * 把 SDK / 网络层抛出的错误归类。
 *
 * 各家的错误文案各不相同且不稳定，这里只匹配**语义明确**的特征串。
 * 顺序有讲究：401/403 必须先于 400 判断，否则 "401 Unauthorized" 里的
 * 数字会被更宽泛的规则抢先命中。
 */
export function classifyTestError(error: unknown): ModelTestErrorKind {
  const message = errorMessage(error).toLowerCase()
  if (/\b401\b|\b403\b|unauthorized|invalid api key|incorrect api key|authentication_error|permission/.test(message))
    return 'auth'
  if (/\b429\b|rate limit|too many requests|quota|insufficient_quota/.test(message))
    return 'rate-limit'
  if (/\b404\b|not found|not_found|does not exist|no such model|unknown model/.test(message))
    return 'not-found'
  if (/timed out|timeout|etimedout|aborted/.test(message))
    return 'timeout'
  if (/econnrefused|enotfound|eai_again|fetch failed|socket hang up|network|tls|certificate|self-signed|proxy/.test(message))
    return 'network'
  if (/\b400\b|\b422\b|invalid_request|validation|bad request|unsupported/.test(message))
    return 'protocol'
  return 'unknown'
}

/**
 * 没有拿到接口返回的用量时，用 o200k tokenizer 估算。
 *
 * 仍然是"估算" —— 它是 GPT 的分词器，对 Claude/Gemini 有约 10~15% 误差，
 * 所以结果里必须带上 tokensEstimated 让 UI 标注出来，不能冒充真实用量。
 */
function estimateOutputTokens(text: string): number {
  if (!text)
    return 0
  try {
    return countTokens(text)
  }
  catch {
    return Math.ceil(text.length / 4)
  }
}

/** 把 iterator.next() 与一个空闲计时器赛跑，使取消/超时在流停滞时也能生效 */
async function nextOrIdle<T>(pending: Promise<IteratorResult<T>>): Promise<IteratorResult<T> | typeof IDLE> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<typeof IDLE>((resolve) => {
        timer = setTimeout(resolve, IDLE_POLL_MS, IDLE)
      }),
    ])
  }
  finally {
    if (timer)
      clearTimeout(timer)
  }
}

export interface ModelTestOptions {
  /** 取消标志由调用方维护，轮询检查 —— 不需要 AbortSignal 传递链路 */
  isCancelled?: () => boolean
  timeoutMs?: number
  /**
   * 强制用另一种协议发这次请求。
   *
   * 探测场景专用：地址不变、模型不变，只换协议走一遍。这样用户不必事先
   * 知道自己的中转站实现的是哪套接口 —— 测一遍就知道了。
   */
  overrideType?: ProviderType
}

export async function runModelTest(
  entry: ProviderEntry,
  model: ProviderModel,
  options: ModelTestOptions = {},
): Promise<ModelTestResult> {
  const startedAt = performance.now()
  const elapsed = () => Math.round(performance.now() - startedAt)
  const timeoutMs = options.timeoutMs ?? MODEL_TEST_TIMEOUT_MS
  const isCancelled = options.isCancelled ?? (() => false)

  // 协议取"模型生效值"而不是 entry.type —— 否则一个挂在中转站下的 gpt 模型
  // 点 Test 时，测的其实是中转站的默认协议路径，测不过还得先存一次盘。
  const type = options.overrideType ?? effectiveProviderType(entry, model)
  const effectiveEntry: ProviderEntry = {
    ...entry,
    type,
    baseUrl: buildProviderBaseUrl(type, entry.baseUrl),
  }
  let provider: LLMProvider
  try {
    provider = createProvider(effectiveEntry)
  }
  catch (error) {
    return { status: 'error', errorKind: 'protocol', message: errorMessage(error), durationMs: elapsed() }
  }

  const request: LLMStreamRequest = {
    model: model.apiModel,
    messages: [{ role: 'user', content: MODEL_TEST_PROMPT }],
    // 与真实调用取同一个 maxTokens。测试输出约 600 token，正常情况下模型会
    // 自然停止；只有 maxTokens 被设得极小时才会截断，此时速度指标仍然有效。
    maxTokens: model.noMaxTokens ? undefined : (model.maxOutputTokens ?? 4096),
    thinking: false,
  }

  const iterator = provider.stream(request)[Symbol.asyncIterator]()
  const takeNext = () => {
    const pending = iterator.next()
    // 提前退出（取消 / 超时 / 抛错）时这个 promise 可能无人接收，
    // 挂一个空 catch 防止 Node 报 unhandledRejection
    pending.catch(() => {})
    return pending
  }

  let firstTextMs: number | null = null
  let firstValidResponseMs: number | null = null
  let output = ''
  let inputTokens: number | null = null
  let outputTokensFromApi: number | null = null
  let stopReason = ''

  try {
    let pending = takeNext()
    while (true) {
      if (isCancelled())
        return { status: 'cancelled', durationMs: elapsed() }
      if (elapsed() >= timeoutMs) {
        return {
          status: 'error',
          errorKind: 'timeout',
          message: `The test did not finish within ${Math.round(timeoutMs / 1000)}s`,
          durationMs: elapsed(),
        }
      }

      const step = await nextOrIdle(pending)
      if (step === IDLE)
        continue
      if (step.done)
        break

      const event: LLMStreamEvent = step.value
      if (firstValidResponseMs === null)
        firstValidResponseMs = elapsed()

      if (event.type === 'text_delta') {
        if (firstTextMs === null && event.text.trim().length > 0)
          firstTextMs = elapsed()
        output += event.text
      }
      else if (event.type === 'done') {
        stopReason = event.stopReason
        inputTokens = event.usage.inputTokens
        outputTokensFromApi = event.usage.outputTokens > 0 ? event.usage.outputTokens : null
      }

      pending = takeNext()
    }
  }
  catch (error) {
    return { status: 'error', errorKind: classifyTestError(error), message: errorMessage(error), durationMs: elapsed() }
  }
  finally {
    try {
      await iterator.return?.()
    }
    catch {
      // 关闭失败不影响已得到的测量结果
    }
  }

  const durationMs = elapsed()
  if (firstValidResponseMs === null) {
    return { status: 'error', errorKind: 'protocol', message: 'The response stream ended without returning any content', durationMs }
  }

  const trimmedOutput = output.trim()
  const tokensEstimated = outputTokensFromApi === null
  const outputTokens = outputTokensFromApi ?? estimateOutputTokens(trimmedOutput)
  const tokensPerSecond = durationMs > 0 ? (outputTokens / (durationMs / 1000)) : 0

  return {
    status: 'success',
    durationMs,
    firstTextMs,
    firstValidResponseMs,
    outputTokens,
    tokensEstimated,
    tokensPerSecond,
    output: trimmedOutput.slice(0, 2000),
    stopReason,
    usage: inputTokens === null ? null : { inputTokens, outputTokens },
  }
}

/** 探测时的超时比常规测试短：这里只想知道"通不通"，不必等一个完整的长回答 */
export const PROBE_TIMEOUT_MS = 20_000

/**
 * 依次试各种协议，找出这个模型实际能用的那一种。
 *
 * 为什么需要它：中转站同时挂多家的模型时，接口形态和模型名之间没有可靠对应关系 ——
 * `glm-4.6` 可能走 Anthropic 路径也可能走 OpenAI 路径，只有打一发真实请求才知道。
 * 把协议选择摆到用户面前，等于把整个配置流程里最难的那道判断题放在最前面。
 *
 * 顺序上把**当前生效协议放第一个**：它通常就是对的，命中时只花一次请求，
 * 用户拿到的是"现在这套可用"，而不是一次无谓的改写。
 *
 * 刻意串行：并发打同一个端点容易触发限流，失败原因也会互相干扰。
 * 全部失败时最坏要 4 次请求，所以只在用户显式点击时才跑。
 */
export async function detectModelProtocol(
  entry: ProviderEntry,
  model: ProviderModel,
  options: { isCancelled?: () => boolean } = {},
): Promise<ProtocolDetection> {
  const isCancelled = options.isCancelled ?? (() => false)
  const previous = effectiveProviderType(entry, model)
  const order: ProviderType[] = [previous, ...PROVIDER_TYPES.filter(type => type !== previous)]

  const attempts: ProtocolAttempt[] = []
  for (const type of order) {
    if (isCancelled())
      break
    const result = await runModelTest(entry, model, {
      isCancelled,
      timeoutMs: PROBE_TIMEOUT_MS,
      overrideType: type,
    })
    attempts.push({ type, result })
    if (result.status === 'success') {
      return { detected: type, previous, previousFailed: false, attempts }
    }
  }

  const previousAttempt = attempts.find(attempt => attempt.type === previous)
  return {
    detected: null,
    previous,
    previousFailed: previousAttempt ? previousAttempt.result.status !== 'success' : false,
    attempts,
  }
}
