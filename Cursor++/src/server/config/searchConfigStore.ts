/**
 * web-tools.json 配置存储 — Search + Fetch Provider 管理
 */
import type { WebToolsConfig } from '../data/defaults'
import { existsSync, unwatchFile, watchFile } from 'node:fs'
import { DEFAULT_WEB_TOOLS, normalizeFetchProvider } from '../data/defaults'
import { logger } from '../logger'
import { readJsonOrNull, withSerial, writeJsonAtomic } from './atomic'
import { getWebToolsFilePath } from './paths'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: WebToolsConfig | null = null

/**
 * 把磁盘上读到的配置补成完整结构。
 *
 * fetch 段只保留 `provider`：Tavily 抓取复用 search 侧 Tavily 项的 key / baseUrl，
 * 老配置里遗留的 `fetch.jina` / `fetch.firecrawl` 以及已下线的 provider 值
 * 都在这里被丢弃，避免读到失效字段后抓取静默落到内置分支。
 */
function withFallback(loaded: Partial<WebToolsConfig> | null): WebToolsConfig {
  if (!loaded)
    return clone(DEFAULT_WEB_TOOLS)
  return {
    $schemaVersion: loaded.$schemaVersion ?? DEFAULT_WEB_TOOLS.$schemaVersion,
    search: {
      providers: loaded.search?.providers ?? clone(DEFAULT_WEB_TOOLS.search.providers),
      parallel: loaded.search?.parallel ?? DEFAULT_WEB_TOOLS.search.parallel,
      maxResults: loaded.search?.maxResults ?? DEFAULT_WEB_TOOLS.search.maxResults,
      fallbackToDuckDuckGo: loaded.search?.fallbackToDuckDuckGo ?? DEFAULT_WEB_TOOLS.search.fallbackToDuckDuckGo,
    },
    fetch: {
      provider: normalizeFetchProvider(loaded.fetch?.provider),
    },
  }
}

export function loadWebTools(): WebToolsConfig {
  if (cache)
    return cache
  const loaded = readJsonOrNull<Partial<WebToolsConfig>>(getWebToolsFilePath())
  cache = withFallback(loaded)
  return cache
}

export function updateWebTools(updater: (draft: WebToolsConfig) => void): Promise<WebToolsConfig> {
  return withSerial('web-tools', async () => {
    const path = getWebToolsFilePath()
    const existing = readJsonOrNull<Partial<WebToolsConfig>>(path)
    cache = withFallback(existing)
    const draft = clone(cache)
    updater(draft)
    writeJsonAtomic(path, draft)
    cache = draft
    logger.info({ searchProviders: draft.search.providers.length, fetchProvider: draft.fetch.provider }, '[CFG] web-tools updated')
    notifyChange()
    return clone(cache)
  })
}

export function getWebTools(): WebToolsConfig {
  return cache ?? loadWebTools()
}

// Backward compat aliases
export function getSearchConfig() {
  return getWebTools().search
}

export function getFetchConfig() {
  return getWebTools().fetch
}

// ── File watching ──

type ChangeListener = () => void
const changeListeners: ChangeListener[] = []
let watching = false

export function onWebToolsChange(fn: ChangeListener): () => void {
  changeListeners.push(fn)
  return () => {
    const idx = changeListeners.indexOf(fn)
    if (idx >= 0)
      changeListeners.splice(idx, 1)
  }
}

function notifyChange() {
  for (const fn of changeListeners)
    fn()
}

export function startWebToolsWatcher(): void {
  if (watching)
    return
  const path = getWebToolsFilePath()
  if (!existsSync(path))
    return
  watchFile(path, { interval: 2000, persistent: false }, () => {
    const loaded = readJsonOrNull<Partial<WebToolsConfig>>(path)
    cache = withFallback(loaded)
    logger.info('[CFG] web-tools reloaded from disk')
    notifyChange()
  })
  watching = true
}

export function stopWebToolsWatcher(): void {
  if (!watching)
    return
  try {
    unwatchFile(getWebToolsFilePath())
  }
  catch {}
  watching = false
}
