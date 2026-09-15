#!/usr/bin/env node
/**
 * 安装仓库的 git hooks。
 *
 * 为什么不让 hooks 直接放 .git/hooks：那个目录不进版本控制，clone 下来就没了，
 * 别人（或换了台机器的你）会静默失去提交门禁。这里把真正的 hook 脚本放在
 * scripts/pre-commit 里纳入版本管理，再用本脚本复制过去。
 *
 * 用法：
 *   node scripts/install-hooks.mjs
 *
 * 顺带设置 core.hooksPath 之外的替代方案：直接写入 .git/hooks/pre-commit，
 * 这样不改变仓库的全局 git 配置，卸载只需删文件。
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

function gitDir() {
  const out = execSync('git rev-parse --git-dir', { cwd: repoRoot, encoding: 'utf8' })
  const path = out.trim()
  return path.startsWith('/') ? path : join(repoRoot, path)
}

const hooksDir = join(gitDir(), 'hooks')
const source = join(__dirname, 'pre-commit')
const target = join(hooksDir, 'pre-commit')

if (!existsSync(source)) {
  console.error(`[hooks] source hook not found: ${source}`)
  process.exit(1)
}

mkdirSync(hooksDir, { recursive: true })

// 若已存在别人的 hook，先备份而不是静默覆盖
if (existsSync(target)) {
  const backup = `${target}.bak-${Date.now()}`
  copyFileSync(target, backup)
  console.log(`[hooks] existing pre-commit backed up to ${backup}`)
}

copyFileSync(source, target)
chmodSync(target, 0o755)

console.log(`[hooks] installed pre-commit → ${target}`)
console.log('[hooks] Build gate now runs on every commit (bypass with --no-verify if truly needed).')
