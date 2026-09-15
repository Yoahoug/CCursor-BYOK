#!/usr/bin/env node
/**
 * 构建门禁 —— 提交 / CI 前统一走这一条命令。
 *
 * 串联三件事，任一失败即以非零码退出：
 *   1. 类型检查  (tsc --noEmit)
 *   2. 代码规范  (eslint src)
 *   3. 单元测试  (vitest run)
 *   4. 生产构建  (esbuild，确认打包产物能生成)
 *
 * 为什么单独抽成脚本：pre-commit hook 与 GitHub Actions 需要**完全一致**的
 * 通过标准。如果两边各写一套，很容易出现「本地绿、CI 红」这种最难查的偏差。
 *
 * 实时网络测试（webFetchLive）默认跳过，门禁不应该依赖外网与第三方配额；
 * 需要跑时手动加 WEBFETCH_LIVE=1。
 *
 * 用法：
 *   node scripts/verify.mjs            # 完整门禁
 *   node scripts/verify.mjs --quick    # 跳过生产构建（仅类型+lint+测试）
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const extensionRoot = join(__dirname, '..')
const quick = process.argv.includes('--quick')

/**
 * 本地开发用 pnpm / 全局 pnpm 皆可，但 CI 上没装 pnpm 也能跑，
 * 所以这里直接调用 node_modules/.bin 下的可执行文件，绕开包管理器。
 */
function localBin(name) {
  const candidates = process.platform === 'win32'
    ? [join(extensionRoot, 'node_modules', '.bin', `${name}.cmd`), join(extensionRoot, 'node_modules', '.bin', name)]
    : [join(extensionRoot, 'node_modules', '.bin', name)]
  for (const candidate of candidates) {
    if (existsSync(candidate))
      return candidate
  }
  return null
}

const steps = [
  {
    name: 'typecheck',
    run: () => {
      const bin = localBin('tsc')
      if (!bin)
        throw new Error('tsc not found — run pnpm install first')
      return { command: bin, args: ['--noEmit'] }
    },
  },
  {
    name: 'lint',
    run: () => {
      const bin = localBin('eslint')
      if (!bin)
        throw new Error('eslint not found — run pnpm install first')
      return { command: bin, args: ['src'] }
    },
  },
  {
    name: 'unit tests',
    run: () => {
      const bin = localBin('vitest')
      if (!bin)
        throw new Error('vitest not found — run pnpm install first')
      return { command: bin, args: ['run'] }
    },
  },
  {
    name: 'production build',
    skip: quick,
    run: () => ({ command: process.execPath, args: ['esbuild.js', '--production'] }),
  },
]

const results = []
let failed = false

for (const step of steps) {
  if (step.skip) {
    console.log(`\n\x1B[90m── ${step.name}: skipped\x1B[0m`)
    continue
  }

  console.log(`\n\x1B[36m── ${step.name}\x1B[0m`)
  let command
  let args
  try {
    ({ command, args } = step.run())
  }
  catch (error) {
    console.error(`\x1B[31m✗ ${step.name} could not start: ${error.message}\x1B[0m`)
    results.push({ name: step.name, ok: false })
    failed = true
    break
  }

  const started = Date.now()
  const result = spawnSync(command, args, { cwd: extensionRoot, stdio: 'inherit' })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  const ok = result.status === 0
  results.push({ name: step.name, ok, elapsed })

  if (!ok) {
    console.error(`\x1B[31m✗ ${step.name} failed after ${elapsed}s\x1B[0m`)
    failed = true
    break
  }
  console.log(`\x1B[32m✓ ${step.name} (${elapsed}s)\x1B[0m`)
}

console.log('')
if (failed) {
  console.error('\x1B[31mBuild gate FAILED — fix the errors above before committing.\x1B[0m')
  process.exit(1)
}
console.log('\x1B[32mBuild gate PASSED.\x1B[0m')
