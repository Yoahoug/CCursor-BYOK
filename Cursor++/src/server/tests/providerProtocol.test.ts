import type { ProviderType } from '../data/defaults'
import { describe, expect, it } from 'vitest'
import {
  buildProviderBaseUrl,
  buildRequestUrlPreview,
  checkBaseUrlShape,
  defaultProtocolForModel,
  describeProviderType,
  familyOf,
  PROTOCOL_FAMILY_OPTIONS,
  protocolSelectionOf,
  providerTypeOf,
  suggestProtocol,
} from '../../shared/providerProtocol'
import { isProviderType } from '../data/defaults'

const ALL_PROVIDER_TYPES: ProviderType[] = ['anthropic', 'openai-chat', 'openai-responses', 'gemini']

describe('两级协议映射', () => {
  it('providerTypeOf 与 protocolSelectionOf 互为逆运算', () => {
    for (const type of ALL_PROVIDER_TYPES) {
      const selection = protocolSelectionOf(type)
      expect(providerTypeOf(selection.family, selection.openaiEndpoint)).toBe(type)
    }
  })

  it('分段控件的标签必须是单个词 —— 含空格会被折成两行', () => {
    // 三档并排时每档只有 ~60px。曾经用过 "Anthropic Messages" / "Google Gemini"，
    // 结果前两档折行、三个按钮高低不齐。这条守卫防止再次写回长名。
    for (const option of PROTOCOL_FAMILY_OPTIONS) {
      expect(option.label).not.toMatch(/\s/)
      expect(option.label.length).toBeLessThanOrEqual(10)
      // 全称与路径说明应该在 hint 里（悬浮可见），而不是靠标签承载
      expect(option.hint).toBeTruthy()
    }
  })

  it('每个 hint 都写清最终路径 —— 地址是前缀，版本段由协议补全', () => {
    const hints = Object.fromEntries(PROTOCOL_FAMILY_OPTIONS.map(o => [o.value, o.hint]))
    expect(hints.anthropic).toContain('/v1/messages')
    // OpenAI 那条曾漏掉 /v1（改造前路径确实是 /chat/completions，现在不是了）
    expect(hints.openai).toContain('/v1/chat/completions')
    expect(hints.gemini).toContain('/v1beta/')
  })

  it('openai-chat 与 openai-responses 归入同一个协议家族', () => {
    expect(familyOf('openai-chat')).toBe('openai')
    expect(familyOf('openai-responses')).toBe('openai')
    expect(familyOf('anthropic')).toBe('anthropic')
    expect(familyOf('gemini')).toBe('gemini')
  })

  it('非 OpenAI 系的端点字段固定为 chat 占位 —— 它只对 OpenAI 系有意义', () => {
    expect(protocolSelectionOf('gemini').openaiEndpoint).toBe('chat')
    expect(protocolSelectionOf('anthropic').openaiEndpoint).toBe('chat')
  })

  it('describeProviderType 给出人类可读名称而非内部枚举名', () => {
    expect(describeProviderType('anthropic')).toBe('Anthropic Messages')
    expect(describeProviderType('openai-chat')).toBe('OpenAI · Chat Completions API')
    expect(describeProviderType('openai-responses')).toBe('OpenAI · Responses API')
    expect(describeProviderType('gemini')).toBe('Google Gemini')
  })
})

describe('buildProviderBaseUrl — 地址是前缀，版本段归协议', () => {
  it('同一个前缀在两家协议下得到各自正确的 baseURL', () => {
    // 这是"一个中转站一个地址"能同时喂对 Anthropic 与 OpenAI 的唯一解法：
    // Anthropic SDK 自己拼 /v1/messages（baseURL 不该带），
    // OpenAI SDK 只拼 /chat/completions（baseURL 必须带）。
    const prefix = 'http://10.66.66.66:8317'
    expect(buildProviderBaseUrl('anthropic', prefix)).toBe('http://10.66.66.66:8317')
    expect(buildProviderBaseUrl('openai-chat', prefix)).toBe('http://10.66.66.66:8317/v1')
    expect(buildProviderBaseUrl('openai-responses', prefix)).toBe('http://10.66.66.66:8317/v1')
    expect(buildProviderBaseUrl('gemini', prefix)).toBe('http://10.66.66.66:8317')
  })

  it('前缀里已经带着该版本段就不再重复', () => {
    expect(buildProviderBaseUrl('openai-chat', 'https://relay.example.com/v1'))
      .toBe('https://relay.example.com/v1')
    expect(buildProviderBaseUrl('openai-chat', 'https://relay.example.com/v1/'))
      .toBe('https://relay.example.com/v1')
  })

  it('不该带版本段的协议会把多余的版本段剥掉 —— 顺手修掉老配置的 /v1/v1', () => {
    expect(buildProviderBaseUrl('anthropic', 'https://relay.example.com/v1'))
      .toBe('https://relay.example.com')
    expect(buildProviderBaseUrl('gemini', 'https://relay.example.com/v1beta'))
      .toBe('https://relay.example.com')
  })

  it('只剥恰好等于该协议版本段的尾段，不误伤 /v2、/anthropic 这类正常路径', () => {
    expect(buildProviderBaseUrl('anthropic', 'https://api.deepseek.com/anthropic'))
      .toBe('https://api.deepseek.com/anthropic')
    expect(buildProviderBaseUrl('anthropic', 'https://relay.example.com/api/v2'))
      .toBe('https://relay.example.com/api/v2')
  })

  it('地址留空时回落到各 SDK 自带的默认地址', () => {
    expect(buildProviderBaseUrl('anthropic', '')).toBe('https://api.anthropic.com')
    expect(buildProviderBaseUrl('openai-chat', '')).toBe('https://api.openai.com/v1')
    expect(buildProviderBaseUrl('gemini', '')).toBe('https://generativelanguage.googleapis.com')
  })
})

