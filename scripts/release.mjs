#!/usr/bin/env node
/**
 * Cursor++ BYOK —— 本地一键发布
 *
 * 把「构建 → 打 tag → 推送 → 创建 Release」收敛成一条命令，全部在**本机**完成。
 * 不再依赖 GitHub Actions 打包（build agent 上跑不了 Cursor 相关的原生依赖，
 * 且线上构建失败时排查链路很长）。
 *
 * 为什么本地构建仍然"兼容多端"：
 *   supermarkdown 的原生模块是按平台分发的 .node 文件，构建时会被**全部**
 *   复制进 dist/ 并打进 VSIX（darwin / linux / win32 × x64 · arm64）。
 *   VSIX 里带的是全套二进制，装到哪个平台就用哪个 —— 所以在本机（macOS）
 *   构建出的产物可以直接发给 Windows / Linux 用户。
 *   脚本最后会校验这套二进制是否齐全，避免"少了某个平台"的残缺产物被发出去。
 *
 * 更新通道衔接：
 *   扩展内的 update-check.ts 读 `releases/latest` 并下载其中的 .vsix 资产，
 *   所以这里必须发布成**正式** Release（非 draft / 非 prerelease），
 *   且 tag 去掉 `v` 前缀后要与 package.json 的 version 完全一致。
 *   版本错位会让用户永远看到「有新版本」却装不上。
 *
 * 用法：
 *   node scripts/release.mjs                  # 完整发布：构建 → 打包 → 装到本地 → 推送发布
 *   node scripts/release.mjs --bump patch     # 先升版本（patch|minor|major）再发布
 *   node scripts/release.mjs --local-only     # 只构建 + 装到本地，不推送、不发 Release
 *   node scripts/release.mjs --no-install     # 只推送发布，不更新本地扩展
 *   node scripts/release.mjs --dry-run        # 构建 + 校验，但不装本地、不打 tag、不推送
 *   node scripts/release.mjs --skip-checks    # 跳过硬检查（typecheck / lint / 单测）
 *   node scripts/release.mjs --allow-dirty    # 允许工作区有未提交改动（默认拒绝）
 *
 * 为什么默认要「同时更新本地」：
 *   只推 Release 的话，本机跑的还是旧代码 —— 本仓库就踩过这个坑：二改功能都已
 *   提交，但本地扩展停在旧构建上，而版本号没变，从版本号根本看不出差异。
 *   默认把本地一并更新掉，保证「发出去的版本 = 本机在跑的版本」。
 *
 * 三种用法：
 *   1) 完整发布 + 更新本地（最常用）   node scripts/release.mjs --bump patch
 *   2) 只想本地试跑，暂不发布         node scripts/release.mjs --local-only
 *      —— 不检查分支 / gh 登录 / 工作区是否干净，所以可以带着未提交的改动试跑
 *   3) 只发版，不动本机               node scripts/release.mjs --no-install
 *
 * 前置条件（仅"发布"需要，--local-only 不需要）：gh CLI 已登录，
 * 且当前分支能推送到 origin。
 *
 * 本地扩展的旧版本会备份到 ~/.ccursor/backups/（保留最近 3 份），
 * 装完的东西不对可以直接从那里拷回去。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// 复用 installer 的跨平台 Cursor 定位（macOS / Linux / Windows 各自的默认安装路径
// 与 CCURSOR_CURSOR_ROOT 覆盖都已在那边处理过，不重复实现）
import { findCursorPathsDetailed, formatDiagnostic } from '../installer/src/detect.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const extensionDir = join(repoRoot, 'Cursor++')
const installerDir = join(repoRoot, 'installer')

const RELEASE_BRANCH = 'main'
/** 本地扩展备份目录 —— 放 ~/.ccursor 下而不是 /tmp，避免重启后被系统清掉 */
const BACKUP_DIR = join(homedir(), '.ccursor', 'backups')
/** 备份保留份数（每份约 33MB，留最近几次够回滚即可） */
const BACKUP_KEEP = 3

/** 本地构建的 VSIX 必须带齐这些文件，缺任何一个都会让对应平台装不上 */
const REQUIRED_ARTIFACTS = [
  'extension.js',
  'webview.js',
  // supermarkdown 原生模块：8 个平台组合
  'supermarkdown.darwin-arm64.node',
  'supermarkdown.darwin-x64.node',
  'supermarkdown.linux-arm64-gnu.node',
  'supermarkdown.linux-arm64-musl.node',
  'supermarkdown.linux-x64-gnu.node',
  'supermarkdown.linux-x64-musl.node',
  'supermarkdown.win32-arm64-msvc.node',
  'supermarkdown.win32-x64-msvc.node',
  // gpt-tokenizer 的词表（外置，不参与打包混淆）
  'o200k_base.js',
]

