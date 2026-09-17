import { getAgentDatabase } from './sqlite'

export type CheckpointKind = 'committed' | 'draft'

export interface PersistedConversationCheckpoint {
  conversationId: string
  kind: CheckpointKind
  rootBlobIds: string[]
  turnBlobIds: string[]
  summaryArchiveIds: string[]
  tokenDetails: { usedTokens: number, maxTokens: number }
  mode: string
  updatedAt: number
}

interface CheckpointRow {
  conversation_id: string
  kind: string
  root_blob_ids_json: string
  turn_blob_ids_json: string
  summary_archive_ids_json: string
  used_tokens: number
  max_tokens: number
  mode: string
  updated_at: number
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  }
  catch {
    return []
  }
}

export async function persistConversationCheckpoint(checkpoint: PersistedConversationCheckpoint): Promise<void> {
  await getAgentDatabase().run(`
        INSERT OR REPLACE INTO conversation_checkpoints (
            conversation_id,
            kind,
            root_blob_ids_json,
            turn_blob_ids_json,
            summary_archive_ids_json,
            used_tokens,
            max_tokens,
            mode,
            updated_at
        ) VALUES (
            $conversationId,
            $kind,
            $rootBlobIdsJson,
            $turnBlobIdsJson,
            $summaryArchiveIdsJson,
            $usedTokens,
            $maxTokens,
            $mode,
            $updatedAt
        )
    `, {
    $conversationId: checkpoint.conversationId,
    $kind: checkpoint.kind,
    $rootBlobIdsJson: JSON.stringify(checkpoint.rootBlobIds),
    $turnBlobIdsJson: JSON.stringify(checkpoint.turnBlobIds),
    $summaryArchiveIdsJson: JSON.stringify(checkpoint.summaryArchiveIds),
    $usedTokens: checkpoint.tokenDetails.usedTokens,
    $maxTokens: checkpoint.tokenDetails.maxTokens,
    $mode: checkpoint.mode,
    $updatedAt: checkpoint.updatedAt,
  })
}

/**
 * 获取指定会话的 committed checkpoint (默认)。
 * 恢复历史时只用 committed，不用 draft。
 */
export async function getPersistedConversationCheckpoint(
  conversationId: string,
  kind: CheckpointKind = 'committed',
): Promise<PersistedConversationCheckpoint | null> {
  if (!conversationId)
    return null

  const row = await getAgentDatabase().get<CheckpointRow>(`
        SELECT conversation_id, kind, root_blob_ids_json, turn_blob_ids_json, summary_archive_ids_json, used_tokens, max_tokens, mode, updated_at
        FROM conversation_checkpoints
        WHERE conversation_id = ? AND kind = ?
    `, [conversationId, kind])
  if (!row)
    return null

  return {
    conversationId: row.conversation_id,
    kind: row.kind as CheckpointKind,
    rootBlobIds: parseStringArray(row.root_blob_ids_json),
    turnBlobIds: parseStringArray(row.turn_blob_ids_json),
    summaryArchiveIds: parseStringArray(row.summary_archive_ids_json),
    tokenDetails: {
      usedTokens: row.used_tokens,
      maxTokens: row.max_tokens,
    },
    mode: row.mode,
    updatedAt: row.updated_at,
  }
}

/** 清除指定会话的 draft checkpoint (provider error 后调用) */
export async function clearDraftCheckpoint(conversationId: string): Promise<void> {
  if (!conversationId)
    return
  await getAgentDatabase().run(
    `DELETE FROM conversation_checkpoints WHERE conversation_id = ? AND kind = 'draft'`,
    [conversationId],
  )
}

/**
 * 清除指定会话的 sqlite checkpoint。
 *
 * 使用场景: 客户端发送空 conversationState + sqlite 里有旧 checkpoint →
 * 判定为 revert / 用户主动重置 → 清空以避免污染下一次重建。
 *
 * 详见 analysis/checkpoint-revert-protocol.md 的 P0 修复方案。
 */
export async function clearPersistedConversationCheckpoint(conversationId: string): Promise<void> {
  if (!conversationId)
    return
  await getAgentDatabase().run(
    `DELETE FROM conversation_checkpoints WHERE conversation_id = ?`,
    [conversationId],
  )
}
