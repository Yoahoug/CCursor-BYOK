/**
 * 协议呈现层 + 最终请求地址推导。
 *
 * 协议挂在**模型**上，不是中转站上
 * ────────────────────────────────
 * 一个中转站（一个 Base URL、一个 Key）几乎总会同时挂 gemini / gpt / deepseek / glm，
 * 各家走各的接口形态 —— 而分流是中转站内部做的。用户既无法判断"这个中转站属于
 * 哪一类协议"，也不该为同一个地址建好几条 provider 记录、把密钥重复填。
 * 所以选择权落在 ProviderModel.type 上，中转站那层不再有协议设置。
 *
 * 存储层仍是 4 个平铺取值：
 *   anthropic / openai-chat / openai-responses / gemini
 *
 * 其中 openai-chat 与 openai-responses 是一对纯内部术语 —— 它们描述的是同一个
 * SDK、同一个 baseURL 下请求路径不同的两个端点。用户没有办法从名字判断，所以
 * UI 把选择重新表述成用户**能自行判断**的两级：
 *   第一级  用哪家的协议      Anthropic / OpenAI / Gemini
 *   第二级  仅 OpenAI 系需要  具体端点 Responses / Chat Completions
 * 这层呈现只影响 UI；存储和运行时见的都是 4 个平铺取值。
 *
 * 而多数情况下用户连第一级都不用点：新建模型默认按模型名推导
 * （见 defaultProtocolForModel），推导结果在保存时固化进配置。
 *
 * 用户填的是地址**前缀**，剩下由协议补全
 * ────────────────────────────────
 * 两个 SDK 都是 `baseURL + path` 的字符串直拼，不做任何智能补全。而它们对
 * 版本段的要求正好相反：
 *   anthropic        baseURL 不该带 /v1     (SDK 自己拼 /v1/messages)
 *   openai-chat      baseURL 必须带 /v1     (SDK 只拼 /chat/completions)
 *   openai-responses baseURL 必须带 /v1     (SDK 只拼 /responses)
 *   gemini           baseUrl 不该带 /v1beta (SDK 自己拼)
 *
 * 所以"一个中转站一个 baseURL"是不可能同时喂对 Anthropic 与 OpenAI 模型的。
 * 解法是让用户只填前缀，版本段与路径都由协议决定 —— 见 buildProviderBaseUrl
 * 与 buildRequestUrlPreview。这也正是本模块存在的另一半理由：让用户在保存前
 * 就能看到**最终会被请求的那个 URL**，而不是等到一个静默 404。
 */
import type { ProviderType } from '../server/data/defaults'

/** 第一级：用哪家的协议。openai-chat 与 openai-responses 在这一级是同一项。 */
export type ProtocolFamily = 'anthropic' | 'openai' | 'gemini'

/** 第二级：仅 OpenAI 系需要，对应两个真实端点路径。 */
export type OpenAIEndpointKind = 'responses' | 'chat'

export interface ProtocolFamilyOption {
  value: ProtocolFamily
  label: string
  hint: string
}

export const PROTOCOL_FAMILY_OPTIONS: readonly ProtocolFamilyOption[] = [
  {
    value: 'anthropic',
    label: 'Anthropic Messages',
    hint: 'Official Claude and any Anthropic-compatible endpoint. Requests go to <url>/v1/messages',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    hint: 'Official GPT and most relays. Requests go to <url>/chat/completions',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    hint: 'Native Gemini protocol. Requests go to <url>/v1beta/models/<model>:streamGenerateContent',
  },
]

/**
 * 各协议 SDK 会自己追加的版本段。
 *
 * baseURL 里该不该带它，**两个 SDK 的要求正好相反** —— 这也是"baseURL 不能放在
 * 中转站层共享"的根本原因：
 *   anthropic        baseURL 不该带 /v1     （SDK 自己拼 /v1/messages）
 *   openai-chat      baseURL 必须带 /v1     （SDK 只拼 /chat/completions）
 *   openai-responses baseURL 必须带 /v1     （SDK 只拼 /responses）
 *   gemini           baseUrl 不该带 /v1beta （SDK 自己拼）
 *
 * 所以一个共享地址不可能同时喂对 Anthropic 和 OpenAI 模型：带 /v1 则 Anthropic
 * 变成 /v1/v1/messages，不带则 OpenAI 变成 /chat/completions（中转站实际是
 * /v1/chat/completions，直接 404）。解决办法只能是"地址由协议补全"，
 * 见 buildProviderBaseUrl。
 */