// ── 输出工具 ──

const usesAnsi = process.stdout.isTTY
function paint(code, text) {
  return usesAnsi ? `\x1B[${code}m${text}\x1B[0m` : text
}
const dim = text => paint('90', text)
const cyan = text => paint('36', text)
const green = text => paint('32', text)
const red = text => paint('31', text)

function fail(message) {
  console.error(`\n${red('✗')} ${message}\n`)
  process.exit(1)
}

function step(title) {
  console.log(`\n${cyan(`── ${title}`)}`)
}

function ok(message) {
  console.log(`${green('✓')} ${message}`)
}

function info(message) {
  console.log(`  ${message}`)
}

// ── 参数解析 ──
// 放在输出工具之后：这些工具用 const 定义，早于它们调用会命中 TDZ。

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const skipChecks = argv.includes('--skip-checks')
const allowDirty = argv.includes('--allow-dirty')
const localOnly = argv.includes('--local-only')
const noInstall = argv.includes('--no-install')

if (localOnly && noInstall)
  fail('--local-only 与 --no-install 互斥：前者只更新本地，后者不更新本地。')

/** 是否把构建结果装到本机 Cursor（local-only 必须装；dry-run 什么都不装） */
const shouldInstallLocal = !noInstall
/** 是否推送 / 打 tag / 发 Release */
const shouldPublish = !localOnly

function readFlagValue(name) {
  const index = argv.indexOf(name)
  if (index === -1)
    return null
  const value = argv[index + 1]
  if (!value || value.startsWith('--'))
    fail(`${name} 需要一个值`)
  return value
}

const bumpKind = readFlagValue('--bump')

/** 直接执行，继承 stdio，失败即整体中止 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env ?? process.env,
    encoding: 'utf8',
  })
  if (result.error)
    fail(`无法执行 ${command}: ${result.error.message}`)
  if (result.status !== 0) {
    if (options.optional)
      return null
    fail(`${command} ${args.join(' ')} 退出码 ${result.status}`)
  }
  return options.capture ? (result.stdout ?? '').trim() : ''
}

/**
 * 解析 node_modules 里某个 CLI 的 JS 入口，返回可直接交给 node 执行的路径。
 *
 * 刻意不走 node_modules/.bin 下的 .cmd / 包装脚本：
 *   1. Node 出于安全考虑（CVE-2024-27980）**拒绝** spawnSync 直接执行 .cmd / .bat，
 *      Windows 上会立刻以 EINVAL 失败。而这个脚本最常跑在 Windows（Cursor 所在机器），
 *      等于整条检查链路在那儿根本走不通。
 *   2. 换成 shell: true 确实能绕过去，但 Node 会告警 DEP0190：shell 模式下参数是
 *      **拼接而非转义**的，像 `git commit -m "chore: release v0.0.17"` 这种带空格的
 *      参数有被拆错的风险 —— 用一个更隐蔽的问题换掉一个显式报错，不划算。
 * 统一改成 `process.execPath` + 包内 JS 入口后，三个平台走**同一条**代码路径，
 * 也就不存在"某端行为不一致"的分叉；顺带也不再依赖 pnpm / npm 装在机器上。
 *
 * 入口路径读 package.json 的 bin 字段而非写死 `bin/tsc` 这类实现细节 ——
 * 依赖升版换了目录结构时不会静默失效。
 */
const TOOL_PACKAGES = {
  tsc: { packageName: 'typescript', binName: 'tsc' },
  eslint: { packageName: 'eslint', binName: 'eslint' },
  vitest: { packageName: 'vitest', binName: 'vitest' },
  vsce: { packageName: '@vscode/vsce', binName: 'vsce' },
}

function resolveNodeTool(toolName, baseDir = extensionDir) {
  const spec = TOOL_PACKAGES[toolName]
  if (!spec)
    fail(`未知工具 "${toolName}"，请先在 TOOL_PACKAGES 中登记。`)

  const packageDir = join(baseDir, 'node_modules', ...spec.packageName.split('/'))
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath))
    return null

  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = typeof bin === 'string' ? bin : bin?.[spec.binName]
  if (!entry)
    return null

  const entryPath = join(packageDir, entry)
  return existsSync(entryPath) ? entryPath : null
}

