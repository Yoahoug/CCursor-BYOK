import { describe, expect, it } from 'vitest'
import { performWebFetch } from '../handlers/agent/web'

// 真实网络探活 — 需要 ~/.ccursor/web-tools.json 里配好 Tavily key。
// 默认跳过，仅在 WEBFETCH_LIVE=1 时运行。
const live = process.env.WEBFETCH_LIVE === '1'

describe.runIf(live)('live tavily fetch against linux.do', () => {
  it('fetches a page that the builtin fetcher cannot reach', async () => {
    const result = await performWebFetch('https://linux.do/t/topic/1957183.json?page=1')
    console.log('URL:', result.url)
    console.log('LEN:', result.markdown.length)
    console.log('HEAD:\n', result.markdown.slice(0, 800))
    expect(result.markdown.length).toBeGreaterThan(1000)
  }, 60_000)

  it('fetches a single post page', async () => {
    const result = await performWebFetch('https://linux.do/t/topic/1957183/1912')
    console.log('URL:', result.url)
    console.log('LEN:', result.markdown.length)
    console.log('HEAD:\n', result.markdown.slice(0, 500))
    expect(result.markdown.length).toBeGreaterThan(500)
  }, 60_000)
})
