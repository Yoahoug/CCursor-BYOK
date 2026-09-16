/**
 * Cursor++ 共享默认值 (TS 版)
 *
 * 必须与 installer/src/defaults.js 保持一致。
 * 用途参见 installer/src/defaults.js 文件头注释。
 */

export const CCURSOR_DIR_NAME = '.ccursor'
export const ROUTES_FILE_NAME = 'routes.json'
export const PROVIDERS_FILE_NAME = 'providers.json'
export const DB_FILE_NAME = 'cursor.db'
export const KNOWLEDGE_BASE_FILE_NAME = 'knowledge-base.json'

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 39831
export const DEFAULT_COLLECTOR_PORT = 14800

/**
 * BASE_REDIRECT —— 不论 BYOK 开关如何,**永远**生效的劫持白名单。
 *
 * 当前只包含"假装订阅"的 2 个 Stripe profile stub。
 * 这些是无 Cursor 付费账号的用户切到 OFF 模式后,仍然需要 stub 的最小集
 * (让 Cursor 渲染器认为账户是 ultra,不进入付费引导)。
 */
export const BASE_REDIRECT: readonly string[] = [
  'REST:/auth/full_stripe_profile',
  'REST:/auth/stripe_profile',
]

/**
 * BYOK_REDIRECT —— 仅在 byokMode === 'on' 时追加进生效白名单。
 *
 * 关闭 BYOK 时这些项**必须**移除,让对应请求直通官方:
 *   - 模型列表 / Agent 流 / Bidi 队列: 关 BYOK 后客户端走真 Cursor
 *   - ChatService 摘要: BYOK Agent 流的本地 sqlite 持久化
 *   - 一组整服务 stub: 支撑 BYOK 流程下的账号 / dashboard / serverConfig 假数据
 *     (整服务挂入是为了后续逐方法实装,当前未实装的方法返回 unimplemented)
 *
 * 注意 BidiAppend 位于 aiserver.v1 包下, 不是 agent.v1 —— 切记别又写错。
 */
export const BYOK_REDIRECT: readonly string[] = [
  // ── BYOK 核心 ──
  'aiserver.v1.AiService/AvailableModels',
  'agent.v1.AgentService/RunSSE',
  'agent.v1.AgentService/UploadConversationBlobs',
  'aiserver.v1.BidiService/BidiAppend',

  // ── 本地摘要持久化(BYOK Agent 配套) ──
  'aiserver.v1.ChatService/GetConversationSummary',
  'aiserver.v1.ChatService/StreamSpeculativeSummaries',

  // ── Rules / Knowledge Base (本地持久化) ──
  'aiserver.v1.AiService/KnowledgeBaseList',
  'aiserver.v1.AiService/KnowledgeBaseAdd',
  'aiserver.v1.AiService/KnowledgeBaseUpdate',
  'aiserver.v1.AiService/KnowledgeBaseRemove',
  // AiService: 模型/配置端点 — BYOK 拦截返回本地配置,不打官方
  'aiserver.v1.AiService/ServerTime',
  'aiserver.v1.AiService/GetDefaultModel',
  'aiserver.v1.AiService/GetDefaultModelNudgeData',

  // ── BYOK 流程下需要 stub 的服务 ──
  'aiserver.v1.AuthService',
  // AnalyticsService: 遥测上报返空; BootstrapStatsig 不拦截(直通官方拿真实 feature gate 配置)
  'aiserver.v1.AnalyticsService/Batch',
  // DashboardService: 逐方法挂入 — 未列出的方法 (如 ListMarketplacePlugins) 直接透传官方 API
  'aiserver.v1.DashboardService/GetPlanInfo',
  'aiserver.v1.DashboardService/GetCurrentPeriodUsage',
  'aiserver.v1.DashboardService/GetTeams',
  'aiserver.v1.DashboardService/GetUserPrivacyMode',
  'aiserver.v1.DashboardService/GetUsageLimitStatusAndActiveGrants',
  'aiserver.v1.DashboardService/GetEffectiveUserPlugins',
  'aiserver.v1.DashboardService/IsOnNewPricing',
  'aiserver.v1.DashboardService/GetManagedSkills',
  'aiserver.v1.DashboardService/GetTeamAdminSettingsOrEmptyIfNotInTeam',
  'aiserver.v1.DashboardService/GetTeamReposOrEmptyIfNotInTeam',
  // 3.6 新增: 不带 OrEmpty 后缀的 Team 端点 (非 team 用户打官方返回 unauthenticated 重试风暴)
  'aiserver.v1.DashboardService/GetTeamAdminSettings',
  'aiserver.v1.DashboardService/GetTeamBackgroundAgentSettings',
  'aiserver.v1.DashboardService/GetTeamRepos',
  // 'aiserver.v1.DashboardService/GetMe',
  'aiserver.v1.DashboardService/GetGlobalCommands',
  'aiserver.v1.DashboardService/GetTeamCommands',
  'aiserver.v1.DashboardService/GetSlackInstallUrl',
  'aiserver.v1.DashboardService/ShareCanvas',
  'aiserver.v1.DashboardService/LookupSharedCanvasByKey',
  'aiserver.v1.ServerConfigService',
  'aiserver.v1.NetworkService',
  'aiserver.v1.HealthService',
  'aiserver.v1.InAppAdService',

  // ── BackgroundComposerService (逐方法 stub — 启动轮询 + UI 初始化) ──
  'aiserver.v1.BackgroundComposerService/ListBackgroundComposers',
  'aiserver.v1.BackgroundComposerService/GetBackgroundComposerUserSettings',
  'aiserver.v1.BackgroundComposerService/ListTeamEnvironments',
  'aiserver.v1.BackgroundComposerService/ListPersonalEnvironments',

  // ── REST endpoints (BYOK 流程下需要的假账号 stub) ──
  'REST:/auth/has_valid_payment_method',
  'REST:/auth/poll',
  'REST:/auth/logout',
]

