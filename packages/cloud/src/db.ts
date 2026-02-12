import type { AuthContext, DeviceRecord, MessageRecord, SessionRecord, SyncOperationRecord } from "./types"
import type { DeviceRegistrationInput, MessageCreateInput, SessionUpsertInput, SyncOperationInput } from "./schema"

function asNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function mapSessionRow(row: Record<string, unknown>): SessionRecord {
  return {
    id: asString(row.id),
    userID: asString(row.user_id),
    title: asString(row.title),
    directoryHash: asString(row.directory_hash) || undefined,
    encryptedState: asString(row.encrypted_state),
    syncVersion: asNumber(row.sync_version),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  }
}

function mapMessageRow(row: Record<string, unknown>): MessageRecord {
  return {
    id: asString(row.id),
    sessionID: asString(row.session_id),
    userID: asString(row.user_id),
    deviceID: asString(row.device_id) || undefined,
    role: asString(row.role),
    encryptedContent: asString(row.encrypted_content),
    createdAt: asNumber(row.created_at),
    syncVersion: asNumber(row.sync_version),
  }
}

function mapSyncRow(row: Record<string, unknown>): SyncOperationRecord {
  return {
    id: asNumber(row.id),
    userID: asString(row.user_id),
    sessionID: asString(row.session_id),
    deviceID: asString(row.device_id) || undefined,
    operation: asString(row.operation) as SyncOperationRecord["operation"],
    entityType: asString(row.entity_type) as SyncOperationRecord["entityType"],
    entityID: asString(row.entity_id),
    payload: asString(row.payload) || undefined,
    hash: asString(row.hash),
    createdAt: asNumber(row.created_at),
  }
}

function mapDeviceRow(row: Record<string, unknown>): DeviceRecord {
  return {
    id: asString(row.id),
    userID: asString(row.user_id),
    name: asString(row.name),
    platform: asString(row.platform) as DeviceRecord["platform"],
    publicKey: asString(row.public_key),
    pushToken: asString(row.push_token) || undefined,
    createdAt: asNumber(row.created_at),
    lastSeen: asNumber(row.last_seen),
  }
}

export async function ensureUser(db: D1Database, auth: AuthContext): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO users (id, email, created_at, last_login)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         last_login = excluded.last_login`,
    )
    .bind(auth.userID, auth.email ?? null, now)
    .run()
}

export async function registerDevice(
  db: D1Database,
  auth: AuthContext,
  input: DeviceRegistrationInput,
): Promise<DeviceRecord> {
  const now = Date.now()

  const existing = await db
    .prepare(`SELECT user_id FROM devices WHERE id = ?1 LIMIT 1`)
    .bind(input.deviceID)
    .first<{ user_id: string }>()

  if (existing && existing.user_id !== auth.userID) {
    throw new Error("device_conflict")
  }

  await db
    .prepare(
      `INSERT INTO devices (
          id,
          user_id,
          name,
          platform,
          public_key,
          push_token,
          created_at,
          last_seen
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          platform = excluded.platform,
          public_key = excluded.public_key,
          push_token = excluded.push_token,
          last_seen = excluded.last_seen
        WHERE devices.user_id = excluded.user_id`,
    )
    .bind(input.deviceID, auth.userID, input.name, input.platform, input.publicKey, input.pushToken ?? null, now)
    .run()

  return {
    id: input.deviceID,
    userID: auth.userID,
    name: input.name,
    platform: input.platform,
    publicKey: input.publicKey,
    pushToken: input.pushToken,
    createdAt: now,
    lastSeen: now,
  }
}

export async function listDevices(db: D1Database, userID: string): Promise<DeviceRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, user_id, name, platform, public_key, push_token, created_at, last_seen
       FROM devices
       WHERE user_id = ?1
       ORDER BY last_seen DESC`,
    )
    .bind(userID)
    .all<Record<string, unknown>>()

  return (result.results ?? []).map(mapDeviceRow)
}

export async function deviceBelongsToUser(db: D1Database, userID: string, deviceID: string): Promise<boolean> {
  const result = await db
    .prepare(`SELECT 1 AS found FROM devices WHERE id = ?1 AND user_id = ?2 LIMIT 1`)
    .bind(deviceID, userID)
    .first<{ found: number }>()

  return result?.found === 1
}