const SDK_VERSION_PATH: Record<ProviderType, string> = {
  'anthropic': '/v1',
  'openai-chat': '/v1',
  'openai-responses': '/v1',
  'gemini': '/v1beta',
}

/** 该协议的 baseURL 里是否必须出现版本段（即 SDK 不会自己拼） */
const BASE_URL_NEEDS_VERSION: Record<ProviderType, boolean> = {
  'anthropic': false,
  'openai-chat': true,
  'openai-responses': true,
  'gemini': false,
}

/** SDK 追加版本段之后的完整路径 —— 预览与实际请求的唯一差别就在这里 */
const SDK_APPENDED_PATH: Record<ProviderType, string> = {
  'anthropic': '/v1/messages',
  'openai-chat': '/chat/completions',
  'openai-responses': '/responses',
  'gemini': '/v1beta/models/{model}:streamGenerateContent',
}

/** 各 SDK 的默认地址（已按上面 BASE_URL_NEEDS_VERSION 的规则取好） */
const DEFAULT_BASE_URL: Record<ProviderType, string> = {
  'anthropic': 'https://api.anthropic.com',
  'openai-chat': 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  'gemini': 'https://generativelanguage.googleapis.com',
}

/**
 * 把用户填的地址换算成**该协议下应该传给 SDK 的 baseURL**。
 *
 * 用户填的是**前缀**（`http://10.66.66.66:8317` 这种），版本段归协议管 ——
 * 于是同一个前缀挂 anthropic 和 gpt 模型都能得到正确结果：
 *   anthropic  → http://10.66.66.66:8317            (+ SDK 自己拼 /v1/messages)
 *   openai-chat→ http://10.66.66.66:8317/v1         (+ SDK 拼 /chat/completions)
 *
 * 前缀里已经写了该版本段就不再重复；反过来，不该带版本段的协议会把多余的
 * 版本段剥掉。这样老配置（地址里带着 /v1）也能被自动纠正，而不是变成 /v1/v1。
 */
export function buildProviderBaseUrl(type: ProviderType, baseUrl: string | undefined): string {
  const typed = stripTrailingSlashes((baseUrl || '').trim())
  const base = typed || DEFAULT_BASE_URL[type]
  const version = SDK_VERSION_PATH[type].toLowerCase()

  // 只剥掉"恰好等于该协议版本段"的尾段，避免误伤 /v2、/api 这类正常路径
  const withoutVersion = base.toLowerCase().endsWith(version)
    ? stripTrailingSlashes(base.slice(0, -version.length))
    : base

  return BASE_URL_NEEDS_VERSION[type] ? `${withoutVersion}${SDK_VERSION_PATH[type]}` : withoutVersion
}

const FAMILY_LABEL: Record<ProtocolFamily, string> = {
  anthropic: 'Anthropic Messages',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
}

/** ProtocolFamily → ProviderType。OpenAI 系需要端点信息，故带第二参数。 */
export function providerTypeOf(family: ProtocolFamily, openaiEndpoint: OpenAIEndpointKind = 'chat'): ProviderType {
  switch (family) {
    case 'anthropic': return 'anthropic'
    case 'gemini': return 'gemini'
    case 'openai': return openaiEndpoint === 'responses' ? 'openai-responses' : 'openai-chat'
  }
}

/** ProviderType → 两级选择。与 providerTypeOf 互为逆运算。 */
export function protocolSelectionOf(type: ProviderType): { family: ProtocolFamily, openaiEndpoint: OpenAIEndpointKind } {
  switch (type) {
    case 'anthropic': return { family: 'anthropic', openaiEndpoint: 'chat' }
    case 'gemini': return { family: 'gemini', openaiEndpoint: 'chat' }
    case 'openai-chat': return { family: 'openai', openaiEndpoint: 'chat' }
    case 'openai-responses': return { family: 'openai', openaiEndpoint: 'responses' }
  }
}

export function familyOf(type: ProviderType): ProtocolFamily {
  return protocolSelectionOf(type).family
}

