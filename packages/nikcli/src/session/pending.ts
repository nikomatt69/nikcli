import { and, asc, eq, inArray } from "drizzle-orm"
import { Schema } from "effect"
import z from "zod"
import { Database } from "@/database/database"
import { Identifier } from "@/id/id"
import { MessageV2 } from "./message-v2"
import { PromptParts } from "./prompt-parts"
import { sessionPending } from "./pending.sql"

export namespace SessionPending {
  export const Delivery = z.enum(["steer", "queue"])
  export type Delivery = z.infer<typeof Delivery>

  export const PromptInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    delivery: Delivery.optional(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    agent: z.string().optional(),
    noReply: z.boolean().optional(),
    tools: z
      .record(z.string(), z.boolean())
      .optional()
      .describe(
        "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
      ),
    format: MessageV2.Format.optional(),
    system: z.string().optional(),
    variant: z.string().optional(),
    parts: z.array(PromptParts.InputPart),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  export const Info = z.object({
    id: Identifier.schema("pending"),
    sessionID: Identifier.schema("session"),
    delivery: Delivery,
    messageID: Identifier.schema("message"),
    data: PromptInput,
    createdAt: z.number().int(),
  })
  export type Info = z.infer<typeof Info>

  function promptPartInput<S extends Schema.Struct.Fields, Id extends string>(
    schema: Schema.Struct<S>,
    identifier: Id,
  ) {
    return schema
      .mapFields((fields) => {
        const {
          messageID: _messageID,
          sessionID: _sessionID,
          id,
          ...rest
        } = fields as S & {
          messageID?: Schema.Top
          sessionID?: Schema.Top
          id?: Schema.Top
        }
        return {
          ...rest,
          ...(id ? { id: Schema.optional(id) } : {}),
        } as Schema.Struct.Fields
      })
      .annotate({ identifier })
  }

  const TextPartInput = promptPartInput(MessageV2.TextPartSchema, "TextPartInput")
  const FilePartInput = promptPartInput(MessageV2.FilePartSchema, "FilePartInput")
  const AgentPartInput = promptPartInput(MessageV2.AgentPartSchema, "AgentPartInput")
  const SubtaskPartInput = promptPartInput(MessageV2.SubtaskPartSchema, "SubtaskPartInput")

  export const PromptPartInputSchema = Schema.Union([
    TextPartInput,
    FilePartInput,
    AgentPartInput,
    SubtaskPartInput,
  ]).annotate({
    identifier: "PromptPartInput",
    discriminator: "type",
  })

  export const PromptPayloadSchema = Schema.Struct({
    messageID: Schema.optional(Schema.String),
    delivery: Schema.optional(Schema.Literals(["steer", "queue"])),
    model: Schema.optional(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
      }),
    ),
    agent: Schema.optional(Schema.String),
    noReply: Schema.optional(Schema.Boolean),
    tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
    format: Schema.optional(MessageV2.FormatSchema),
    system: Schema.optional(Schema.String),
    variant: Schema.optional(Schema.String),
    parts: Schema.Array(PromptPartInputSchema),
  }).annotate({ identifier: "SessionPromptInput" })

  export const PromptInputSchema = Schema.Struct({
    sessionID: Schema.String,
    ...PromptPayloadSchema.fields,
  }).annotate({ identifier: "SessionPendingPromptInput" })

  export const InfoSchema = Schema.Struct({
    id: Schema.String,
    sessionID: Schema.String,
    delivery: Schema.Literals(["steer", "queue"]),
    messageID: Schema.String,
    data: PromptInputSchema,
    createdAt: Schema.Number,
  }).annotate({ identifier: "SessionPendingInput" })

  export class ConflictError extends Error {
    override readonly name = "SessionPendingConflictError"
    readonly _tag = "SessionPendingConflictError"

    constructor(
      readonly sessionID: string,
      readonly messageID: string,
    ) {
      super(`Message ${messageID} was already admitted with different input in session ${sessionID}`)
    }
  }

  type Executor = Database.TxOrDb
  type Row = typeof sessionPending.$inferSelect

  function db() {
    return Database.syncDb()
  }

  function decode(row: Row): Info | undefined {
    try {
      return Info.parse({
        id: row.id,
        sessionID: row.sessionId,
        delivery: row.delivery,
        messageID: row.messageId,
        data: JSON.parse(row.data),
        createdAt: row.createdAt,
      })
    } catch {
      return undefined
    }
  }

  export function canonical(input: PromptInput): string {
    return JSON.stringify(PromptInput.parse(input))
  }

  export function getByMessage(sessionID: string, messageID: string, tx: Executor = db()): Info | undefined {
    const row = tx
      .select()
      .from(sessionPending)
      .where(and(eq(sessionPending.sessionId, sessionID), eq(sessionPending.messageId, messageID)))
      .get()
    return row ? decode(row) : undefined
  }

  export function get(id: string, tx: Executor = db()): Info | undefined {
    const row = tx.select().from(sessionPending).where(eq(sessionPending.id, id)).get()
    return row ? decode(row) : undefined
  }

  export function steer(sessionID: string, id: string, tx: Executor = db()): Info | undefined {
    tx.update(sessionPending)
      .set({ delivery: "steer" })
      .where(and(eq(sessionPending.id, id), eq(sessionPending.sessionId, sessionID)))
      .run()
    return get(id, tx)
  }

  export function insert(
    input: {
      sessionID: string
      messageID: string
      delivery: Delivery
      data: string
      createdAt?: number
    },
    tx: Executor = db(),
  ): Info {
    const row = {
      id: Identifier.ascending("pending"),
      sessionId: input.sessionID,
      delivery: input.delivery,
      messageId: input.messageID,
      data: input.data,
      createdAt: input.createdAt ?? Date.now(),
    } satisfies typeof sessionPending.$inferInsert
    tx.insert(sessionPending).values(row).run()
    const decoded = decode(row)
    if (!decoded) throw new Error("Failed to decode inserted pending input")
    return decoded
  }

  export function list(sessionID: string, delivery?: Delivery, tx: Executor = db()): Info[] {
    const where = delivery
      ? and(eq(sessionPending.sessionId, sessionID), eq(sessionPending.delivery, delivery))
      : eq(sessionPending.sessionId, sessionID)
    return tx
      .select()
      .from(sessionPending)
      .where(where)
      .orderBy(asc(sessionPending.createdAt), asc(sessionPending.id))
      .all()
      .flatMap((row) => {
        const info = decode(row)
        return info ? [info] : []
      })
  }

  export function remove(ids: string[], tx: Executor = db()): number {
    if (ids.length === 0) return 0
    const result = tx.delete(sessionPending).where(inArray(sessionPending.id, ids)).run()
    return (result as unknown as { changes: number }).changes
  }

  export function removeSession(sessionID: string, tx: Executor = db()): number {
    const result = tx.delete(sessionPending).where(eq(sessionPending.sessionId, sessionID)).run()
    return (result as unknown as { changes: number }).changes
  }
}
