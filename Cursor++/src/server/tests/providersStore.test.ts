import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isProviderType, PROVIDER_TYPES } from '../data/defaults'

// Mock paths.ts 让 store 指向临时目录,避免污染 ~/.ccursor/providers.json
let tmpDir: string
vi.mock('../config/paths', () => ({
  getProvidersFilePath: () => join(tmpDir, 'providers.json'),
}))

// 动态 import 以保证 mock 已就位。
// resetModules 不可省略: setup.ts(setupFiles)已经加载过 providersStore, 模块缓存里
// 那份绑定的是**真实** paths —— 不重置就会读到用户自己的 ~/.ccursor/providers.json。
async function loadStore() {
  vi.resetModules()
  const store = await import('../config/providersStore')
  store.resetProvidersCacheForTests()
  return store
}

function writeProvidersFile(config: unknown): void {
  writeFileSync(join(tmpDir, 'providers.json'), JSON.stringify(config))
}

/** 构造一条结构完整的 provider —— 只有 type 是需要变化观察的字段 */
function providerFixture(id: string, type: string) {
  return {
    id,
    name: id,
    type,
    baseUrl: '',
    auth: { kind: 'apiKey', value: 'test-key' },
    models: [{ id: `${id}-model`, apiModel: `${id}-model`, displayName: id, thinking: false }],
  }
}

describe('isProviderType — 运行时取值校验', () => {
  it('接受全部已登记的 provider 类型', () => {
    for (const providerType of PROVIDER_TYPES)
      expect(isProviderType(providerType)).toBe(true)
  })

  it('拒绝未登记 / 大小写不符 / 非字符串输入', () => {
    expect(isProviderType('bedrock')).toBe(false)
    expect(isProviderType('ANTHROPIC')).toBe(false)
    expect(isProviderType('')).toBe(false)
    expect(isProviderType(undefined)).toBe(false)
    expect(isProviderType(null)).toBe(false)
    expect(isProviderType(42)).toBe(false)
    expect(isProviderType({ type: 'anthropic' })).toBe(false)
  })

  it('不会被原型链上的属性名误判', () => {
    // 用 Object.hasOwn 而非 `value in FLAGS` 的原因: 后者会把原型链属性也当成合法值
    expect(isProviderType('toString')).toBe(false)
    expect(isProviderType('constructor')).toBe(false)
  })

  it('取值表 PROVIDER_TYPES 与类型定义保持一致', () => {
    expect([...PROVIDER_TYPES].sort()).toEqual(['anthropic', 'gemini', 'openai-chat', 'openai-responses'])
  })
})

describe('providersStore — provider.type 配置边界校验', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'byok-providers-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('保留四种合法 type，丢掉无法识别的 type', async () => {
    const store = await loadStore()
    writeProvidersFile({
      $schemaVersion: 1,
      providers: [
        providerFixture('keep-anthropic', 'anthropic'),
        providerFixture('keep-openai-chat', 'openai-chat'),
        providerFixture('keep-openai-responses', 'openai-responses'),
        providerFixture('keep-gemini', 'gemini'),
        providerFixture('drop-unknown', 'bedrock'),
        providerFixture('drop-case', 'ANTHROPIC'),
        providerFixture('drop-empty', ''),
      ],
    })

    const loaded = store.loadProviders()
    expect(loaded.providers.map(p => p.id)).toEqual([
      'keep-anthropic',
      'keep-openai-chat',
      'keep-openai-responses',
      'keep-gemini',
    ])
  })

  it('丢掉 null / 非对象条目而不是崩溃', async () => {
    const store = await loadStore()
    writeProvidersFile({
      $schemaVersion: 1,
      providers: [
        null,
        'not-an-object',
        42,
        providerFixture('keep', 'anthropic'),
      ],
    })

    const loaded = store.loadProviders()
    expect(loaded.providers.map(p => p.id)).toEqual(['keep'])
  })

  it('被丢掉的 provider 不会进入 modelId 反向索引', async () => {
    const store = await loadStore()
    writeProvidersFile({
      $schemaVersion: 1,
      providers: [
        providerFixture('valid', 'gemini'),
        providerFixture('invalid', 'bedrock'),
      ],
    })

    store.loadProviders()
    // 合法 provider 的模型可路由
    expect(store.lookupModel('valid-model')?.provider.id).toBe('valid')
    // 非法 type 的 provider 连模型一起被丢弃 —— 关键点: 它绝不会被静默当成 anthropic
    expect(store.lookupModel('invalid-model')).toBeNull()
  })

  it('type 合法但其他字段缺失时按默认值补齐', async () => {
    const store = await loadStore()
    writeProvidersFile({
      providers: [{ id: 'minimal', type: 'anthropic', models: undefined }],
    })

    const loaded = store.loadProviders()
    expect(loaded.$schemaVersion).toBe(1)
    expect(loaded.providers).toHaveLength(1)
    expect(loaded.providers[0]).toMatchObject({
      id: 'minimal',
      name: 'minimal',
      type: 'anthropic',
      baseUrl: '',
      auth: { kind: 'apiKey', value: '' },
      models: [],
    })
  })
})
