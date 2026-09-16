import type { SearchProviderEntry, WebToolsConfig } from '../../data/defaults'
import { getFetchConfig, getSearchConfig } from '../../config/searchConfigStore'
import { logger } from '../../logger'

// ── Search: multi-provider dispatch ──

import { loadSupermarkdown, supermarkdownUnavailableMessage } from './supermarkdown'

const FETCH_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_MARKDOWN_CHARS = 100_000
const CACHE_TTL_MS = 5 * 60_000
const BINARY_TYPES = /^(image|video|audio|application\/pdf|application\/octet-stream|application\/zip)/
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/3.4 Chrome/131.0.0.0 Safari/537.36'

const EXCLUDE_SELECTORS = [
  'nav',
  'header',
  'footer',
  'aside',
  '.sidebar',
  '.navigation',
  '.menu',
  '.nav',
  '.advertisement',
  '.ads',
  '#ads',
  '.ad-container',
  '.related-posts',
  '.comments',
  '.social-share',
  'script',
  'style',
  'noscript',
  'iframe',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
]

interface CacheEntry { markdown: string, url: string, expiresAt: number }
const fetchCache = new Map<string, CacheEntry>()

/**
 * 私网 / 特殊用途 IPv4 段。
 *
 * 覆盖 127.0.0.0/8（整个回环段，不只是 127.0.0.1）、10/8、172.16/12、
 * 192.168/16、169.254/16（链路本地）、0.0.0.0/8（"本机"）、以及
 * 100.64/10（运营商级 NAT）。
 */
const PRIVATE_IPV4_PATTERN = /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(?:1[6-9]|2\d|3[01])\.)/

/**
 * 归一化主机名，使各种等价写法落到同一个可比较的形式。
 *
 * `new URL()` 会做一部分归一化（`0x7f000001` / `2130706433` / `127.1` 都会
 * 变成 `127.0.0.1`），但**IPv6 会带着方括号返回**（`[::1]`），而尾点
 * （`localhost.`）也会保留。原实现直接拿 hostname 与 `'::1'` 比较，
 * 因此 `http://[::1]:8080/` 这类写法能整个绕过守卫。
 */
function normalizeHostname(hostname: string): string {
  let host = hostname.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']'))
    host = host.slice(1, -1)
  // 根区的绝对写法（localhost.）与 localhost 是同一台机器
  while (host.endsWith('.'))
    host = host.slice(0, -1)
  return host
}

/**
 * 该主机名是否是一个 IPv4 字面量。
 *
 * 只有字面量才该参与网段判断 —— 原实现直接对 hostname 跑 `/^(10\.|127\.)/`，
 * 于是 `10.example.com`、`127.example.org` 这类**普通域名**会被误判为内网。
 * 真实 IP 字面量此时已被 URL 解析器归一到点分十进制，所以这里只需做形状校验。
 */
function isIpv4Literal(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4)
    return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part))
      return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

/**
 * 把 IPv4-mapped IPv6（`::ffff:7f00:1`）还原成点分十进制。
 *
 * URL 解析器会把它规范成十六进制形式，因此 `::ffff:127.0.0.1` 看一眼
 * 认不出是回环地址 —— 必须还原后再走同一套 IPv4 判断。
 */
function ipv4FromMappedIpv6(host: string): string | null {
  // ::ffff:a.b.c.d 与 ::ffff:xxxx:xxxx 两种形态都会出现
  const dotted = host.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (dotted)
    return dotted[1]
  const hex = host.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!hex)
    return null
  const high = Number.parseInt(hex[1], 16)
  const low = Number.parseInt(hex[2], 16)
  return [high >> 8, high & 0xFF, low >> 8, low & 0xFF].join('.')
}

/** IPv6 里的私网 / 特殊用途段：回环、未指定、ULA(fc00::/7)、链路本地(fe80::/10) */
function isPrivateIpv6(host: string): boolean {
  if (host === '::1' || host === '::')
    return true
  // fc00::/7 → 首字节 fc 或 fd；fe80::/10 → fe80–febf
  if (/^f[cd][0-9a-f]{0,2}:/.test(host))
    return true
  if (/^fe[89ab][0-9a-f]?:/.test(host))
    return true
  return false
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:')
      return false
    const host = normalizeHostname(u.hostname)
    if (!host)
      return false
    if (host === 'localhost' || host === '0.0.0.0' || host === '::' || host === '::1')
      return false
    // 只有真正的 IPv4 字面量才做网段判断，避免把 10.example.com 这类域名误杀
    if (isIpv4Literal(host)) {
      if (PRIVATE_IPV4_PATTERN.test(host))
        return false
    }
    const mappedIpv4 = ipv4FromMappedIpv6(host)
    if (mappedIpv4 && isIpv4Literal(mappedIpv4) && PRIVATE_IPV4_PATTERN.test(mappedIpv4))
      return false
    if (isPrivateIpv6(host))
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
      throw new Error(`Unsupported content type: ${contentType}`)
    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES)
      throw new Error(`Response too large: ${contentLength} bytes`)
    const text = await response.text()
    if (text.length > MAX_RESPONSE_BYTES)
      throw new Error(`Response body too large: ${text.length} bytes`)
    const finalUrl = response.url || url
    let markdown: string
    if (contentType.includes('text/html') || /^<!doctype html/i.test(text) || /<html[\s>]/i.test(text)) {
      markdown = htmlToMarkdown(text, finalUrl)
    }
    else if (contentType.includes('application/json')) {
      try { markdown = `# ${finalUrl}\n\n\`\`\`json\n${JSON.stringify(JSON.parse(text), null, 2).slice(0, MAX_MARKDOWN_CHARS)}\n\`\`\`` }
      catch { markdown = `# ${finalUrl}\n\n\`\`\`\n${text.slice(0, MAX_MARKDOWN_CHARS)}\n\`\`\`` }
    }
    else { markdown = `# ${finalUrl}\n\n${text.slice(0, MAX_MARKDOWN_CHARS)}` }
    return { url: finalUrl, markdown }
  }
  finally { clearTimeout(timer) }
}

