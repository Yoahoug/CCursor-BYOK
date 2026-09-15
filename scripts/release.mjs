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
 *   node scripts/release.mjs                  # 用 package.json 里的现有版本发版
 *   node scripts/release.mjs --bump patch     # 先升版本（patch|minor|major）再发版
 *   node scripts/release.mjs --dry-run        # 构建 + 校验，但不打 tag / 不推送 / 不发 Release
 *   node scripts/release.mjs --skip-checks    # 跳过硬检查（typecheck / lint / 单测）
 *   node scripts/release.mjs --allow-dirty    # 允许工作区有未提交改动（默认拒绝）
 *
 * 前置条件：gh CLI 已登录（gh auth status），且当前分支能推送到 origin。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const extensionDir = join(repoRoot, 'Cursor++')
const installerDir = join(repoRoot, 'installer')

const RELEASE_BRANCH = 'main'

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

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true })
  info(`当前分支：${branch}`)
  if (branch !== RELEASE_BRANCH && !dryRun) {
    fail(`发布必须在 ${RELEASE_BRANCH} 分支上进行（当前 ${branch}）。`
      + `\n  如确需换分支，请先修改脚本里的 RELEASE_BRANCH。`)
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
        + '\n  （确需跳过可加 --allow-dirty，但发出去的产物将无法对应到某个 commit）')
    }
  }

  // 打包链路要用的东西，缺了就直接说清楚
  if (!existsSync(join(extensionDir, 'node_modules')))
    fail('Cursor++/node_modules 不存在，请先执行 pnpm install。')
  if (!existsSync(join(extensionDir, 'node_modules', 'esbuild')))
    fail('缺少 esbuild 模块 —— 请先在 Cursor++/ 下执行 pnpm install。')
  if (!localBin('vsce'))
    fail('找不到 vsce —— 请先在 Cursor++/ 下执行 pnpm install。')

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
  const existingTag = run('git', ['tag', '--list', tag], { capture: true })
  if (existingTag)
    fail(`tag ${tag} 已存在。请先提升版本号（--bump patch），或删除该 tag。`)

  if (!dryRun) {
    const existingRelease = run('gh', ['release', 'view', tag], { capture: true, optional: true })
    if (existingRelease)
      fail(`Release ${tag} 已存在，无法重复发布。`)
  }

  ok(`将发布 ${tag}`)
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

console.log(dryRun ? dim('（dry-run：不会修改任何远端状态）') : '')
preflight()
const target = resolveVersion()
runChecks()
const vsixPath = buildAndPackage(target.version)
publish(target, vsixPath)

console.log('')
if (dryRun) {
  console.log(green(`dry-run 完成：${target.tag} 已构建并通过校验，未发布。`))
}
else {
  console.log(green(`发布完成：${target.tag}`))
  console.log(`  Release：https://github.com/Yoahoug/CCursor-BYOK/releases/tag/${target.tag}`)
  console.log(`  扩展会在下次检查更新时（最长 4 小时）提示 Update Now。`)
}
