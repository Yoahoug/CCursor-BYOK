import type { WebToolsConfig } from '../data/defaults'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WEB_TOOLS, normalizeFetchProvider } from '../data/defaults'

const FAKE_TAVILY_KEY = 'tvly-test-key'

function mockWebTools(fetchConfig: WebToolsConfig['fetch'], tavilyApiKey = FAKE_TAVILY_KEY, tavilyBaseUrl?: string) {
  vi.doMock('../config/searchConfigStore', () => ({
    getSearchConfig: () => ({
      providers: [
        { id: 'default-tavily', type: 'tavily', enabled: true, apiKey: tavilyApiKey, baseUrl: tavilyBaseUrl },
        { id: 'default-ddg', type: 'duckduckgo', enabled: false },
      ],
      parallel: false,
      maxResults: 10,
      fallbackToDuckDuckGo: true,
    }),
    getFetchConfig: () => fetchConfig,
  }))
}

function tavilyResponse(rawContent: string, url = 'https://example.com/') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results: [{ url, title: 'Example', raw_content: rawContent }],
      failed_results: [],
    }),
    text: async () => '',
  }
}

afterEach(() => {
  vi.doUnmock('../config/searchConfigStore')
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('normalizeFetchProvider', () => {
  it('keeps the two supported providers', () => {
    expect(normalizeFetchProvider('builtin')).toBe('builtin')
    expect(normalizeFetchProvider('tavily')).toBe('tavily')
  })

  it('maps removed providers back to the default', () => {
    // 老版本 web-tools.json 里可能还留着 jina / firecrawl
    expect(normalizeFetchProvider('jina')).toBe(DEFAULT_WEB_TOOLS.fetch.provider)
    expect(normalizeFetchProvider('firecrawl')).toBe(DEFAULT_WEB_TOOLS.fetch.provider)
  })

  it('falls back to the default for unknown or missing values', () => {
    expect(normalizeFetchProvider(undefined)).toBe(DEFAULT_WEB_TOOLS.fetch.provider)
    expect(normalizeFetchProvider('')).toBe(DEFAULT_WEB_TOOLS.fetch.provider)
    expect(normalizeFetchProvider('nope')).toBe(DEFAULT_WEB_TOOLS.fetch.provider)
  })

  it('defaults to tavily', () => {
    expect(DEFAULT_WEB_TOOLS.fetch.provider).toBe('tavily')
  })
})

describe('performWebFetch with the tavily provider', () => {
  it('requests Tavily extract with advanced depth and the reused search key', async () => {
    mockWebTools({ provider: 'tavily' }, FAKE_TAVILY_KEY, 'https://tavily-mirror.example:8181')
    const fetchMock = vi.fn(async () => tavilyResponse('plain text body'))
    vi.stubGlobal('fetch', fetchMock)

    const { performWebFetch } = await import('../handlers/agent/web')
    const result = await performWebFetch('https://example.com/')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    // baseUrl 复用 search 侧配置，而不是 Tavily 官方地址
    expect(endpoint).toBe('https://tavily-mirror.example:8181/extract')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_TAVILY_KEY}`)

    const body = JSON.parse(String(init.body))
    expect(body.urls).toEqual(['https://example.com/'])
    // basic 档位对 Cloudflare 站点会返回 "Failed to fetch url"
    expect(body.extract_depth).toBe('advanced')

    expect(result.markdown).toBe('plain text body')
  })

  it('falls back to the official Tavily endpoint when baseUrl is not set', async () => {
    mockWebTools({ provider: 'tavily' })
    const fetchMock = vi.fn(async () => tavilyResponse('body'))
    vi.stubGlobal('fetch', fetchMock)

    const { performWebFetch } = await import('../handlers/agent/web')
    await performWebFetch('https://example.com/')

    const [endpoint] = fetchMock.mock.calls[0] as unknown as [string]
    expect(endpoint).toBe('https://api.tavily.com/extract')
  })

  it('converts a Discourse topic JSON payload into readable per-post markdown', async () => {
    const discoursePayload = JSON.stringify({
      title: 'Test Topic',
      post_stream: {
        posts: [
          { post_number: 1, username: 'alice', created_at: '2026-01-02T03:04:05.000Z', raw: 'first **post**' },
          { post_number: 2, username: 'bob', created_at: '2026-01-03T00:00:00.000Z', cooked: '<p>second<br>post</p>' },
        ],
      },
    })
    mockWebTools({ provider: 'tavily' })
    vi.stubGlobal('fetch', vi.fn(async () => tavilyResponse(discoursePayload, 'https://forum.example/t/topic/1.json')))

    const { performWebFetch } = await import('../handlers/agent/web')
    const result = await performWebFetch('https://forum.example/t/topic/1.json')

    expect(result.markdown).toContain('# Test Topic')
    expect(result.markdown).toContain('## #1 — alice (2026-01-02)')
    expect(result.markdown).toContain('first **post**')
    expect(result.markdown).toContain('## #2 — bob (2026-01-03)')
    // cooked HTML 被还原成文本，标签不再出现在结果里
    expect(result.markdown).toContain('second')
    expect(result.markdown).not.toContain('<p>')
    expect(result.markdown).not.toContain('post_stream')
  })

  it('passes non-Discourse content through unchanged', async () => {
    mockWebTools({ provider: 'tavily' })
    vi.stubGlobal('fetch', vi.fn(async () => tavilyResponse('{"just":"json"}')))

    const { performWebFetch } = await import('../handlers/agent/web')
    const result = await performWebFetch('https://example.com/data.json')

    expect(result.markdown).toBe('{"just":"json"}')
  })

  it('reports both failures when the Tavily endpoint and the builtin fallback both fail', async () => {
    mockWebTools({ provider: 'tavily' }, FAKE_TAVILY_KEY, 'http://tavily-mirror.internal:8181')
    // Tavily 端点不可达时连接被拒
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/extract'))
        throw new Error('connect ECONNREFUSED 10.0.0.9:8181')
      // 内置回退：目标站点被 Cloudflare 拦
      return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        url: String(url),
        headers: { get: () => 'text/html' },
        text: async () => '',
        json: async () => ({}),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { performWebFetch } = await import('../handlers/agent/web')
    // 两个原因都要出现在报错里，否则自定义 Base URL 配置错误会被误读成"Tavily 没生效"
    await expect(performWebFetch('https://blocked.example/page')).rejects.toThrow(/Tavily extract failed.*ECONNREFUSED.*Built-in fallback also failed.*403/)
  })

  it('surfaces the HTTP status when the Tavily endpoint rejects the request', async () => {
    mockWebTools({ provider: 'tavily' })
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => '{"detail":{"error":"Unauthorized"}}',
      json: async () => ({}),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { performWebFetch } = await import('../handlers/agent/web')
    await expect(performWebFetch('https://example.com/')).rejects.toThrow()
  })

  it('falls back to the builtin fetcher when no Tavily API key is configured', async () => {
    mockWebTools({ provider: 'tavily' }, '')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: { get: () => 'text/plain' },
      text: async () => 'plain body',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { performWebFetch } = await import('../handlers/agent/web')
    const result = await performWebFetch('https://example.com/')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    // 回退到内置抓取：普通 GET，不走 Tavily POST
    expect(endpoint).toBe('https://example.com/')
    expect(init.method).toBeUndefined()
    expect(result.markdown).toContain('plain body')
  })

  it('uses the builtin fetcher when the provider is builtin', async () => {
    mockWebTools({ provider: 'builtin' })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: { get: () => 'text/plain' },
      text: async () => 'builtin body',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { performWebFetch } = await import('../handlers/agent/web')
    const result = await performWebFetch('https://example.com/')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.markdown).toContain('builtin body')
  })
})

describe('isValidUrl guard', () => {
  it('still rejects private and local addresses before reaching any provider', async () => {
    mockWebTools({ provider: 'tavily' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { performWebFetch } = await import('../handlers/agent/web')

    await expect(performWebFetch('http://127.0.0.1:8080/')).rejects.toThrow('Invalid or blocked URL')
    await expect(performWebFetch('http://10.0.0.5/')).rejects.toThrow('Invalid or blocked URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
