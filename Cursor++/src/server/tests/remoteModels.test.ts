import { describe, expect, it } from 'vitest'
import { normalizeRemoteModels, remoteModelLabel } from '../../shared/remoteModels'

describe('normalizeRemoteModels — 上游字段归一化', () => {
  it('读取 Anthropic 风格的 snake_case display_name', () => {
    // 这是本项目真实遇到的情况：中转站把 id 混淆成不可读的串，
    // display_name 才是唯一可读的名字。漏掉这个字段列表就成乱码。
    const result = normalizeRemoteModels({
      data: [
        { id: 'claude-fable-5-dd-hsalf-1.4v-keespeed', display_name: 'deepseek-v4.1-flash', owned_by: 'WorkBuddy' },
      ],
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('claude-fable-5-dd-hsalf-1.4v-keespeed')
    expect(result[0]?.displayName).toBe('deepseek-v4.1-flash')
    expect(result[0]?.ownedBy).toBe('WorkBuddy')
  })

  it('也认 camelCase displayName 写法', () => {
    const result = normalizeRemoteModels({ data: [{ id: 'a', displayName: 'Readable A' }] })
    expect(result[0]?.displayName).toBe('Readable A')
  })

  it('没有 display_name 时留空，而不是拿 id 顶替', () => {
    // 空串让 UI 能判断"没有可读名"，直接复用 id 会让它误以为上游给了名字
    const result = normalizeRemoteModels({ data: [{ id: 'bare-model' }] })
    expect(result[0]?.displayName).toBe('')
  })

  it('上游给秒级时间戳时要换算成毫秒', () => {
    const result = normalizeRemoteModels({ data: [{ id: 'a', created: 1_700_000_000 }] })
    expect(result[0]?.createdAt).toBe(1_700_000_000_000)
  })

  it('已是毫秒的时间戳不会被再乘一千', () => {
    const result = normalizeRemoteModels({ data: [{ id: 'a', created: 1_700_000_000_000 }] })
    expect(result[0]?.createdAt).toBe(1_700_000_000_000)
  })

  it('created_at 是 ISO 字符串时也能解析', () => {
    const result = normalizeRemoteModels({ data: [{ id: 'a', created_at: '2026-09-17T04:27:05Z' }] })
    expect(result[0]?.createdAt).toBe(Date.parse('2026-09-17T04:27:05Z'))
  })

  it('时间缺失记为 0', () => {
    const result = normalizeRemoteModels({ data: [{ id: 'a' }] })
    expect(result[0]?.createdAt).toBe(0)
  })

  it('按时间降序排在前面；全为 0 时保持上游顺序', () => {
    // 全 0 时不能乱序 —— 上游给的顺序本身可能是有意义的
    const noTime = normalizeRemoteModels({ data: [{ id: 'first' }, { id: 'second' }, { id: 'third' }] })
    expect(noTime.map(m => m.id)).toEqual(['first', 'second', 'third'])

    const withTime = normalizeRemoteModels({
      data: [
        { id: 'old', created: 1_600_000_000 },
        { id: 'new', created: 1_700_000_000 },
      ],
    })
    expect(withTime.map(m => m.id)).toEqual(['new', 'old'])
  })

  it('认 Gemini 的 {models:[{name}]} 形状并去掉 models/ 前缀', () => {
    // name 是 "models/gemini-2.5-flash"，用作 apiModel 时必须去掉前缀
    const result = normalizeRemoteModels({ models: [{ name: 'models/gemini-2.5-flash' }] })
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('gemini-2.5-flash')
  })

  it('响应体直接是数组时也认', () => {
    const result = normalizeRemoteModels([{ id: 'plain' }])
    expect(result.map(m => m.id)).toEqual(['plain'])
  })

  it('缺少 id 的条目被丢弃', () => {
    const result = normalizeRemoteModels({ data: [{ display_name: 'no id' }, { id: 'ok' }] })
    expect(result.map(m => m.id)).toEqual(['ok'])
  })

  it('非对象响应体返回空数组而不是抛异常', () => {
    expect(normalizeRemoteModels(null)).toEqual([])
    expect(normalizeRemoteModels('nope')).toEqual([])
    expect(normalizeRemoteModels({})).toEqual([])
    expect(normalizeRemoteModels({ data: 'not-an-array' })).toEqual([])
  })

  it('数组里的杂项（null / 字符串）被跳过', () => {
    const result = normalizeRemoteModels({ data: [null, 'x', { id: 'good' }] })
    expect(result.map(m => m.id)).toEqual(['good'])
  })
})

describe('remoteModelLabel', () => {
  it('优先用可读名', () => {
    expect(remoteModelLabel({ id: 'obfuscated', displayName: 'gpt-5.5', ownedBy: '', createdAt: 0 })).toBe('gpt-5.5')
  })

  it('没有可读名时退回 id', () => {
    expect(remoteModelLabel({ id: 'gpt-5.5', displayName: '', ownedBy: '', createdAt: 0 })).toBe('gpt-5.5')
  })
})
