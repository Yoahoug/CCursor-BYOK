import { getFetchConfig, getSearchConfig } from '../../config/searchConfigStore'
import { loadSupermarkdown, supermarkdownUnavailableMessage } from './supermarkdown'
import { logger } from '../../logger'

const FETCH_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_MARKDOWN_CHARS = 100_000
const CACHE_TTL_MS = 5 * 60_000
const BINARY_TYPES = /^(image|video|audio|application\/pdf|application\/octet-stream|application\/zip)/
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/3.4 Chrome/131.0.0.0 Safari/537.36'

const EXCLUDE_SELECTORS = [
  'nav', 'header', 'footer', 'aside',
  '.sidebar', '.navigation', '.menu', '.nav',
  '.advertisement', '.ads', '#ads', '.ad-container',
  '.related-posts', '.comments', '.social-share',
  'script', 'style', 'noscript', 'iframe',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
]

interface CacheEntry { markdown: string, url: string, expiresAt: number }
const fetchCache = new Map<string, CacheEntry>()

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:')
      return false
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0')
      return false
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host))
      return false
    return true
  }
  catch {
    return false
  }
}

function htmlToMarkdown(html: string, sourceUrl: string): string {
  const loaded = loadSupermarkdown()
  if (!loaded.ok) {
    logger.error({ error: loaded.error.message }, '[WEB] supermarkdown native module unavailable')
    throw new Error(supermarkdownUnavailableMessage(loaded.error))
  }

  try {
    const md = loaded.convert(html, {
      excludeSelectors: EXCLUDE_SELECTORS,
      baseUrl: sourceUrl,
      headingStyle: 'atx',
      linkStyle: 'referenced',
    })
    return md.slice(0, MAX_MARKDOWN_CHARS)
  }
  catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error({ error: message }, '[WEB] supermarkdown convert failed')
    throw new Error(`Built-in Web Fetch failed while converting HTML with supermarkdown: ${message}`)
  }
}

function fallbackStripHtml(html: string, sourceUrl: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim() : sourceUrl
  const body = decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  ).slice(0, MAX_MARKDOWN_CHARS)
  return `# ${title}\n\nSource: ${sourceUrl}\n\n${body}`
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&nbsp;/g, ' ')
}

async function fetchBuiltin(url: string): Promise<{ url: string, markdown: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, 'accept': 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok)
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    const contentType = response.headers.get('content-type') ?? ''
    if (BINARY_TYPES.test(contentType))
      throw new Error(`binary content type not supported: ${contentType}`)
    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES)
      throw new Error(`response too large: ${contentLength} bytes`)
    const text = await response.text()
    if (text.length > MAX_RESPONSE_BYTES)
      throw new Error(`response body too large: ${text.length} bytes`)
    const finalUrl = response.url || url
    let markdown: string
    if (contentType.includes('text/html') || /^<!doctype html/i.test(text) || /<html[\s>]/i.test(text))
      markdown = htmlToMarkdown(text, finalUrl)
    else if (contentType.includes('application/json')) {
      try { markdown = `# ${finalUrl}\n\n\`\`\`json\n${JSON.stringify(JSON.parse(text), null, 2).slice(0, MAX_MARKDOWN_CHARS)}\n\`\`\`` }
      catch { markdown = `# ${finalUrl}\n\n\`\`\`\n${text.slice(0, MAX_MARKDOWN_CHARS)}\n\`\`\`` }
    }
    else { markdown = `# ${finalUrl}\n\n${text.slice(0, MAX_MARKDOWN_CHARS)}` }
    return { url: finalUrl, markdown }
  }
  finally { clearTimeout(timer) }
}

async function fetchJina(url: string, apiKey: string): Promise<{ url: string, markdown: string }> {
  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (apiKey)
    headers.Authorization = `Bearer ${apiKey}`
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`Jina reader failed: ${response.status}`)
  const json = await response.json() as any
  const data = json.data || json
  return {
    url: data.url || url,
    markdown: (data.content || data.text || '').slice(0, MAX_MARKDOWN_CHARS),
  }
}

