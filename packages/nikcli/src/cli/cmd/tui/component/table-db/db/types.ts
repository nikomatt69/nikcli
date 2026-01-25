export interface DBSchema {
  tables: DBTable[]
  views?: DBView[]
  indexes?: DBIndex[]
}

export interface DBTable {
  name: string
  columns: DBColumn[]
  primaryKey: string[]
  foreignKeys?: DBForeignKey[]
  rowCount?: number
  sql?: string
}

export interface DBColumn {
  name: string
  type: string
  notNull: boolean
  defaultValue?: string
  primaryKey: boolean
}

export interface DBForeignKey {
  table: string
  column: string
  referencedTable: string
  referencedColumn: string
  onDelete: "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION"
}

export interface DBView {
  name: string
  sql: string
}

export interface DBIndex {
  name: string
  tableName: string
  columns: string[]
  unique: boolean
}

export interface TablePreview {
  tableName: string
  columns: DBColumn[]
  sampleData: any[]
  rowCount: number
}

export interface TableChange {
  type: "add_table" | "drop_table" | "add_column" | "drop_column" | "modify_column"
  tableName: string
  columnName?: string
  oldDefinition?: DBColumn
  newDefinition?: DBColumn
}

export interface DBEditRequest {
  id: string
  sessionID: string
  type: "db_create" | "db_edit" | "db_query"
  filePath: string
  schema?: DBSchema
  preview?: TablePreview[]
  changes?: TableChange[]
  sql?: string
  always: string[]
  tool?: { messageID: string; callID: string }
}

export type DBConnectionType = "sqlite" | "postgres" | "mysql" | "duckdb" | "sql_file" | "prisma"

export const DB_EXTENSIONS: Record<DBConnectionType, string[]> = {
  sqlite: [".sqlite", ".sqlite3", ".db", ".db3", ".s3db", ".sdb"],
  postgres: [".pgsql", ".postgres", ".psql", ".pg"],
  mysql: [".mysql", ".myd", ".frm"],
  duckdb: [".duckdb", ".db"],
  sql_file: [".sql"],
  prisma: [".prisma"],
}

export function detectDBType(filePath: string): DBConnectionType {
  const ext = filePath.toLowerCase()
  if (DB_EXTENSIONS.sqlite.some((e) => ext.endsWith(e))) return "sqlite"
  if (DB_EXTENSIONS.postgres.some((e) => ext.endsWith(e))) return "postgres"
  if (DB_EXTENSIONS.mysql.some((e) => ext.endsWith(e))) return "mysql"
  if (DB_EXTENSIONS.duckdb.some((e) => ext.endsWith(e))) return "duckdb"
  if (DB_EXTENSIONS.sql_file.some((e) => ext.endsWith(e))) return "sql_file"
  return "sqlite"
}

export interface DBConnectionConfig {
  type: DBConnectionType
  path?: string
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
}

export interface QueryResult {
  columns: string[]
  rows: any[]
  rowCount: number
  executionTime: number
}