/** 兼容旧调用: 完整白名单 = BASE + BYOK */
export const DEFAULT_REDIRECT: readonly string[] = [...BASE_REDIRECT, ...BYOK_REDIRECT]

/** BYOK 开关: 1 = on (BYOK 启用), 0 = off (走官方) */
export type ByokMode = 0 | 1

export interface RoutesConfig {
  $schemaVersion: number
  byokMode: ByokMode
  server: { host: string, port: number }
  collector: { host: string, port: number }
  redirect: string[]
}

export const DEFAULT_ROUTES: RoutesConfig = {
  $schemaVersion: 1,
  byokMode: 1,
  server: { host: DEFAULT_HOST, port: DEFAULT_PORT },
  collector: { host: DEFAULT_HOST, port: DEFAULT_COLLECTOR_PORT },
  redirect: [...BASE_REDIRECT, ...BYOK_REDIRECT],
}

/** 根据 byokMode 计算最终 redirect 数组 */
export function buildRedirectForMode(mode: ByokMode): string[] {
  return mode
    ? [...BASE_REDIRECT, ...BYOK_REDIRECT]
    : [...BASE_REDIRECT]
}

// ── Provider / Model ──

export type ProviderType = 'anthropic' | 'openai-chat' | 'openai-responses' | 'gemini'

/**
 * ProviderType 的完整取值表。
 *
 * 刻意用 Record<ProviderType, true> 而不是普通数组：新增 provider 时**漏改这里会
 * 直接编译报错**（Record 要求覆盖全部键），而数组不会 —— 避免出现"类型里加了、
 * 运行时校验却不认识"的错配。下面的 PROVIDER_TYPES 与 isProviderType 均从此表派生。
 */
const PROVIDER_TYPE_FLAGS: Record<ProviderType, true> = {
  'anthropic': true,
  'openai-chat': true,
  'openai-responses': true,
  'gemini': true,
}

/** ProviderType 的全部取值 — 供穷举与展示使用 */
export const PROVIDER_TYPES = Object.keys(PROVIDER_TYPE_FLAGS) as ProviderType[]

