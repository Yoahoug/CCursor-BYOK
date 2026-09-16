import type { ProviderType } from '../../data/defaults'
/**
 * 默认 User-Agent 字符串
 *
 * 按 provider type 对齐官方 CLI 产品的 UA 格式:
 *   - Anthropic → Claude Code: `claude-cli/{version} (external, cli)`
 *   - OpenAI    → Codex CLI:   `codex_cli_rs/{version} ({os}; {arch})`
 *   - Gemini    → 不覆盖 (SDK 默认)
 *
 * 用户可通过 ProviderEntry.headers 中的 "User-Agent" 字段覆盖。
 */
import os from 'node:os'

const CLAUDE_CODE_VERSION = '2.1.154'
const CODEX_VERSION = '0.133.0'

function getOsToken(): string {
  const platform = os.platform()
  const release = os.release()
  const arch = os.arch()
  const osName = platform === 'darwin' ? 'Mac OS' : platform === 'win32' ? 'Windows' : 'Linux'
  return `${osName} ${release}; ${arch}`
}

const UA_BY_PROVIDER_TYPE: Partial<Record<ProviderType, string>> = {
  'anthropic': `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
  'openai-responses': `codex_cli_rs/${CODEX_VERSION} (${getOsToken()})`,
}

export function getDefaultUserAgent(providerType: ProviderType): string | undefined {
  return UA_BY_PROVIDER_TYPE[providerType]
}

export function buildDefaultHeaders(
  providerType: ProviderType,
  customHeaders?: Record<string, string>,
): Record<string, string> | undefined {
  const ua = getDefaultUserAgent(providerType)
  if (!ua && !customHeaders)
    return undefined

  const headers: Record<string, string> = {}
  if (ua)
    headers['User-Agent'] = ua
  if (customHeaders)
    Object.assign(headers, customHeaders)
  return Object.keys(headers).length > 0 ? headers : undefined
}
