import { eq, asc } from "drizzle-orm"
import { Database } from "@/database/database"
import { messageInfo, messagePart } from "./message.sql"
import type { MessageV2 } from "./message-v2"

/**
 * SQL-backed repository for Message and Part data.
 * Provides synchronous CRUD operations against the central nikcli.db.
 */
export namespace MessageRepo {
  function db() {
    return Database.syncDb()
  }

  // ============================================================================
  // Message operations
  // ============================================================================

  export function getMessage(sessionId: string, messageId: string): MessageV2.Info | undefined {
    const row = db().select().from(messageInfo).where(eq(messageInfo.id, messageId)).get()
    if (!row) return undefined
    return JSON.parse(row.info) as MessageV2.Info
  }

  export function listMessages(sessionId: string): MessageV2.Info[] {
    const rows = db()
      .select()
      .from(messageInfo)
      .where(eq(messageInfo.sessionId, sessionId))
      .orderBy(asc(messageInfo.createdAt))
      .all()
    return rows.map((row) => JSON.parse(row.info) as MessageV2.Info)
  }

  export function upsertMessage(msg: MessageV2.Info): void {
    db()
      .insert(messageInfo)
      .values({
        id: msg.id,
        sessionId: msg.sessionID,
        role: msg.role,
        info: JSON.stringify(msg),
        createdAt: msg.time.created,
      })
      .onConflictDoUpdate({
        target: messageInfo.id,
        set: {
          info: JSON.stringify(msg),
        },
      })
      .run()
  }

  export function removeMessage(sessionId: string, messageId: string): boolean {
    // Remove associated parts first
    db().delete(messagePart).where(eq(messagePart.messageId, messageId)).run()
    const result = db().delete(messageInfo).where(eq(messageInfo.id, messageId)).run()
    return (result as any).changes > 0
  }

  // ============================================================================
  // Part operations
  // ============================================================================

  export function getPart(messageId: string, partId: string): MessageV2.Part | undefined {
    const row = db().select().from(messagePart).where(eq(messagePart.id, partId)).get()
    if (!row) return undefined
    return JSON.parse(row.info) as MessageV2.Part
  }

  export function listParts(messageId: string): MessageV2.Part[] {
    const rows = db()
      .select()
      .from(messagePart)
      .where(eq(messagePart.messageId, messageId))
      .orderBy(asc(messagePart.sortKey))
      .all()
    return rows.map((row) => JSON.parse(row.info) as MessageV2.Part)
  }

  export function upsertPart(part: MessageV2.Part): void {
    db()
      .insert(messagePart)
      .values({
        id: part.id,
        messageId: part.messageID,
        sessionId: part.sessionID,
        type: part.type,
        info: JSON.stringify(part),
        sortKey: part.id,
      })
      .onConflictDoUpdate({
        target: messagePart.id,
        set: {
          type: part.type,
          info: JSON.stringify(part),
        },
      })
      .run()
  }

  export function removePart(messageId: string, partId: string): boolean {
    const result = db().delete(messagePart).where(eq(messagePart.id, partId)).run()
    return (result as any).changes > 0
  }

  // ============================================================================
  // Composite operations
  // ============================================================================

  export function getMessageWithParts(sessionId: string, messageId: string): MessageV2.WithParts | undefined {
    const info = getMessage(sessionId, messageId)
    if (!info) return undefined
    const parts = listParts(messageId)
    return { info, parts }
  }
}