/** 用 node 执行解析出的 CLI 入口 —— 平台无关的调用方式（见 TOOL_PACKAGES 说明） */
function runTool(toolName, args, options = {}) {
  const entryPath = resolveNodeTool(toolName)
  if (!entryPath) {
    fail(`找不到 ${toolName} —— 请先在 Cursor++/ 下执行 pnpm install。`
      + `\n  （期望在 node_modules/${TOOL_PACKAGES[toolName].packageName} 下找到 CLI 入口）`)
  }
  return run(process.execPath, [entryPath, ...args], { cwd: extensionDir, ...options })
}

// ── 版本号处理 ──

function readPackageVersion(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
}

function bumpVersion(version, kind) {
  const parts = version.split('.').map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN))
    fail(`无法解析版本号 "${version}"，期望 x.y.z 形式`)
  const [major, minor, patch] = parts
  if (kind === 'major')
    return `${major + 1}.0.0`
  if (kind === 'minor')
    return `${major}.${minor + 1}.0`
  if (kind === 'patch')
    return `${major}.${minor}.${patch + 1}`
  fail(`未知的 --bump 值 "${kind}"，可选 patch | minor | major`)
}

/**
 * 只替换首个顶层 `"version"` 字段。
 *
 * 刻意不做 JSON 往返序列化：那样会重排/丢失注释与原有格式，
 * 让每次发版都带上无关的 diff 噪音。
 */
function writePackageVersion(dir, nextVersion) {
  const path = join(dir, 'package.json')
  const source = readFileSync(path, 'utf8')
  const replaced = source.replace(/^(\s*"version"\s*:\s*")[^"]+(")/m, `$1${nextVersion}$2`)
  if (replaced === source)
    fail(`在 ${path} 中未找到可替换的 "version" 字段`)
  writeFileSync(path, replaced)
}

// ── 前置检查 ──

/**
 * 本机 Cursor 的 app 根目录（`.../resources/app`），由 preflight 探测后填入。
 *
 * 单测需要它：`@vscode/sqlite3` 只存在于 Cursor 安装目录里，
 * 而扩展侧的自动探测在下面两种情况下会落空（见 runChecks 的说明）。
 */
let cursorAppRoot = null

function preflight() {
  step('前置检查')

  // --local-only 只动本机，因此分支 / gh 登录 / 工作区干净这三项约束都不适用。
  // 尤其"工作区干净"：提交前先在本地试跑未提交的改动，正是这个模式最常用的场景。
  if (shouldPublish) {
    const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true })
    info(`当前分支：${branch}`)
    if (branch !== RELEASE_BRANCH && !dryRun) {
      fail(`发布必须在 ${RELEASE_BRANCH} 分支上进行（当前 ${branch}）。`
        + `\n  只想更新本地的话用 --local-only；确需换分支请改脚本里的 RELEASE_BRANCH。`)
    }

    const ghVersion = run('gh', ['--version'], { capture: true, optional: true })
    if (!ghVersion)
      fail('未找到 gh CLI。发布需要它来创建 Release —— 安装：https://cli.github.com/')
    info(`gh：${ghVersion.split('\n')[0]}`)

    // gh auth status 在未登录时返回非零
    const authStatus = run('gh', ['auth', 'status'], { capture: true, optional: true })
    if (!authStatus)
      fail('gh 未登录，请先执行 gh auth status 完成登录。')

    if (!dryRun) {
      // 发布产物必须能对应到某个确定的 commit。--bump 也不能豁免：
      // 版本号是在这一步之后才写的，此刻工作区本就该是干净的。
      const dirtyStatus = run('git', ['status', '--porcelain'], { capture: true })
      if (dirtyStatus && !allowDirty) {
        const lines = dirtyStatus.split('\n').slice(0, 10)
        fail('工作区有未提交的改动，先提交再发版：\n    '
          + lines.join('\n    ')
          + (dirtyStatus.split('\n').length > 10 ? '\n    …' : '')
          + '\n  （确需跳过可加 --allow-dirty；只是想在本地试跑则用 --local-only）')
      }
    }
  }
  else {
    info('模式：--local-only（只更新本地，不检查分支 / gh 登录 / 工作区状态）')
    if (dryRun)
      info('同时指定了 --dry-run，因此不会真正写入')
  }

  // 打包链路要用的东西，缺了就直接说清楚
  if (!existsSync(join(extensionDir, 'node_modules')))
    fail('Cursor++/node_modules 不存在，请先执行 pnpm install。')
  if (!existsSync(join(extensionDir, 'node_modules', 'esbuild')))
    fail('缺少 esbuild 模块 —— 请先在 Cursor++/ 下执行 pnpm install。')
  if (!resolveNodeTool('vsce'))
    fail('找不到 vsce —— 请先在 Cursor++/ 下执行 pnpm install。')

  // 定位 Cursor 安装目录。一次探测供两处复用：
  //   1. 本地安装目标（下面）—— 提前确认，免得构建完才发现装不上；
  //   2. 单测要用的 CURSOR_APP_ROOT（见 runChecks）。
  const cursorLocation = findCursorPathsDetailed()
  cursorAppRoot = cursorLocation.paths?.appRoot ?? null

  // 本地安装目标在这里就确认，而不是等构建完再发现找不到 Cursor：
  // 到那时版本号已经改过、包也打好了，白白浪费一轮。
  if (shouldInstallLocal && !dryRun) {
    if (!cursorLocation.paths) {
      fail(`要更新本地扩展，但找不到 Cursor 安装目录（本地扩展可能尚未安装）:\n`
        + `${formatDiagnostic(cursorLocation.diagnostic)}`
        + '\n  （只想发布、不更新本地的话，加 --no-install）')
    }
    const installed = existsSync(join(cursorLocation.paths.cursor2plusDir, 'package.json'))
    info(`Cursor ${cursorLocation.paths.cursorVersion}：${cursorAppRoot}`)
    info(`本地扩展：${installed ? '已安装，将被覆盖' : '未安装，将新建'}`)
  }

  ok('前置检查通过')
}

