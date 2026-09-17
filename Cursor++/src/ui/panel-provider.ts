/**
 * Cursor++ 侧边栏面板 — Server 控制 + Provider 配置
 *
 * 渲染策略:
 *   - Hono JSX 生成带 Alpine 指令的静态 HTML (extension host 侧, 一次性)
 *   - dist/webview.js (Alpine.js + store) 内联注入, 接管所有交互
 *   - 通过 postMessage 与 extension host 双向通信
 *
 * Provider 机制:
 *   - 数据源: ~/.ccursor/providers.json (通过 providersStore)
 *   - Alpine store 管理 drafts / expanded / autocomplete 等 UI 状态
 *   - 所有表单交互由 Alpine 响应式处理, 无 innerHTML 重写
 */
import type { ProviderEntry } from '../server/data/defaults'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { bumpRefreshSignal } from '../server'
import { searchCatalog } from '../server/config/catalogStore'
import { loadProviders, updateProviders } from '../server/config/providersStore'
import { effectiveProviderType, isProviderType } from '../server/data/defaults'
import { detectModelProtocol, runModelTest } from '../server/handlers/llm/modelTest'
import { resetProviderInstanceCache } from '../server/handlers/llm/providerRuntime'
import { logger } from '../server/logger'
import { buildUsageSummary, renameProviderInUsageFile } from '../server/stats/usageStore'
import { buildProviderBaseUrl, materializeModelProtocols } from '../shared/providerProtocol'
import { normalizeRemoteModels } from '../shared/remoteModels'
import { renderHtml } from './components/layout'
import { getState, onStateChange, refreshState } from './state'

let webviewJsCache: string | null = null

/**
 * 中转站改名后同步历史用量记录。
 *
 * 用量行按显示名聚合，改名后旧记录会留在旧名字下，「按模型」那张表就会把
 * 同一个中转站拆成两行、命中率也被拆散。新的记录带 providerId（显示时能按 id
 * 重新解析），但已经写下的老记录没有 id，只能靠这里按旧名字改写追平。
 *
 * 统计是纯附加数据，写失败不该影响 provider 保存本身，因此只记日志。
 */
function syncUsageProviderNames(previous: ProviderEntry[], next: ProviderEntry[]): void {
  const previousById = new Map(previous.map(entry => [entry.id, entry]))
  for (const entry of next) {
    const before = previousById.get(entry.id)
    if (!before || before.name === entry.name)
      continue
    void renameProviderInUsageFile({
      providerId: entry.id,
      previousName: before.name,
      nextName: entry.name,
    }).catch((error) => {
      logger.warn({ error, providerId: entry.id }, '[STATS] failed to sync provider name in usage records')
    })
  }
}

/**
 * 正在进行的模型测试 —— testId → 取消标志。
 *
 * 放模块级而非实例属性：面板视图可能被重建（侧边栏收起/拖动/重载），
 * 但一个已经发出的 HTTP 请求不该因此失去取消能力。
 */
const runningModelTests = new Map<string, { cancelled: boolean }>()

function getWebviewJs(extensionPath: string): string {
  if (!webviewJsCache) {
    const raw = readFileSync(join(extensionPath, 'dist', 'webview.js'), 'utf-8')
    // 内联 <script> 安全转义: </script> 和 <!-- 会被 HTML 解析器截断
    webviewJsCache = raw.replaceAll('</script>', '<\\/script>').replaceAll('<!--', '<\\!--')
  }
  return webviewJsCache
}

