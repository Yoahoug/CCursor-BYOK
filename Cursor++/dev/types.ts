/** 预览宿主与编排进程之间的类型契约（dev-only） */

export interface InboundMessage {
  type: string
  [key: string]: unknown
}

export interface PreviewHostOptions {
  /** 假的扩展安装目录 —— panel-provider 从这里读 dist/webview.js */
  extensionPath: string
  /** codicon 字体的 HTTP 前缀，用于把 asWebviewUri 映射到预览服务器 */
  codiconUrlBase: string
  log: (text: string) => void
}

export interface PreviewHost {
  /** 面板 HTML（内含内联的 webview.js），每次重建后重新取 */
  getPanelHtml: () => string
  /** 订阅面板发往宿主方向的消息，返回取消订阅函数 */
  addOutboundListener: (listener: (message: InboundMessage) => void) => () => void
  /** 把浏览器侧发来的消息交给面板（等价于 VS Code 的 onDidReceiveMessage） */
  handleInbound: (message: InboundMessage) => void
  dispose: () => void
}