/**
 * Discourse 论坛的 topic JSON 响应 → 可读 markdown。
 *
 * Tavily 抓取 `https://<forum>/t/topic/<id>.json` 时，`raw_content` 是未经加工的
 * 原始 JSON（一页 20 帖约 90-135KB）。直接透传有两个问题：
 *   1. 超过 MAX_MARKDOWN_CHARS 被截断，模型只看到前几帖 + 一堆转义字符；
 *   2. `cooked` 字段里全是 HTML 标签与转义实体，可读性差。
 * 这里把扁平的 post 列表还原成带楼层号的 markdown，顺带丢掉 avatar / 时间戳等
 * 对理解内容无用的元数据，让同样的字符预算能装下更多正文。
 */
function formatDiscourseTopicJson(raw: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object')
    return null

  // 这是外部服务返回的 JSON：逐层守卫而不是断言，避免上游改结构时
  // 在深层属性访问上抛 TypeError（那会被上层当成抓取失败）。
  const topic = parsed as Record<string, unknown>
  const postStream = topic.post_stream as Record<string, unknown> | undefined
  const posts = postStream?.posts
  if (!Array.isArray(posts) || posts.length === 0)
    return null

  const title = typeof topic.title === 'string' ? topic.title : ''
  const lines: string[] = []
  if (title)
    lines.push(`# ${title}`, '')

  for (const entry of posts) {
    const post = entry as Record<string, unknown>
    const postNumber = post.post_number ?? '?'
    const author = (typeof post.username === 'string' && post.username)
      || (typeof post.name === 'string' && post.name)
      || 'unknown'
    const createdAt = typeof post.created_at === 'string' ? post.created_at.slice(0, 10) : ''
    lines.push(`## #${postNumber} — ${author}${createdAt ? ` (${createdAt})` : ''}`)

    // `raw` 是作者原始 markdown，优先用它；老帖 / 已编辑帖可能只有 `cooked` HTML。
    const rawBody = typeof post.raw === 'string' ? post.raw : ''
    const body = rawBody.trim() ? rawBody : stripHtmlToText(String(post.cooked ?? ''))
    lines.push(body.trim(), '')
  }

  return lines.join('\n').trim()
}

/** `cooked` HTML → 纯文本：保留段落与换行，去掉标签与常见实体 */
function stripHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\n{3,}/g, '\n\n')
}

/**
 * Tavily Extract 抓取。
 *
 * 与内置抓取的关键差异：请求从 Tavily 的服务端出口发出，因此能拿到
 * Cloudflare 挑战页后面的内容（linux.do 这类站点内置抓取必定 403）。
 *
 * 必须显式指定 `extract_depth: 'advanced'` —— basic 档位对这类受保护站点
 * 会直接返回 `Failed to fetch url`（实测 linux.do 稳定复现）。
 */
