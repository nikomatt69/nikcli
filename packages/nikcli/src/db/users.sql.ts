import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ============================================================================
// Users
// ============================================================================

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    role: text("role").notNull().default("user"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    createdAtIdx: index("idx_users_created_at").on(table.createdAt),
  }),
)

// ============================================================================
// User Sessions
// ============================================================================

export const userSessions = sqliteTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    tokenHashIdx: index("idx_user_sessions_token_hash").on(table.tokenHash),
    userIdIdx: index("idx_user_sessions_user_id").on(table.userId),
  }),
)

// ============================================================================
// Chat Contacts
// ============================================================================

export const chatContacts = sqliteTable(
  "chat_contacts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    pk: index("idx_chat_contacts_pk").on(table.userId, table.contactId),
  }),
)

// ============================================================================
// Chat Messages
// ============================================================================

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    receiverId: text("receiver_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    conversationIdx: index("idx_chat_messages_conversation").on(table.senderId, table.receiverId, table.createdAt),
    receiverIdx: index("idx_chat_messages_receiver").on(table.receiverId, table.read),
  }),
)