// ── 版本一致性 ──

function resolveVersion() {
  step('确定版本号')

  const extensionVersion = readPackageVersion(extensionDir)
  const installerVersion = readPackageVersion(installerDir)
  info(`Cursor++/package.json  : ${extensionVersion}`)
  info(`installer/package.json : ${installerVersion}`)

  if (extensionVersion !== installerVersion) {
    fail(`两处版本号不一致（${extensionVersion} vs ${installerVersion}）。`
      + '\n  installer 的版本会写进安装器元数据，与扩展不一致会让用户看到的版本对不上。')
  }

  let version = extensionVersion
  if (bumpKind) {
    version = bumpVersion(extensionVersion, bumpKind)

    // tag 已存在时先拦下来，别改完文件才发现
    const existingTag = run('git', ['tag', '--list', `v${version}`], { capture: true })
    if (existingTag)
      fail(`tag v${version} 已存在，无法重复发布。`)

    if (dryRun) {
      info(dim(`[dry-run] 将把版本 ${extensionVersion} → ${version}`))
    }
    else {
      writePackageVersion(extensionDir, version)
      writePackageVersion(installerDir, version)
      info(`版本已更新：${extensionVersion} → ${version}`)
    }
  }

  const tag = `v${version}`

  // --local-only 不碰远端，也就没理由被历史 tag / Release 挡住 ——
  // 否则已发布过的版本再想本地重装一次就做不到了。
  if (shouldPublish) {
    const existingTag = run('git', ['tag', '--list', tag], { capture: true })
    if (existingTag)
      fail(`tag ${tag} 已存在。请先提升版本号（--bump patch），或删除该 tag。`)

    if (!dryRun) {
      const existingRelease = run('gh', ['release', 'view', tag], { capture: true, optional: true })
      if (existingRelease)
        fail(`Release ${tag} 已存在，无法重复发布。`)
    }
    ok(`将发布 ${tag}`)
  }
  else {
    ok(`本地安装 v${version}（不推送）`)
  }

  return { version, tag, bumped: Boolean(bumpKind) }
}

// ── 校验与构建 ──

