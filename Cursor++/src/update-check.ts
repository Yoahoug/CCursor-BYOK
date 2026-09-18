/**
 * 版本更新检查 + 一键更新（二改版通道）
 *
 * 从本仓库的 GitHub Release 查询最新版本，与当前 extension 版本比较，有更新时弹通知。
 *
 * 为什么不用上游那条 `npx @cometix/ccursor update`：
 *   上游命令会下载并安装 **官方版**，把我们这边的改动（Web Fetch 走 Tavily、
 *   Web Search 修复等）整个覆盖掉。二改版必须指向自己的发布通道，
 *   所以这里读 Yoahoug/CCursor-BYOK 的 Release，并直接用它的 .vsix 资产做更新。
 *
 * 走 GitHub Releases API 而不是 npm：仓库是 public，匿名可读，无需 token；
 * 且 Release 里挂着构建好的 .vsix，更新时不必依赖 npm 上是否存在同名包。
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as vscode from 'vscode'
import { version as CURRENT_VERSION } from '../package.json'

/** 本二改版的发布通道 */
const RELEASE_REPO = 'Yoahoug/CCursor-BYOK'
const RELEASE_API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`
const RELEASES_PAGE_URL = `https://github.com/${RELEASE_REPO}/releases`
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours
const STATE_KEY_LAST_CHECK = 'ccursor.updateCheck.lastCheckMs'
const STATE_KEY_DISMISSED = 'ccursor.updateCheck.dismissedVersion'

let timer: ReturnType<typeof setInterval> | null = null
let updating = false

interface LatestRelease {
  version: string
  /** Release 里挂的 .vsix 资产下载地址，找不到则为空 */
  assetUrl: string
}

/** 一次安装尝试的结果 —— 通知文案由调用方决定 */
type InstallOutcome = { ok: true } | { ok: false, error: string }

/** 面板「Check for Updates」按钮的返回值，由 panel-provider 转成 toast 显示 */
export interface ManualUpdateOutcome {
  status: 'up-to-date' | 'updated' | 'failed'
  /** 一行面向用户的说明 */
  message: string
}

/** 手动更新的回调：log 进输出通道，onProgress 让面板能显示"正在检查/正在安装" */
export interface ManualUpdateHooks {
  log?: (msg: string) => void
  onProgress?: (phase: 'checking' | 'installing', version?: string) => void
}

function getCurrentVersion(): string {
  return CURRENT_VERSION
}

/** Release tag 允许写成 v0.0.17，比较前统一去前缀 */
function normalizeVersion(value: string): string {
  return value.replace(/^v/, '')
}

function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split('.').map(Number)
  const pb = normalizeVersion(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (Number.isNaN(va) || Number.isNaN(vb))
      return 0
    if (va !== vb)
      return va - vb
  }
  return 0
}

async function fetchLatestRelease(): Promise<LatestRelease | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(RELEASE_API_URL, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ccursor-byok-update-check',
      },
    })
    clearTimeout(timeout)
    if (!res.ok)
      return null
    const data = await res.json() as {
      tag_name?: string
      assets?: Array<{ name?: string, browser_download_url?: string }>
    }
    const tag = data.tag_name
    if (!tag)
      return null

    const asset = data.assets?.find(a => a.name?.endsWith('.vsix'))
    return { version: tag, assetUrl: asset?.browser_download_url ?? '' }
  }
  catch {
    return null
  }
}

/** 当前扩展在本机的安装目录（用于就地把新版本覆盖进去） */
function resolveExtensionDir(context: vscode.ExtensionContext): string | null {
  const ext = vscode.extensions.getExtension(`${context.extension.packageJSON.publisher}.${context.extension.packageJSON.name}`)
  return ext?.extensionPath ?? null
}