describe('buildRequestUrlPreview — 前缀 + 协议补全后的完整地址', () => {
  it('同一个中转站前缀下，各协议拼出各自真实存在的端点', () => {
    // 实测该中转站：/v1/messages、/v1/chat/completions、/v1/responses、
    // /v1beta/models/... 都是 401（存在），而不带 /v1 的路径全是 404。
    const prefix = 'http://10.66.66.66:8317'
    expect(buildRequestUrlPreview('anthropic', prefix)).toBe('http://10.66.66.66:8317/v1/messages')
    expect(buildRequestUrlPreview('openai-chat', prefix)).toBe('http://10.66.66.66:8317/v1/chat/completions')
    expect(buildRequestUrlPreview('openai-responses', prefix)).toBe('http://10.66.66.66:8317/v1/responses')
    expect(buildRequestUrlPreview('gemini', prefix)).toBe(
      'http://10.66.66.66:8317/v1beta/models/{model}:streamGenerateContent',
    )
  })

  it('地址留空时回落到各 SDK 自带默认地址', () => {
    expect(buildRequestUrlPreview('anthropic', '')).toBe('https://api.anthropic.com/v1/messages')
    expect(buildRequestUrlPreview('openai-chat', '')).toBe('https://api.openai.com/v1/chat/completions')
    expect(buildRequestUrlPreview('openai-responses', '')).toBe('https://api.openai.com/v1/responses')
    expect(buildRequestUrlPreview('gemini', '')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent',
    )
  })

  it('保留 Anthropic 兼容前缀 —— DeepSeek 这类端点的关键路径', () => {
    expect(buildRequestUrlPreview('anthropic', 'https://api.deepseek.com/anthropic'))
      .toBe('https://api.deepseek.com/anthropic/v1/messages')
  })

  it('末尾斜杠不会造成双斜杠', () => {
    expect(buildRequestUrlPreview('anthropic', 'https://relay.example.com/anthropic/'))
      .toBe('https://relay.example.com/anthropic/v1/messages')
    expect(buildRequestUrlPreview('openai-chat', 'https://relay.example.com/v1///'))
      .toBe('https://relay.example.com/v1/chat/completions')
  })

  it('openai 系默认 baseURL 自带 /v1，因此路径只补 /chat/completions', () => {
    expect(buildRequestUrlPreview('openai-chat', 'https://api.openai.com/v1'))
      .toBe('https://api.openai.com/v1/chat/completions')
  })
})

describe('checkBaseUrlShape — 版本段已自动处理，只剩"填了完整端点"这一个坑', () => {
  it('把完整端点填成前缀时报警（路径会被拼两遍）', () => {
    for (const [type, url] of [
      ['anthropic', 'http://10.66.66.66:8317/v1/messages'],
      ['openai-chat', 'http://10.66.66.66:8317/v1/chat/completions'],
      ['openai-responses', 'http://10.66.66.66:8317/v1/responses'],
    ] as const) {
      const warning = checkBaseUrlShape(type, url)
      expect(warning?.level).toBe('warn')
      expect(warning?.message).toContain('prefix')
    }
  })

  it('纯前缀不再产生任何提示 —— 版本段该不该带由协议自己决定', () => {
    // 这几条在改造前都会报警（缺 /v1 / 多带 /v1），现在都能自动处理好
    expect(checkBaseUrlShape('openai-chat', 'https://relay.example.com')).toBeNull()
    expect(checkBaseUrlShape('anthropic', 'https://relay.example.com/v1')).toBeNull()
    expect(checkBaseUrlShape('gemini', 'https://relay.example.com/v1beta')).toBeNull()
    expect(checkBaseUrlShape('anthropic', 'https://api.deepseek.com/anthropic')).toBeNull()
    expect(checkBaseUrlShape('openai-chat', 'https://relay.example.com/v1')).toBeNull()
  })

  it('空地址与非法地址不做判断（交给 URL 校验去管）', () => {
    expect(checkBaseUrlShape('anthropic', '')).toBeNull()
    expect(checkBaseUrlShape('anthropic', '   ')).toBeNull()
    expect(checkBaseUrlShape('anthropic', 'not a url')).toBeNull()
  })
})

