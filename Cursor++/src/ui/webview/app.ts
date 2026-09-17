/**
 * Alpine.js store — webview 客户端全部逻辑
 *
 * 替代原先 panel-provider.ts 内的 640 行内联 JS。
 * Alpine 响应式代理自动追踪 mutation → DOM 更新, 无需手动 render() / rebind。
 */
import type { Alpine as AlpineType } from 'alpinejs'
import type { ProviderType } from '../../server/data/defaults'
import type { ModelTestResult, ProtocolAttempt, ProtocolDetection } from '../../shared/modelTestTypes'
import type { ProtocolFamily, ProtocolFamilyOption } from '../../shared/providerProtocol'
import type { RemoteModelEntry } from '../../shared/remoteModels'
import type { UsageSummary } from '../../shared/usageTypes'
import { isProviderType } from '../../server/data/defaults'
import { reorderById } from '../../shared/listReorder'
import {
  buildRequestUrlPreview,
  checkBaseUrlShape,
  defaultProtocolForModel,
  describeProviderType,
  familyOf,
  materializeModelProtocols,
  PROTOCOL_FAMILY_OPTIONS,
  providerTypeOf,
} from '../../shared/providerProtocol'
import { clone, describeAttempt, errorHintFor, errorLabelFor, providersEqual, uid } from './valueComparison'

declare function acquireVsCodeApi(): { postMessage: (msg: any) => void, getState: () => any, setState: (s: any) => void }

// acquireVsCodeApi 只能调用一次
const vscode = acquireVsCodeApi()

// debounce timer for catalog search
let acTimer: ReturnType<typeof setTimeout> | null = null

