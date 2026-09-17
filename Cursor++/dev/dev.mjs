#!/usr/bin/env node
/**
 * Cursor++ 前端预览（dev-only）
 *
 * 在浏览器里跑**真实的面板**：真 PanelProvider、真 Hono JSX 组件、真 Alpine store、
 * 真配置读写、真用量统计、真模型测试。只替换宿主那一层，因此预览与装进 Cursor
 * 的表现同源 —— 不会出现"预览好看、装上不对"。
 *
 * 用法:
 *   node dev/dev.mjs [--port 5199] [--theme light_modern] [--no-open] [--real-home]
 *
 * 主题:
 *   默认 light_modern（浅色）—— 审外观时浅色底更容易看出边框、留白和字重。
 *   加 ?theme=dark_modern 等可在浏览器里临时切换，不需要重启。
 *
 * 数据隔离:
 *   默认把 ~/.ccursor 拷进 dev/.cache/home 再指过去，所以面板里的 Save / 切换 BYOK
 *   只改副本，不会动到真实配置（真实 Cursor++ 正在监听那些文件，改了会互相干扰）。
 *   --real-home 直接读写真实目录，仅在明确想改真配置时使用。
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { WebSocketServer } from 'ws'
import { buildThemeCss, KNOWN_THEMES } from './theme.mjs'

const require = createRequire(import.meta.url)
const devDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
const extensionRoot = resolve(devDir, '..')
const cacheDir = join(devDir, '.cache')

// ── 参数 ──────────────────────────────────────────────────────────
function readFlag(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}
const hasFlag = name => process.argv.includes(`--${name}`)

const requestedPort = Number(readFlag('port') ?? 5199)
// 默认浅色：审查排版/间距/层级时长时间盯着深色背景更累，浅色底更容易看出
// 边框、留白和字重的问题。想要深色用 --theme dark_modern 切回去。
const themeName = KNOWN_THEMES.includes(readFlag('theme')) ? readFlag('theme') : 'light_modern'
const shouldOpenBrowser = !hasFlag('no-open')
const useRealHome = hasFlag('real-home')

function log(text) {
  process.stdout.write(`[preview] ${text}\n`)
}

// ── 数据沙箱 ──────────────────────────────────────────────────────
//
// 必须在 require 任何 src 模块之前改掉 USERPROFILE —— paths.ts 的 getCcursorDir()
// 每次都实时读 homedir()，改完就指向沙箱了。
const realHome = homedir()
const sandboxHome = join(cacheDir, 'home')

function prepareSandbox() {
  if (useRealHome) {
    log(`data: 真实目录 (--real-home) — 面板里的保存会写入 ~/.ccursor`)
    return
  }

  const sourceDir = join(realHome, '.ccursor')
  const targetDir = join(sandboxHome, '.ccursor')
  mkdirSync(join(targetDir, 'logs'), { recursive: true })

  // 用量与目录文件较大且只读，直接复制；cursor.db 500MB+ 且面板链用不到，跳过
  const filesToCopy = [
    'providers.json',
    'routes.json',
    'web-tools.json',
    'usage-stats.jsonl',
    'models-catalog.json',
    'knowledge-base.json',
  ]
  const copied = []
  for (const fileName of filesToCopy) {
    const source = join(sourceDir, fileName)
    if (!existsSync(source))
      continue
    copyFileSync(source, join(targetDir, fileName))
    copied.push(fileName)
  }

  process.env.USERPROFILE = sandboxHome
  process.env.HOME = sandboxHome
  log(`data: 沙箱 ${targetDir}  ← 复制了 ${copied.length} 个文件 (${copied.join(', ') || '无'})`)
}

prepareSandbox()

// ── Cursor 安装目录（主题 + codicon 字体）─────────────────────────
//
// 不能只信 LOCALAPPDATA：Cursor 可以装在别的盘（本机就在 D:），
// 而 LOCALAPPDATA / PROGRAMFILES 仍指向 C:。所以按候选路径 + 全盘扫描两级找。
function candidateRelativePaths() {
  const userName = process.env.USERNAME || ''
  return [
    join('Programs', 'cursor', 'resources', 'app'),
    join('Users', userName, 'AppData', 'Local', 'Programs', 'cursor', 'resources', 'app'),
    join('Program Files', 'Cursor', 'resources', 'app'),
    join('Cursor', 'resources', 'app'),
    join('Programs', 'Cursor', 'resources', 'app'),
  ]
}

function looksLikeCursorApp(candidate) {
  return Boolean(candidate) && existsSync(join(candidate, 'out', 'media', 'codicon.ttf'))
}

function resolveCursorAppRoot() {
  const directCandidates = [
    process.env.CURSOR_APP_ROOT,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'cursor', 'resources', 'app'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Cursor', 'resources', 'app'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Cursor', 'resources', 'app'),
    '/Applications/Cursor.app/Contents/Resources/app',
    join(realHome, '.local', 'share', 'cursor', 'resources', 'app'),
  ].filter(Boolean)

  for (const candidate of directCandidates) {
    if (looksLikeCursorApp(candidate))
      return candidate
  }

  // 全盘扫描：逐个盘符探常见的安装相对路径
  const driveLetters = 'CDEFGHIJ'
  for (const letter of driveLetters) {
    for (const relativePath of candidateRelativePaths()) {
      const candidate = `${letter}:\\${relativePath}`
      if (looksLikeCursorApp(candidate))
        return candidate
    }
  }

  return null
}

const cursorAppRoot = resolveCursorAppRoot()
if (!cursorAppRoot)
  log('warn: 没找到 Cursor 安装目录，codicon 图标与主题回退到内置值（可用 CURSOR_APP_ROOT 指定）')
else
  log(`cursor: ${cursorAppRoot}`)

// ── 目录布局（刻意复刻真实安装形态）───────────────────────────────
//
// 真实环境: <app>/extensions/cursor2plus → ../../out/media/codicon.ttf
// 预览复刻成同样的相对关系，panel-provider 里那段路径推导逻辑才能原样生效。
const fakeExtensionPath = join(cacheDir, 'extensions', 'cursor2plus')
const fakeCodiconDir = join(cacheDir, 'out', 'media')
const webviewBundlePath = join(fakeExtensionPath, 'dist', 'webview.js')
const hostBundlePath = join(cacheDir, 'preview-host.cjs')

function prepareDirectoryLayout() {
  mkdirSync(join(fakeExtensionPath, 'dist'), { recursive: true })
  mkdirSync(fakeCodiconDir, { recursive: true })

  if (cursorAppRoot) {
    copyFileSync(
      join(cursorAppRoot, 'out', 'media', 'codicon.ttf'),
      join(fakeCodiconDir, 'codicon.ttf'),
    )
  }
  else {
    // 没有字体时 panel-provider 会跳过 @font-face，图标退化成空白（而不是乱码方块）
    log('warn: codicon.ttf 缺失 → 图标不显示')
  }
}

prepareDirectoryLayout()

// ── 构建 ──────────────────────────────────────────────────────────
const vscodeStubPath = join(devDir, 'vscode-stub.cjs')
const serverShimPath = join(devDir, 'server-shim.mjs')

/**
 * 把 `../server`（目录入口）指向替身。
 *
 * 只拦 src/ui 下那两个 importer —— 它们各自只取一个符号，而真实入口会拉起
 * Fastify + 27 个 ConnectRPC 服务 + SQLite（7MB protobuf），对 UI 预览既没必要
 * 又会和正在运行的 Cursor++ 抢 39831 端口。
 * `../server/config`、`../server/stats/*` 等一律保持真实。
 */