/** 人类可读的类型描述，例如 "OpenAI · Responses API" */
export function describeProviderType(type: ProviderType): string {
  if (type === 'openai-chat')
    return `${FAMILY_LABEL.openai} · Chat Completions API`
  if (type === 'openai-responses')
    return `${FAMILY_LABEL.openai} · Responses API`
  return FAMILY_LABEL[familyOf(type)]
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  }
  catch {
    return null
  }
}

/**
 * 最终会被请求的完整 URL。
 *
 * 这是本模块最有价值的一个函数：地址填错时 SDK 只会给出一个 404，而这里
 * 能在保存前把拼接结果摆到用户面前，让错误自己暴露。
 */
export function buildRequestUrlPreview(type: ProviderType, baseUrl: string): string {
  return `${buildProviderBaseUrl(type, baseUrl)}${SDK_APPENDED_PATH[type]}`
}

export interface BaseUrlShapeWarning {
  /** warn = 极可能出错; info = 值得留意 */
  level: 'warn' | 'info'
  message: string
}

/**
 * 检查用户填的地址形状。
 *
 * 版本段（/v1、/v1beta）的重复与缺失已经由 buildProviderBaseUrl 自动处理，
 * 不再需要提示。这里只剩一个真正会静默失败的坑：**把完整端点当成前缀填了进来**
 * ——那样路径会被拼两遍。
 */
export function checkBaseUrlShape(type: ProviderType, baseUrl: string): BaseUrlShapeWarning | null {
  const trimmed = stripTrailingSlashes((baseUrl || '').trim())
  if (!trimmed)
    return null

  const url = parseUrl(trimmed)
  if (!url)
    return null

  const path = stripTrailingSlashes(url.pathname).toLowerCase()
  const appended = SDK_APPENDED_PATH[type].toLowerCase()

  // gemini 的追加路径带 {model} 占位，无法直接比对
  if (appended.includes('{model}'))
    return null

  if (path.endsWith(appended)) {
    return {
      level: 'warn',
      message: `This expects the address prefix, not a full endpoint. It already ends with ${SDK_APPENDED_PATH[type]}, `
        + 'so the path would be appended twice — remove that part.',
    }
  }

  return null
}

export interface ProtocolSuggestion {
  /** 建议采用的具体类型 */
  type: ProviderType
  /** 为什么这么建议 —— 直接展示给用户，让建议可被验证而非盲信 */
  reason: string
}

/**
 * 从 baseURL / 模型名推断协议类型。
 *
 * 设计约束（刻意保守）：
 *   - 只做**确定性**推断：地址里出现 /anthropic、/chat/completions 这类明确
 *     特征才给建议；仅凭域名猜厂商一律不给，避免误导
 *   - 调用方只能把它**当作建议展示**，绝不允许静默改写用户已保存的配置
 *   - 返回 null 表示"没有把握"，此时 UI 不应该显示任何提示
 */
export function suggestProtocol(baseUrl: string, apiModel = ''): ProtocolSuggestion | null {
  const trimmed = (baseUrl || '').trim()
  const url = parseUrl(trimmed)
  const path = (url?.pathname ?? '').toLowerCase()
  const host = (url?.hostname ?? '').toLowerCase()
  const model = apiModel.trim().toLowerCase()

  // ── 地址特征优先：它们比模型名更可靠 ──
  if (host.endsWith('generativelanguage.googleapis.com')) {
    return { type: 'gemini', reason: 'this address is the official Gemini endpoint' }
  }
  if (path.includes('/anthropic')) {
    return { type: 'anthropic', reason: 'the path contains /anthropic, so this is an Anthropic-compatible endpoint' }
  }
  if (path.endsWith('/messages')) {
    return { type: 'anthropic', reason: 'the path ends with /messages, an Anthropic endpoint' }
  }
  if (path.endsWith('/chat/completions')) {
    return { type: 'openai-chat', reason: 'the path ends with /chat/completions' }
  }
  if (path.endsWith('/responses')) {
    return { type: 'openai-responses', reason: 'the path ends with /responses' }
  }
  if (host === 'api.anthropic.com' || host.endsWith('.anthropic.com')) {
    return { type: 'anthropic', reason: 'this address is the official Anthropic endpoint' }
  }
  if (host === 'api.openai.com' || host.endsWith('.openai.com')) {
    return { type: 'openai-responses', reason: 'this address is the official OpenAI endpoint; the Responses API is recommended' }
  }

  // ── 退而用模型名：只认前缀特征极强的那些 ──
  if (model.startsWith('claude')) {
    return { type: 'anthropic', reason: 'the model name starts with claude' }
  }
  if (model.startsWith('gemini')) {
    return { type: 'gemini', reason: 'the model name starts with gemini' }
  }
  if (model.startsWith('gpt-5') || /^o[1-9]\b/.test(model)) {
    return { type: 'openai-responses', reason: 'this generation officially uses the Responses API' }
  }

  return null
}