/**
 * 校验外部输入（providers.json 里的 provider.type）是否为合法 provider 类型。
 *
 * type 决定后续用哪套工具定义与提示词，是无法容错的字段，所以必须在配置边界
 * 就拦下，不能让非法值流进内存缓存。用法见 providersStore 的 withFallback。
 */
export function isProviderType(value: unknown): value is ProviderType {
  return typeof value === 'string' && Object.hasOwn(PROVIDER_TYPE_FLAGS, value)
}

export interface ProviderAuth {
  kind: 'apiKey' | 'token'
  value: string
}

/**
 * 思考档位。三家 SDK 的映射:
 *   - OpenAI reasoning_effort: 原样枚举透传 (完全对齐)
 *   - Anthropic output_config.effort: minimal→low, xhigh→max (4.5-opus / 4.6 + 专用)
 *   - Gemini thinkingConfig.thinkingLevel: xhigh→HIGH (饱和)
 * 用户应按 model 是否支持选填;不填则 handler 回退默认行为。
 */
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ProviderModel {
  id: string
  apiModel: string
  /**
   * 该模型使用的协议 —— **只有模型层有协议，中转站层没有**。
   *
   * 为什么协议必须落在模型上：一个中转站（一个 Base URL、一个 Key）几乎总会
   * 同时挂多家的模型 —— gemini、gpt、deepseek、glm 各自走不同的接口形态，
   * 而分流是中转站内部做的。用户既无法判断"这个中转站属于哪一类协议"，
   * 也不该为同一个地址建好几条 provider 记录、把密钥重复填。
   *
   * 该值由 UI 在把草稿交给服务端之前固化：没手动选过就按模型名推导（见
   * shared/providerProtocol.ts 的 materializeModelProtocols）。**手写的
   * providers.json 里可能为空** —— 此时回落到 provider.type，见
   * effectiveProviderType。
   */
  type?: ProviderType
  displayName: string
  thinking: boolean
  /** 统一思考档位 — 优先用于 OpenAI/Gemini/Anthropic 4.5-opus+/4.6+ */
  thinkingLevel?: ThinkingLevel
  /** 精确思考预算 (token 数) — 适用于老 Claude 4.x (legacy thinking.enabled) 和 Gemini 精确覆盖 */
  thinkingBudgetTokens?: number
  supportsAgent?: boolean
  /** 控制图片上传按钮显隐 — 客户端粘贴不受限，但上传按钮会隐藏 */
  supportsImages?: boolean
  supportsCmdK?: boolean
  supportsMaxMode?: boolean
  supportsNonMaxMode?: boolean
  contextTokenLimit?: number
  /** 单次输出最大 token 数 — 不填默认 8192 */
  maxOutputTokens?: number
  /**
   * 不向 LLM 发送 max_output_tokens 参数 (仅 openai-responses) —
   * 某些自建网关/代理不接受此参数,开启后由模型自行决定输出长度
   */
  noMaxTokens?: boolean
  supportsSandboxing?: boolean
  defaultOn?: boolean
  /** Fast 模式 — OpenAI: service_tier=priority / Anthropic: fast-mode beta */
  fastMode?: boolean
  /** 模型选择器里 hover 显示的 markdown tooltip (非 max mode) */
  tooltipMarkdown?: string
  /** 模型选择器里 hover 显示的 markdown tooltip (max mode 开启时) */
  tooltipMarkdownForMaxMode?: string

  /**
   * Edit 面板参数选项 — 不填则无 Edit 按钮（完全向后兼容）。
   *
   * 按模型的生效协议自动选择生成模式:
   *   - anthropic / gemini: thinking (bool toggle) + effort (enum)
   *   - openai-*:           reasoning (enum, None=关闭)
   *
   * effort / reasoning / budget 三者互斥。
   */
  parameters?: {
    /** Anthropic/Gemini: 显式 thinking 开关 */
    thinking?: boolean
    /** Anthropic/Gemini: effort 档位选项 (与 reasoning/budget 互斥) */
    effort?: ThinkingLevel[]
    /** OpenAI: 单一 reasoning 枚举 — None=关闭 (与 effort/budget 互斥) */
    reasoning?: ThinkingLevel[]
    /** 旧模型 budget 预设 (与 effort/reasoning 互斥) */
    budget?: number[]
    /** Context 容量选项 */
    context?: number[]
    /** Fast 模式开关 */
    fast?: boolean
    /** 用户自定义参数 */
    custom?: Array<{
      id: string
      name: string
      type: 'boolean' | 'enum'
      values?: string[]
      displayNames?: string[]
      default?: string
      tooltip?: string
    }>
  }
}

