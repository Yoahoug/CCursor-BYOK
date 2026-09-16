export interface ToolResultEnvelope {
  result: {
    case: string
    value: Record<string, unknown>
  }
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function bigintLike(value: unknown): bigint | undefined {
  if (typeof value === 'bigint')
    return value
  if (typeof value === 'number' && Number.isFinite(value))
    return BigInt(Math.trunc(value))
  if (typeof value === 'string' && value.length > 0) {
    try {
      return BigInt(value)
    }
    catch {
      return undefined
    }
  }
  return undefined
}

export function enumLike(value: unknown, fallback: string | number = ''): string | number {
  if (typeof value === 'string' || typeof value === 'number')
    return value
  return fallback
}

export function arr<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export function resultCase(value: unknown): { case: string, value: Record<string, unknown> } | null {
  const json = obj(value)
  for (const [k, v] of Object.entries(json)) {
    if (v !== undefined) {
      return { case: k, value: obj(v) }
    }
  }
  return null
}

export function envelope(resultCaseName: string, value: Record<string, unknown>): ToolResultEnvelope {
  return { result: { case: resultCaseName, value } }
}

export function truncate(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text
}