describe('suggestProtocol — 刻意保守，认不出就不说话', () => {
  it('地址特征优先于模型名', () => {
    expect(suggestProtocol('https://api.deepseek.com/anthropic')?.type).toBe('anthropic')
    expect(suggestProtocol('https://relay.example.com/v1/chat/completions')?.type).toBe('openai-chat')
    expect(suggestProtocol('https://relay.example.com/v1/responses')?.type).toBe('openai-responses')
    expect(suggestProtocol('https://generativelanguage.googleapis.com')?.type).toBe('gemini')
    expect(suggestProtocol('https://api.anthropic.com')?.type).toBe('anthropic')
    expect(suggestProtocol('https://api.openai.com/v1')?.type).toBe('openai-responses')
  })

  it('地址里含 /anthropic 时优先于模型名判断', () => {
    // 该地址明显是 Anthropic 兼容端点，模型名写 gpt-4 也不该改变结论
    expect(suggestProtocol('https://relay.example.com/anthropic', 'gpt-4')?.type).toBe('anthropic')
  })

  it('没有地址特征时退回模型名前缀', () => {
    expect(suggestProtocol('https://relay.example.com', 'claude-sonnet-4-5')?.type).toBe('anthropic')
    expect(suggestProtocol('https://relay.example.com', 'gemini-2.5-pro')?.type).toBe('gemini')
    expect(suggestProtocol('https://relay.example.com', 'gpt-5.1')?.type).toBe('openai-responses')
  })

  it('认不出来时返回 null —— UI 因此不会显示任何提示', () => {
    expect(suggestProtocol('https://relay.example.com', 'some-model')).toBeNull()
    expect(suggestProtocol('https://relay.example.com')).toBeNull()
    expect(suggestProtocol('')).toBeNull()
  })

  it('o-series 的判定不会误伤 o200k 这类名字', () => {
    expect(suggestProtocol('https://relay.example.com', 'o3-mini')?.type).toBe('openai-responses')
    expect(suggestProtocol('https://relay.example.com', 'o200k-base')).toBeNull()
  })

  it('每条建议都带可验证的理由', () => {
    const suggestion = suggestProtocol('https://api.deepseek.com/anthropic')
    expect(suggestion?.reason).toBeTruthy()
    expect(suggestion?.reason).toContain('/anthropic')
  })
})

describe('defaultProtocolForModel — 新模型默认协议，按中转站现实收敛', () => {
  it('官方域名才默认 Gemini / Responses，其余落到中转站最常见的两家', () => {
    expect(defaultProtocolForModel('https://generativelanguage.googleapis.com', 'gemini-2.5-pro')).toBe('gemini')
    expect(defaultProtocolForModel('https://api.openai.com/v1', 'gpt-5.1')).toBe('openai-responses')
    expect(defaultProtocolForModel('https://api.anthropic.com', 'claude-sonnet-4-5')).toBe('anthropic')
  })

  it('中转站上的 gemini 名字不推导成原生 Gemini —— 否则路径必然 404', () => {
    // 中转站几乎一律用 Anthropic 或 OpenAI Chat 形态转发各家模型，
    // 把这类模型指到 /v1beta/models/... 是错的
    expect(defaultProtocolForModel('http://10.66.66.66:8317', 'gemini-2.5-pro')).toBe('anthropic')
    expect(defaultProtocolForModel('https://relay.example.com', 'gemini-2.5-pro')).toBe('anthropic')
  })

  it('中转站上的 GPT 系默认 Chat Completions —— 多数中转站只实现了它', () => {
    expect(defaultProtocolForModel('http://10.66.66.66:8317', 'gpt-5.1')).toBe('openai-chat')
    expect(defaultProtocolForModel('https://relay.example.com', 'o3-mini')).toBe('openai-chat')
  })

  it('地址里的显式路径特征优先于模型名', () => {
    expect(defaultProtocolForModel('https://relay.example.com/anthropic', 'gpt-5.1')).toBe('anthropic')
    expect(defaultProtocolForModel('https://relay.example.com/v1/chat/completions', 'claude-x')).toBe('openai-chat')
    expect(defaultProtocolForModel('https://relay.example.com/v1/responses', 'claude-x')).toBe('openai-responses')
  })

  it('认不出的模型名一律回落到 Anthropic Messages', () => {
    // 第三方聚合中转站以 Anthropic 形态最普遍（Claude Code 生态的转发服务基本是这个形状）
    expect(defaultProtocolForModel('http://10.66.66.66:8317', 'deepseek-v4.1-flash')).toBe('anthropic')
    expect(defaultProtocolForModel('https://relay.example.com', 'glm-4.6')).toBe('anthropic')
    expect(defaultProtocolForModel('https://relay.example.com', 'grok-4')).toBe('anthropic')
  })

  it('永远返回一个具体协议，绝不返回空 —— 它会被直接写进配置', () => {
    for (const model of ['', 'whatever', 'o200k-base']) {
      expect(isProviderType(defaultProtocolForModel('', model))).toBe(true)
      expect(isProviderType(defaultProtocolForModel('not a url', model))).toBe(true)
    }
  })
})
