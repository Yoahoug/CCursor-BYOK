/**
 * 预览宿主（dev-only）
 *
 * 在纯 Node 里顶替 VS Code，把一个 **真实的 PanelProvider** 跑起来：
 * 真组件、真 store、真配置读写、真用量统计、真模型测试，只替换宿主那一层。
 * 这样预览里看到的界面与装进 Cursor 的完全同源，不会出现"预览好看、装上不对"。
 *
 * 三条替代关系（其余全是真代码）：
 *   `vscode` 模块      → dev/vscode-stub.cjs        （见 esbuild alias）
 *   `src/server`       → dev/server-shim.mjs        （避开 Fastify + SQLite + 端口占用）
 *   `acquireVsCodeApi` → dev/preview-client.js      （经 WebSocket 接到这里）
 *
 * 生命周期刻意对齐 VS Code：容器展开时调用一次 resolveWebviewView，
 * 之后只靠 postMessage 双向通信。
 */
import type { InboundMessage, PreviewHost, PreviewHostOptions } from './types'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { isServerRunning, setPreviewServerRunning } from './server-shim.mjs'
import { PanelProvider } from '../src/ui/panel-provider'
import { refreshState } from '../src/ui/state'

/** 注册面板用到的命令 —— 镜像 extension.ts 的对应实现，去掉 renderer 侧副作用 */
function registerPreviewCommands(log: (text: string) => void): void {
  vscode.commands.registerCommand('cursor2plus.toggleByok', async () => {
    const { toggleByokMode } = await import('../src/server/config/routesStore')
    const next = await toggleByokMode()
    await refreshState()
    log(next.byokMode ? 'BYOK enabled' : 'BYOK disabled (pass through to official)')
  })

  vscode.commands.registerCommand('cursor2plus.serverToggle', async () => {
    // 预览里没有真实 server 进程，直接切状态位并让面板重新拉一次 state
    const nextRunning = !isServerRunning()
    setPreviewServerRunning(nextRunning)
    await refreshState()
    log(nextRunning ? 'Preview server flag → running' : 'Preview server flag → stopped')
  })

  vscode.commands.registerCommand('cursor2plus.editRoutes', () => {
    log('editRoutes → 真实环境会打开 ~/.ccursor/routes.json')
  })

  vscode.commands.registerCommand('cursor2plus.editProviders', () => {
    log('editProviders → 真实环境会打开 ~/.ccursor/providers.json')
  })

  vscode.commands.registerCommand('cursor2plus.toggleFileLog', () => {
    log('toggleFileLog → 预览未接文件日志')
  })

  vscode.commands.registerCommand('cursor2plus.openLogFile', () => {
    log('openLogFile → 预览未接文件日志')
  })
}

export function initPreviewHost(options: PreviewHostOptions): PreviewHost {
  const { extensionPath, codiconUrlBase, log } = options

  registerPreviewCommands(log)

  const outboundListeners = new Set<(message: InboundMessage) => void>()
  let inboundHandler: ((message: any) => unknown) | undefined
  let capturedHtml = ''

  const extensionContext = {
    extensionPath,
    extensionUri: vscode.Uri.file(extensionPath),
    // update-check 靠 context.extension.packageJSON 拼出扩展 id 去查安装目录
    // （vscode.extensions.getExtension），缺了它那条路径会直接抛 TypeError。
    // 预览的假扩展目录里没有 package.json，这里就按真实形状内联 —— 这两个值
    // 与 Cursor++/package.json 里的 publisher / name 保持一致即可。
    extension: {
      id: 'cometix-space.cursor2plus',
      packageJSON: { publisher: 'cometix-space', name: 'cursor2plus' },
    },
    subscriptions: [],
    globalState: { get: (_key: string, fallback: unknown) => fallback, update: async () => {} },
    workspaceState: { get: (_key: string, fallback: unknown) => fallback, update: async () => {} },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    asAbsolutePath: (relativePath: string) => join(extensionPath, relativePath),
    extensionMode: 1,
  }

  // WebviewView 替身 —— 只实现 panel-provider 真正调用的那几项
  const webviewView = {
    webview: {
      options: {},
      set html(value: string) {
        capturedHtml = value
      },
      get html() {
        return capturedHtml
      },
      onDidReceiveMessage(handler: (message: any) => unknown) {
        inboundHandler = handler
        return { dispose() {} }
      },
      postMessage(message: InboundMessage) {
        for (const listener of outboundListeners)
          listener(message)
        return Promise.resolve(true)
      },
      /**
       * 真实环境会把本地文件重写到 webview 专用 origin。
       * 预览里映射成 HTTP 端点，让 @font-face 能取到 codicon.ttf。
       */
      asWebviewUri(uri: { fsPath: string }) {
        return {
          toString: () => `${codiconUrlBase}?path=${encodeURIComponent(uri.fsPath)}`,
        }
      },
    },
    onDidDispose() {
      return { dispose() {} }
    },
    show() {},
    visible: true,
    title: 'Cursor++',
  }

  const provider = new PanelProvider(extensionContext as any)
  provider.resolveWebviewView(webviewView as any)

  log(`panel resolved; html ${capturedHtml.length} bytes`)

  return {
    getPanelHtml: () => capturedHtml,
    addOutboundListener(listener) {
      outboundListeners.add(listener)
      return () => outboundListeners.delete(listener)
    },
    handleInbound(message) {
      if (typeof message?.type !== 'string')
        return
      // 面板内部按类型分发，未识别的类型静默忽略
      void inboundHandler?.(message)
    },
    dispose() {
      outboundListeners.clear()
    },
  }
}
