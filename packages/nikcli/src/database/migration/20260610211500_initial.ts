import { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260610211500_initial",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS account (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL,
        url TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        token_expiry INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY DEFAULT 1 NOT NULL,
        active_account_id TEXT,
        active_org_id TEXT
      );

      INSERT OR IGNORE INTO config (id) VALUES (1);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);

      CREATE TABLE IF NOT EXISTS chat_contacts (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        contact_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, contact_id)
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY NOT NULL,
        sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
        ON chat_messages(sender_id, receiver_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_receiver
        ON chat_messages(receiver_id, read);

      CREATE TABLE IF NOT EXISTS mobile_tokens (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        expires_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_mobile_tokens_hash ON mobile_tokens(hash);

      CREATE TABLE IF NOT EXISTS workspace (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        branch TEXT,
        config TEXT NOT NULL,
        status TEXT,
        events TEXT,
        event_limit INTEGER,
        time_used INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workspace_project ON workspace(project_id);
    `)
  },
} satisfies DatabaseMigration.Migration
