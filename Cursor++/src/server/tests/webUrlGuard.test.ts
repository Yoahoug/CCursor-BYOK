import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * WebFetch 的 URL 守卫 —— 阻断本机与内网目标。
 *
 * 背景：`new URL()` 会归一化一部分写法（`0x7f000001`、`2130706433`、`127.1`
 * 都变成 `127.0.0.1`），但**IPv6 主机名会带方括号返回**（`[::1]`），尾点
 * （`localhost.`）也会保留。旧实现拿 hostname 直接与 `'::1'` 比较，
 * 于是 `http://[::1]:8080/` 这类写法能整个绕过守卫。
 *
 * 这里全部用 stub 掉的 fetch，确认请求**根本不会发出**。
 */

function mockWebTools() {
  vi.doMock('../config/searchConfigStore', () => ({
    getSearchConfig: () => ({
      providers: [{ id: 'default-tavily', type: 'tavily', enabled: true, apiKey: 'tvly-test' }],
      parallel: false,
      maxResults: 10,
      fallbackToDuckDuckGo: true,
    }),
    getFetchConfig: () => ({ provider: 'tavily' }),
  }))
}

const BLOCKED_TARGETS = [
  // IPv4 —— 归一化后应被识别
  'http://127.0.0.1/',
  'http://127.0.0.1:8080/',
  'http://127.1/',
  'http://0x7f000001/',
  'http://2130706433/',
  'http://10.0.0.5/',
  'http://172.16.0.1/',
  'http://172.31.255.254/',
  'http://192.168.1.1/',
  'http://169.254.169.254/',
  'http://0.0.0.0/',
  // IPv6 —— 回归重点：这些在旧实现下全部漏网
  'http://[::1]/',
  'http://[::1]:8080/',
  'http://[0:0:0:0:0:0:0:1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[::ffff:7f00:1]/',
  'http://[fd00::1]/',
  'http://[fc00::1]/',
  'http://[fe80::1]/',
  // 主机名
  'http://localhost/',
  'http://localhost./',
  'http://LOCALHOST/',
]

const ALLOWED_TARGETS = [
  'https://example.com/',
  'https://api.tavily.com/extract',
  'http://localhost.example.com/',
  'http://10.example.com/',
  'http://notlocal/',
  'http://[2606:4700::1111]/', // 真实公网 IPv6（Cloudflare DNS）
  'http://8.8.8.8/',
]

afterEach(() => {
  vi.doUnmock('../config/searchConfigStore')
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('isValidUrl guard (via performWebFetch)', () => {
  it.each(BLOCKED_TARGETS)('refuses to fetch %s', async (target) => {
    mockWebTools()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { performWebFetch } = await import('../handlers/agent/web')
    await expect(performWebFetch(target)).rejects.toThrow('Invalid or blocked URL')
    // 关键断言：被拦下的目标绝不能产生任何网络请求
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(ALLOWED_TARGETS)('allows %s to reach the provider', async (target) => {
    mockWebTools()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ url: target, raw_content: 'body' }], failed_results: [] }),
      text: async (): Promise<string> => '',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { performWebFetch } = await import('../handlers/agent/web')
    const result = await performWebFetch(target)

    expect(result.markdown).toBe('body')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
