import { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260611000000_session_message_todo_permission",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS session_info (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        directory TEXT NOT NULL,
        parent_id TEXT,
        workspace_id TEXT,
        version TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_info_project ON session_info(project_id);
      CREATE INDEX IF NOT EXISTS idx_session_info_parent ON session_info(parent_id);
      CREATE INDEX IF NOT EXISTS idx_session_info_workspace ON session_info(workspace_id);

      CREATE TABLE IF NOT EXISTS message_info (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES session_info(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        info TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_message_info_session ON message_info(session_id);
      CREATE INDEX IF NOT EXISTS idx_message_info_role ON message_info(role);

      CREATE TABLE IF NOT EXISTS message_part (
        id TEXT PRIMARY KEY NOT NULL,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        info TEXT NOT NULL,
        sort_key TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_message_part_message ON message_part(message_id);
      CREATE INDEX IF NOT EXISTS idx_message_part_session ON message_part(session_id);
      CREATE INDEX IF NOT EXISTS idx_message_part_sort ON message_part(message_id, sort_key);

      CREATE TABLE IF NOT EXISTS todo_info (
        session_id TEXT PRIMARY KEY NOT NULL,
        todos TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS permission_ruleset (
        project_id TEXT PRIMARY KEY NOT NULL,
        rules TEXT NOT NULL DEFAULT '[]'
      );
    `)
  },
} satisfies DatabaseMigration.Migration