function runProcess(command: string, args: string[]): Promise<{ code: number, stderr: string }> {
  return new Promise((resolve) => {
    let stderr = ''
    let child: ChildProcess
    try {
      child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    }
    catch (error) {
      resolve({ code: -1, stderr: error instanceof Error ? error.message : String(error) })
      return
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      resolve({ code: -1, stderr: error.message })
    })
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stderr })
    })
  })
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ccursor-byok-update-check' },
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok)
    throw new Error(`download failed: HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length === 0)
    throw new Error('downloaded file is empty')
  await writeFile(destination, buffer)
}

/**
 * 解压 VSIX（本质是 zip）。
 *
 * 平台差异很实在：macOS / Linux 有 `unzip`，Windows 10+ 自带的是 bsdtar
 * （`tar` 能处理 zip）而**没有** `unzip`。原先这里写死 `unzip`，在 Windows 上
 * 会以 ENOENT 失败，更新永远装不上。按平台给首选命令，再互相兜底一次。
 */
async function extractVsix(vsixPath: string, extractDir: string): Promise<void> {
  const attempts: Array<[string, string[]]> = process.platform === 'win32'
    ? [
        ['tar', ['-xf', vsixPath, '-C', extractDir]],
        ['unzip', ['-q', '-o', vsixPath, '-d', extractDir]],
      ]
    : [
        ['unzip', ['-q', '-o', vsixPath, '-d', extractDir]],
        ['tar', ['-xf', vsixPath, '-C', extractDir]],
      ]

  let lastError = ''
  for (const [command, args] of attempts) {
    const result = await runProcess(command, args)
    if (result.code === 0)
      return
    lastError = result.stderr.trim() || `${command} exited with ${result.code}`
  }

  throw new Error(`failed to extract the downloaded vsix: ${lastError}`)
}

/**
 * 下载 Release 里的 .vsix 并就地覆盖当前扩展目录。
 *
 * .vsix 是 zip，解压后 `extension/` 子目录就是扩展内容。
 * 覆盖后需要重启 Cursor 才会加载新代码 —— 这个没法绕过（扩展目录里的 JS
 * 已被当前进程 require 进内存），所以只能提示用户重启。
 */
async function installRelease(assetUrl: string, context: vscode.ExtensionContext): Promise<void> {
  const extensionDir = resolveExtensionDir(context)
  if (!extensionDir) {
    throw new Error('could not locate the installed extension directory')
  }

  const workDir = join(tmpdir(), `ccursor-update-${Date.now()}`)
  const vsixPath = join(workDir, 'update.vsix')
  const extractDir = join(workDir, 'extracted')

  try {
    await mkdir(extractDir, { recursive: true })
    await downloadFile(assetUrl, vsixPath)

    await extractVsix(vsixPath, extractDir)

    // .vsix 内固定结构：extension/ 下才是扩展本体
    const payloadDir = join(extractDir, 'extension')
    if (!existsSync(join(payloadDir, 'package.json'))) {
      throw new Error('unexpected vsix layout: extension/package.json not found')
    }

    // 逐项复制而不是整体替换：扩展目录旁可能还有 Cursor 自己维护的文件，
    // 直接删目录会连带清掉。这里只覆盖文件，并顺带清掉旧版本残留的 dist 文件。
    const distSource = join(payloadDir, 'dist')
    const distTarget = join(extensionDir, 'dist')
    if (existsSync(distTarget) && existsSync(distSource)) {
      await rm(distTarget, { recursive: true, force: true })
    }

    const entries = await readdir(payloadDir, { withFileTypes: true })
    for (const entry of entries) {
      const from = join(payloadDir, entry.name)
      const to = join(extensionDir, entry.name)
      if (entry.isDirectory()) {
        await rm(to, { recursive: true, force: true })
      }
      await cpRecursive(from, to)
    }
  }
  finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

/** 递归复制；Node 18+ 的 fs.cp 在某些平台有兼容问题，这里自己实现保证行为一致 */
async function cpRecursive(from: string, to: string): Promise<void> {
  const { copyFile, mkdir: mkdirFs, readdir: readdirFs, stat } = await import('node:fs/promises')
  const info = await stat(from)
  if (info.isDirectory()) {
    await mkdirFs(to, { recursive: true })
    const children = await readdirFs(from)
    for (const child of children) {
      await cpRecursive(join(from, child), join(to, child))
    }
    return
  }
  await mkdirFs(dirname(to), { recursive: true })
  await copyFile(from, to)
}

/**
 * 只负责"把某个版本装上去"，不弹任何对话框 —— 结果交给调用方去呈现。
 *
 * 手动按钮与后台定时检查共用这一段：前者把结果变成面板里的 toast，
 * 后者用通知 + 重启按钮，但两者的安装行为必须完全一致。
 */
async function installLatest(
  latest: LatestRelease,
  context: vscode.ExtensionContext,
  log?: (msg: string) => void,
): Promise<InstallOutcome> {
  if (!latest.assetUrl) {
    return { ok: false, error: `${latest.version} has no downloadable .vsix asset` }
  }

  log?.(`[UPDATE] installing ${latest.version} from ${latest.assetUrl}`)
  try {
    await installRelease(latest.assetUrl, context)
    log?.(`[UPDATE] ${latest.version} installed; restart required`)
    return { ok: true }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log?.(`[UPDATE] update failed: ${message}`)
    return { ok: false, error: message }
  }
}

async function performUpdate(latest: LatestRelease, context: vscode.ExtensionContext, log?: (msg: string) => void): Promise<void> {
  if (updating)
    return
  if (!latest.assetUrl) {
    void vscode.window.showWarningMessage(
      `Cursor++ BYOK ${latest.version} has no downloadable .vsix asset. Open the release page instead.`,
      'Open Release Page',
    ).then((choice) => {
      if (choice === 'Open Release Page')
        void vscode.env.openExternal(vscode.Uri.parse(RELEASES_PAGE_URL))
    })
    return
  }

  updating = true
  try {
    const outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Updating Cursor++ BYOK to ${latest.version}…` },
      async () => installLatest(latest, context, log),
    )
    if (outcome.ok) {
      const action = await vscode.window.showInformationMessage(
        `Cursor++ BYOK ${latest.version} installed. Restart Cursor to apply it.`,
        'Restart Cursor',
      )
      if (action === 'Restart Cursor')
        await vscode.commands.executeCommand('workbench.action.reloadWindow')
      return
    }

    const action = await vscode.window.showErrorMessage(
      `Failed to update Cursor++ BYOK: ${outcome.error}`,
      'Open Release Page',
    )
    if (action === 'Open Release Page')
      void vscode.env.openExternal(vscode.Uri.parse(RELEASES_PAGE_URL))
  }
  finally {
    updating = false
  }
}