export interface ProviderEntry {
  id: string
  name: string
  /**
   * 中转站的缺省协议 —— 界面已不再暴露这个字段。
   *
   * 历史：协议曾经是"一个中转站一种"，后来发现一个中转站（一个地址、一个 Key）
   * 几乎总会同时挂 gemini / gpt / deepseek / glm，各家走各的接口形态，于是
   * 协议挪到了模型上（见 ProviderModel.type），选择权也一并挪走。
   *
   * 它现在的职责只剩一个：**模型没有 type 时的回落值**（见 effectiveProviderType）。
   * 经 UI 保存过的配置里每个模型都会带上 type，这个字段就再也轮不到；
   * 但手写的 providers.json 里它仍是用户唯一的表态方式，所以保留 —— 删掉类型
   * 定义会让那些文件解析报错，删掉回落分支会让它们解析不出协议。
   */
  type: ProviderType
  baseUrl: string
  auth: ProviderAuth
  models: ProviderModel[]
  /**
   * HTTP 代理 URL — 对 Anthropic / OpenAI provider 生效。
   *
   * 用途:
   *   1. 抓包调试: mitmproxy / Charles 等工具观察最终 LLM request/response
   *   2. 代理访问: 需要 proxy 才能连接的模型提供商
   *
   * 格式: "http://host:port" (undici ProxyAgent 仅支持 HTTP proxy)
   * 留空则不走代理。
   *
   * Gemini 不支持: @google/genai SDK (经核实含最新 2.7.0) 的 GoogleGenAIOptions /
   * HttpOptions 均无 fetch/dispatcher 注入点,无法像 Anthropic/OpenAI 那样传
   * createProxiedFetch。前端对 gemini 隐藏此字段 (provider-fields.tsx)。
   */
  proxyUrl?: string
  /**
   * 自定义请求头 — 每次 LLM 请求时附加。
   *
   * 用途:
   *   - Anthropic: anthropic-beta (interleaved-thinking, prompt-caching-scope 等)
   *   - OpenAI: 自定义 header (如 Helicone 等代理网关需要的 key)
   *   - 第三方兼容 API: 特定认证或功能头
   *
   * 示例: { "anthropic-beta": "interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05" }
   */
  headers?: Record<string, string>
}

export interface ProvidersConfig {
  $schemaVersion: number
  providers: ProviderEntry[]
}

/**
 * BYOK Provider 兜底常量 — server 读不到文件 / 文件损坏时的 fallback。
 * 不放任何 provider,避免"假装有配置"造成的歧义。
 * 首次安装时 installer 会释放一份更丰富的 INITIAL_PROVIDERS 到磁盘,
 * 那部分数据定义在 installer/src/defaults.js。
 */
export const DEFAULT_PROVIDERS: ProvidersConfig = {
  $schemaVersion: 1,
  providers: [],
}

/**
 * 求某个模型实际生效的协议：模型级 type 优先，否则回落到中转站的缺省值。
 *
 * 整个请求链路上"用哪套协议"只认这一个函数的结果 —— resolveModel 把它的返回值
 * 填进 ResolvedModel.provider，下游的 conversationCodec / stateStrategy /
 * provider 实例全部从那里派生。
 *
 * 这里**刻意不做"按模型名猜协议"的推导**：推导规则只有一条，在
 * shared/providerProtocol.ts 的 defaultProtocolForModel，由 UI 在把草稿交给
 * 服务端之前（存盘、测试）固化进 model.type。放在这里现算会让服务端和界面各自
 * 用一套规则推导，两边悄悄分叉；而且对手写的 providers.json 来说，用户显式写下
 * 的 provider.type 比模型名更可信。
 *
 * 因此新增协议相关逻辑时不要在别处重新读 provider.type，否则模型级的值会在
 * 那条分支上被静默绕过，症状是"改了模型的协议，但工具定义还是旧的那套"。
 */
