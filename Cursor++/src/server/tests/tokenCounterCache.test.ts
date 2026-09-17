import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import { afterEach, describe, expect, it } from 'vitest'
import {
  countTokens,
  getTokenCountCacheSizeForTests,
  resetTokenCountCacheForTests,
} from '../handlers/agent/tokenCounter'

/**
 * countTokens 的记忆化必须**逐值等价** —— 缓存只是跳过重复计算，
 * 绝不能改变任何一个返回值。这里直接拿 gpt-tokenizer 的原始 encode 做对照。
 */

/** 直接调用底层 encode，不经过任何缓存 —— 作为唯一的真值来源 */
function uncachedCount(text: string): number {
  return encode(text, { allowedSpecial: 'all' }).length
}

afterEach(() => {
  resetTokenCountCacheForTests()
})

describe('countTokens 缓存等价性', () => {
  it('缓存命中与未命中给出完全相同的值', () => {
    const samples = [
      'hello world',
      '你好，世界。这是一段中文文本，用来验证多字节字符的编码一致性。',
      'function foo() { return 42 }',
      'A'.repeat(5000),
      '😀🎉🚀 emoji 与代理对混排',
      '<user_query>\n测试内容 with mixed ASCII\n</user_query>',
      '\n\n\n',
      '   leading and trailing spaces   ',
      'tab\tseparated\tvalues',
      'special tokens: <|endoftext|> and <|fim_prefix|>',
    ]

    for (const sample of samples) {
      resetTokenCountCacheForTests()
      const first = countTokens(sample) // cold
      const second = countTokens(sample) // warm
      const truth = uncachedCount(sample)

      expect(first).toBe(truth)
      expect(second).toBe(truth)
    }
  })

  it('空串始终是 0，且不进缓存', () => {
    resetTokenCountCacheForTests()
    expect(countTokens('')).toBe(0)
    expect(getTokenCountCacheSizeForTests()).toBe(0)
  })

  it('长文本在缓存前后一致', () => {
    const long = 'The quick brown fox jumps over the lazy dog. '.repeat(2000)
    resetTokenCountCacheForTests()
    const cold = countTokens(long)
    const warm = countTokens(long)
    expect(cold).toBe(uncachedCount(long))
    expect(warm).toBe(cold)
  })

  it('缓存有上限，不会随输入无限增长', () => {
    resetTokenCountCacheForTests()
    for (let i = 0; i < 2000; i++)
      countTokens(`distinct input ${i}`)
    expect(getTokenCountCacheSizeForTests()).toBeLessThanOrEqual(500)
  })

  it('清空缓存后重新计算仍然正确（淘汰不会破坏结果）', () => {
    const text = 'eviction safety check'
    const expected = uncachedCount(text)
    resetTokenCountCacheForTests()
    for (let i = 0; i < 600; i++) {
      countTokens(text)
      // 中间穿插大量新文本，把 text 挤出缓存
      countTokens(`filler ${i}`)
    }
    expect(countTokens(text)).toBe(expected)
  })
})
