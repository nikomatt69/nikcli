import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const instructionBlob = sqliteTable("instruction_blob", {
  hash: text("hash").primaryKey(),
  body: text("body").notNull(),
})

export const instructionState = sqliteTable("instruction_state", {
  sessionId: text("session_id").primaryKey(),
  epochSeq: integer("epoch_seq").notNull(),
  updatedSeq: integer("updated_seq").notNull(),
  parentSessionId: text("parent_session_id"),
  parentSeq: integer("parent_seq"),
  data: text("data").notNull(),
})
