/**
 * Runtime config 兼容垫片
 *
 * 历史:此文件曾承载所有 LLM provider 的 baseUrl + apiKey + host/port,
 * 在 BYOK 重新设计后,Provider 凭据移交给 ~/.ccursor/providers.json,
 * server host/port 移交给 ~/.ccursor/routes.json。
 *
 * 本文件保留:
 *   - `config.server.{host,port}` 只读视图 (读取 routesStore)
 *   - `initRuntimeConfig()` 兼容签名 (现在仅持久化 host/port 到 routes.json)
 *
 * 类型: provider 方言统一用 defaults.ts 的 `ProviderType`。
 * 这里曾有 `export type Provider = ProviderType` 这层别名 —— 它不带来任何语义区分
 * （"Provider" 在别处也指 LLMProvider 接口、ProviderPromptProfile 等，反而容易混），
 * 且让"到底哪个是权威定义"多绕一跳，故移除；引用方直接导入 ProviderType。
 *
 * 不再持有任何 LLM provider 凭据。
 */
import type { ProviderType } from './data/defaults'
import { loadRoutes, setServerHost, setServerPort } from './config/routesStore'
import { PROVIDER_TYPES } from './data/defaults'

/** 只读视图: 调用方读 config.server.host/port 时实时取自 routes.json */
export const config = {
  server: {
    get host() {
      return loadRoutes().server.host
    },
    get port() {
      return loadRoutes().server.port
    },
  },
}

export interface RuntimeConfigInit {
  host?: string
  port?: number
}

export async function initRuntimeConfig(init: RuntimeConfigInit): Promise<void> {
  if (init.host !== undefined)
    await setServerHost(init.host)
  if (init.port !== undefined)
    await setServerPort(init.port)
}

/** 历史接口: 当前实现按 providers.json 的 provider type 集合返回 */
export function getAvailableProviders(): ProviderType[] {
  // 仅作占位; 真正的"模型可用性"由 providersStore + availableModels 合并决定
  // 返回副本 —— PROVIDER_TYPES 是共享表, 调用方不应改到它
  return [...PROVIDER_TYPES]
}