const serverShimPlugin = {
  name: 'preview-server-shim',
  setup(build) {
    build.onResolve({ filter: /^\.\.\/server$/ }, (args) => {
      const normalized = args.importer.replace(/\\/g, '/')
      if (!normalized.includes('/src/ui/'))
        return null
      return { path: serverShimPath }
    })
  },
}

/** 每次构建结束后安排一次浏览器刷新（防抖，避免连续保存时反复打断） */
let reloadTimer = null
function scheduleReload(reason) {
  if (!bootstrapped)
    return
  if (reloadTimer)
    clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    rebuildHost(reason)
  }, 350)
}

const reloadPlugin = {
  name: 'preview-reload',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0)
        return
      scheduleReload(build.initialOptions.outfile?.includes('webview') ? 'webview' : 'host')
    })
  },
}

const sharedAlias = { vscode: vscodeStubPath }

function createHostContext() {
  return esbuild.context({
    entryPoints: [join(devDir, 'preview-entry.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    outfile: hostBundlePath,
    sourcemap: false,
    logLevel: 'warning',
    jsx: 'automatic',
    jsxImportSource: 'hono/jsx',
    alias: sharedAlias,
    define: {
      'import.meta.url': 'undefined',
      __HUB_URL__: JSON.stringify('https://ccursor.cometix.dev'),
    },
    external: ['@vakra-dev/supermarkdown'],
    plugins: [serverShimPlugin, reloadPlugin],
  })
}

function createWebviewContext() {
  return esbuild.context({
    entryPoints: [join(extensionRoot, 'src', 'ui', 'webview', 'alpine-entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: webviewBundlePath,
    // 真的浏览器里调试，源码映射能直接落到 .ts 行
    sourcemap: 'inline',
    logLevel: 'warning',
    plugins: [reloadPlugin],
  })
}

// ── 宿主 ──────────────────────────────────────────────────────────
let host = null
let bootstrapped = false
const sockets = new Set()

function summarize(value) {
  let text
  try {
    text = JSON.stringify(value)
  }
  catch {
    return '<unserializable>'
  }
  if (!text)
    return String(value)
  return text.length > 240 ? `${text.slice(0, 240)}… (+${text.length - 240})` : text
}

function attachOutboundListener() {
  host.addOutboundListener((message) => {
    log(`host→panel  ${summarize(message)}`)
    const payload = JSON.stringify(message)
    for (const socket of sockets) {
      if (socket.readyState === 1)
        socket.send(payload)
    }
  })
}

function rebuildHost(reason) {
  try {
    host?.dispose()

    // 清掉 require 缓存，让面板模块级缓存（webview.js 内联文本等）重新读取
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(cacheDir))
        delete require.cache[key]
    }

    const hostModule = require(hostBundlePath)
    host = hostModule.initPreviewHost({
      extensionPath: fakeExtensionPath,
      codiconUrlBase: '/__codicon',
      log: text => log(`host: ${text}`),
    })
    attachOutboundListener()

    log(`rebuilt (${reason}) → 已通知 ${sockets.size} 个页面刷新`)
    for (const socket of sockets) {
      if (socket.readyState === 1)
        socket.send(JSON.stringify({ __dev: 'reload' }))
    }
  }
  catch (error) {
    log(`ERROR 重建宿主失败: ${error?.stack ?? error}`)
  }
}

// ── HTTP ──────────────────────────────────────────────────────────
function send(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' })
  response.end(body)
}

/**
 * 把主题变量与客户端垫片注入面板 HTML。
 *
 * 垫片必须在 head 里 —— app.ts 在模块顶层就调用 acquireVsCodeApi()，
 * 而内联的 webview.js 挂在 body 末尾，放后面就来不及了。
 */
function injectPreviewAssets(panelHtml, activeTheme) {
  const themeCss = cursorAppRoot ? buildThemeCss(cursorAppRoot, activeTheme) : ''
  const headExtras = `
    <style id="preview-theme-vars">${themeCss}</style>
    <style>
      /* 预览外壳：真实侧边栏是窄栏，这里保留全宽以便同时观察宽窄两种排版 */
      html, body { height: 100%; }
    </style>
    <script src="/preview-client.js"></script>
  `
  if (!panelHtml.includes('</head>')) {
    log('warn: 面板 HTML 里没有 </head>，垫片注入可能失败')
    return panelHtml
  }
  return panelHtml.replace('</head>', `${headExtras}</head>`)
}

function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)

  if (url.pathname === '/preview-client.js') {
    return send(response, 200, readFileSync(join(devDir, 'preview-client.js')), 'text/javascript; charset=utf-8')
  }

  if (url.pathname === '/__codicon') {
    const requestedPath = resolve(decodeURIComponent(url.searchParams.get('path') ?? ''))
    if (!requestedPath.startsWith(resolve(cacheDir))) {
      return send(response, 403, 'forbidden')
    }
    if (!existsSync(requestedPath))
      return send(response, 404, 'missing codicon')
    return send(response, 200, readFileSync(requestedPath), 'font/ttf')
  }

  if (url.pathname === '/__health') {
    return send(response, 200, JSON.stringify({ ok: true, theme: themeName, sockets: sockets.size }), 'application/json')
  }

  if (url.pathname === '/' || url.pathname === '/panel') {
    if (!host)
      return send(response, 503, '宿主尚未就绪，稍等片刻后刷新')

    const requestedTheme = url.searchParams.get('theme')
    const activeTheme = KNOWN_THEMES.includes(requestedTheme) ? requestedTheme : themeName
    const html = injectPreviewAssets(host.getPanelHtml(), activeTheme)
    log(`GET ${url.pathname} → ${html.length} bytes (theme=${activeTheme})`)
    return send(response, 200, html, 'text/html; charset=utf-8')
  }

  return send(response, 404, 'not found')
}