async function fetchFirecrawl(url: string, apiKey: string, baseUrl?: string): Promise<{ url: string, markdown: string }> {
  const endpoint = `${(baseUrl || 'https://api.firecrawl.dev').replace(/\/+$/, '')}/v1/scrape`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['markdown'] }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`Firecrawl scrape failed: ${response.status}`)
  const json = await response.json() as any
  const data = json.data || json
  return {
    url: data.metadata?.sourceURL || url,
    markdown: (data.markdown || data.content || '').slice(0, MAX_MARKDOWN_CHARS),
  }
}

export async function performWebFetch(url: string): Promise<{ url: string, markdown: string }> {
  if (!isValidUrl(url))
    throw new Error(`invalid or blocked URL: ${url}`)

  const cached = fetchCache.get(url)
  if (cached && cached.expiresAt > Date.now())
    return { url: cached.url, markdown: cached.markdown }

  const cfg = getFetchConfig()
  let result: { url: string, markdown: string }

  switch (cfg.provider) {
    case 'jina':
      result = await fetchJina(url, cfg.jina?.apiKey || '')
      break
    case 'firecrawl':
      result = await fetchFirecrawl(url, cfg.firecrawl?.apiKey || '', cfg.firecrawl?.baseUrl)
      break
    default:
      result = await fetchBuiltin(url)
  }

  fetchCache.set(url, { markdown: result.markdown, url: result.url, expiresAt: Date.now() + CACHE_TTL_MS })
  logger.info({ url: result.url, mdLen: result.markdown.length, provider: cfg.provider }, '[WEB] fetch completed')
  return result
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  )
}

function decodeDuckDuckGoHref(href: string): string {
  try {
    const u = new URL(href, 'https://duckduckgo.com')
    const uddg = u.searchParams.get('uddg')
    return uddg ? decodeURIComponent(uddg) : u.toString()
  }
  catch {
    return href
  }
}

// ── Search: multi-provider dispatch ──

import type { FetchProviderConfig, SearchProviderEntry, WebToolsConfig } from '../../data/defaults'

export type SearchRef = { title: string, url: string, chunk: string }

/**
 * DuckDuckGo 抓取会返回 202 + 反爬挑战页（"Select all squares containing a duck"）。
 * 该页面上只有 "About DuckDuckGo / lite / here" 几个导航链接，没有 result__a 结果节点。
 * 旧版实现直接跑兜底正则抓全页链接，把这些导航链接当成搜索结果返回给模型，
 * 造成静默失败。这里显式识别拦截页并抛错。
 */
function isDuckDuckGoChallengePage(html: string): boolean {
  if (!html.includes('result__a') && !html.includes('result__snippet')) {
    if (/Select all squares containing a duck|Unfortunately, bots use DuckDuckGo/i.test(html))
      return true
  }
  return false
}

