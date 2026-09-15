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
 * 定位 node_modules/.bin 下的可执行文件。
 *
 * 不通过 pnpm / npm run 转发：包管理器不一定装在每台机器上（AI 跑的环境
 * 常常只有 node），直接调用 .bin 更稳。Windows 上是 .cmd。
 */
function localBin(name, baseDir = extensionDir) {
  const binDir = join(baseDir, 'node_modules', '.bin')
  const candidates = process.platform === 'win32'
    ? [join(binDir, `${name}.cmd`), join(binDir, name)]
    : [join(binDir, name)]
  for (const candidate of candidates) {
    if (existsSync(candidate))
      return candidate
  }
  return null
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
  if (!localBin('vsce'))
    fail('找不到 vsce —— 请先在 Cursor++/ 下执行 pnpm install。')

  // 本地安装目标在这里就确认，而不是等构建完再发现找不到 Cursor：
  // 到那时版本号已经改过、包也打好了，白白浪费一轮。
  if (shouldInstallLocal && !dryRun) {
    const { paths, diagnostic } = findCursorPathsDetailed()
    if (!paths) {
      fail(`要更新本地扩展，但找不到 Cursor 安装目录。\n${formatDiagnostic(diagnostic)}`
        + '\n  （只想发布、不更新本地的话，加 --no-install）')
    }
    const installed = existsSync(join(paths.cursor2plusDir, 'package.json'))
    info(`Cursor ${paths.cursorVersion}：${paths.appRoot}`)
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

  const tsc = localBin('tsc')
  const eslint = localBin('eslint')
  const vitest = localBin('vitest')
  for (const [name, bin] of [['tsc', tsc], ['eslint', eslint], ['vitest', vitest]]) {
    if (!bin)
      fail(`找不到 ${name} —— 请先在 Cursor++/ 下执行 pnpm install。`)
  }

  info('typecheck…')
  run(tsc, ['--noEmit'], { cwd: extensionDir })

  info('lint…')
  run(eslint, ['src'], { cwd: extensionDir })

  // 实时网络测试默认跳过：发版不应依赖外网与第三方配额（会因对方限流而假失败）
  info('unit tests…')
  run(vitest, ['run'], { cwd: extensionDir })

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
  const vsce = localBin('vsce')
  if (!vsce)
    fail('找不到 vsce —— 请先在 Cursor++/ 下执行 pnpm install。')
  run(vsce, [
    'package',
    '--no-dependencies',
    '--allow-missing-repository',
    '--skip-license',
    '--allow-star-activation',
  ], { cwd: extensionDir })

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

  // 文件覆盖在扩展重启前不会生效（JS 已 require 进内存），所以只提示不阻断。
  // Windows 上另有麻烦：正在被占用的 .node 会写入失败，那里需要先关掉 Cursor。
  if (isCursorRunning(paths.appRoot)) {
    if (process.platform === 'win32') {
      fail('Cursor 正在运行，Windows 下扩展目录里的原生模块可能被占用而写入失败。'
        + '\n  请完全退出 Cursor 后重试。')
    }
    info('Cursor 正在运行 —— 文件可以覆盖，但需重启 Cursor 才会加载新代码。')
  }

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

    // 2) 替换扩展本体。
    //    dist/ 先删后拷：旧版本可能留下已被移除的文件（例如换 provider 后残留的模块），
    //    整体覆盖会把这些僵尸文件留下来。
    mkdirSync(targetDir, { recursive: true })
    rmSync(join(targetDir, 'dist'), { recursive: true, force: true })
    cpSync(payloadDir, targetDir, { recursive: true })

    // 3) 校验：确认落盘的产物与 VSIX 内容一致
    const mismatch = REQUIRED_ARTIFACTS
      .filter(name => existsSync(join(payloadDir, 'dist', name)))
      .filter(name => !existsSync(join(targetDir, 'dist', name)))
    if (mismatch.length > 0)
      fail(`写入后校验失败，以下文件缺失：${mismatch.join(', ')}`)

    const installedVersion = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')).version
    if (installedVersion !== version)
      fail(`版本不符：期望 ${version}，实际写入 ${installedVersion}`)

    ok(`本地扩展已更新到 v${installedVersion}（${REQUIRED_ARTIFACTS.length} 个文件校验通过）`)
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