/**
 * 面板「Check for Updates」按钮的入口：检查一次，有更新就直接装上。
 *
 * 与后台定时检查的区别只有两点：不受「Later」的忽略版本影响（用户主动点的），
 * 以及整个过程**只**在面板内反馈，不额外弹通知 —— 用户就在面板上看着，
 * 再弹一个系统通知是重复打扰。
 */
export async function checkForUpdatesManually(
  context: vscode.ExtensionContext,
  hooks: ManualUpdateHooks = {},
): Promise<ManualUpdateOutcome> {
  const { log, onProgress } = hooks
  const current = getCurrentVersion()

  if (updating) {
    return { status: 'failed', message: 'An update is already in progress.' }
  }

  onProgress?.('checking')
  const latest = await fetchLatestRelease()
  if (!latest) {
    log?.('[UPDATE] manual check failed: could not read the latest release')
    return {
      status: 'failed',
      message: 'Could not reach GitHub to check for updates. Check your network and try again.',
    }
  }

  if (compareVersions(latest.version, current) <= 0) {
    log?.(`[UPDATE] manual check: up to date (current=${current}, latest=${latest.version})`)
    return { status: 'up-to-date', message: `You are on the latest version (${current}).` }
  }

  updating = true
  try {
    // 手动触发时不再弹通知进度条：用户就盯着面板，进度在按钮上体现。
    onProgress?.('installing', normalizeVersion(latest.version))
    const outcome = await installLatest(latest, context, log)
    if (!outcome.ok) {
      return { status: 'failed', message: `Update to ${latest.version} failed: ${outcome.error}` }
    }
    return {
      status: 'updated',
      message: `${latest.version} installed. Restart Cursor to apply it.`,
    }
  }
  finally {
    updating = false
  }
}

async function checkOnce(state: vscode.Memento, context: vscode.ExtensionContext, log?: (msg: string) => void) {
  const current = getCurrentVersion()
  const latest = await fetchLatestRelease()
  if (!latest)
    return

  state.update(STATE_KEY_LAST_CHECK, Date.now())

  if (compareVersions(latest.version, current) <= 0) {
    log?.(`[UPDATE] up to date (current=${current}, latest=${latest.version})`)
    return
  }

  const dismissed = state.get<string>(STATE_KEY_DISMISSED)
  if (dismissed === normalizeVersion(latest.version))
    return

  log?.(`[UPDATE] new version available: ${latest.version} (current=${current})`)

  const action = await vscode.window.showInformationMessage(
    `Cursor++ BYOK ${latest.version} is available (current: ${current}).`,
    'Update Now',
    'Release Notes',
    'Later',
  )

  if (action === 'Update Now') {
    await performUpdate(latest, context, log)
  }
  else if (action === 'Release Notes') {
    void vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${RELEASE_REPO}/releases/tag/${latest.version}`))
  }
  else if (action === 'Later') {
    state.update(STATE_KEY_DISMISSED, normalizeVersion(latest.version))
  }
}

export function startUpdateCheck(
  state: vscode.Memento,
  context: vscode.ExtensionContext,
  log?: (msg: string) => void,
) {
  const lastCheck = state.get<number>(STATE_KEY_LAST_CHECK) ?? 0
  const elapsed = Date.now() - lastCheck

  // 首次或距上次检查超过间隔 → 立即检查
  if (elapsed >= CHECK_INTERVAL_MS) {
    setTimeout(checkOnce, 5000, state, context, log) // 延迟 5s 避免拖慢 activate
  }

  timer = setInterval(checkOnce, CHECK_INTERVAL_MS, state, context, log)
}

export function stopUpdateCheck() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
