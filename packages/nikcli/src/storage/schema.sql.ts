import { integer } from "drizzle-orm/sqlite-core"

/**
 * Shared timestamp columns for SQLite tables.
 * Column names are snake_case (created_at, updated_at) in the database,
 * while TypeScript property names are also snake_case for consistency
 * with the existing schema and the PublicUser/User types.
 * Uses Drizzle's $default() for insert-time defaults and $onUpdate() for automatic updates.
 */
export const Timestamps = {
  created_at: integer("created_at")
    .notNull()
    .$default(() => Date.now()),
  updated_at: integer("updated_at")
    .notNull()
    .$onUpdate(() => Date.now()),
}