export async function sessionBelongsToUser(db: D1Database, userID: string, sessionID: string): Promise<boolean> {
  const result = await db
    .prepare(`SELECT 1 AS found FROM sessions WHERE id = ?1 AND user_id = ?2 LIMIT 1`)
    .bind(sessionID, userID)
    .first<{ found: number }>()

  return result?.found === 1
}

export async function getSession(db: D1Database, userID: string, sessionID: string): Promise<SessionRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, title, directory_hash, encrypted_state, sync_version, created_at, updated_at
       FROM sessions
       WHERE id = ?1 AND user_id = ?2
       LIMIT 1`,
    )
    .bind(sessionID, userID)
    .first<Record<string, unknown>>()

  if (!row) return null
  return mapSessionRow(row)
}

export async function listSessions(db: D1Database, userID: string, limit = 50): Promise<SessionRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, user_id, title, directory_hash, encrypted_state, sync_version, created_at, updated_at
       FROM sessions
       WHERE user_id = ?1
       ORDER BY updated_at DESC
       LIMIT ?2`,
    )
    .bind(userID, limit)
    .all<Record<string, unknown>>()

  return (result.results ?? []).map(mapSessionRow)
}

export async function upsertSession(
  db: D1Database,
  userID: string,
  sessionID: string,
  input: SessionUpsertInput,
): Promise<SessionRecord> {
  const now = Date.now()
  const current = await getSession(db, userID, sessionID)

  if (!current) {
    const foreign = await db
      .prepare(`SELECT user_id FROM sessions WHERE id = ?1 LIMIT 1`)
      .bind(sessionID)
      .first<{ user_id: string }>()
    if (foreign && foreign.user_id !== userID) {
      throw new Error("session_conflict")
    }
  }

  const createdAt = current?.createdAt ?? now
  const syncVersion = Math.max(current?.syncVersion ?? 1, input.syncVersion ?? 1)

  await db
    .prepare(
      `INSERT INTO sessions (
         id,
         user_id,
         title,
         directory_hash,
         encrypted_state,
         sync_version,
         created_at,
         updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         directory_hash = excluded.directory_hash,
         encrypted_state = excluded.encrypted_state,
         sync_version = excluded.sync_version,
         updated_at = excluded.updated_at
       WHERE sessions.user_id = excluded.user_id`,
    )
    .bind(
      sessionID,
      userID,
      input.title,
      input.directoryHash ?? null,
      input.encryptedState,
      syncVersion,
      createdAt,
      now,
    )
    .run()

  return {
    id: sessionID,
    userID,
    title: input.title,
    directoryHash: input.directoryHash,
    encryptedState: input.encryptedState,
    syncVersion,
    createdAt,
    updatedAt: now,
  }
}

export async function deleteSession(db: D1Database, userID: string, sessionID: string): Promise<boolean> {
  const owned = await sessionBelongsToUser(db, userID, sessionID)
  if (!owned) return false

  await db.prepare(`DELETE FROM messages WHERE session_id = ?1 AND user_id = ?2`).bind(sessionID, userID).run()
  await db.prepare(`DELETE FROM sessions WHERE id = ?1 AND user_id = ?2`).bind(sessionID, userID).run()
  return true
}

export async function appendMessage(
  db: D1Database,
  userID: string,
  sessionID: string,
  input: MessageCreateInput,
): Promise<MessageRecord> {
  const owned = await sessionBelongsToUser(db, userID, sessionID)
  if (!owned) {
    throw new Error("session_not_found")
  }

  const now = Date.now()
  const createdAt = input.createdAt ?? now
  const syncVersion = input.syncVersion ?? 1

  const existing = await db
    .prepare(`SELECT user_id FROM messages WHERE id = ?1 LIMIT 1`)
    .bind(input.messageID)
    .first<{ user_id: string }>()

  if (existing && existing.user_id !== userID) {
    throw new Error("message_conflict")
  }

  await db
    .prepare(
      `INSERT INTO messages (
          id,
          session_id,
          user_id,
          device_id,
          role,
          encrypted_content,
          created_at,
          sync_version
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
          device_id = excluded.device_id,
          role = excluded.role,
          encrypted_content = excluded.encrypted_content,
          created_at = excluded.created_at,
          sync_version = excluded.sync_version
        WHERE messages.user_id = excluded.user_id`,
    )
    .bind(
      input.messageID,
      sessionID,
      userID,
      input.deviceID ?? null,
      input.role,
      input.encryptedContent,
      createdAt,
      syncVersion,
    )
    .run()

  await db
    .prepare(`UPDATE sessions SET updated_at = ?1, sync_version = MAX(sync_version, ?2) WHERE id = ?3 AND user_id = ?4`)
    .bind(now, syncVersion, sessionID, userID)
    .run()

  return {
    id: input.messageID,
    sessionID,
    userID,
    deviceID: input.deviceID,
    role: input.role,
    encryptedContent: input.encryptedContent,
    createdAt,
    syncVersion,
  }
}

