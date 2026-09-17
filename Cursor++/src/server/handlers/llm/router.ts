import type { ProviderRuntime } from './providerRuntime'
import { resolveProviderRuntime } from './providerRuntime'

export type RouteResult = ProviderRuntime

export function routeModel(modelId: string): RouteResult {
  return resolveProviderRuntime(modelId)
}
