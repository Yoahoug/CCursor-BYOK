/**
 * Agent 协议 — 对外入口 (barrel)
 *
 * 将 Cursor AgentClientMessage (runRequest) 转换为 LLM messages 数组。
 * 内部拆分在 protocol/ 目录:
 *
 *   protocol/types.ts            — ParsedRunRequest 类型
 *   protocol/shared.ts           — escapeXml / emptyParsed / workspaceUris
 *   protocol/parseRunRequest.ts  — parseRunRequest (解析 runRequest → ParsedRunRequest)
 *   protocol/messageBuilder.ts   — buildMessages (组装 system + preamble + current turn)
 *   protocol/prompts/
 *     ├─ anthropicSystem.ts      — Claude / Gemini 家族 system prompt
 *     ├─ openaiSystem.ts         — GPT 家族 system prompt
 *     └─ composerFallback.ts     — Composer 回退 system prompt
 *
 * 官方服务端的组装逻辑 (从抓包还原):
 *   1. System prompt: 硬编码模板 + modelId + MCP/terminal 路径注入 (~21KB)
 *   2. Preamble user: <user_info> + <agent_transcripts> + <rules> + <agent_skills>
 *   3. Current-turn user: <user_query>
 *
 * 客户端通过 runRequest 发送:
 *   - action.userMessageAction.userMessage.text — 用户消息
 *   - action.userMessageAction.requestContext.rules — 规则 (type: global/agentFetched/...)
 *   - action.userMessageAction.requestContext.env — 环境信息
 *   - action.userMessageAction.requestContext.agentSkills — Agent Skills
 *   - action.userMessageAction.requestContext.mcpFileSystemOptions — MCP 配置
 *   - action.userMessageAction.requestContext.mcpInstructions — MCP 使用说明
 *   - modelDetails.modelId — 模型 ID
 *   - conversationState.turns — 历史 blob IDs
 *   - conversationId — 会话 ID
 */

export { collectExtraContextBlobIds, resolveExtraContextBlobs } from './protocol/blobResolve'
export { buildMessages } from './protocol/messageBuilder'
export { parseRunRequest } from './protocol/parseRunRequest'
export { workspaceUris } from './protocol/shared'
export type { ParsedRunRequest } from './protocol/types'
