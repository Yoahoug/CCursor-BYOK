/**
 * `vscode` 模块替身（dev-only）
 *
 * 面板代码只通过这一个模块接触宿主，因此把它替换掉之后，`PanelProvider`、
 * Hono JSX 组件树、Alpine store 全都能在纯 Node 里跑起来。
 *
 * 这里刻意保持"薄"：只实现 src/ui 真正用到的那几项，行为尽量贴近 VS Code。
 * 需要新 API 时按真实语义补，不要在替身里偷偷改语义 —— 那会让预览与线上漂移。
 *
 * 被用到的 API（可从 src/ui 的 `vscode.xxx` 引用反查）：
 *   window.createOutputChannel / createStatusBarItem / registerWebviewViewProvider
 *   window.show{Information,Warning,Error}Message / showTextDocument
 *   commands.registerCommand / executeCommand
 *   workspace.getConfiguration / name / onDidChangeConfiguration
 *   Uri.file / EventEmitter / Disposable / ThemeColor / StatusBarAlignment ...
 */

/** 假的可释放句柄 —— VS Code 的 dispose 约定 */
const sharedDisposable = { dispose() {} }

/** 已注册命令：id → handler，供 executeCommand 回放 */
const commandHandlers = new Map()

/** 信息提示的旁路回调（预览控制台用） */
let informationMessageHandler = null

/**
 * 事件发射器。
 *
 * state.ts 会 `new vscode.EventEmitter()` 并把它当共享状态源用，
 * 所以 `event` 必须是可反复订阅的，且 fire 要同步派发。
 */
class EventEmitter {
  constructor() {
    this.listeners = new Set()
    this.event = (listener) => {
      this.listeners.add(listener)
      return { dispose: () => this.listeners.delete(listener) }
    }
  }

  fire(value) {
    for (const listener of [...this.listeners])
      listener(value)
  }

  dispose() {
    this.listeners.clear()
  }
}

const vscode = {
  window: {
    createOutputChannel: () => ({
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {},
      appendLine() {},
      dispose() {},
    }),
    createStatusBarItem: () => ({
      show() {},
      hide() {},
      dispose() {},
      text: '',
      tooltip: '',
      command: undefined,
    }),
    registerWebviewViewProvider: () => sharedDisposable,
    showInformationMessage: (message) => {
      informationMessageHandler?.(message)
      return Promise.resolve(undefined)
    },
    showWarningMessage: () => Promise.resolve(undefined),
    showErrorMessage: () => Promise.resolve(undefined),
    showTextDocument: () => Promise.resolve(undefined),
    onDidChangeActiveTextEditor: () => sharedDisposable,
    activeTextEditor: undefined,
  },

  commands: {
    registerCommand: (id, handler) => {
      commandHandlers.set(id, handler)
      return { dispose: () => commandHandlers.delete(id) }
    },
    executeCommand: async (id, ...args) => {
      const handler = commandHandlers.get(id)
      if (!handler)
        return undefined
      return handler(...args)
    },
  },

  workspace: {
    name: 'preview',
    // 预览里没有 settings.json 层，全部回落到代码里的默认值
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    onDidChangeConfiguration: () => sharedDisposable,
    workspaceFolders: [],
    fs: {},
    openTextDocument: () => Promise.resolve({}),
  },

  env: { openExternal: () => Promise.resolve(true) },

  // 预览里没有真实的扩展安装目录 —— 返回 undefined 让 update-check 走
  // 「找不到扩展目录」那条正常错误分支，而不是在这里抛 TypeError。
  extensions: {
    getExtension: () => undefined,
  },

  Uri: {
    file: value => ({
      fsPath: value,
      toString: () => `file:///${String(value).replace(/\\/g, '/')}`,
    }),
    parse: value => ({ toString: () => value }),
  },

  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id
    }
  },
  EventEmitter,
  Disposable: class Disposable {
    constructor(fn) {
      this.dispose = fn ?? (() => {})
    }

    static from() {
      return sharedDisposable
    }
  },
  ExtensionMode: { Production: 1 },
  ViewColumn: { One: 1 },
  RelativePattern: class RelativePattern {
    constructor(base, pattern) {
      this.base = base
      this.pattern = pattern
    }
  },

  // ── 预览专用钩子（前缀 __ 表示非真实 API）──
  __commands: commandHandlers,
  __setInformationMessageHandler: (fn) => {
    informationMessageHandler = fn
  },
}

module.exports = vscode