async function searchDuckDuckGo(searchTerm: string, max: number): Promise<SearchRef[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchTerm)}`
  const response = await fetch(searchUrl, {
    headers: { 'user-agent': USER_AGENT, 'accept': 'text/html' },
    redirect: 'follow',
  })
  // 202 属于 2xx，response.ok 为 true，所以必须单独判断反爬状态码。
  if (response.status === 202)
    throw new Error('DDG search blocked by anti-bot challenge (HTTP 202); configure an API search provider instead')
  if (!response.ok)
    throw new Error(`DDG search failed: ${response.status}`)
  const html = await response.text()
  if (isDuckDuckGoChallengePage(html))
    throw new Error('DDG search blocked by anti-bot challenge; configure an API search provider instead')
  const refs: SearchRef[] = []
  const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,1200}?(?:<a[^>]+class="result__snippet"[^>]*>|<div[^>]+class="result__snippet"[^>]*>)([\s\S]*?)(?:<\/a>|<\/div>)/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) && refs.length < max) {
    const href = decodeDuckDuckGoHref(match[1])
    const title = stripTags(match[2])
    const chunk = stripTags(match[3]).slice(0, 400)
    if (title && href)
      refs.push({ title, url: href, chunk })
  }
  return refs
}

async function searchExa(apiKey: string, searchTerm: string, max: number): Promise<SearchRef[]> {
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query: searchTerm, numResults: max, contents: { highlights: true } }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok)
    throw new Error(`Exa search failed: ${res.status}`)
  const json = await res.json() as any
  return (json.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    chunk: r.highlights?.join('\n') || r.summary || r.text?.slice(0, 1000) || '',
  })).filter((r: SearchRef) => r.title && r.url)
}

async function searchTavily(apiKey: string, searchTerm: string, max: number, baseUrl?: string): Promise<SearchRef[]> {
  const endpoint = `${(baseUrl || 'https://api.tavily.com').replace(/\/+$/, '')}/search`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query: searchTerm, max_results: max }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok)
    throw new Error(`Tavily search failed: ${res.status}`)
  const json = await res.json() as any
  return (json.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    chunk: (r.content || '').slice(0, 1000),
  })).filter((r: SearchRef) => r.title && r.url)
}

async function searchBrave(apiKey: string, searchTerm: string, max: number): Promise<SearchRef[]> {
  const params = new URLSearchParams({ q: searchTerm, count: String(max), extra_snippets: '1' })
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok)
    throw new Error(`Brave search failed: ${res.status}`)
  const json = await res.json() as any
  return (json.web?.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    chunk: [r.description, ...(r.extra_snippets || [])].filter(Boolean).join('\n').slice(0, 1000),
  })).filter((r: SearchRef) => r.title && r.url)
}

async function searchJina(apiKey: string, searchTerm: string, max: number): Promise<SearchRef[]> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  }
  if (apiKey)
    headers.Authorization = `Bearer ${apiKey}`
  headers['X-Respond-With'] = 'no-content'

  const response = await fetch('https://s.jina.ai/', {
    method: 'POST',
    headers,
    body: JSON.stringify({ q: searchTerm, num: max }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok)
    throw new Error(`Jina search failed: ${response.status}`)
  const json = await response.json() as any
  return (json.data || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    chunk: (r.description || r.content || '').slice(0, 1000),
  })).filter((r: SearchRef) => r.title && r.url)
}

async function searchFirecrawl(apiKey: string, searchTerm: string, max: number, baseUrl?: string): Promise<SearchRef[]> {
  const endpoint = `${(baseUrl || 'https://api.firecrawl.dev').replace(/\/+$/, '')}/v1/search`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: searchTerm, limit: max }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok)
    throw new Error(`Firecrawl search failed: ${response.status}`)
  const json = await response.json() as any
  return (json.data || []).map((r: any) => ({
    title: r.title || r.metadata?.title || '',
    url: r.url || '',
    chunk: (r.markdown || r.content || r.description || '').slice(0, 1000),
  })).filter((r: SearchRef) => r.title && r.url)
}

async function searchWithProvider(provider: SearchProviderEntry, searchTerm: string, max: number): Promise<SearchRef[]> {
  switch (provider.type) {
    case 'duckduckgo': return searchDuckDuckGo(searchTerm, max)
    case 'exa': return searchExa(provider.apiKey!, searchTerm, max)
    case 'tavily': return searchTavily(provider.apiKey!, searchTerm, max, provider.baseUrl)
    case 'brave': return searchBrave(provider.apiKey!, searchTerm, max)
    case 'jina': return searchJina(provider.apiKey || '', searchTerm, max)
    case 'firecrawl': return searchFirecrawl(provider.apiKey!, searchTerm, max, provider.baseUrl)
    default: throw new Error(`unknown search provider: ${provider.type}`)
  }
}

function deduplicateResults(results: SearchRef[], max: number): SearchRef[] {
  const seen = new Set<string>()
  const deduped: SearchRef[] = []
  for (const r of results) {
    try {
      const u = new URL(r.url)
      const key = `${u.hostname}${u.pathname}`
      if (seen.has(key))
        continue
      seen.add(key)
      deduped.push(r)
      if (deduped.length >= max)
        break
    }
    catch {
      deduped.push(r)
    }
  }
  return deduped
}

export async function performWebSearch(searchTerm: string, config?: WebToolsConfig['search']): Promise<SearchRef[]> {
  const cfg = config ?? getSearchConfig()
  const enabled = cfg.providers.filter(p => p.enabled && (p.type === 'duckduckgo' || p.apiKey))
  const allowDdgFallback = cfg.fallbackToDuckDuckGo !== false

  if (enabled.length === 0) {
    if (!allowDdgFallback)
      throw new Error('No search provider configured. Enable one in the Cursor++ panel (Web Tools).')
    return searchDuckDuckGo(searchTerm, cfg.maxResults)
  }

  if (cfg.parallel && enabled.length > 1) {
    const settled = await Promise.allSettled(
      enabled.map(p => searchWithProvider(p, searchTerm, cfg.maxResults)),
    )
    const merged: SearchRef[] = []
    let lastError: unknown = null
    for (const r of settled) {
      if (r.status === 'fulfilled')
        merged.push(...r.value)
      else {
        lastError = r.reason
        logger.warn({ error: (r.reason as Error)?.message }, '[WEB] parallel search provider failed')
      }
    }
    if (merged.length > 0) {
      const deduped = deduplicateResults(merged, cfg.maxResults)
      logger.info({ searchTerm, providers: enabled.length, total: merged.length, deduped: deduped.length }, '[WEB] parallel search completed')
      return deduped
    }
    if (allowDdgFallback) {
      logger.warn('[WEB] all parallel providers failed, fallback to DDG')
      try {
        return await searchDuckDuckGo(searchTerm, cfg.maxResults)
      }
      catch (ddgError) {
        throw new Error(`All search providers failed. Last provider error: ${(lastError as Error)?.message ?? 'unknown'}. DDG fallback: ${(ddgError as Error).message}`)
      }
    }
    throw new Error(`All search providers failed. Last error: ${(lastError as Error)?.message ?? 'unknown'}`)
  }

  const provider = enabled[0]
  try {
    const results = await searchWithProvider(provider, searchTerm, cfg.maxResults)
    logger.info({ searchTerm, provider: provider.type, results: results.length }, '[WEB] search completed')
    return results
  }
  catch (e) {
    const providerError = (e as Error).message
    logger.warn({ provider: provider.type, error: providerError }, '[WEB] primary search failed')
    if (!allowDdgFallback)
      throw new Error(`${provider.type} search failed: ${providerError}`)
    logger.warn({ provider: provider.type }, '[WEB] fallback to DDG')
    try {
      return await searchDuckDuckGo(searchTerm, cfg.maxResults)
    }
    catch (ddgError) {
      throw new Error(`${provider.type} search failed: ${providerError}. DDG fallback also failed: ${(ddgError as Error).message}`)
    }
  }
}

/**
 * 面板"Test connection"按钮用 — 用一条固定查询探活当前配置的 provider。
 *
 * 走的是与真实搜索完全相同的代码路径(searchWithProvider),所以能一并验证:
 * baseUrl 是否可达、apiKey 是否有效、响应结构是否被正确解析。
 * 成功时返回可读的摘要(命中条数 / 耗时 / 实际使用的端点)。
 */
export async function performSearchTest(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
): Promise<string> {
  const provider = {
    id: 'connection-test',
    type: providerType as SearchProviderEntry['type'],
    enabled: true,
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
  } as SearchProviderEntry

  const endpoint = providerType === 'tavily'
    ? `${(baseUrl || 'https://api.tavily.com').replace(/\/+$/, '')}/search`
    : providerType === 'firecrawl'
      ? `${(baseUrl || 'https://api.firecrawl.dev').replace(/\/+$/, '')}/v1/search`
      : `(official ${providerType} endpoint)`

  if (providerType !== 'duckduckgo' && !apiKey)
    throw new Error('API key is empty')

  const startedAt = Date.now()
  const results = await searchWithProvider(provider, 'cursor ide byok test', 3)
  const elapsedMs = Date.now() - startedAt

  if (results.length === 0)
    throw new Error(`Reached ${endpoint} but it returned 0 results — check quota or key scope`)

  return `OK — ${results.length} result(s) in ${elapsedMs}ms via ${endpoint}`
}