function runChecks() {
  if (skipChecks) {
    console.log(`\n${dim('── 检查：已跳过（--skip-checks）')}`)
    return
  }

  step('检查（typecheck + lint + 单测）')

  for (const toolName of ['tsc', 'eslint', 'vitest']) {
    if (!resolveNodeTool(toolName))
      fail(`找不到 ${toolName} —— 请先在 Cursor++/ 下执行 pnpm install。`)
  }

  info('typecheck…')
  runTool('tsc', ['--noEmit'])

  info('lint…')
  runTool('eslint', ['src'])

  // 实时网络测试默认跳过：发版不应依赖外网与第三方配额（会因对方限流而假失败）
  // 单测里的 sqlite 用例要从 **Cursor 安装目录**加载 @vscode/sqlite3
  // （见 Cursor++/src/server/database/sqlite.ts 的 getCursorAppCandidates）。
  // 它那边的自动探测在两种常见情况下会落空：
  //   · Cursor 装在非默认盘符或自定义路径（硬编码候选里没有，例如 D:\…）；
  //   · vitest 下 __dirname 指向本仓库源码目录，"相对自身往上 3 层"反推出的不是安装目录。
  // 扩展代码本身就为此提供了 CURSOR_APP_ROOT 覆盖，而"Cursor 装在哪"这件事上面已经探到了，
  // 这里直接接上 —— 否则测试会栽在一个脚本已经知道答案的问题上。
  const testEnv = cursorAppRoot
    ? { ...process.env, CURSOR_APP_ROOT: cursorAppRoot }
    : process.env
  if (cursorAppRoot)
    info(dim(`CURSOR_APP_ROOT=${cursorAppRoot}`))
  else
    info(dim('未定位到 Cursor 安装目录，未注入 CURSOR_APP_ROOT（依赖 sqlite3 的用例可能失败）'))

  info('unit tests…')
  runTool('vitest', ['run'], { env: testEnv })

  ok('检查通过')
}

function buildAndPackage(version) {
  step('生产构建')

  // esbuild.js 是本仓库的构建脚本（内部 require('esbuild')），要用 node 跑，
  // 不能直接调用 node_modules/.bin/esbuild —— 那是 esbuild 自身的 CLI。
  if (!existsSync(join(extensionDir, 'node_modules', 'esbuild')))
    fail('找不到 esbuild 模块 —— 请先在 Cursor++/ 下执行 pnpm install。')
  run(process.execPath, ['esbuild.js', '--production'], { cwd: extensionDir })
  ok('已生成生产构建产物')

  step('校验多端产物')
  const distDir = join(extensionDir, 'dist')
  const missing = REQUIRED_ARTIFACTS.filter(name => !existsSync(join(distDir, name)))
  if (missing.length > 0) {
    fail(`构建产物缺少以下文件，该 VSIX 无法在所有平台安装：\n    ${missing.join('\n    ')}`
      + '\n  通常说明 supermarkdown / gpt-tokenizer 的依赖安装不完整，重新 pnpm install。')
  }
  // 按平台归类，让"兼容多端"这件事在输出里可见
  const nativeModules = REQUIRED_ARTIFACTS.filter(name => name.endsWith('.node'))
  info(`原生模块齐备（${nativeModules.length} 个平台组合）：`)
  for (const name of nativeModules)
    info(dim(`  · ${name}`))
  ok('多端产物完整')

  step('打包 VSIX')
  runTool('vsce', [
    'package',
    '--no-dependencies',
    '--allow-missing-repository',
    '--skip-license',
    '--allow-star-activation',
  ])

  const vsixPath = join(extensionDir, `cursor2plus-${version}.vsix`)
  if (!existsSync(vsixPath))
    fail(`打包结束但未找到 ${vsixPath}`)
  const sizeMb = (readFileSync(vsixPath).length / 1024 / 1024).toFixed(2)
  ok(`已打包 ${vsixPath} (${sizeMb} MB)`)
  return vsixPath
}

// ── 本地安装 ──

/**
 * 按备份名尾部的 ISO 时间戳排序，只保留最近 N 份。
 *
 * 不能直接按整个文件名字典序排：那样 `cursor2plus-v0.0.9-...` 会排到
 * `cursor2plus-v0.0.10-...` 之后（'9' > '1'），于是版本跨位数时反而把
 * 更新的那份删掉、留下旧的。名字尾部的 `YYYY-MM-DDTHH-MM-SS` 是定长且
 * 字典序即时间序，按它排才可靠。
 */
function backupTimestamp(name) {
  return name.slice(-19)
}

function pruneBackups() {
  if (!existsSync(BACKUP_DIR))
    return
  const entries = readdirSync(BACKUP_DIR)
    .filter(name => name.startsWith('cursor2plus-'))
    .sort((left, right) => backupTimestamp(left).localeCompare(backupTimestamp(right)))
  for (const stale of entries.slice(0, Math.max(0, entries.length - BACKUP_KEEP))) {
    rmSync(join(BACKUP_DIR, stale), { recursive: true, force: true })
  }
}