/**
 * 新模型默认用哪套协议 —— 只在模型没有显式指定过协议时使用。
 *
 * 这是**默认值**，不是建议：它会被直接写进配置，所以宁可保守。
 *
 * 分两步，因为"地址里的信号"和"模型名里的信号"可靠性完全不同：
 *
 *   1. 地址自己就能说明问题（路径含 /anthropic、以 /chat/completions 结尾、
 *      是官方域名…）→ 直接采信。用户把端点写进地址是个明确表态。
 *   2. 地址没给任何信号、只能看模型名 → 这时才需要按中转站的现实修正：
 *      - `gemini` 与 `openai-responses` 只有**官方域名**才默认。中转站几乎一律
 *        用 Anthropic Messages 或 OpenAI Chat 形态转发各家模型，把中转站上的
 *        `gemini-3-pro` 指到 generativelanguage.googleapis.com 的路径上必然 404。
 *      - 中转站上的 GPT 系默认 Chat Completions —— 绝大多数中转站只实现了它。
 *      - 其余一律回落到 Anthropic Messages。第三方聚合中转站以 Anthropic 形态
 *        最为普遍（Claude Code 生态的转发服务基本都是这个形状）。
 *
 * 模型名只能说明"这是哪家的模型"，说明不了"中转站用哪种接口形态暴露它"——
 * 所以看模型名的那一步必须保守。
 */
export function defaultProtocolForModel(baseUrl: string, apiModel: string): ProviderType {
  // 1. 地址本身就是明确表态
  const fromUrl = suggestProtocol(baseUrl)
  if (fromUrl)
    return fromUrl.type

  // 2. 只能看模型名 —— 中转站上要收敛
  const fromName = suggestProtocol(baseUrl, apiModel)
  if (!fromName)
    return 'anthropic'

  const host = (parseUrl((baseUrl || '').trim())?.hostname ?? '').toLowerCase()
  const isFirstParty = host === 'api.openai.com' || host.endsWith('.openai.com')
    || host.endsWith('generativelanguage.googleapis.com')
    || host === 'api.anthropic.com' || host.endsWith('.anthropic.com')

  if (isFirstParty)
    return fromName.type
  if (fromName.type === 'gemini')
    return 'anthropic'
  if (fromName.type === 'openai-responses')
    return 'openai-chat'
  return fromName.type
}

/**
 * 本地版本的 isProviderType。直接用 SDK_VERSION_PATH 这张 Record 做校验 ——
 * 它是 Record<ProviderType, ...>，所以新增协议而漏改这里会编译报错，不会漏判。
 * （不 import server/data/defaults 的同名函数，避免 shared ↔ server 形成环。）
 */
function isProviderTypeValue(value: unknown): value is ProviderType {
  return typeof value === 'string' && Object.hasOwn(SDK_VERSION_PATH, value)
}

/** materializeModelProtocols 能处理的最小形状 —— 免得 shared 依赖 server 的完整类型 */
interface MaterializableProvider {
  baseUrl?: string
  models?: Array<{ apiModel?: string, type?: unknown }> | null
}

/**
 * 把自动推导出的协议**固化**到每个模型上，原地修改并返回同一个对象。
 *
 * 谁需要调用它：任何把草稿交给服务端的路径（保存、测试）。原因是
 * `effectiveProviderType` 只认 model.type / provider.type，不认识上面这套按
 * 模型名推导的规则 —— 不固化的话，"界面显示 Anthropic、实际请求走 provider
 * 默认协议"这种分歧会一直存在，直到用户手动点一下协议选择器。
 *
 * 已经有显式 type 的模型一律不动：那是用户的明确选择，不该被推导覆盖。
 */
export function materializeModelProtocols<T extends MaterializableProvider>(provider: T): T {
  for (const model of provider?.models ?? []) {
    if (!isProviderTypeValue(model?.type))
      model.type = defaultProtocolForModel(provider?.baseUrl ?? '', model?.apiModel ?? '')
  }
  return provider
}