export function initApp(Alpine: AlpineType) {
  // Alpine store 内 this 指向 proxy 对象, TS 无法推断 — 用 any 绕过
  const store: any = {
    // ── 来自 extension 推送 ──
    state: null as any,

    // ── 本地 UI 状态 ──
    drafts: {} as Record<string, any>,
    expanded: {} as Record<string, boolean>,
    modelExpanded: {} as Record<string, Record<string, boolean>>,
    headersInvalid: {} as Record<string, boolean>,

    // ── 模型拖动排序 ──
    // 拖动过程中只记录"谁在拖、拖到谁、插在前面还是后面"，真正的数组改动等 drop 时一次做完。
    // 这样拖动全程不碰 drafts，不会因为中途重排导致鼠标下的元素位置跳动。
    modelDragId: '' as string,
    modelDragOverId: '' as string,
    modelDragAfter: false,

    remoteModels: {} as Record<string, { loading: boolean, models?: RemoteModelEntry[], error?: string }>,
    saveSnapshots: {} as Record<string, { targetIds: string[], snapshots: Record<string, any> }>,
    savingProviders: {} as Record<string, boolean>,

    // ── 模型连通性测试 ──
    // key 是 model id（全局唯一），这样切换 provider 折叠状态不会丢结果
    // overrideType 记录这次结果是"用哪种协议测出来的" —— 协议探测成功后就靠它回填
    modelTests: {} as Record<string, { running: boolean, testId?: string, overrideType?: ProviderType, result?: ModelTestResult }>,
    batchTesting: {} as Record<string, boolean>,

    /**
     * 协议自动探测 —— 进行中标记 + 上次结果。
     * 结果留着是为了在全部协议都打不通时，能把"每种协议各自报了什么错"列出来。
     */
    protocolDetecting: {} as Record<string, boolean>,
    protocolDetections: {} as Record<string, ProtocolDetection | null>,

    // ── 用量统计（缓存仪表盘） ──
    usageOpen: false,
    usageLoading: false,
    usageStats: null as UsageSummary | null,
    usageError: '',

    // ── 二次确认弹窗 ──
    //
    // 存描述符而不是闭包：Alpine 会把 state 包成 reactive proxy，
    // 把函数放进去既没必要也让序列化/调试变复杂。动作由 kind 分支还原。
    confirmDialog: null as null | {
      kind: 'deleteProvider' | 'removeModel'
      title: string
      message: string
      warning?: string
      confirmLabel: string
      pid: string
      mid?: string
    },

    // ── 子页签 ──
    //
    // 主界面是仪表盘（默认）：打开面板多半是想确认"通不通、省了多少"，
    // 而不是改配置。配置挪到第二个页签，改完切回来就能看到效果。
    activeTab: 'dashboard' as 'dashboard' | 'config',

    setTab(tab: 'dashboard' | 'config') {
      this.activeTab = tab
      // 切回仪表盘顺手刷新：用户很可能刚发过请求，想看新的命中率
      if (tab === 'dashboard')
        this.loadUsageStats()
    },

    // ── Web Tools Config ──
    webToolsOpen: false,
    webToolsTab: 'search' as 'search' | 'fetch',
    webTools: null as any,
    searchTesting: false,
    searchTestResult: null as { level: 'ok' | 'error', text: string } | null,
    fetchTesting: false,
    fetchTestResult: null as { level: 'ok' | 'error', text: string } | null,

    isSearchProviderEnabled(type: string): boolean {
      return this.webTools?.search?.providers?.find((p: any) => p.type === type)?.enabled ?? false
    },
    getSearchProviderKey(type: string): string {
      return this.webTools?.search?.providers?.find((p: any) => p.type === type)?.apiKey ?? ''
    },
    toggleSearchProvider(type: string, enabled: boolean) {
      if (!this.webTools?.search)
        return
      const p = this.webTools.search.providers.find((x: any) => x.type === type)
      if (p)
        p.enabled = enabled
    },
    setSearchProviderKey(type: string, key: string) {
      if (!this.webTools?.search)
        return
      const p = this.webTools.search.providers.find((x: any) => x.type === type)
      if (p)
        p.apiKey = key
    },
    getSearchProviderBaseUrl(type: string): string {
      return this.webTools?.search?.providers?.find((p: any) => p.type === type)?.baseUrl ?? ''
    },
    setSearchProviderBaseUrl(type: string, value: string) {
      if (!this.webTools?.search)
        return
      const p = this.webTools.search.providers.find((x: any) => x.type === type)
      if (p)
        p.baseUrl = value
    },
    setSearchOption(key: string, value: any) {
      if (this.webTools?.search)
        (this.webTools.search as any)[key] = value
    },
    testSearchProvider(type: string) {
      if (this.searchTesting)
        return
      this.searchTesting = true
      this.searchTestResult = null
      this.post('testSearchProvider', {
        // 字段名不能叫 type —— post() 用它承载消息类型, 同名会被载荷覆盖掉
        providerType: type,
        apiKey: this.getSearchProviderKey(type),
        baseUrl: this.getSearchProviderBaseUrl(type),
      })
    },
    setFetchProvider(provider: string) {
      if (this.webTools)
        this.webTools.fetch.provider = provider
      this.fetchTestResult = null
    },
    /**
     * Tavily 抓取复用 Search 标签页 Tavily 那一项的 key / baseUrl，
     * 这里把它汇总成一行状态文案，避免用户在 Fetch 页找不到填写位置。
     */
    get fetchCredentialStatus(): { level: 'ok' | 'warn', text: string } {
      const entry = this.webTools?.search?.providers?.find((p: any) => p.type === 'tavily')
      const hasKey = Boolean(entry?.apiKey?.trim())
      if (!hasKey) {
        return {
          level: 'warn',
          text: 'No Tavily API key found — add one on the "Search" tab. Until then, fetch falls back to the built-in converter (which cannot reach sites behind Cloudflare).',
        }
      }
      const baseUrl = entry?.baseUrl?.trim()
      return {
        level: 'ok',
        text: baseUrl
          ? `Reusing the key from the "Search" tab; all fetches go to ${baseUrl}.`
          : 'Reusing the key from the "Search" tab via the official api.tavily.com endpoint.',
      }
    },
    testFetchProvider() {
      if (this.fetchTesting)
        return
      this.fetchTesting = true
      this.fetchTestResult = null
      this.post('testFetchProvider', {
        // 同 testSearchProvider: 不能用 type 作字段名, 否则会覆盖消息类型
        providerType: 'tavily',
        apiKey: this.getSearchProviderKey('tavily'),
        baseUrl: this.getSearchProviderBaseUrl('tavily'),
      })
    },
    saveWebTools() {
      if (!this.webTools)
        return
      this.post('saveWebTools', { config: JSON.parse(JSON.stringify(this.webTools)) })
      this.webToolsOpen = false
      this.toast('Web tools config saved', 'info')
    },

    // ── Toast ──
    toasts: [] as Array<{ id: number, text: string, level: string }>,
    _toastId: 0,

    toast(text: string, level: 'error' | 'warn' | 'info' = 'info', durationMs = 4000) {
      const id = ++this._toastId
      this.toasts = [...this.toasts, { id, text, level }]
      if (durationMs > 0)
        setTimeout(() => this.dismissToast(id), durationMs)
    },

    dismissToast(id: number) {
      this.toasts = this.toasts.filter((t: any) => t.id !== id)
    },

    // ── Autocomplete ──
    ac: null as { pid: string, mid: string, results: any[], selected: number, reqId: number } | null,
    acReqId: 0,

    // ── 派生 ──
    get providers(): any[] {
      if (!this.state)
        return []
      const base: any[] = this.state.providers || []
      const seen = new Set<string>()
      const out: any[] = []
      for (const p of base) {
        seen.add(p.id)
        out.push(this.drafts[p.id] ?? p)
      }
      // 新建但尚未保存的
      for (const [id, draft] of Object.entries(this.drafts)) {
        if (!seen.has(id))
          out.push(draft)
      }
      return out
    },

    get serverLabel(): string {
      const s = this.state
      if (!s)
        return ''
      if (s.server === 'local')
        return `Running on :${s.port} (this window)`
      if (s.server === 'remote')
        return `Running on :${s.port} (another window)`
      if (s.serverIssue === 'port_occupied')
        return `Port :${s.port} is occupied by another process`
      return 'Not running'
    },

    // ── Draft 管理 ──
    baseProvider(pid: string): any {
      return (this.state?.providers || []).find((p: any) => p.id === pid)
    },

    getProviderView(pid: string): any {
      return this.drafts[pid] || this.baseProvider(pid) || {}
    },

    getModel(pid: string, mid: string): any {
      const d = this.getProviderView(pid)
      return (d.models || []).find((x: any) => x.id === mid)
    },

    /** 兼容模板旧命名：只读，不创建 draft。写操作必须调用 ensureDraft。 */
    getDraft(pid: string): any {
      return this.getProviderView(pid)
    },

    ensureDraft(pid: string): any {
      if (!this.drafts[pid]) {
        const base = this.baseProvider(pid)
        if (base)
          this.drafts[pid] = clone(base)
        else
          return {}
      }
      return this.drafts[pid]
    },

    getDraftOrOriginal(pid: string): any {
      return this.getProviderView(pid)
    },

    isDirty(pid: string): boolean {
      const draft = this.drafts[pid]
      if (!draft)
        return false
      const base = this.baseProvider(pid)
      if (!base)
        return true // new, not saved
      return !providersEqual(base, draft)
    },

    // ── 协议 ──
    //
    // 协议**只挂在模型上**。一个中转站（一个地址、一个 Key）通常同时挂着
    // gpt / gemini / grok / glm / deepseek，各家走各的接口形态 —— 中转站自己
    // 内部就分流了，用户不需要、也无从判断"这个中转站属于哪一类协议"。
    // 所以中转站那层不再有协议设置，模型那层也不再需要"继承"这回事。
    //
    // 存储层仍是 4 个平铺的 ProviderType（见 src/shared/providerProtocol.ts），
    // 只是选择权从 provider 挪到了 model。

    /**
     * 折叠头部的一行摘要 —— 中转站下各模型分别用哪套协议。
     *
     * 一个中转站下混挂多家模型是常态，只显示一个协议名会误导，所以列出
     * 去重后的协议名；还没有填 API Model 的模型不参与统计。
     */
    typeLabel(pid: string): string {
      const models = this.getDraft(pid).models || []
      const labels: string[] = []
      for (const m of models) {
        if (!m?.apiModel?.trim())
          continue
        const label = describeProviderType(this.modelProtocolType(pid, m.id))
        if (!labels.includes(label))
          labels.push(label)
      }
      return labels.join(' · ')
    },

    /** baseURL 形状检查 —— 只关心会静默失败的那几个坑。按模型算，因为路径由协议决定 */
    baseUrlShape(pid: string, mid: string): { level: 'warn' | 'info', message: string } | null {
      const p = this.getDraft(pid)
      return checkBaseUrlShape(this.modelProtocolType(pid, mid), p.baseUrl ?? '')
    },

    // ── 模型连通性测试 ──

    modelTest(mid: string): { running: boolean, testId?: string, result?: ModelTestResult } | null {
      return this.modelTests[mid] ?? null
    },

    /** 结果徽标用的紧凑文案；未测试时返回空串，让列表保持干净 */
    modelTestSummary(mid: string): string {
      const state = this.modelTests[mid]
      if (!state)
        return ''
      if (state.running)
        return 'Testing…'
      const result = state.result
      if (!result)
        return ''
      if (result.status === 'cancelled')
        return 'Cancelled'
      if (result.status === 'error')
        return 'Failed'
      return `${result.tokensPerSecond.toFixed(1)} tok/s`
    },

    modelTestTone(mid: string): string {
      const state = this.modelTests[mid]
      if (!state?.result || state.running)
        return 'idle'
      if (state.result.status === 'success')
        return 'ok'
      if (state.result.status === 'cancelled')
        return 'idle'
      return 'bad'
    },

    clearModelTest(mid: string) {
      const { [mid]: _removed, ...rest } = this.modelTests
      this.modelTests = rest
    },

    /** 成功时的指标明细。标注估算来源, 不把估算值冒充真实用量。 */
    modelTestMetrics(mid: string): string {
      const result = this.modelTests[mid]?.result
      if (!result || result.status !== 'success')
        return ''
      const parts = [
        `${result.tokensPerSecond.toFixed(1)} tok/s`,
        `first token ${result.firstTextMs ?? '—'} ms`,
        `total ${result.durationMs} ms`,
        `${result.outputTokens} tokens${result.tokensEstimated ? ' (estimated)' : ''}`,
      ]
      // thinking 模型的首个事件是思考 token 而非正文, 两者不同时值得单列
      if (result.firstValidResponseMs !== null && result.firstValidResponseMs !== result.firstTextMs)
        parts.splice(2, 0, `first event ${result.firstValidResponseMs} ms`)
      if (result.usage)
        parts.push(`in ${result.usage.inputTokens} / out ${result.usage.outputTokens}`)
      return parts.join(' · ')
    },

    /** 徽标悬浮提示 —— 列表里只放徽标, 细节进 tooltip */
    modelTestDetail(mid: string): string {
      const state = this.modelTests[mid]
      if (!state)
        return 'Click to run a connectivity test'
      if (state.running)
        return 'Testing… click to cancel'
      const result = state.result
      if (!result)
        return 'Click to run a connectivity test'
      if (result.status === 'cancelled')
        return `Cancelled (${result.durationMs} ms)`
      if (result.status === 'error')
        return `${errorLabelFor(result.errorKind)} —— ${errorHintFor(result.errorKind)}\n${result.message}`
      return `${this.modelTestMetrics(mid)}\n\n${result.output.slice(0, 400)}`
    },

    modelTestErrorLabel(mid: string): string {
      const result = this.modelTests[mid]?.result
      return result?.status === 'error' ? errorLabelFor(result.errorKind) : ''
    },

    modelTestErrorHint(mid: string): string {
      const result = this.modelTests[mid]?.result
      return result?.status === 'error' ? errorHintFor(result.errorKind) : ''
    },

    modelTestOutput(mid: string): string {
      const result = this.modelTests[mid]?.result
      return result?.status === 'success' ? result.output : ''
    },

    testModel(pid: string, mid: string) {
      if (this.modelTests[mid]?.running)
        return
      void this._runTestAndWait(pid, mid)
    },
    cancelModelTest(mid: string) {
      const state = this.modelTests[mid]
      if (state?.testId)
        this.post('cancelModelTest', { testId: state.testId })
    },

    /**
     * 依次测试该 provider 下所有填了 API Model 的模型。
     *
     * 刻意串行：并发打同一个端点容易被限流，而且并发请求会互相抢带宽，
     * 让 tokens/s 这个指标失去可比性 —— 批量测试的价值恰恰在于横向比较。
     */
    async testAllModels(pid: string) {
      if (this.batchTesting[pid])
        return
      const models = (this.getDraft(pid).models || []).filter((m: any) => m?.apiModel?.trim())
      if (models.length === 0) {
        this.toast('Nothing to test: fill in API Model for the model first', 'warn')
        return
      }
      this.batchTesting = { ...this.batchTesting, [pid]: true }
      try {
        for (const model of models)
          await this._runTestAndWait(pid, model.id)
      }
      finally {
        const { [pid]: _removed, ...rest } = this.batchTesting
        this.batchTesting = rest
      }
    },

    _testResolvers: {} as Record<string, () => void>,

    _runTestAndWait(pid: string, mid: string, overrideType?: ProviderType): Promise<void> {
      return new Promise((resolve) => {
        const testId = uid('test')
        this._testResolvers[testId] = resolve
        this.modelTests = { ...this.modelTests, [mid]: { running: true, testId, overrideType } }
        this.post('testModel', {
          testId,
          pid,
          mid,
          overrideType,
          // 带上 draft：用户常是「改完地址立刻想测」，此时还没保存
          draft: JSON.parse(JSON.stringify(this.getDraft(pid))),
        })
      })
    },

    // ── 模型级协议 ──
    //
    // 协议挂在模型上而不是中转站上：一个中转站（一个地址、一个 Key）通常同时
    // 挂着 gemini / gpt / deepseek / glm，它们各走各的接口形态。协议若只挂在
    // 中转站上，用户就得为同一个地址建好几条记录，密钥也要重复填。
    //
    // 模型没显式选定协议时，按模型名自动推导（见 defaultProtocolForModel）——
    // 常见情况用户一个字都不用填。推导值只在显示与保存时使用，落盘后就是
    // 普通的具体协议，运行时不依赖推导。

    /** 该模型实际生效的协议：显式选定的优先，否则按模型名推导 */
    modelProtocolType(pid: string, mid: string): ProviderType {
      const draft = this.getDraft(pid)
      const model = (draft.models || []).find((m: any) => m.id === mid)
      if (isProviderType(model?.type))
        return model.type
      return defaultProtocolForModel(draft.baseUrl ?? '', model?.apiModel ?? '')
    },

    /**
     * 是否还没显式选过协议（当前显示的是推导值）。
     * 仅用于给分段控件加一个提示态，不影响存储。
     */
    modelProtocolIsAuto(pid: string, mid: string): boolean {
      const model = (this.getDraft(pid).models || []).find((m: any) => m.id === mid)
      return !isProviderType(model?.type)
    },

    /** 该模型实际请求到的完整地址 —— 协议不同路径就不同，必须按模型算 */
    modelRequestUrlPreview(pid: string, mid: string): string {
      const draft = this.getDraft(pid)
      return buildRequestUrlPreview(this.modelProtocolType(pid, mid), draft.baseUrl ?? '')
    },

    /**
     * 显式指定模型协议。
     *
     * 参数是**协议家族**而不是 ProviderType —— 分段控件给的是用户视角的三档
     * （Anthropic / OpenAI / Gemini），而 'openai' 不是合法的 ProviderType。
     * 这里必须映射一次，否则会往配置里写进一个 isProviderType 不认的值，
     * 结果是"点了没反应"（回落成自动推导）。
     */
    setModelProtocol(pid: string, mid: string, family: ProtocolFamily) {
      const draft = this.ensureDraft(pid)
      const model = (draft.models || []).find((m: any) => m.id === mid)
      if (!model)
        return
      model.type = providerTypeOf(family)
      this.normalizeAuthKind(pid)
      // 探测结果描述的是旧协议，留着会误导
      this.clearModelTest(mid)
      this.protocolDetections = { ...this.protocolDetections, [mid]: null }
    },

    /**
     * 把自动推导出的协议固化到每个模型上。
     *
     * 交给 shared/providerProtocol 实现而不是在这里重写：服务端在测试路径上也要
     * 做同一件事（见 panel-provider 的 testModel），两处必须用同一套规则。
     */
    materializeModelProtocols(provider: any): any {
      return materializeModelProtocols(provider)
    },

    /**
     * 可选协议家族 —— 每套协议对每个模型都是候选，不做过滤。
     * 参数只为模板调用方便而保留。
     */
    modelProtocolOptions(): readonly ProtocolFamilyOption[] {
      return PROTOCOL_FAMILY_OPTIONS
    },

    /** 当前生效协议所属的家族（用于高亮分段控件） */
    modelProtocolSelection(pid: string, mid: string): ProtocolFamily {
      return familyOf(this.modelProtocolType(pid, mid))
    },

    /** 人类可读的协议名 —— 折叠头部的标签用 */
    modelProtocolLabel(pid: string, mid: string): string {
      return describeProviderType(this.modelProtocolType(pid, mid))
    },

    /** 探测结果明细 —— 全部打不通时把每种协议各自的错误列出来 */
    protocolAttemptsText(mid: string): string {
      const detection = this.protocolDetections[mid]
      if (!detection?.attempts?.length)
        return ''
      return detection.attempts
        .map((attempt: { type: ProviderType, result: ModelTestResult }) => {
          const label = describeProviderType(attempt.type)
          if (attempt.result.status === 'success')
            return `${label}: OK`
          if (attempt.result.status === 'cancelled')
            return `${label}: cancelled`
          return `${label}：${errorLabelFor(attempt.result.errorKind)} —— ${attempt.result.message}`
        })
        .join('\n')
    },

    // ── 协议自动探测 ──
    //
    // 「不必自己选协议」的落地点：不从 URL 猜（猜不准 —— 同一个 host:port
    // 往往同时挂了两套路径），而是拿每套协议各发一次真实请求，用结果说话。
    // 全部失败时把每种协议各自的错误一并列出，比"只有一种能通"信息量大得多。

    _protocolResolvers: {} as Record<string, (outcome: { ok: boolean, detection?: ProtocolDetection, error?: string }) => void>,

    _detectAndWait(pid: string, mid: string) {
      return new Promise<{ ok: boolean, detection?: ProtocolDetection, error?: string }>((resolve) => {
        const requestId = uid('probe')
        this._protocolResolvers[requestId] = resolve
        this.post('detectProtocol', {
          requestId,
          pid,
          mid,
          // 带上 draft：用户常是「填完地址立刻想探一下」，此时还没保存
          draft: JSON.parse(JSON.stringify(this.getDraft(pid))),
        })
      })
    },

    async detectProtocol(pid: string, mid: string) {
      if (this.protocolDetecting[mid])
        return
      const before = this.modelProtocolType(pid, mid)
      this.protocolDetecting = { ...this.protocolDetecting, [mid]: true }
      this.protocolDetections = { ...this.protocolDetections, [mid]: null }
      try {
        const outcome = await this._detectAndWait(pid, mid)
        if (!outcome.ok || !outcome.detection) {
          this.toast(`Protocol detection failed: ${outcome.error ?? 'unknown error'}`, 'error', 8000)
          return
        }
        const detection = outcome.detection as ProtocolDetection
        this.protocolDetections = { ...this.protocolDetections, [mid]: detection }

        if (!detection.detected) {
          const detail = detection.attempts
            .map((attempt: ProtocolAttempt) => `${describeProviderType(attempt.type)}：${describeAttempt(attempt.result)}`)
            .join('；')
          this.toast(`None of the four protocols worked — ${detail}`, 'error', 15000)
          return
        }
        // 原本那套就能用：明确说"无需改动"，而不是偷偷写一个和原来相同的值
        if (detection.detected === before) {
          this.toast(`${describeProviderType(detection.detected)} works; no config change needed`, 'info', 6000)
          return
        }
        this.setModelProtocol(pid, mid, detection.detected)
        this.toast(`Switched to ${describeProviderType(detection.detected)} — remember to save`, 'info', 10000)
      }
      finally {
        const { [mid]: _removed, ...rest } = this.protocolDetecting
        this.protocolDetecting = rest
      }
    },

    // ── 用量统计（缓存仪表盘） ──

    /** 首屏是否已经主动拉过统计，见 message 处理器里的 usageBootstrapped */
    usageBootstrapped: false,

    toggleUsage() {
      this.usageOpen = !this.usageOpen
      if (this.usageOpen)
        this.loadUsageStats()
    },

    loadUsageStats() {
      if (this.usageLoading)
        return
      this.usageLoading = true
      this.usageError = ''
      this.post('loadUsageStats', { requestId: uid('usage') })
    },

    /**
     * 紧凑数字。统计面板一行里要塞下 6~7 位 token 数，原样显示会把布局挤爆，
     * 精确值通过 title 悬浮给出。
     */
    formatCount(value: number | null | undefined): string {
      if (value === null || value === undefined || !Number.isFinite(value))
        return '0'
      const magnitude = Math.abs(value)
      if (magnitude >= 1_000_000_000)
        return `${(value / 1_000_000_000).toFixed(1)}B`
      if (magnitude >= 1_000_000)
        return `${(value / 1_000_000).toFixed(1)}M`
      if (magnitude >= 10_000)
        return `${(value / 1_000).toFixed(1)}K`
      return String(Math.round(value))
    },

    /** 命中率 null 时显示 — 而不是 0%，"没数据"和"零命中"必须能区分 */
    formatPercent(rate: number | null | undefined): string {
      if (rate === null || rate === undefined || !Number.isFinite(rate))
        return '—'
      return `${(rate * 100).toFixed(1)}%`
    },

    /**
     * 按口径取合计。
     *
     * 面板上有三个口径，必须显式区分，否则用户看到的数字到底是哪一段的说不清：
     *   today   —— 本地时区当天
     *   allTime —— 全部记录（不受 14 天窗口限制）
     *   window  —— 最近 14 天，趋势图与「按模型」表用（走 usageDays / usageModelRows）
     */
    usageScopeTotals(scope: 'today' | 'allTime') {
      return this.usageStats?.[scope] ?? null
    },

    /** 口径标题 —— 放在对应数据块上方 */
    usageScopeLabel(scope: 'today' | 'allTime'): string {
      return scope === 'today' ? 'Today' : 'All time'
    },

    /**
     * 口径副标题：说明这段数据覆盖的是哪一段时间。
     *
     * 「今日」给当天日期；「全部」给 firstRecordAt → lastRecordAt 的**起止区间**，
     * 而不是原先的 "since <起点>"。
     *
     * 原来只给起点会读错：数据只攒了两天时，`since 2026-09-16` 里的 09-16 会被
     * 当成"当前日期"（用户看到今天已是 17 号，就会以为面板没刷新）。写成
     * `2026-09-16 → 2026-09-17` 一眼就是区间，两端都摆出来了。
     *
     * 区间右端取真实的最晚记录时间，不是"今天"：几天没用时显示"截至今天"会
     * 让人以为数据是新的。
     */
    usageScopeSubtitle(scope: 'today' | 'allTime'): string {
      const stamp = (timestamp: number): string => {
        const date = new Date(timestamp)
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${date.getFullYear()}-${month}-${day}`
      }

      if (scope === 'today') {
        // 取 byDay 末格（窗口终点即今天），保证与趋势图那天完全一致
        const todayKey = this.usageStats?.byDay?.length
          ? this.usageStats.byDay[this.usageStats.byDay.length - 1]?.date
          : null
        return todayKey ? String(todayKey) : ''
      }

      const { firstRecordAt, lastRecordAt } = this.usageStats ?? {}
      if (!firstRecordAt)
        return ''
      // 只有一天数据时给单个日期，`09-17 → 09-17` 是废话
      if (!lastRecordAt || lastRecordAt === firstRecordAt)
        return stamp(firstRecordAt)
      return `${stamp(firstRecordAt)} → ${stamp(lastRecordAt)}`
    },

    /**
     * 总量卡片的悬浮说明。
     *
     * 面板上显示的是紧凑格式（166.6M），精确值只有悬浮才给 —— 跟其他指标一样，
     * 把 6~7 位数字铺在卡片里会把布局挤爆。顺带说清这个数包含什么：
     * 缓存读取 + 未命中输入，也就是这段时间真正发给模型的输入量。
     */
    usagePromptTitle(scope: 'today' | 'allTime'): string {
      const totals = this.usageScopeTotals(scope)
      if (!totals)
        return ''
      const exact = Math.round(totals.promptTokens ?? 0).toLocaleString('en-US')
      const range = scope === 'today' ? 'today' : 'across all recorded history'
      return `${exact} input tokens sent ${range} — cache reads plus new tokens`
    },

    /**
     * 是否有任何数据。
     *
     * 判据用 allTime 而不是窗口：只按窗口判的话，超过 14 天没用的用户
     * 会看到"暂无数据"，但累计区块其实是有数的。
     */
    usageHasData(): boolean {
      return (this.usageStats?.allTime?.calls ?? 0) > 0
    },

    usageModelRows() {
      return (this.usageStats?.byModel ?? []).slice(0, 6)
    },

    usageDays() {
      return this.usageStats?.byDay ?? []
    },

    /** 窗口内单日最大 prompt 规模 —— 柱状图的 100% 基准 */
    _usagePeak(): number {
      return this.usageDays().reduce(
        (peak: number, day: any) => Math.max(peak, (day.cacheReadTokens ?? 0) + (day.nonCachedInputTokens ?? 0)),
        0,
      )
    },

    usageColumnHeight(day: any): number {
      const peak = this._usagePeak()
      if (peak <= 0)
        return 0
      const total = (day.cacheReadTokens ?? 0) + (day.nonCachedInputTokens ?? 0)
      return Math.max(2, Math.round((total / peak) * 100))
    },

    /** 柱内命中缓存部分占比（占该柱自身高度） */
    usageCachedShare(day: any): number {
      const total = (day.cacheReadTokens ?? 0) + (day.nonCachedInputTokens ?? 0)
      if (total <= 0)
        return 0
      return Math.round(((day.cacheReadTokens ?? 0) / total) * 100)
    },

    /** 命中率色调：低于 20% 基本说明前缀缓存没生效，值得提示 */
    usageTone(rate: number | null | undefined): string {
      if (rate === null || rate === undefined)
        return 'flat'
      if (rate >= 0.6)
        return 'ok'
      if (rate >= 0.2)
        return 'warn'
      return 'bad'
    },

    // ── 柱状图悬浮详情 ──
    //
    // 不用原生 title：它由操作系统绘制，弹出延迟约 1s 且无法做动画，在 14 根柱子
    // 之间横向对比时要等它出现；而且它跟着指针走，读数还得来回找。
    // 这里自己维护一份悬浮态，位置由列索引算出并夹在容器内，首尾两列不会溢出面板。

    usageHover: null as null | { day: any, leftPercent: number },

    /**
     * 最后一次悬浮的目标 —— clearUsageHover **不**清它。
     *
     * 提示框的淡出有 120ms。如果一离开就把内容置空，这段过渡里剩下的是一个
     * 空边框在图表上方闪一下：日期和数值都没了，但盒子还在，因为 opacity 正从
     * 1 往 0 走。位置同理 —— 清空后 left 会落回兜底的 50%，盒子会先横跳到中间
     * 再消失。所以淡出期间沿用上一次的内容与位置，让它带着字整体淡下去。
     */
    usageTipLast: null as null | { day: any, leftPercent: number },

    /** 展开中取当前目标，淡出中取上一次 —— 提示框任何时候都有可显示的内容 */
    get _usageTipTarget(): { day: any, leftPercent: number } | null {
      return this.usageHover ?? this.usageTipLast
    },

    setUsageHover(day: any, index: number, count: number) {
      const center = count <= 0 ? 50 : ((index + 0.5) / count) * 100
      // 夹在 16%~84%：提示框自身有宽度，贴边会被面板裁掉
      const leftPercent = Math.min(84, Math.max(16, center))
      this.usageHover = { day, leftPercent }
      this.usageTipLast = this.usageHover
    },

    clearUsageHover() {
      // 只关不删：内容要留给淡出动画用，见上面的 usageTipLast
      this.usageHover = null
    },

    usageTipStyle(): string {
      return `left:${this._usageTipTarget?.leftPercent ?? 50}%`
    },

    usageTipDate(): string {
      return this._usageTipTarget?.day?.date ?? ''
    },

    usageHoverRows(): Array<{ label: string, value: string }> {
      const day = this._usageTipTarget?.day
      if (!day)
        return []
      return [
        { label: 'prompt', value: this.formatCount((day.cacheReadTokens ?? 0) + (day.nonCachedInputTokens ?? 0)) },
        { label: 'cached', value: this.formatCount(day.cacheReadTokens) },
        { label: 'new', value: this.formatCount(day.nonCachedInputTokens) },
        { label: 'output', value: this.formatCount(day.outputTokens) },
        { label: 'hit rate', value: this.formatPercent(day.cacheHitRate) },
        { label: 'calls', value: String(day.calls ?? 0) },
      ]
    },

    /** 图表横轴范围说明 —— 14 个具体日期挤在侧边栏宽度里读不清 */
    usageRangeLabel(): string {
      const days = this.usageDays()
      if (days.length === 0)
        return ''
      const first = String(days[0]?.date ?? '')
      const last = String(days[days.length - 1]?.date ?? '')
      const short = (value: string) => value.slice(5)
      return `${short(first)} → ${short(last)} · ${days.length} days`
    },

    /**
     * 标题后缀用的窗口说明。
     *
     * 趋势图和「按模型」表都是 14 天窗口口径，但表头原本只写 "Daily prompt tokens"
     * 和 "By model"，看不出这两个数到底统计了多久 —— 现在上面多了「今日/累计」
     * 两块，不写清口径就更容易被误当成同一段时间。
     */
    usageRangeShort(): string {
      return `last ${this.usageStats?.windowDays ?? 14}d`
    },

    // ── 二次确认弹窗 ──
    //
    // 删除 provider 会立刻落盘，model 删除则要等 Save —— 文案里说清楚，
    // 否则用户会以为没保存就能随便点。

    requestDeleteProvider(pid: string) {
      const provider = this.getProviderView(pid)
      const modelCount = (provider.models || []).length
      const isUnsaved = !this.baseProvider(pid)
      const name = provider.name || pid
      this.confirmDialog = {
        kind: 'deleteProvider',
        title: 'Delete provider',
        message: isUnsaved
          ? `"${name}" has not been saved yet; discarding it only affects this panel.`
          : `"${name}"${modelCount > 0 ? ` and its ${modelCount} model(s)` : ''} will be removed from providers.json.`,
        warning: isUnsaved ? undefined : 'This is written to disk immediately and cannot be undone from this panel.',
        confirmLabel: isUnsaved ? 'Discard' : 'Delete',
        pid,
      }
    },

    requestRemoveModel(pid: string, mid: string) {
      const provider = this.getProviderView(pid)
      const model = (provider.models || []).find((x: any) => x.id === mid)
      this.confirmDialog = {
        kind: 'removeModel',
        title: 'Remove model',
        message: `"${model?.displayName || model?.apiModel || mid}" will be removed from "${provider.name || pid}".`,
        warning: 'Takes effect after you save this provider.',
        confirmLabel: 'Delete',
        pid,
        mid,
      }
    },

    cancelConfirm() {
      this.confirmDialog = null
    },

    confirmAction() {
      const dialog = this.confirmDialog
      if (!dialog)
        return
      // 先关闭再执行：删除会触发 saveProviders → state 回推 → 重渲染，
      // 留着弹窗会让它在重渲染中被重建
      this.confirmDialog = null
      if (dialog.kind === 'deleteProvider')
        this.deleteProvider(dialog.pid)
      else if (dialog.kind === 'removeModel' && dialog.mid)
        this.deleteModel(dialog.pid, dialog.mid)
    },

    // ── 校验 ──
    validate(pid: string) {
      const p = this.getDraft(pid)
      const all = this.providers
      const errors: Record<string, string> = {}

      if (!p.name?.trim())
        errors.name = 'Name is required'
      if (!isProviderType(p.type))
        errors.type = 'Invalid protocol'
      if (p.baseUrl?.trim()) {
        try {
          void new URL(p.baseUrl.trim())
        }
        catch {
          errors.baseUrl = 'Invalid URL'
        }
      }
      if (!p.auth?.value?.trim())
        errors.authValue = 'Auth value is required'
      // Anthropic 允许 apiKey / token 两种; 其他协议只允许 apiKey
      if (this.providerUsesAnthropic(pid)) {
        if (!['apiKey', 'token'].includes(p.auth?.kind))
          errors.authKind = 'Invalid auth kind'
      }
      else if (p.auth?.kind !== 'apiKey') {
        errors.authKind = 'Only the Anthropic protocol accepts a Bearer token here'
      }

      // name 唯一
      const dupName = all.filter((x: any) => (x.name || '').trim().toLowerCase() === (p.name || '').trim().toLowerCase()).length > 1
      if (dupName)
        errors.name = 'Duplicate provider name'

      // model 校验
      const modelErrors: Record<string, Record<string, string>> = {}
      const modelIds = new Set<string>()
      const OPTIONAL_NUM_FIELDS = ['thinkingBudgetTokens']
      for (const m of p.models || []) {
        const me: Record<string, string> = {}
        if (!m.apiModel?.trim())
          me.apiModel = 'API Model is required'
        if (!m.displayName?.trim())
          me.displayName = 'Display name is required'
        if (modelIds.has(m.id))
          me.id = 'Duplicate model id'
        modelIds.add(m.id)
        // contextTokenLimit 必填 — 影响 Cursor UI 上下文进度条
        if (m.contextTokenLimit === undefined || m.contextTokenLimit === null || m.contextTokenLimit === '') {
          me.contextTokenLimit = 'Context limit is required'
        }
        else if (!Number.isFinite(Number(m.contextTokenLimit)) || Number(m.contextTokenLimit) <= 0 || !Number.isInteger(Number(m.contextTokenLimit))) {
          me.contextTokenLimit = 'Must be a positive integer'
        }
        // maxOutputTokens — noMaxTokens 开启时跳过必填校验
        if (!m.noMaxTokens) {
          if (m.maxOutputTokens === undefined || m.maxOutputTokens === null || m.maxOutputTokens === '') {
            me.maxOutputTokens = 'Max output is required'
          }
          else if (!Number.isFinite(Number(m.maxOutputTokens)) || Number(m.maxOutputTokens) <= 0 || !Number.isInteger(Number(m.maxOutputTokens))) {
            me.maxOutputTokens = 'Must be a positive integer'
          }
        }
        for (const f of OPTIONAL_NUM_FIELDS) {
          const v = m[f]
          if (v === undefined || v === null || v === '')
            continue
          if (!Number.isFinite(Number(v)) || Number(v) < 0 || !Number.isInteger(Number(v))) {
            me[f] = 'Must be a non-negative integer'
          }
        }
        // Budget 模式校验: thinking=true + 无 level → budget 必填, ≥1024, < maxOutputTokens
        if (m.thinking && !m.thinkingLevel) {
          const b = m.thinkingBudgetTokens
          const maxOut = Number(m.maxOutputTokens) || 0
          if (b === undefined || b === null || b === '')
            me.thinkingBudgetTokens = 'Required — enter a thinking budget'
          else if (Number(b) < 1024)
            me.thinkingBudgetTokens = 'Minimum 1024'
          else if (maxOut > 0 && Number(b) >= maxOut)
            me.thinkingBudgetTokens = `Must be below the max output (${maxOut})`
          else if (maxOut === 0)
            me.thinkingBudgetTokens = 'Fill in max output first'
        }
        if (Object.keys(me).length > 0)
          modelErrors[m.id] = me
      }

      return { errors, modelErrors, ok: Object.keys(errors).length === 0 && Object.keys(modelErrors).length === 0 }
    },

    // ── UI 操作 ──
    toggleExpand(pid: string) {
      this.expanded[pid] = !this.expanded[pid]
    },

    toggleModelExpand(pid: string, mid: string) {
      if (!this.modelExpanded[pid])
        this.modelExpanded[pid] = {}
      this.modelExpanded[pid][mid] = !this.modelExpanded[pid][mid]
    },

    // ── 字段更新 ──
    updateField(pid: string, field: string, value: any) {
      const d = this.ensureDraft(pid)
      if (field === 'auth.kind') {
        d.auth = { ...(d.auth || {}), kind: value }
      }
      else if (field === 'auth.value') {
        d.auth = { ...(d.auth || {}), value }
      }
      else if (field === 'headers') {
        // JSON textarea → parse to object, ignore invalid
        if (typeof value === 'string') {
          const trimmed = value.trim()
          if (!trimmed) {
            delete d.headers
          }
          else {
            try {
              const parsed = JSON.parse(trimmed)
              if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
                d.headers = parsed
            }
            catch { /* 输入中途不合法 — 不更新 */ }
          }
        }
      }
      else {
        d[field] = value
      }
    },

    formatHeaders(pid: string): string {
      const h = this.getDraft(pid).headers
      if (!h || typeof h !== 'object' || Object.keys(h).length === 0)
        return ''
      return JSON.stringify(h, null, 2)
    },

    updateHeaders(pid: string, raw: string) {
      const trimmed = raw.trim()
      if (!trimmed) {
        this.headersInvalid[pid] = false
        this.updateField(pid, 'headers', '')
        return
      }
      try {
        JSON.parse(trimmed)
        this.headersInvalid[pid] = false
      }
      catch {
        this.headersInvalid[pid] = true
      }
      this.updateField(pid, 'headers', raw)
    },

    /**
     * 该中转站下是否有模型走 Anthropic 协议。
     *
     * Auth Kind 只在 Anthropic 下有意义（只有它同时接受 x-api-key 与
     * Authorization: Bearer）；OpenAI / Gemini 都只有 apiKey 一种。
     * 以前按 provider.type 判断，但协议已经挪到模型上，所以改为看模型。
     * 还没有模型时按 true 处理 —— 让用户能先填完鉴权再配模型。
     */
    providerUsesAnthropic(pid: string): boolean {
      const models = this.getDraft(pid).models || []
      if (!models.length)
        return true
      return models.some((m: any) => this.modelProtocolType(pid, m.id) === 'anthropic')
    },

    /**
     * 该中转站下是否有模型能用 HTTP 代理。
     * Gemini SDK 没有 fetch 注入点，只有 Anthropic / OpenAI 能走代理。
     */
    providerUsesProxy(pid: string): boolean {
      const models = this.getDraft(pid).models || []
      if (!models.length)
        return true
      return models.some((m: any) => this.modelProtocolType(pid, m.id) !== 'gemini')
    },

    /**
     * 规范化 auth.kind：非 Anthropic 一律重置为 apiKey，避免旧的 "token" 残留污染。
     * Anthropic 同时支持两种，保留用户的选择。
     */
    normalizeAuthKind(pid: string) {
      const d = this.ensureDraft(pid)
      if (!this.providerUsesAnthropic(pid)) {
        d.auth = { ...(d.auth || { value: '' }), kind: 'apiKey' }
      }
    },

    updateModelField(pid: string, mid: string, field: string, value: any) {
      const d = this.ensureDraft(pid)
      const m = (d.models || []).find((x: any) => x.id === mid)
      if (!m)
        return

      if (field === 'thinkingLevel') {
        if (!value)
          delete m.thinkingLevel
        else m.thinkingLevel = value
      }
      else if (field === 'thinking') {
        m.thinking = !!value
        if (!value) {
          delete m.thinkingLevel
          delete m.thinkingBudgetTokens
        }
        else {
          const pType = this.modelProtocolType(pid, mid)
          if (!m.thinkingLevel && !m.thinkingBudgetTokens) {
            if (pType === 'anthropic')
              m.thinkingLevel = 'high'
            else
              m.thinkingLevel = 'medium'
          }
        }
      }
      else {
        m[field] = value
      }

      // QS 联动: thinking/thinkingLevel 变更时自动开启对应 QS 开关
      if (field === 'thinking' || field === 'thinkingLevel') {
        this._syncQsFromDefaults(pid, mid)
      }
    },

    setThinkingMode(pid: string, mid: string, mode: 'level' | 'budget') {
      const d = this.ensureDraft(pid)
      const m = (d.models || []).find((x: any) => x.id === mid)
      if (!m)
        return
      if (mode === 'level') {
        delete m.thinkingBudgetTokens
        if (!m.thinkingLevel)
          m.thinkingLevel = 'high'
      }
      else {
        delete m.thinkingLevel
      }
    },

    updateModelNumber(pid: string, mid: string, field: string, raw: string) {
      const d = this.ensureDraft(pid)
      const m = (d.models || []).find((x: any) => x.id === mid)
      if (!m)
        return

      if (raw.trim() === '') {
        delete m[field]
        if (field === 'contextTokenLimit')
          delete m.contextTokenLimitForMaxMode
      }
      else {
        const n = Number(raw)
        m[field] = n
        if (field === 'contextTokenLimit')
          m.contextTokenLimitForMaxMode = n
      }

      // QS 联动: budget 模式 (thinkingBudgetTokens) 变更时同样自动开启 QS 开关
      if (field === 'thinkingBudgetTokens')
        this._syncQsFromDefaults(pid, mid)
    },

    // ── Provider / Model 增删 ──
    addProvider() {
      const p = {
        id: uid('provider'),
        name: 'New Provider',
        type: 'anthropic',
        baseUrl: '',
        auth: { kind: 'apiKey', value: '' },
        models: [],
      }
      this.drafts[p.id] = p
      this.expanded[p.id] = true
    },

    addModel(pid: string) {
      const d = this.ensureDraft(pid)
      const m = {
        id: uid('model'),
        apiModel: '',
        displayName: '',
        thinking: false,
        defaultOn: true, // 新建模型默认启用, 避免用户忘记勾选导致客户端看不到
      }
      if (!d.models)
        d.models = []
      d.models.push(m)
      if (!this.modelExpanded[pid])
        this.modelExpanded[pid] = {}
      this.modelExpanded[pid][m.id] = true
    },

    deleteModel(pid: string, mid: string) {
      const d = this.ensureDraft(pid)
      d.models = (d.models || []).filter((x: any) => x.id !== mid)
      if (this.modelExpanded[pid])
        delete this.modelExpanded[pid][mid]
    },

    // ── 模型拖动排序 ──
    //
    // 顺序是有意义的：Cursor 的模型选择器按 providers.json 里 models 数组的顺序渲染
    // （见 server/config/providersStore.ts 的 flattenModels），用户把常用模型拖到前面
    // 就能少滚动。所以这里改的是真实的数组顺序，会和其它字段一样进 draft 走 dirty → 保存流程。

    beginModelDrag(mid: string) {
      this.modelDragId = mid
      this.modelDragOverId = ''
      this.modelDragAfter = false
    },

    /**
     * 指针走到某个模型卡片上 —— 以上下半区决定插在它前面还是后面。
     *
     * 用卡片中线而不是鼠标移动方向，是因为"往上拖但还没越过中线"时，
     * 按方向判断会让插入位置提前跳变，看起来比实际更靠前。
     */
    hoverModelDuringDrag(mid: string, event: DragEvent) {
      if (!this.modelDragId || this.modelDragId === mid)
        return
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      if (!rect) {
        this.modelDragOverId = mid
        this.modelDragAfter = false
        return
      }
      const midpoint = rect.top + rect.height / 2
      this.modelDragOverId = mid
      this.modelDragAfter = event.clientY > midpoint
    },

    endModelDrag() {
      this.modelDragId = ''
      this.modelDragOverId = ''
      this.modelDragAfter = false
    },

    /** 模板里判断插入线画在卡片上沿还是下沿 */
    modelDropEdge(mid: string): 'top' | 'bottom' | '' {
      if (!this.modelDragId || this.modelDragOverId !== mid)
        return ''
      if (this.modelDragId === mid)
        return ''
      return this.modelDragAfter ? 'bottom' : 'top'
    },

    dropModel(pid: string, targetId: string) {
      const draggedId = this.modelDragId
      const placeAfter = this.modelDragAfter
      this.endModelDrag()
      if (!draggedId || draggedId === targetId)
        return

      const d = this.ensureDraft(pid)
      const models = d.models || []
      const next = reorderById(models, draggedId, targetId, placeAfter)
      // 顺序没变就别动数组 —— 赋值会替换引用，白白触发一次全列表重渲染
      if (next.every((m: any, i: number) => m === models[i]))
        return
      d.models = next
    },

    // ── QuickSwitch auto-link ──

    _syncQsFromDefaults(pid: string, mid: string) {
      const d = this.ensureDraft(pid)
      const m = (d.models || []).find((x: any) => x.id === mid)
      if (!m)
        return
      const pType = this.modelProtocolType(pid, mid)
      const isOpenAI = pType === 'openai-chat' || pType === 'openai-responses'

      if (m.thinking && m.thinkingLevel) {
        if (!m.parameters)
          m.parameters = {}
        if (isOpenAI) {
          if (!Array.isArray(m.parameters.reasoning))
            m.parameters.reasoning = this._qsLevelsForType(pType)
        }
        else {
          if (m.parameters.thinking !== true)
            m.parameters.thinking = true
          if (!Array.isArray(m.parameters.effort))
            m.parameters.effort = this._qsLevelsForType(pType)
        }
      }
      // budget 模式 (Anthropic/Gemini): QS 没有 budget 轴, 只联动 Thinking Toggle,
      // 运行时由 resolved.thinkingBudgetTokens 兜底
      else if (m.thinking && m.thinkingBudgetTokens && !isOpenAI) {
        if (!m.parameters)
          m.parameters = {}
        if (m.parameters.thinking !== true)
          m.parameters.thinking = true
      }
    },

    _qsLevelsForType(pType: string): string[] {
      if (pType === 'anthropic')
        return ['low', 'medium', 'high', 'xhigh', 'max']
      if (pType === 'gemini')
        return ['minimal', 'low', 'medium', 'high']
      return ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    },

    // ── Edit Panel parameters helpers ──

    setEditParam(pid: string, mid: string, key: string, value: any) {
      const d = this.ensureDraft(pid)
      const m = (d.models || []).find((x: any) => x.id === mid)
      if (!m)
        return
      if (!m.parameters)
        m.parameters = {}
      if (value === undefined || value === false)
        delete (m.parameters as any)[key]
      else
        (m.parameters as any)[key] = value
      if (Object.keys(m.parameters).length === 0)
        delete m.parameters
    },

    toggleEditParamArrayItem(pid: string, mid: string, key: string, item: string, checked: boolean) {
      const d = this.ensureDraft(pid)
      const m = (d.models || []).find((x: any) => x.id === mid)
      if (!m?.parameters)
        return
      const arr: string[] = (m.parameters as any)[key]
      if (!Array.isArray(arr))
        return
      if (checked && !arr.includes(item))
        arr.push(item)
      else if (!checked)
        (m.parameters as any)[key] = arr.filter((v: string) => v !== item)
    },

    removeEditParamArrayIndex(pid: string, mid: string, key: string, index: number) {
      const d = this.ensureDraft(pid)
      const m = (d.models || []).find((x: any) => x.id === mid)
      if (!m?.parameters)
        return
      const arr: any[] = (m.parameters as any)[key]
      if (!Array.isArray(arr))
        return
      arr.splice(index, 1)
    },

    addEditParamContextValue(pid: string, mid: string, value: number) {
      const d = this.ensureDraft(pid)
      const m = (d.models || []).find((x: any) => x.id === mid)
      if (!m?.parameters || !Array.isArray(m.parameters.context))
        return
      if (!value || value <= 0 || !Number.isFinite(value))
        return
      if (!m.parameters.context.includes(value)) {
        m.parameters.context.push(value)
        m.parameters.context.sort((a: number, b: number) => a - b)
      }
    },

    resetProvider(pid: string) {
      delete this.drafts[pid]
      const base = (this.state?.providers || []).find((p: any) => p.id === pid)
      if (!base) {
        delete this.expanded[pid]
        delete this.modelExpanded[pid]
      }
    },

    moveProvider(pid: string, direction: number) {
      const list = [...(this.state?.providers || [])]
      const idx = list.findIndex((p: any) => p.id === pid)
      if (idx < 0)
        return
      const target = idx + direction
      if (target < 0 || target >= list.length)
        return
      const tmp = list[idx]
      list[idx] = list[target]
      list[target] = tmp
      const merged = list.map((p: any) => this.materializeModelProtocols(this.drafts[p.id] ?? p))
      this.post('saveProviders', { providers: JSON.parse(JSON.stringify(merged)) })
    },

    deleteProvider(pid: string) {
      const remaining = (this.state?.providers || []).filter((p: any) => p.id !== pid)
      const merged = remaining.map((p: any) => this.materializeModelProtocols(this.drafts[p.id] ?? p))
      delete this.drafts[pid]
      delete this.expanded[pid]
      delete this.modelExpanded[pid]
      this.post('saveProviders', { providers: JSON.parse(JSON.stringify(merged)) })
    },

    saveProvider(pid: string) {
      try {
        const p = this.getProviderView(pid)
        const v = this.validate(pid)
        if (!v.ok) {
          const providerName = p.name || 'Provider'
          for (const [, msg] of Object.entries(v.errors))
            this.toast(`${providerName}: ${msg}`, 'error', 6000)
          for (const [mid, errs] of Object.entries(v.modelErrors) as [string, Record<string, string>][]) {
            const m = (p.models || []).find((x: any) => x.id === mid)
            const modelLabel = m?.displayName || m?.apiModel || mid
            for (const [, msg] of Object.entries(errs))
              this.toast(`${providerName}: ${modelLabel} — ${msg}`, 'error', 6000)
            this.expanded[p.id] = true
            if (!this.modelExpanded[p.id])
              this.modelExpanded[p.id] = {}
            this.modelExpanded[p.id][mid] = true
          }
          return
        }

        // 固化自动推导出的协议：服务端只认 model.type / provider.type，
        // 不认识按模型名的推导规则，不固化就会出现"界面显示的和实际请求的不一致"
        this.materializeModelProtocols(p)
        const snapshot = clone(p)
        const baseProviders = [...(this.state?.providers || [])]
        const idx = baseProviders.findIndex((x: any) => x.id === pid)
        const nextProviders = idx >= 0
          ? baseProviders.map((x: any) => x.id === pid ? snapshot : x)
          : [...baseProviders, snapshot]
        const requestId = uid('save')
        this.saveSnapshots[requestId] = { targetIds: [pid], snapshots: { [pid]: snapshot } }
        this.savingProviders[pid] = true
        this.post('saveProviders', {
          requestId,
          targetIds: [pid],
          providers: JSON.parse(JSON.stringify(nextProviders)),
        })
      }
      catch (e) {
        this.toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
      }
    },

    // ── Autocomplete ──
    searchCatalog(pid: string, mid: string, query: string) {
      if (acTimer)
        clearTimeout(acTimer)
      const q = query.trim()
      if (q.length < 2 && !this.ac) {
        return
      }
      acTimer = setTimeout(() => {
        const reqId = ++this.acReqId
        this.ac = { pid, mid, results: [], selected: 0, reqId }
        vscode.postMessage({ type: 'searchCatalog', query: q.length >= 2 ? q : '', requestId: reqId })
      }, 120)
    },

    toggleCatalog(pid: string, mid: string, inputEl: HTMLInputElement | null) {
      if (this.ac?.pid === pid && this.ac?.mid === mid) {
        this.ac = null
        return
      }
      const q = (inputEl?.value ?? '').trim()
      const reqId = ++this.acReqId
      this.ac = { pid, mid, results: [], selected: 0, reqId }
      vscode.postMessage({ type: 'searchCatalog', query: q, requestId: reqId })
      inputEl?.focus()
    },

    applyCatalogEntry(pid: string, mid: string, entry: any) {
      const d = this.ensureDraft(pid)
      const m = (d.models || []).find((x: any) => x.id === mid)
      if (!m)
        return

      // id 保持 addModel 生成的随机值不变 — 作为跨 provider 全局唯一 key
      m.apiModel = entry.id
      if (!m.displayName?.trim())
        m.displayName = entry.name
      if (m.contextTokenLimit === undefined || m.contextTokenLimit === null) {
        m.contextTokenLimit = entry.contextLimit
        m.contextTokenLimitForMaxMode = entry.contextLimit
      }
      if (!m.thinking && entry.reasoning) {
        m.thinking = true
        if (!m.thinkingLevel && !m.thinkingBudgetTokens) {
          const pType = d.type
          m.thinkingLevel = pType === 'anthropic' ? 'high' : 'medium'
        }
      }
      if ((m.maxOutputTokens === undefined || m.maxOutputTokens === null) && entry.outputLimit)
        m.maxOutputTokens = entry.outputLimit
      if (m.supportsAgent === undefined)
        m.supportsAgent = entry.toolCall
      if (m.supportsImages === undefined)
        m.supportsImages = entry.hasImages

      this.ac = null
      // x-effect 在 input 聚焦时不回写 DOM，blur 后又不重跑（m.apiModel 无二次变化）。
      // 因此手动将选中的 entry.id 写入 DOM 再 blur，确保完整 model ID 上屏。
      queueMicrotask(() => {
        if (document.activeElement instanceof HTMLInputElement) {
          document.activeElement.value = m.apiModel || ''
          document.activeElement.blur()
        }
      })
    },

    acNavigate(dir: number) {
      if (!this.ac || !this.ac.results.length)
        return
      this.ac.selected = Math.max(0, Math.min(this.ac.selected + dir, this.ac.results.length - 1))
    },

    acSelect(pid: string, mid: string) {
      if (!this.ac || !this.ac.results.length)
        return
      const entry = this.ac.results[this.ac.selected]
      if (entry)
        this.applyCatalogEntry(pid, mid, entry)
    },

    acClose() {
      this.ac = null
    },

    // ── Remote Models (GET /v1/models) ──
    fetchRemoteModels(pid: string) {
      if (this.remoteModels[pid]?.loading)
        return
      const draft = this.getDraft(pid)
      if (!draft.baseUrl?.trim()) {
        this.toast('Set the Base URL first', 'warn')
        return
      }
      if (!draft.auth?.value?.trim()) {
        this.toast('Set the auth value first', 'warn')
        return
      }
      this.remoteModels = { ...this.remoteModels, [pid]: { loading: true } }
      this.post('fetchRemoteModels', { pid, draft: JSON.parse(JSON.stringify(draft)) })
    },

    dismissRemoteModels(pid: string) {
      const { [pid]: _, ...rest } = this.remoteModels
      this.remoteModels = rest
    },

    applyRemoteModel(pid: string, rm: RemoteModelEntry) {
      this.addModel(pid)
      const d = this.ensureDraft(pid)
      const models = d.models || []
      const lastModel = models[models.length - 1]
      if (lastModel) {
        lastModel.apiModel = rm.id
        // Display Name 也一并填上。
        //
        // 有些中转站会把 id 混淆成不可读的串（把 flash 倒写成 hsalf 之类），
        // 此时上游给的 display_name 才是唯一认得出来的名字。只填 apiModel 的话
        // 用户得自己对照着手敲一遍，而这正是最容易敲错的地方。
        // 只在还没填过时才写，避免覆盖用户已经改好的名字。
        if (!lastModel.displayName?.trim())
          lastModel.displayName = rm.displayName || rm.id
        // 展开新 model 面板
        if (!this.modelExpanded[pid])
          this.modelExpanded[pid] = {}
        this.modelExpanded[pid][lastModel.id] = true
        // 触发 catalog fuzzy search 自动补全
        queueMicrotask(() => this.searchCatalog(pid, lastModel.id, rm.id))
      }
    },

    /**
     * 列表里每一项的展示文案。
     *
     * 上游给了 display_name 就用它当主标题 —— id 可能是混淆过的乱码，
     * 直接拿 id 当标题会让整列都不可读。
     */
    remoteModelPrimary(rm: RemoteModelEntry): string {
      return rm.displayName || rm.id
    },

    /** 副标题：只有可读名和 id 不一致时才显示 id，否则是重复信息 */
    remoteModelSecondary(rm: RemoteModelEntry): string {
      if (!rm.displayName || rm.displayName === rm.id)
        return ''
      return rm.id
    },

    /** apiModel blur — id 保持不变,不再同步覆盖 */
    syncModelId(_pid: string, _mid: string) {
      // id 是 addModel 生成的随机值,作为全局唯一 key,不随 apiModel 变化
    },

    /** 获取单个 model 的校验错误 (供模板使用, 避免长表达式) */
    getModelErrors(pid: string, mid: string): Record<string, string> {
      return this.validate(pid).modelErrors[mid] || {}
    },

    fmtCtx(n: number): string {
      if (n >= 1_000_000) {
        const v = n / 1_000_000
        return `${Number.isInteger(v) ? v : v.toFixed(1)}M`
      }
      if (n >= 1_000)
        return `${Math.round(n / 1_000)}k`
      return String(n)
    },

    // ── 通信 ──
    //
    // 信封字段必须最后展开: 载荷里若带了同名 key (例如 type), 会覆盖掉消息类型,
    // 宿主侧 switch 就匹配不到任何分支 —— 请求被静默丢弃, 界面永远停在"Testing…"。
    // 让信封优先, 这类冲突退化成"载荷字段丢失"而不是"整条消息消失"。
    post(type: string, payload?: any) {
      vscode.postMessage({ ...payload, type })
    },
  }

  Alpine.store('app', store)

  // ── 消息接收 ──
  window.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data
    const s = Alpine.store('app') as any

    if (msg?.type === 'state') {
      s.state = msg.state
      if (msg.state?.webTools)
        s.webTools = clone(msg.state.webTools)
      for (const pid of Object.keys(s.drafts)) {
        const base = (s.state?.providers || []).find((p: any) => p.id === pid)
        if (base && providersEqual(base, s.drafts[pid]))
          delete s.drafts[pid]
      }
      // 首次拿到 state 就拉一次用量统计。
      //
      // 不能只靠 setTab / toggleUsage 触发：面板打开时 activeTab 本来就是
      // dashboard，那两个入口都不会被调用，于是首屏是空的 —— 必须切一次页签
      // 才会去加载。放在这里而不是紧跟 ready，是因为收到 state 才说明扩展宿主
      // 那侧已经就绪，此时发请求不会丢。
      if (!s.usageBootstrapped) {
        s.usageBootstrapped = true
        s.loadUsageStats()
      }
    }
    else if (msg?.type === 'saveProvidersResult') {
      if (msg.state) {
        s.state = msg.state
        if (msg.state?.webTools)
          s.webTools = clone(msg.state.webTools)
      }
      const requestId = msg.requestId as string
      const pending = requestId ? s.saveSnapshots[requestId] : null
      const targetIds = pending?.targetIds || msg.targetIds || []
      for (const pid of targetIds)
        delete s.savingProviders[pid]
      if (!msg.ok) {
        s.toast(`Save failed: ${msg.error || 'unknown error'}`, 'error', 6000)
      }
      else {
        for (const pid of targetIds) {
          const sent = pending?.snapshots?.[pid]
          const current = s.drafts[pid]
          const base = (s.state?.providers || []).find((p: any) => p.id === pid)
          if (sent && current && providersEqual(current, sent))
            delete s.drafts[pid]
          else if (sent && !current && base && providersEqual(base, sent))
            delete s.drafts[pid]
          else if (!sent && base && current && providersEqual(base, current))
            delete s.drafts[pid]
        }
        s.toast('Providers saved.', 'info')
      }
      if (requestId)
        delete s.saveSnapshots[requestId]
    }
    else if (msg?.type === 'remoteModelsResult') {
      const pid = msg.pid as string
      if (msg.error) {
        s.remoteModels = { ...s.remoteModels, [pid]: { loading: false, error: msg.error } }
        s.toast(`Failed to fetch models: ${msg.error}`, 'error', 6000)
      }
      else {
        s.remoteModels = { ...s.remoteModels, [pid]: { loading: false, models: msg.models || [] } }
      }
    }
    else if (msg?.type === 'catalogResults') {
      if (!s.ac || msg.requestId !== s.ac.reqId)
        return
      s.ac.results = msg.results || []
      s.ac.selected = 0
    }
    else if (msg?.type === 'searchTestResult') {
      s.searchTesting = false
      s.searchTestResult = msg.ok
        ? { level: 'ok', text: msg.text || 'Success' }
        : { level: 'error', text: msg.text || 'Failed' }
    }
    else if (msg?.type === 'fetchTestResult') {
      s.fetchTesting = false
      s.fetchTestResult = msg.ok
        ? { level: 'ok', text: msg.text || 'Success' }
        : { level: 'error', text: msg.text || 'Failed' }
    }
    else if (msg?.type === 'modelTestResult') {
      const mid = msg.mid as string
      // 结果必须记住"用了哪种协议"：探测成功后就靠它回填到 provider 上。
      // 冗余存一份在 result 里是为了排错时能从单条结果看出当时的口径。
      const overrideType = isProviderType(msg.overrideType) ? msg.overrideType : undefined
      s.modelTests = {
        ...s.modelTests,
        [mid]: { running: false, overrideType, result: msg.result as ModelTestResult },
      }
      // 批量测试靠这个 resolver 串起来 —— 必须等结果落到 state 之后再放行下一个
      const testId = msg.testId as string | undefined
      const resolve = testId ? s._testResolvers[testId] : null
      if (testId && resolve) {
        delete s._testResolvers[testId]
        resolve()
      }
    }
    else if (msg?.type === 'protocolDetected') {
      const mid = String(msg.mid ?? '')
      s.protocolDetecting = { ...s.protocolDetecting, [mid]: false }
      const requestId = String(msg.requestId ?? '')
      const resolveDetect = s._protocolResolvers[requestId]
      if (resolveDetect) {
        delete s._protocolResolvers[requestId]
        resolveDetect(msg.error
          ? { ok: false, error: String(msg.error) }
          : { ok: true, detection: msg.detection as ProtocolDetection })
      }
    }
    else if (msg?.type === 'usageStats') {
      s.usageLoading = false
      if (msg.error) {
        s.usageError = String(msg.error)
      }
      else {
        s.usageError = ''
        s.usageStats = msg.summary as UsageSummary
      }
    }
    else if (msg?.type === 'toast') {
      s.toast(msg.text, msg.level || 'info', msg.duration ?? 4000)
    }
  })

  // 通知 extension 就绪
  vscode.postMessage({ type: 'ready' })
}