export async function listMessages(
  db: D1Database,
  userID: string,
  sessionID: string,
  after: number,
  limit: number,
): Promise<MessageRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, session_id, user_id, device_id, role, encrypted_content, created_at, sync_version
       FROM messages
       WHERE user_id = ?1 AND session_id = ?2 AND created_at > ?3
       ORDER BY created_at ASC
       LIMIT ?4`,
    )
    .bind(userID, sessionID, after, limit)
    .all<Record<string, unknown>>()

  return (result.results ?? []).map(mapMessageRow)
}

export async function recordSyncOperation(
  db: D1Database,
  userID: string,
  input: {
    sessionID: string
    deviceID?: string
    operation: "upsert" | "delete"
    entityType: "session" | "message"
    entityID: string
    payload?: string
    hash: string
    timestamp: number
  },
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO sync_log (
        user_id,
        session_id,
        device_id,
        operation,
        entity_type,
        entity_id,
        payload,
        hash,
        created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      userID,
      input.sessionID,
      input.deviceID ?? null,
      input.operation,
      input.entityType,
      input.entityID,
      input.payload ?? null,
      input.hash,
      Date.now(),
    )
    .run()

  return Number(result.meta.last_row_id ?? 0)
}

async function validateSyncOperationOwnership(
  db: D1Database,
  userID: string,
  operation: SyncOperationInput,
): Promise<void> {
  const session = await db
    .prepare(`SELECT user_id FROM sessions WHERE id = ?1 LIMIT 1`)
    .bind(operation.sessionID)
    .first<{ user_id: string }>()

  if (session && session.user_id !== userID) {
    throw new Error("session_conflict")
  }
}

export async function pushSyncOperations(
  db: D1Database,
  userID: string,
  deviceID: string,
  operations: SyncOperationInput[],
): Promise<number> {
  if (operations.length === 0) return Date.now()

  for (const operation of operations) {
    await validateSyncOperationOwnership(db, userID, operation)
  }

  const now = Date.now()
  const statements = operations.map((operation) =>
    db
      .prepare(
        `INSERT INTO sync_log (
          user_id,
          session_id,
          device_id,
          operation,
          entity_type,
          entity_id,
          payload,
          hash,
          created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        userID,
        operation.sessionID,
        deviceID,
        operation.operation,
        operation.entityType,
        operation.entityID,
        operation.payload ?? null,
        operation.hash,
        now,
      ),
  )

  await db.batch(statements)

  const cursor = await db
    .prepare(`SELECT MAX(id) AS id FROM sync_log WHERE user_id = ?1`)
    .bind(userID)
    .first<{ id: number | string | null }>()

  if (!cursor?.id) return now
  return Number(cursor.id)
}

export async function pullSyncOperations(
  db: D1Database,
  userID: string,
  since: number,
  limit: number,
): Promise<{ operations: SyncOperationRecord[]; cursor: number }> {
  const result = await db
    .prepare(
      `SELECT id, user_id, session_id, device_id, operation, entity_type, entity_id, payload, hash, created_at
       FROM sync_log
       WHERE user_id = ?1 AND id > ?2
       ORDER BY id ASC
       LIMIT ?3`,
    )
    .bind(userID, since, limit)
    .all<Record<string, unknown>>()

  const operations = (result.results ?? []).map(mapSyncRow)
  const cursor = operations.at(-1)?.id ?? since
  return { operations, cursor }
}
