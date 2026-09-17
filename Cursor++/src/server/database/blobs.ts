import { getAgentDatabase } from './sqlite'

interface BlobRow {
  blob_data: string
}

export async function persistBlob(blobId: string, blobData: string): Promise<void> {
  const now = Date.now()
  await getAgentDatabase().run(`
        INSERT INTO agent_blobs (blob_id, blob_data, created_at, last_accessed_at)
        VALUES ($blobId, $blobData, $now, $now)
        ON CONFLICT(blob_id) DO UPDATE SET
            blob_data = excluded.blob_data,
            last_accessed_at = excluded.last_accessed_at
    `, { $blobId: blobId, $blobData: blobData, $now: now })
}

export async function loadPersistedBlob(blobId: string): Promise<string | undefined> {
  const database = getAgentDatabase()
  const row = await database.get<BlobRow>('SELECT blob_data FROM agent_blobs WHERE blob_id = ?', [blobId])
  if (!row)
    return undefined

  await database.run('UPDATE agent_blobs SET last_accessed_at = ? WHERE blob_id = ?', [Date.now(), blobId])
  return row.blob_data
}
