import type { DBSchema, DBTable, DBColumn, DBForeignKey, DBIndex, TablePreview, QueryResult } from "./types"

export interface IDBConnection {
  readonly type: string
  readonly connected: boolean
  getSchema(): Promise<DBSchema>
  getTablePreview(tableName: string, limit?: number): Promise<TablePreview>
  executeQuery(sql: string): Promise<QueryResult>
  executeCommand(sql: string): Promise<void>
  createTable(name: string, columns: DBColumn[], foreignKeys?: DBForeignKey[]): Promise<void>
  dropTable(name: string): Promise<void>
  addColumn(tableName: string, column: DBColumn): Promise<void>
  dropColumn(tableName: string, columnName: string): Promise<void>
  modifyColumn(tableName: string, columnName: string, newDef: DBColumn): Promise<void>
  getIndexes(): Promise<DBIndex[]>
  createIndex(name: string, tableName: string, columns: string[], unique?: boolean): Promise<void>
  dropIndex(name: string): Promise<void>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  close(): void
}

export type ConnectionFactory = (config: ConnectionConfig) => Promise<IDBConnection>

export interface ConnectionConfig {
  type: string
  path?: string
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
}

export function parseConnectionString(connStr: string): ConnectionConfig {
  if (
    connStr.startsWith("sqlite://") ||
    (!connStr.includes("://") &&
      (connStr.endsWith(".db") || connStr.endsWith(".sqlite") || connStr.endsWith(".sqlite3")))
  ) {
    const path = connStr.startsWith("sqlite://") ? connStr.replace("sqlite://", "") : connStr.replace("file:", "")
    return { type: "sqlite", path }
  }

  if (connStr.startsWith("postgres://") || connStr.startsWith("postgresql://")) {
    const url = new URL(connStr)
    return {
      type: "postgres",
      host: url.hostname,
      port: parseInt(url.port || "5432"),
      database: url.pathname.slice(1) || undefined,
      username: url.username,
      password: url.password,
    }
  }

  if (connStr.startsWith("mysql://")) {
    const url = new URL(connStr)
    return {
      type: "mysql",
      host: url.hostname,
      port: parseInt(url.port || "3306"),
      database: url.pathname.slice(1) || undefined,
      username: url.username,
      password: url.password,
    }
  }

  if (connStr.startsWith("duckdb://")) {
    return { type: "duckdb", path: connStr.replace("duckdb://", "") }
  }

  return { type: "sqlite", path: connStr }
}
