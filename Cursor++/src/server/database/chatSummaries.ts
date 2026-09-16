import type { ConversationSummary } from '../gen/aiserver_v1_pb'
import { create } from '@bufbuild/protobuf'
import { ConversationSummarySchema } from '../gen/aiserver_v1_pb'
import { getAgentDatabase } from './sqlite'

export type PersistedConversationSummaryKind = 'latest' | 'speculative'

export interface PersistedConversationSummaryRecord {
  conversationId: string
  kind: PersistedConversationSummaryKind
  summary: ConversationSummary
  updatedAt: number
}

interface ConversationSummaryRow {
  conversation_id: string
  kind: PersistedConversationSummaryKind
  truncation_bubble_id_inclusive: string
  resume_bubble_id_inclusive: string
  previous_summary_bubble_id: string
  summary_text: string
  includes_tool_results: number
  strategy: string
  updated_at: number
}

function rowToRecord(row: ConversationSummaryRow): PersistedConversationSummaryRecord {
  return {
    conversationId: row.conversation_id,
    kind: row.kind,
    summary: create(ConversationSummarySchema, {
      summary: row.summary_text,
      truncationLastBubbleIdInclusive: row.truncation_bubble_id_inclusive,
      clientShouldStartSendingFromInclusiveBubbleId: row.resume_bubble_id_inclusive,
      previousConversationSummaryBubbleId: row.previous_summary_bubble_id,
      includesToolResults: Boolean(row.includes_tool_results),
      strategy: row.strategy,
    }),
    updatedAt: row.updated_at,
  }
}

export async function persistConversationSummaries(
  conversationId: string,
  kind: PersistedConversationSummaryKind,
  summaries: ConversationSummary[],
): Promise<void> {
  if (!conversationId || summaries.length === 0) {
    return
  }

  const now = Date.now()
  const database = getAgentDatabase()

  await database.transaction(async () => {
    if (kind === 'latest') {
      await database.run(
        `DELETE FROM conversation_summaries WHERE conversation_id = ? AND kind = 'latest'`,
        [conversationId],
      )
    }

    if (kind === 'speculative') {
      await database.run(
        `DELETE FROM conversation_summaries
                 WHERE conversation_id = $conversationId
                   AND kind = 'speculative'
                   AND truncation_bubble_id_inclusive NOT IN (
                     SELECT value FROM json_each($boundaryJson)
                   )`,
        {
          $conversationId: conversationId,
          $boundaryJson: JSON.stringify(summaries.map(summary => summary.truncationLastBubbleIdInclusive)),
        },
      )
    }

    for (const summary of summaries) {
      await database.run(
        `INSERT INTO conversation_summaries (
                    conversation_id,
                    kind,
                    truncation_bubble_id_inclusive,
                    resume_bubble_id_inclusive,
                    previous_summary_bubble_id,
                    summary_text,
                    includes_tool_results,
                    strategy,
                    updated_at
                ) VALUES (
                    $conversationId,
                    $kind,
                    $truncationBubbleIdInclusive,
                    $resumeBubbleIdInclusive,
                    $previousSummaryBubbleId,
                    $summaryText,
                    $includesToolResults,
                    $strategy,
                    $updatedAt
                )
                ON CONFLICT(conversation_id, kind, truncation_bubble_id_inclusive) DO UPDATE SET
                    resume_bubble_id_inclusive = excluded.resume_bubble_id_inclusive,
                    previous_summary_bubble_id = excluded.previous_summary_bubble_id,
                    summary_text = excluded.summary_text,
                    includes_tool_results = excluded.includes_tool_results,
                    strategy = excluded.strategy,
                    updated_at = excluded.updated_at`,
        {
          $conversationId: conversationId,
          $kind: kind,
          $truncationBubbleIdInclusive: summary.truncationLastBubbleIdInclusive,
          $resumeBubbleIdInclusive: summary.clientShouldStartSendingFromInclusiveBubbleId,
          $previousSummaryBubbleId: summary.previousConversationSummaryBubbleId,
          $summaryText: summary.summary,
          $includesToolResults: summary.includesToolResults ? 1 : 0,
          $strategy: summary.strategy,
          $updatedAt: now,
        },
      )
    }
  })
}

export async function getLatestConversationSummary(conversationId: string): Promise<ConversationSummary | null> {
  if (!conversationId) {
    return null
  }

  const row = await getAgentDatabase().get<ConversationSummaryRow>(
    `SELECT conversation_id, kind, truncation_bubble_id_inclusive, resume_bubble_id_inclusive,
                previous_summary_bubble_id, summary_text, includes_tool_results, strategy, updated_at
         FROM conversation_summaries
         WHERE conversation_id = ? AND kind = 'latest'
         ORDER BY updated_at DESC
         LIMIT 1`,
    [conversationId],
  )

  return row ? rowToRecord(row).summary : null
}

export async function listSpeculativeConversationSummaries(conversationId: string): Promise<ConversationSummary[]> {
  if (!conversationId) {
    return []
  }

  const rows = await getAgentDatabase().all<ConversationSummaryRow>(
    `SELECT conversation_id, kind, truncation_bubble_id_inclusive, resume_bubble_id_inclusive,
                previous_summary_bubble_id, summary_text, includes_tool_results, strategy, updated_at
         FROM conversation_summaries
         WHERE conversation_id = ? AND kind = 'speculative'
         ORDER BY updated_at DESC, truncation_bubble_id_inclusive ASC`,
    [conversationId],
  )

  return rows.map(row => rowToRecord(row).summary)
}
