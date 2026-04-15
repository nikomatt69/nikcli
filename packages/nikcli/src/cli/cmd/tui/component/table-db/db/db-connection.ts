import type { DBSchema, DBTable, DBColumn, TablePreview, QueryResult } from "./types"
import { detectDBType } from "./types"

/** Safely escape a SQLite identifier by wrapping in double-quotes and doubling any internal double-quotes. */
function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export class DBConnection {
  private _path: string
  private _dbType: ReturnType<typeof detectDBType>
  private _db: any = null

  constructor(path: string) {
    this._path = path
    this._dbType = detectDBType(path)
  }

  get type() { return this._dbType }
  get path() { return this._path }

  private _getDb(): any {
    if (!this._db) {
      const bunSqlite = require("bun:sqlite")
      this._db = new bunSqlite.Database(this._path)
    }
    return this._db
  }

  getSchema(): DBSchema {
    return this._getSqliteSchema()
  }

  private _getSqliteSchema(): DBSchema {
    const tables = this._getSqliteTables()
    const views = this._getSqliteViews()
    const indexes = this._getSqliteIndexes()
    return { tables, views, indexes }
  }

  private _getSqliteTables(): DBTable[] {
    const db = this._getDb()
    const tables: DBTable[] = []

    try {
      const sqliteMaster = db.prepare(`
        SELECT name, sql FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all()

      for (const row of sqliteMaster) {
        const tableName = row.name
        const columnsInfo = this._getTableInfo(tableName)
        const rowCount = this._getRowCount(tableName)

        tables.push({
          name: tableName,
          columns: columnsInfo,
          primaryKey: columnsInfo.filter((c: DBColumn) => c.primaryKey).map((c: DBColumn) => c.name),
          foreignKeys: this._getForeignKeys(tableName),
          rowCount,
          sql: row.sql ?? undefined,
        })
      }
    } catch {
      return []
    }

    return tables
  }

  private _getSqliteViews(): Array<{ name: string; sql: string }> {
    const db = this._getDb()
    try {
      const views = db.prepare(`
        SELECT name, sql FROM sqlite_master 
        WHERE type='view'
        ORDER BY name
      `).all()

      return views
        .filter((v: any): v is { name: string; sql: string } => v.sql !== null)
        .map((v: any) => ({ name: v.name, sql: v.sql }))
    } catch {
      return []
    }
  }

  private _getSqliteIndexes(): Array<{ name: string; tableName: string; columns: string[]; unique: boolean }> {
    const db = this._getDb()
    try {
      const indexes = db.prepare(`
        SELECT name, tbl_name, sql FROM sqlite_master 
        WHERE type='index' AND name NOT LIKE 'sqlite_%autoindex_%'
      `).all()

      return indexes.map((idx: any) => ({
        name: idx.name,
        tableName: idx.tbl_name,
        columns: this._parseIndexColumns(idx.name),
        unique: idx.sql?.toUpperCase().includes("UNIQUE") ?? false,
      }))
    } catch {
      return []
    }
  }

  private _parseIndexColumns(indexName: string): string[] {
    const db = this._getDb()
    try {
      const info = db.prepare(`PRAGMA index_info(${escapeIdentifier(indexName)})`).all()
      return info.map((c: any) => c.name)
    } catch {
      return []
    }
  }

  private _getTableInfo(tableName: string): DBColumn[] {
    const db = this._getDb()
    const info = db.prepare(`PRAGMA table_info(${escapeIdentifier(tableName)})`).all()

    return info.map((col: any) => ({
      name: col.name,
      type: col.type || "TEXT",
      notNull: col.notnull > 0,
      defaultValue: col.dflt_value ?? undefined,
      primaryKey: col.pk > 0,
    }))
  }

  private _getForeignKeys(tableName: string): Array<{
    table: string
    column: string
    referencedTable: string
    referencedColumn: string
    onDelete: "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION"
  }> {
    const db = this._getDb()
    try {
      const fkInfo = db.prepare(`PRAGMA foreign_key_list(${escapeIdentifier(tableName)})`).all()

      return fkInfo.map((fk: any) => ({
        table: tableName,
        column: fk.from,
        referencedTable: fk.table,
        referencedColumn: fk.to,
        onDelete: (fk.on_delete?.toUpperCase() as "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION") || "NO ACTION",
      }))
    } catch {
      return []
    }
  }

  private _getRowCount(tableName: string): number {
    const db = this._getDb()
    const result = db.prepare(`SELECT COUNT(*) as count FROM ${escapeIdentifier(tableName)}`).get()
    return result?.count ?? 0
  }

  getTablePreview(tableName: string, limit: number = 10): TablePreview {
    const db = this._getDb()
    const schema = this.getSchema()
    const table = schema.tables.find((t) => t.name === tableName)

    if (!table) {
      return { tableName, columns: [], sampleData: [], rowCount: 0 }
    }

    const safeLimit = Math.max(1, Math.floor(limit))
    const data = db.prepare(`SELECT * FROM ${escapeIdentifier(tableName)} LIMIT ?`).all(safeLimit)

    return {
      tableName,
      columns: table.columns,
      sampleData: data as any[],
      rowCount: table.rowCount ?? 0,
    }
  }

  executeQuery(sql: string): QueryResult {
    const db = this._getDb()
    const startTime = Date.now()

    try {
      const isSelect = sql.trim().toUpperCase().startsWith("SELECT")

      if (isSelect) {
        const result = db.prepare(sql).all()
        const columns = result.length > 0 ? Object.keys(result[0]) : []

        return {
          columns,
          rows: result as any[],
          rowCount: result.length,
          executionTime: Date.now() - startTime,
        }
      } else {
        db.prepare(sql).run()
        return {
          columns: ["changes"],
          rows: [{ changes: 0 }],
          rowCount: 1,
          executionTime: Date.now() - startTime,
        }
      }
    } catch (error) {
      throw new Error(`Query failed: ${error}`)
    }
  }

  close(): void {
    if (this._db) {
      this._db.close()
      this._db = null
    }
  }

  static testConnection(path: string): boolean {
    try {
      const bunSqlite = require("bun:sqlite")
      const db = new bunSqlite.Database(path)
      db.close()
      return true
    } catch {
      return false
    }
  }
}
