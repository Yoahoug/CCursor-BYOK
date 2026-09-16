import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * WebFetch 的**失败分支**必须可见 —— 这是 0.0.16 的核心修复方向。
 *
 * 该版本把「抓取失败时静默返回垃圾数据」改成「抛出带 provider 名与原因的错误」。
 * 这组测试把那条契约钉住：任何失败路径都不允许返回空 markdown 或不含原因的
 * 成功结果。
 *
 * 全部用 stub 掉的 fetch，不触网。
 */

function mockWebTools(options: { provider: 'builtin' | 'tavily', apiKey?: string }) {
  vi.doMock('../config/searchConfigStore', () => ({
    getSearchConfig: () => ({
      providers: [
        { id: 'default-tavily', type: 'tavily', enabled: true, apiKey: options.apiKey ?? '' },
        { id: 'default-ddg', type: 'duckduckgo', enabled: false },
      ],
      parallel: false,
      maxResults: 10,
      fallbackToDuckDuckGo: true,
    }),
    getFetchConfig: () => ({ provider: options.provider }),
  }))
}

afterEach(() => {
  vi.doUnmock('../config/searchConfigStore')
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('tavily 抓取的失败分支不可静默', () => {
  it('tavily 返回 401 时抛出：内置回退也失败 → 两个原因都要出现', async () => {
    mockWebTools({ provider: 'tavily', apiKey: 'bad-key' })
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/extract')) {
        return {
          ok: false,
          status: 401,
          text: async (): Promise<string> => '{"detail":{"error":"Unauthorized"}}',
          json: async () => ({}),
        }
      }
      // 内置回退：目标站点拒绝
      return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        url: String(url),
        headers: { get: () => 'text/html' },
        text: async (): Promise<string> => '',
        json: async () => ({}),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { performWebFetch } = await import('../handlers/agent/web')
    const error = await performWebFetch('https://blocked.example/page').then(
      () => null,
      (e: unknown) => e as Error,
    )

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toMatch(/401/)
    expect(error!.message).toMatch(/403/)
    expect(error!.message).toMatch(/Built-in fallback also failed/)
  })

  it('tavily 返回 200 但 results 为空时抛错，而不是静默返回空正文', async () => {
    mockWebTools({ provider: 'tavily', apiKey: 'k' })
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/extract')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [], failed_results: [{ error: 'Failed to fetch url' }] }),
          text: async (): Promise<string> => '',
        }
      }
      return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        url: String(url),
        headers: { get: () => 'text/html' },
        text: async (): Promise<string> => '',
        json: async () => ({}),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { performWebFetch } = await import('../handlers/agent/web')
    // 上游明确报了失败原因时，要把原因带出来而不是只给一句 generic error
    await expect(performWebFetch('https://example.com/')).rejects.toThrow(/returned no content: Failed to fetch url/)
  })
})

describe('内置抓取的失败分支不可静默', () => {
  it('非 2xx 抛出带状态码的错误', async () => {
    mockWebTools({ provider: 'builtin' })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      url: 'https://example.com/',
      headers: { get: () => 'text/html' },
      text: async () => '',
    })))

    const { performWebFetch } = await import('../handlers/agent/web')
    await expect(performWebFetch('https://example.com/')).rejects.toThrow(/HTTP 500/)
  })

  it('二进制内容类型被拒绝，不会把乱码当正文返回', async () => {
    mockWebTools({ provider: 'builtin' })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/file.pdf',
      headers: { get: (name: string) => (name === 'content-type' ? 'application/pdf' : null) },
      text: async () => '%PDF-1.7 binary',
    })))

    const { performWebFetch } = await import('../handlers/agent/web')
    await expect(performWebFetch('https://example.com/file.pdf')).rejects.toThrow(/Unsupported content type/)
  })

  it('超长响应被拒绝，不会返回截断后的半截内容', async () => {
    mockWebTools({ provider: 'builtin' })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/huge',
      headers: { get: (name: string) => (name === 'content-type' ? 'text/plain' : name === 'content-length' ? String(5 * 1024 * 1024) : null) },
      text: async () => 'x',
    })))

    const { performWebFetch } = await import('../handlers/agent/web')
    await expect(performWebFetch('https://example.com/huge')).rejects.toThrow(/Response too large/)
  })

  it('content-type 是 JSON 但正文不是合法 JSON 时 → 降级为 code block，仍可见正文', async () => {
    mockWebTools({ provider: 'builtin' })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/data',
      headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
      text: async () => 'not-json-at-all',
    })))

    const { performWebFetch } = await import('../handlers/agent/web')
    const result = await performWebFetch('https://example.com/data')

    expect(result.markdown).toContain('not-json-at-all')
  })
})