export function effectiveProviderType(provider: ProviderEntry, model?: ProviderModel | null): ProviderType {
  if (model && isProviderType(model.type))
    return model.type
  return provider.type
}

export const MODELS_CATALOG_FILE_NAME = 'models-catalog.json'
export const WEB_TOOLS_FILE_NAME = 'web-tools.json'
export const MANAGED_SKILLS_FILE_NAME = 'managed-skills.json'

// ── Web Tools (Search + Fetch) ──

export type SearchProviderType = 'duckduckgo' | 'exa' | 'tavily' | 'brave' | 'jina' | 'firecrawl'

export interface SearchProviderEntry {
  id: string
  type: SearchProviderType
  enabled: boolean
  apiKey?: string
  /**
   * API 地址覆盖 — 用于自建中转/代理网关。
   * 留空则使用各 provider 的官方地址。当前支持 tavily / firecrawl。
   */
  baseUrl?: string
}

export type FetchProviderType = 'builtin' | 'tavily'

/**
 * 抓取服务商配置。
 *
 * Tavily 抓取**不在这里单独存 key / baseUrl**，而是复用 Search 标签页里
 * Tavily 那一项的 apiKey 与 baseUrl。理由：两者是同一个 Tavily 账号，
 * 分开配置会出现"搜索配好了、抓取还得再填一遍"的割裂，也容易填成两个不同的 key。
 * 所以这里只留一个 provider 选择位。
 */
export interface FetchProviderConfig {
  provider: FetchProviderType
}

export interface WebToolsConfig {
  $schemaVersion: number
  search: {
    providers: SearchProviderEntry[]
    parallel: boolean
    maxResults: number
    /**
     * 全部启用的 provider 都失败时,是否回落到 DuckDuckGo 抓取。
     *
     * 默认 true(保留兜底能力)。注意: DDG 会对抓取返回 202 反爬挑战页,
     * 页面上只有 "About DuckDuckGo / lite / here" 这类导航链接。
     * searchDuckDuckGo 已加入挑战页识别,遇到拦截会抛出明确错误,
     * 不会再把导航链接当成搜索结果返回给模型。
     */
    fallbackToDuckDuckGo?: boolean
  }
  fetch: FetchProviderConfig
}

export const DEFAULT_WEB_TOOLS: WebToolsConfig = {
  $schemaVersion: 1,
  search: {
    providers: [
      { id: 'default-tavily', type: 'tavily', enabled: false },
      { id: 'default-ddg', type: 'duckduckgo', enabled: false },
    ],
    parallel: false,
    maxResults: 10,
    fallbackToDuckDuckGo: true,
  },
  fetch: {
    // Tavily 抓取对 Cloudflare 挑战页(linux.do 这类)有效，内置抓取会被 403 拦掉，
    // 所以默认选它；没配 key 时 web.ts 会自动回退到内置抓取。
    provider: 'tavily',
  },
}

/** 已被移除的 Fetch provider — 读到旧配置时按默认值处理 */
export const REMOVED_FETCH_PROVIDERS: readonly string[] = ['jina', 'firecrawl']

/**
 * 归一化磁盘上读到的 fetch provider。
 *
 * 老版本 web-tools.json 里可能存着已下线的 'jina' / 'firecrawl'，
 * 直接当默认值处理，避免 UI 单选按钮全不选中、抓取落到 default 分支。
 */
export function normalizeFetchProvider(value: unknown): FetchProviderType {
  if (value === 'builtin' || value === 'tavily')
    return value
  return DEFAULT_WEB_TOOLS.fetch.provider
}