/**
 * 解压 VSIX（本质是 zip）到指定目录。
 *
 * 平台差异在这件事上很实在：macOS / Linux 有 `unzip`，而 Windows 10+ 自带的是
 * bsdtar（`tar`，能处理 zip）而**没有** `unzip`。所以按平台选工具，而不是写死一个。
 */
function extractVsix(vsixPath, extractDir) {
  const attempts = process.platform === 'win32'
    ? [['tar', ['-xf', vsixPath, '-C', extractDir]]]
    : [['unzip', ['-q', '-o', vsixPath, '-d', extractDir]]]

  for (const [command, args] of attempts) {
    if (run(command, args, { capture: true, optional: true }) !== null)
      return
  }

  fail(process.platform === 'win32'
    ? '解压 VSIX 失败 —— 需要系统 tar 命令（Windows 10 起自带）。'
    : '解压 VSIX 失败 —— 需要系统 unzip 命令。')
}

/** 文件内容的 sha256 —— 用来判断某个文件是否真的需要重写 */
function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * 递归列出目录下所有文件的相对路径，统一用 `/` 分隔。
 *
 * 归一化分隔符是必需的：Windows 上 readdir 给出的是 `dist\extension.js`，
 * 而 VSIX 里是 `dist/extension.js`，直接比较会把同一个文件当成两个。
 * 取出来统一成 `/`，回写时再用 resolveRelative 转回本机形式。
 */
function listRelativeFiles(root) {
  if (!existsSync(root))
    return []

  const collected = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory())
        walk(join(dir, entry.name), relativePath)
      else
        collected.push(relativePath)
    }
  }
  walk(root, '')
  return collected
}

/** 把 `/` 分隔的相对路径转回本机路径 */
function resolveRelative(root, relativePath) {
  return join(root, ...relativePath.split('/'))
}

/**
 * 把刚打好的 VSIX 装到本机 Cursor。
 *
 * 刻意不调用 installer 的 install()：那条路径会连带重打 Cursor 本体补丁
 * （renderer hook / always-local / 签名绕过…），而我们这里只是替换扩展本体，
 * 补丁早就在位，重打一遍既慢又多一份备份噪音。
 *
 * 也不能直接复用 installer/src/extension-embed.js —— 它依赖打包时才注入的
 * __dirname 与 fflate，独立运行会挂。所以这里自己解压，与 update-check.ts
 * 里的就地更新保持一致。
 */
