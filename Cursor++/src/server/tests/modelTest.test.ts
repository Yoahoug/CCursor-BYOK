import { describe, expect, it } from 'vitest'
import { classifyTestError, MODEL_TEST_PROMPT } from '../handlers/llm/modelTest'

describe('classifyTestError — 让 UI 能说清下一步做什么', () => {
  it('按语义归类常见失败', () => {
    expect(classifyTestError(new Error('401 Unauthorized'))).toBe('auth')
    expect(classifyTestError(new Error('invalid api key'))).toBe('auth')
    expect(classifyTestError(new Error('429 Too Many Requests'))).toBe('rate-limit')
    expect(classifyTestError(new Error('model_not_found'))).toBe('not-found')
    expect(classifyTestError(new Error('request timed out'))).toBe('timeout')
    expect(classifyTestError(new Error('fetch failed'))).toBe('network')
    expect(classifyTestError(new Error('400 invalid_request_error'))).toBe('protocol')
    expect(classifyTestError(new Error('something odd happened'))).toBe('unknown')
  })

  it('401 不会被更宽泛的 400 规则抢先命中', () => {
    // 顺序敏感：若 400 规则排在前面，"401" 会被归成 protocol，
    // 用户就会去改请求参数，而实际要改的是 API Key。
    expect(classifyTestError(new Error('HTTP 401 from upstream'))).toBe('auth')
    expect(classifyTestError(new Error('HTTP 403 from upstream'))).toBe('auth')
  })

  it('404 与 429 各自独立归类，不互相串味', () => {
    expect(classifyTestError(new Error('HTTP 404'))).toBe('not-found')
    expect(classifyTestError(new Error('HTTP 429'))).toBe('rate-limit')
  })

  it('网络层错误的常见形态都能识别', () => {
    expect(classifyTestError(new Error('connect ECONNREFUSED 127.0.0.1:8080'))).toBe('network')
    expect(classifyTestError(new Error('getaddrinfo ENOTFOUND relay.example.com'))).toBe('network')
    expect(classifyTestError(new Error('self-signed certificate in certificate chain'))).toBe('network')
  })

  it('非 Error 输入也能处理而不是抛异常', () => {
    expect(classifyTestError('ECONNREFUSED')).toBe('network')
    expect(classifyTestError({ message: 'opaque' })).toBe('unknown')
    expect(classifyTestError(undefined)).toBe('unknown')
    expect(classifyTestError(null)).toBe('unknown')
  })
})

describe('模型测试提示词 MODEL_TEST_PROMPT —— 为测量而设计', () => {
  it('要求固定长度的输出，否则 tokens/s 没有可比性', () => {
    // 纯 "ping" 只有一两个 token，算出来的速度会被首字延迟完全淹没。
    // 这条断言是为了防止有人为了"看起来简洁"把提示词改短。
    expect(MODEL_TEST_PROMPT).toContain('1 through 120')
    expect(MODEL_TEST_PROMPT).toMatch(/no explanation/i)
  })
})
