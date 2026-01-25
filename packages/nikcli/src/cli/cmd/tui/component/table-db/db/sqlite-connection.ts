import type { DBSchema, DBTable, DBColumn, DBForeignKey, DBIndex, TablePreview, QueryResult } from "./types"
import type { IDBConnection, ConnectionConfig } from "./connections"

export class SQLiteConnection implements IDBConnection {
  readonly type = "sqlite"
  private _path: string
  private _db: any = null
  private _transactionMode = false

  constructor(config: ConnectionConfig) {
    this._path = config.path || ":memory:"
  }

  get connected(): boolean {
    return this._db !== null
  }

  private _getDb(): any {
    if (!this._db) {
      const bunSqlite = require("bun:sqlite")
      this._db = new bunSqlite.Database(this._path)
    }
    return this._db
  }

  async getSchema(): Promise<DBSchema> {
    const tables = this._getSqliteTables()
    const views = this._getSqliteViews()
    const indexes = this._getSqliteIndexes()
    return { tables, views, indexes }
  }

  private _getSqliteTables(): DBTable[] {
    const db = this._getDb()
    const tables: DBTable[] = []

    try {
      const sqliteMaster = db
        .prepare(
          `
        SELECT name, sql FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
        )
        .all()

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
      const views = db
        .prepare(
          `
        SELECT name, sql FROM sqlite_master 
        WHERE type='view'
        ORDER BY name
      `,
        )
        .all()

      return views
        .filter((v: any): v is { name: string; sql: string } => v.sql !== null)
        .map((v: any) => ({ name: v.name, sql: v.sql }))
    } catch {
      return []
    }
  }

  private _getSqliteIndexes(): DBIndex[] {
    const db = this._getDb()
    try {
      const indexes = db
        .prepare(
          `
        SELECT name, tbl_name, sql FROM sqlite_master 
        WHERE type='index' AND name NOT LIKE 'sqlite_%autoindex_%'
      `,
        )
        .all()

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
      const info = db.prepare(`PRAGMA index_info('${indexName}')`).all()
      return info.map((c: any) => c.name)
    } catch {
      return []
    }
  }

  private _getTableInfo(tableName: string): DBColumn[] {
    const db = this._getDb()
    const info = db.prepare(`PRAGMA table_info('${tableName}')`).all()

    return info.map((col: any) => ({
      name: col.name,
      type: col.type || "TEXT",
      notNull: col.notnull > 0,
      defaultValue: col.dflt_value ?? undefined,
      primaryKey: col.pk > 0,
    }))
  }

  private _getForeignKeys(tableName: string): DBForeignKey[] {
    const db = this._getDb()
    try {
      const fkInfo = db.prepare(`PRAGMA foreign_key_list('${tableName}')`).all()

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
    const result = db.prepare(`SELECT COUNT(*) as count FROM '${tableName}'`).get()
    return result?.count ?? 0
  }

  async getTablePreview(tableName: string, limit: number = 10): Promise<TablePreview> {
    const db = this._getDb()
    const schema = await this.getSchema()
    const table = schema.tables.find((t) => t.name === tableName)

    if (!table) {
      return { tableName, columns: [], sampleData: [], rowCount: 0 }
    }

    const data = db.prepare(`SELECT * FROM '${tableName}' LIMIT ${limit}`).all()

    return {
      tableName,
      columns: table.columns,
      sampleData: data as any[],
      rowCount: table.rowCount ?? 0,
    }
  }

  async executeQuery(sql: string): Promise<QueryResult> {
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

  async executeCommand(sql: string): Promise<void> {
    const db = this._getDb()
    db.prepare(sql).run()
  }

  async createTable(name: string, columns: DBColumn[], foreignKeys?: DBForeignKey[]): Promise<void> {
    const columnDefs = columns.map((col) => {
      let def = `${col.name} ${col.type}`
      if (col.notNull) def += " NOT NULL"
      if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`
      if (col.primaryKey) def += " PRIMARY KEY"
      return def
    })

    const fkDefs =
      foreignKeys?.map(
        (fk) =>
          `FOREIGN KEY (${fk.column}) REFERENCES ${fk.referencedTable}(${fk.referencedColumn}) ON DELETE ${fk.onDelete}`,
      ) || []

    const sql = `CREATE TABLE ${name} (${columnDefs.concat(fkDefs).join(", ")})`
    await this.executeCommand(sql)
  }

  async dropTable(name: string): Promise<void> {
    await this.executeCommand(`DROP TABLE IF EXISTS ${name}`)
  }

  async addColumn(tableName: string, column: DBColumn): Promise<void> {
    let sql = `ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.type}`
    if (column.notNull) sql += " NOT NULL"
    if (column.defaultValue) sql += ` DEFAULT ${column.defaultValue}`
    await this.executeCommand(sql)
  }

  async dropColumn(tableName: string, columnName: string): Promise<void> {
    await this.executeCommand(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`)
  }

  async modifyColumn(tableName: string, columnName: string, newDef: DBColumn): Promise<void> {
    await this.executeCommand(`ALTER TABLE ${tableName} RENAME COLUMN ${columnName} TO ${newDef.name}`)
    if (newDef.type !== "TEXT") {
      const db = this._getDb()
      db.prepare(`ALTER TABLE ${tableName} ALTER COLUMN ${newDef.name} TYPE ${newDef.type}`).run()
    }
  }

  async getIndexes(): Promise<DBIndex[]> {
    return this._getSqliteIndexes()
  }

  async createIndex(name: string, tableName: string, columns: string[], unique: boolean = false): Promise<void> {
    const uniqueStr = unique ? " UNIQUE" : ""
    const cols = columns.join(", ")
    await this.executeCommand(`CREATE${uniqueStr} INDEX IF NOT EXISTS ${name} ON ${tableName} (${cols})`)
  }

  async dropIndex(name: string): Promise<void> {
    await this.executeCommand(`DROP INDEX IF EXISTS ${name}`)
  }

  async beginTransaction(): Promise<void> {
    this._transactionMode = true
    await this.executeCommand("BEGIN TRANSACTION")
  }

  async commit(): Promise<void> {
    await this.executeCommand("COMMIT")
    this._transactionMode = false
  }

  async rollback(): Promise<void> {
    await this.executeCommand("ROLLBACK")
    this._transactionMode = false
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