function installLocal(vsixPath, version) {
  step('更新本地扩展')

  const { paths, diagnostic } = findCursorPathsDetailed()
  if (!paths) {
    fail(`找不到 Cursor 安装目录。\n${formatDiagnostic(diagnostic)}`)
  }

  const targetDir = paths.cursor2plusDir
  info(`目标：${targetDir}`)

  // 覆盖的文件在扩展重启前不会生效（JS 已 require 进内存），所以只提示不阻断。
  // 个别被占用的文件会在替换步骤里单独跳过，并在结尾汇总报错 —— 见那里的说明。
  if (isCursorRunning(paths.appRoot))
    info('Cursor 正在运行 —— 需重启 Cursor 才会加载新代码（被占用的文件会单独跳过并提示）。')

  const workDir = join(homedir(), '.ccursor', '.release-tmp')
  const extractDir = join(workDir, 'extracted')
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })

  try {
    extractVsix(vsixPath, extractDir)

    const payloadDir = join(extractDir, 'extension')
    if (!existsSync(join(payloadDir, 'package.json')))
      fail(`VSIX 结构异常：缺少 extension/package.json（${vsixPath}）`)

    // 1) 备份现有扩展（仅在已安装时）
    if (existsSync(join(targetDir, 'package.json'))) {
      mkdirSync(BACKUP_DIR, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const previous = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')).version
      const backupPath = join(BACKUP_DIR, `cursor2plus-v${previous}-${stamp}`)
      cpSync(targetDir, backupPath, { recursive: true })
      pruneBackups()
      info(`已备份旧版本 v${previous} → ${basename(backupPath)}`)
    }

    // 2) 替换扩展本体 —— 只写**内容有差异**的文件。
    //
    //    为什么不整体 rm + cp：目录里体积最大的是一整套 supermarkdown 原生模块
    //    （8 个 .node，约 27MB），而它们几乎从不变化。原先无条件重写全部文件时，
    //    只要有一个 .node 正被运行中的 Cursor 占用，整个安装就当场失败 —— 哪怕这次
    //    根本没改动任何原生模块。改成按内容跳过之后，"在 Cursor 里跑发布"这个最常见
    //    的情况也能顺利完成，不必先关掉它；顺带也快得多。
    //
    //    僵尸文件仍然要清：旧版本可能留下已被移除的模块（比如换掉 provider 后的残留）。
    //    cursor2plus/ 完全由 VSIX 拥有（installer 的 extension-embed.js 就是整目录删掉
    //    重装），所以这里做全树镜像，多出来的文件一律删除。
    mkdirSync(targetDir, { recursive: true })

    const payloadFiles = listRelativeFiles(payloadDir)
    const writtenFiles = []
    const unchangedFiles = []
    const removedFiles = []
    const blockedFiles = []

    for (const relativePath of payloadFiles) {
      const sourcePath = resolveRelative(payloadDir, relativePath)
      const targetPath = resolveRelative(targetDir, relativePath)

      if (existsSync(targetPath) && hashFile(sourcePath) === hashFile(targetPath)) {
        unchangedFiles.push(relativePath)
        continue
      }

      try {
        mkdirSync(dirname(targetPath), { recursive: true })
        cpSync(sourcePath, targetPath)
        writtenFiles.push(relativePath)
      }
      catch (error) {
        blockedFiles.push({ relativePath, reason: error.code ?? error.message })
      }
    }

    const payloadFileSet = new Set(payloadFiles)
    for (const relativePath of listRelativeFiles(targetDir)) {
      if (payloadFileSet.has(relativePath))
        continue
      try {
        rmSync(resolveRelative(targetDir, relativePath))
        removedFiles.push(relativePath)
      }
      catch (error) {
        blockedFiles.push({ relativePath, reason: error.code ?? error.message })
      }
    }

    // 3) 被占用的文件必须显式报出来，不能默默算成功 ——
    //    否则会变成"脚本说装好了、实际一部分还是旧代码"这种最难排查的状态。
    if (blockedFiles.length > 0) {
      fail(`${blockedFiles.length} 个文件被占用，未能写入：\n    `
        + blockedFiles.map(item => `${item.relativePath}（${item.reason}）`).join('\n    ')
        + '\n  这些通常是运行中的 Cursor 已加载的原生模块。'
        + '\n  请完全退出 Cursor 后重跑本命令 —— 已写入的文件内容一致，会被自动跳过，不会重复覆盖。')
    }

    // 4) 校验：确认落盘的产物与 VSIX 内容一致
    const mismatch = REQUIRED_ARTIFACTS
      .filter(name => existsSync(join(payloadDir, 'dist', name)))
      .filter(name => !existsSync(join(targetDir, 'dist', name)))
    if (mismatch.length > 0)
      fail(`写入后校验失败，以下文件缺失：${mismatch.join(', ')}`)

    const installedVersion = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')).version
    if (installedVersion !== version)
      fail(`版本不符：期望 ${version}，实际写入 ${installedVersion}`)

    ok(`本地扩展已更新到 v${installedVersion}`
      + `（写入 ${writtenFiles.length} 个，内容一致跳过 ${unchangedFiles.length} 个`
      + (removedFiles.length > 0 ? `，清理旧文件 ${removedFiles.length} 个` : '')
      + '）')
  }
  finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

/**
 * 判断 Cursor 是否在运行 —— 只用于给出"需重启"提示与 Windows 的占用预警，
 * 因此宁可漏报也不要误报。
 *
 * 不用 `pgrep -x Cursor`：macOS 上匹配不到。pgrep 匹配的是 argv，而 Cursor 主进程
 * 的 argv 里并不含可执行文件路径（实测 0 命中）；`ps -Ao comm=` 才拿得到真实路径。
 */
function isCursorRunning(appRoot) {
  if (process.platform === 'win32') {
    const listing = run('tasklist', ['/FI', 'IMAGENAME eq Cursor.exe'], { capture: true, optional: true })
    return Boolean(listing && listing.includes('Cursor.exe'))
  }

  const listing = run('ps', ['-Ao', 'comm='], { capture: true, optional: true })
  if (!listing)
    return false

  // macOS 上 appRoot 形如 <bundle>/Contents/Resources/app，主可执行文件是
  // <bundle>/Contents/MacOS/Cursor —— 按精确路径匹配，避免把 Helper / 崩溃上报
  // 之类的子进程也算进来。
  const expectedExecutable = deriveMacExecutablePath(appRoot)
  return listing.split('\n').some((line) => {
    const path = line.trim()
    if (!path)
      return false
    if (expectedExecutable && path === expectedExecutable)
      return true
    // Linux 发行方式多样（/opt/cursor、/usr/share/cursor、AppImage…），
    // 退化为"可执行文件名恰好是 cursor / Cursor"
    const name = basename(path)
    return process.platform === 'linux' && (name === 'cursor' || name === 'Cursor')
  })
}

/** 由 appRoot 推导主可执行文件路径；仅 macOS 的 bundle 结构可推导 */
function deriveMacExecutablePath(appRoot) {
  if (process.platform !== 'darwin')
    return null
  const bundleRoot = appRoot.replace(/\/Contents\/Resources\/app\/?$/, '')
  if (bundleRoot === appRoot)
    return null
  return join(bundleRoot, 'Contents', 'MacOS', 'Cursor')
}

// ── 发布 ──

function buildReleaseNotes(version) {
  return [
    `Cursor++ BYOK ${version}`,
    '',
    '**安装/更新**：扩展检测到新版本后会提示 **Update Now**，自动下载本 Release 的 VSIX 并覆盖安装（装完需重启 Cursor）。',
    '',
    '**手动安装**（可选）：',
    `1. 下载下方 \`cursor2plus-${version}.vsix\``,
    '2. 用 installer 安装，或按 README「方式三」解压覆盖扩展目录',
    '',
    '> 本产物由本地构建，内含 macOS / Linux / Windows（x64 · arm64）全部原生模块。',
  ].join('\n')
}

function publish({ version, tag, bumped }, vsixPath) {
  if (dryRun) {
    step('发布（dry-run，已跳过）')
    info(dim(`将执行：git commit → git tag ${tag} → git push → gh release create ${tag}`))
    info(dim(`将上传：${vsixPath}`))
    return
  }

  step('提交版本号变更')
  if (bumped) {
    run('git', ['add', join(extensionDir, 'package.json'), join(installerDir, 'package.json')])
    run('git', ['commit', '-m', `chore: release ${tag}`])
    ok(`已提交版本号变更（${tag}）`)
  }
  else {
    info('版本号未变更，跳过')
  }

  step(`打 tag 并推送`)
  run('git', ['tag', '-a', tag, '-m', `Cursor++ BYOK ${version}`])
  run('git', ['push', 'origin', RELEASE_BRANCH])
  run('git', ['push', 'origin', tag])
  ok(`已推送 ${RELEASE_BRANCH} 与 ${tag}`)

  step('创建 GitHub Release')
  // 先推 tag 再用 --verify-tag：避免 gh 拿默认分支 HEAD 去伪造一个 tag，
  // 造成 Release 指向的 commit 与实际发布的代码不一致。
  run('gh', [
    'release', 'create', tag,
    '--title', `Cursor++ BYOK ${version}`,
    '--notes', buildReleaseNotes(version),
    '--verify-tag',
    vsixPath,
  ])

  ok(`Release ${tag} 已发布`)
}

// ── 主流程 ──

// 顺序刻意如此：构建 → 打包 → **更新本地** → 推送发布。
// 本地安装放在推送之前，是为了让"装不上"这类问题在创建公开 Release 之前就暴露 ——
// 若反过来，会出现「Release 已发布、本机却没更新成功」的半成品状态。
console.log(dryRun ? dim('（dry-run：不会修改本地扩展，也不会动远端）') : '')
preflight()
const target = resolveVersion()
runChecks()
const vsixPath = buildAndPackage(target.version)

if (shouldInstallLocal && !dryRun)
  installLocal(vsixPath, target.version)
else if (dryRun)
  console.log(`\n${dim('── 更新本地扩展：dry-run，已跳过')}`)

if (shouldPublish)
  publish(target, vsixPath)
else
  console.log(`\n${dim('── 推送发布：--local-only，已跳过')}`)

console.log('')
if (dryRun) {
  console.log(green(`dry-run 完成：${target.tag} 已构建并通过校验，未更新本地、未发布。`))
}
else if (localOnly) {
  console.log(green(`本地已更新到 ${target.tag}（未推送、未发 Release）`))
  console.log(`  重启 Cursor 后生效。确认没问题再执行：node scripts/release.mjs`)
}
else {
  console.log(green(`发布完成：${target.tag}`))
  console.log(`  Release：https://github.com/Yoahoug/CCursor-BYOK/releases/tag/${target.tag}`)
  if (shouldInstallLocal)
    console.log(`  本地扩展已同步更新；重启 Cursor 后生效。`)
  console.log(`  其他机器会在下次检查更新时（最长 4 小时）提示 Update Now。`)
}