export class PanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'cursor2plus.panel'

  private view?: vscode.WebviewView
  private context: vscode.ExtensionContext
  private disposeStateListener?: vscode.Disposable

  constructor(context: vscode.ExtensionContext) {
    this.context = context
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView

    // codicon 字体取自 **Cursor 本体**（`<app>/out/media/codicon.ttf`），也就是扩展目录
    // 之外 —— 图标没必要自己再打包一份 141KB 的字体。
    //
    // 但必须把这个目录显式加进 localResourceRoots：webview 只允许加载 roots 之内的
    // 本地资源，默认 roots 就是扩展目录本身。少了这一句，@font-face 的请求会被拦下，
    // 字体静默回退到系统字体 —— 而 .codicon 用的是私有区码位，系统字体里没有，
    // 于是图标全变成"缺字方块"（密码框旁的眼睛按钮就是这样消失的）。
    // 注意 localResourceRoots 一旦显式给出就会**替换**默认值，所以扩展目录要一并列上。
    const mediaDir = join(this.context.extensionPath, '..', '..', 'out', 'media')
    const codiconPath = join(mediaDir, 'codicon.ttf')
    const hasCodiconFont = existsSync(codiconPath)

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        ...(hasCodiconFont ? [vscode.Uri.file(mediaDir)] : []),
      ],
    }

    const webviewJs = getWebviewJs(this.context.extensionPath)

    // 字体找不到时宁可不注入 @font-face：那样按钮是空的，而不是更糟的方块乱码。
    // （正常情况下这个分支走不到 —— Cursor 各平台安装目录里都带 media/codicon.ttf。）
    const codiconUri = hasCodiconFont
      ? webviewView.webview.asWebviewUri(vscode.Uri.file(codiconPath)).toString()
      : undefined

    webviewView.webview.html = renderHtml(webviewJs, codiconUri)

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          await refreshState()
          this.postState()
          break
        case 'toggleByok':
          await vscode.commands.executeCommand('cursor2plus.toggleByok')
          break
        case 'toggleServer':
          await vscode.commands.executeCommand('cursor2plus.serverToggle')
          break
        case 'editRoutes':
          await vscode.commands.executeCommand('cursor2plus.editRoutes')
          break
        case 'editProvidersJson':
          await vscode.commands.executeCommand('cursor2plus.editProviders')
          break
        case 'toggleFileLog':
          await vscode.commands.executeCommand('cursor2plus.toggleFileLog')
          break
        case 'openLogFile':
          await vscode.commands.executeCommand('cursor2plus.openLogFile')
          break
        case 'searchCatalog': {
          const query = typeof msg.query === 'string' ? msg.query : ''
          const results = searchCatalog(query, 30)
          this.view?.webview.postMessage({
            type: 'catalogResults',
            requestId: msg.requestId,
            results,
          })
          break
        }
        case 'fetchRemoteModels': {
          const pid = msg.pid as string
          const providers = getState().providers || []
          const draft = msg.draft as any
          const p = draft || providers.find((x: any) => x.id === pid)
          if (!p?.auth?.value) {
            this.view?.webview.postMessage({ type: 'remoteModelsResult', pid, error: 'No API key set yet' })
            break
          }
          const baseUrl = (p.baseUrl || '').trim()
          if (!baseUrl) {
            this.view?.webview.postMessage({ type: 'remoteModelsResult', pid, error: 'No Base URL set yet' })
            break
          }
          // 「列出模型」得挑一种协议去问。中转站下可以混挂多家，这里取第一个
          // 填了 API Model 的模型所生效的协议 —— 它至少对应一个真实存在的模型，
          // 比拿遗留的 provider.type 去猜更靠谱。都没有时回落到 provider.type。
          const probeModel = (p.models || []).find((m: any) => m?.apiModel?.trim())
          const type = probeModel ? effectiveProviderType(p, probeModel) : p.type
          // 地址是前缀，版本段由协议补全 —— 见 shared/providerProtocol.ts
          const base = buildProviderBaseUrl(type, baseUrl)
          const url = type === 'anthropic'
            ? `${base}/v1/models`
            : type === 'gemini'
              // Gemini Developer API: GET {host}/v1beta/models (key 走 x-goog-api-key header)
              ? `${base}/v1beta/models`
              : `${base}/models`
          try {
            const headers: Record<string, string> = {}
            if (type === 'gemini') {
              headers['x-goog-api-key'] = p.auth.value
              headers['x-goog-api-client'] = 'google-genai-sdk/2.7.0'
            }
            else {
              headers.Authorization = `Bearer ${p.auth.value}`
              if (type === 'anthropic') {
                headers['x-api-key'] = p.auth.value
                headers['anthropic-version'] = '2023-06-01'
              }
            }
            if (p.headers && typeof p.headers === 'object') {
              for (const [k, v] of Object.entries(p.headers)) {
                if (typeof v === 'string')
                  headers[k] = v
              }
            }
            const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
            if (!resp.ok) {
              const body = await resp.text().catch(() => '')
              this.view?.webview.postMessage({ type: 'remoteModelsResult', pid, error: `${resp.status} ${resp.statusText}: ${body.slice(0, 200)}` })
              break
            }
            const json = await resp.json() as any
            const models = normalizeRemoteModels(json)
            this.view?.webview.postMessage({ type: 'remoteModelsResult', pid, models })
          }
          catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            this.view?.webview.postMessage({ type: 'remoteModelsResult', pid, error: errMsg })
          }
          break
        }
        case 'saveWebTools': {
          try {
            const { updateWebTools } = await import('../server/config/searchConfigStore')
            await updateWebTools((draft) => {
              Object.assign(draft, msg.config)
            })
            await refreshState()
            this.postState()
          }
          catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            this.view?.webview.postMessage({ type: 'toast', text: `Failed to save web tools config: ${errMsg}`, level: 'error', duration: 6000 })
          }
          break
        }
        case 'testSearchProvider': {
          const providerType = String(msg.providerType || '')
          const apiKey = String(msg.apiKey || '')
          const baseUrl = String(msg.baseUrl || '').trim()
          try {
            const { performSearchTest } = await import('../server/handlers/agent/web')
            const result = await performSearchTest(providerType, apiKey, baseUrl)
            this.view?.webview.postMessage({
              type: 'searchTestResult',
              ok: true,
              text: result,
            })
          }
          catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            this.view?.webview.postMessage({
              type: 'searchTestResult',
              ok: false,
              text: errMsg,
            })
          }
          break
        }
        case 'testFetchProvider': {
          const providerType = String(msg.providerType || '')
          const apiKey = String(msg.apiKey || '')
          const baseUrl = String(msg.baseUrl || '').trim()
          try {
            const { performFetchTest } = await import('../server/handlers/agent/web')
            const result = await performFetchTest(providerType, apiKey, baseUrl)
            this.view?.webview.postMessage({
              type: 'fetchTestResult',
              ok: true,
              text: result,
            })
          }
          catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            this.view?.webview.postMessage({
              type: 'fetchTestResult',
              ok: false,
              text: errMsg,
            })
          }
          break
        }
        case 'testModel': {
          const testId = String(msg.testId ?? '')
          const pid = String(msg.pid ?? '')
          const mid = String(msg.mid ?? '')
          // 探测协议时由 UI 指定用哪种协议发 —— 地址和模型都不变，只换协议
          const overrideType = isProviderType(msg.overrideType) ? msg.overrideType : undefined
          // 优先用 draft：用户常常是「改完地址立刻想测一下」，此时还没保存
          const draft = msg.draft as ProviderEntry | undefined
          const provider = draft
            // 草稿里模型可能还没固化协议（新加的模型没手动点过）。不固化的话
            // runModelTest 会回落到 provider.type，测出一条与界面显示不符的路径。
            ? materializeModelProtocols({ ...draft, models: draft.models ?? [] })
            : getState().providers.find(x => x.id === pid)
          const model = (provider?.models ?? []).find(m => m.id === mid)
          if (!testId || !provider || !model) {
            this.view?.webview.postMessage({
              type: 'modelTestResult',
              testId,
              pid,
              mid,
              overrideType,
              result: {
                status: 'error',
                errorKind: 'unknown',
                message: 'Provider or model to test was not found (it may have been deleted)',
                durationMs: 0,
              },
            })
            break
          }
          const cancelFlag = { cancelled: false }
          runningModelTests.set(testId, cancelFlag)
          try {
            const result = await runModelTest(provider, model, {
              isCancelled: () => cancelFlag.cancelled,
              overrideType,
            })
            this.view?.webview.postMessage({ type: 'modelTestResult', testId, pid, mid, overrideType, result })
          }
          finally {
            runningModelTests.delete(testId)
          }
          break
        }
        case 'cancelModelTest': {
          const testId = String(msg.testId ?? '')
          const cancelFlag = runningModelTests.get(testId)
          if (cancelFlag)
            cancelFlag.cancelled = true
          break
        }
        case 'detectProtocol': {
          // 一键探测：把该模型逐个协议试一遍，返回能通的那个。
          // 前端据此直接把结果写进 draft.type，用户全程不必自己选协议。
          const requestId = String(msg.requestId ?? '')
          const pid = String(msg.pid ?? '')
          const mid = String(msg.mid ?? '')
          const draft = msg.draft as ProviderEntry | undefined
          // 与 testModel 同样先固化协议：detectModelProtocol 拿"当前生效协议"
          // 当作第一个尝试项，不固化的话它会拿到过时的 provider.type，
          // 返回的 previous 就和界面显示的协议对不上。
          const provider = draft
            ? materializeModelProtocols({ ...draft, models: draft.models ?? [] })
            : getState().providers.find(x => x.id === pid)
          const model = (provider?.models ?? []).find(m => m.id === mid)
          if (!provider || !model) {
            this.view?.webview.postMessage({
              type: 'protocolDetected',
              requestId,
              pid,
              mid,
              error: 'Provider or model to detect was not found (it may have been deleted)',
            })
            break
          }
          const cancelFlag = { cancelled: false }
          runningModelTests.set(requestId, cancelFlag)
          try {
            const detection = await detectModelProtocol(provider, model, {
              isCancelled: () => cancelFlag.cancelled,
            })
            this.view?.webview.postMessage({ type: 'protocolDetected', requestId, pid, mid, detection })
          }
          catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            this.view?.webview.postMessage({ type: 'protocolDetected', requestId, pid, mid, error: errMsg })
          }
          finally {
            runningModelTests.delete(requestId)
          }
          break
        }
        case 'loadUsageStats': {
          const requestId = String(msg.requestId ?? '')
          try {
            const summary = await buildUsageSummary()
            this.view?.webview.postMessage({ type: 'usageStats', requestId, summary })
          }
          catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            this.view?.webview.postMessage({ type: 'usageStats', requestId, error: errMsg })
          }
          break
        }
        case 'saveProviders': {
          const next = msg.providers as ProviderEntry[]
          const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined
          const targetIds = Array.isArray(msg.targetIds) ? msg.targetIds : undefined
          // 改名要同步到历史用量记录，而写入之后就取不到旧名字了，所以先抓一份
          const previousProviders = loadProviders().providers
          try {
            await updateProviders((draft) => {
              draft.providers = next
            })
            syncUsageProviderNames(previousProviders, next)
            resetProviderInstanceCache()
            bumpRefreshSignal()
            const state = await refreshState()
            this.postState()
            if (requestId) {
              this.view?.webview.postMessage({
                type: 'saveProvidersResult',
                requestId,
                targetIds,
                ok: true,
                state,
              })
            }
            else {
              this.view?.webview.postMessage({ type: 'toast', text: 'Providers saved.', level: 'info' })
            }
          }
          catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            if (requestId) {
              this.view?.webview.postMessage({
                type: 'saveProvidersResult',
                requestId,
                targetIds,
                ok: false,
                error: errMsg,
              })
            }
            else {
              this.view?.webview.postMessage({ type: 'toast', text: `Save failed: ${errMsg}`, level: 'error', duration: 6000 })
            }
          }
          break
        }
        default:
          // 未知消息类型一律留痕。默认静默丢弃会让"字段撞名"这类 bug 表现为
          // 界面永远转圈 —— 例如载荷里带了 type 覆盖掉信封字段, 宿主这边什么也看不到。
          logger.warn({ type: msg?.type }, '[UI] unknown webview message type')
      }
    })

    this.disposeStateListener?.dispose()
    this.disposeStateListener = onStateChange(() => this.postState())
    webviewView.onDidDispose(() => {
      this.disposeStateListener?.dispose()
      this.disposeStateListener = undefined
      this.view = undefined
    })
  }

  private postState() {
    if (!this.view)
      return
    const s = getState()
    this.view.webview.postMessage({ type: 'state', state: s })
  }
}