function openBrowser(url) {
  const command = process.platform === 'win32'
    ? ['cmd.exe', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]]

  try {
    spawn(command[0], command[1], { detached: true, stdio: 'ignore' }).unref()
  }
  catch {
    log(`无法自动打开浏览器，请手动访问 ${url}`)
  }
}

// ── 启动 ──────────────────────────────────────────────────────────
async function main() {
  const hostContext = await createHostContext()
  const webviewContext = await createWebviewContext()

  // 先出 webview.js —— 宿主在 resolveWebviewView 时会立刻读取它
  await webviewContext.rebuild()
  await hostContext.rebuild()

  rebuildHost('initial')
  bootstrapped = true

  await hostContext.watch()
  await webviewContext.watch()

  const server = createServer(handleRequest)
  const webSocketServer = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname !== '/__ws') {
      socket.destroy()
      return
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      sockets.add(webSocket)
      log(`ws connected (${sockets.size} 个页面)`)

      webSocket.on('message', (data) => {
        let message
        try {
          message = JSON.parse(data.toString())
        }
        catch {
          return
        }
        log(`panel→host  ${summarize(message)}`)
        host?.handleInbound(message)
      })

      webSocket.on('close', () => {
        sockets.delete(webSocket)
        log(`ws closed (${sockets.size} 个页面)`)
      })
    })
  })

  // 端口被占时顺延，避免旧实例没退干净就起不来
  let port = requestedPort
  for (;;) {
    try {
      await new Promise((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise)
        server.listen(port, '127.0.0.1', resolvePromise)
      })
      break
    }
    catch (error) {
      if (error.code !== 'EADDRINUSE' || port > requestedPort + 20)
        throw error
      port += 1
    }
  }

  const url = `http://127.0.0.1:${port}/`
  log('')
  log(`  预览地址   ${url}`)
  log(`  主题       ${themeName}   （加 ?theme=light_modern 等可临时切换）`)
  log(`  数据       ${useRealHome ? '真实 ~/.ccursor（会写入）' : '沙箱副本（写入不影响真实配置）'}`)
  log(`  改代码后   自动重新打包并刷新页面`)
  log('')

  if (shouldOpenBrowser)
    openBrowser(url)

  process.on('SIGINT', async () => {
    log('正在退出…')
    host?.dispose()
    await hostContext.dispose()
    await webviewContext.dispose()
    server.close()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