async function fetchTavily(url: string, apiKey: string, baseUrl?: string): Promise<{ url: string, markdown: string }> {
  const endpoint = `${(baseUrl || 'https://api.tavily.com').replace(/\/+$/, '')}/extract`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ urls: [url], extract_depth: 'advanced' }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Tavily extract failed: ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`)
  }

  const json = await response.json() as any
  const firstResult = Array.isArray(json?.results) ? json.results[0] : undefined
  if (!firstResult) {
    const failure = Array.isArray(json?.failed_results) ? json.failed_results[0] : undefined
    throw new Error(`Tavily extract returned no content${failure?.error ? `: ${failure.error}` : ''}`)
  }

  const raw = String(firstResult.raw_content ?? '')
  const resolvedUrl = String(firstResult.url || url)
  const body = formatDiscourseTopicJson(raw) ?? raw
  return { url: resolvedUrl, markdown: body.slice(0, MAX_MARKDOWN_CHARS) }
}

/**
 * 取 Tavily 的 key / baseUrl —— 复用 Search 标签页里 Tavily 那一项的配置。
 *
 * 抓取与搜索是同一个 Tavily 账号，分开配置会让用户重复填一遍 key，
 * 也容易两边填成不同的 key。没配或未启用时返回 null，由调用方回退内置抓取。
 */
function resolveTavilyCredentials(): { apiKey: string, baseUrl?: string } | null {
  const tavilyEntry = getSearchConfig().providers?.find(p => p.type === 'tavily')
  const apiKey = tavilyEntry?.apiKey?.trim()
  if (!apiKey)
    return null
  return { apiKey, baseUrl: tavilyEntry?.baseUrl?.trim() || undefined }
}

export async function performWebFetch(url: string): Promise<{ url: string, markdown: string }> {
  if (!isValidUrl(url))
    throw new Error(`Invalid or blocked URL: ${url}`)

  const cached = fetchCache.get(url)
  if (cached && cached.expiresAt > Date.now())
    return { url: cached.url, markdown: cached.markdown }

  const cfg = getFetchConfig()
  let result: { url: string, markdown: string }

  switch (cfg.provider) {
    case 'tavily': {
      const credentials = resolveTavilyCredentials()
      if (!credentials) {
        // 选了 Tavily 却还没填 key：回退内置抓取而不是直接报错，
        // 否则用户在面板里切到 Tavily 后连普通站点都抓不了。
        logger.warn({ url }, '[WEB] fetch provider is tavily but no Tavily API key configured; falling back to builtin')
        result = await fetchBuiltin(url)
        break
      }
      try {
        result = await fetchTavily(url, credentials.apiKey, credentials.baseUrl)
      }
      catch (tavilyError) {
        // Tavily 失败时回退内置抓取：Tavily 有配额限制，且对小站点偶尔抽风，
        // 而内置抓取对普通站点（无 CF 防护）成功率很高。
        //
        // 但回退本身会掩盖真实故障：自建中转挂掉时，用户只会看到内置抓取的 403，
        // 误以为"Tavily 没生效"。所以回退也失败时把两个原因都报出来。
        const tavilyMessage = tavilyError instanceof Error ? tavilyError.message : String(tavilyError)
        logger.warn({ url, error: tavilyMessage }, '[WEB] tavily fetch failed; falling back to builtin')
        try {
          result = await fetchBuiltin(url)
        }
        catch (builtinError) {
          const builtinMessage = builtinError instanceof Error ? builtinError.message : String(builtinError)
          throw new Error(`Tavily extract failed: ${tavilyMessage}. Built-in fallback also failed: ${builtinMessage}`)
        }
      }
      break
    }
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

export interface SearchRef { title: string, url: string, chunk: string }

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
    default: throw new Error(`Unknown search provider: ${provider.type}`)
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
      throw new Error('No search provider is enabled. Enable one under "Web Tools" in the Cursor++ panel.')
    return searchDuckDuckGo(searchTerm, cfg.maxResults)
  }

  if (cfg.parallel && enabled.length > 1) {
    const settled = await Promise.allSettled(
      enabled.map(p => searchWithProvider(p, searchTerm, cfg.maxResults)),
    )
    const merged: SearchRef[] = []
    let lastError: unknown = null
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        merged.push(...r.value)
      }
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

/**
 * 面板 Fetch 标签页"Test connection"用 — 验证 Tavily 抓取链路。
 *
 * 刻意用 example.com 而不是随机站点：这是一个稳定、无 CF 防护、内容极小的目标，
 * 探测结果只反映"key + baseUrl 是否可用"，不会因为目标站点抽风而误报失败。
 * 走的是与真实抓取同一条 fetchTavily 路径（含 advanced 深度参数）。
 */
export async function performFetchTest(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
): Promise<string> {
  if (providerType === 'builtin') {
    const loaded = loadSupermarkdown()
    if (!loaded.ok)
      throw new Error(supermarkdownUnavailableMessage(loaded.error))
    return 'OK — built-in HTML→Markdown converter available'
  }

  if (providerType !== 'tavily')
    throw new Error(`Unknown fetch provider: ${providerType}`)
  if (!apiKey)
    throw new Error('API key is empty — Tavily fetch reuses the key from the Search tab')

  const endpoint = `${(baseUrl || 'https://api.tavily.com').replace(/\/+$/, '')}/extract`
  const startedAt = Date.now()
  const probeUrl = 'https://example.com'
  const result = await fetchTavily(probeUrl, apiKey, baseUrl)
  const elapsedMs = Date.now() - startedAt

  // fetchTavily 内部会做 Discourse JSON 解析，普通页面原样返回；
  // 走到这里只要拿到非空正文就算链路通。
  if (!result.markdown.trim())
    throw new Error(`Reached ${endpoint} but it returned empty content — check quota or key scope`)

  return `OK — ${result.markdown.length} chars in ${elapsedMs}ms via ${endpoint}`
}
