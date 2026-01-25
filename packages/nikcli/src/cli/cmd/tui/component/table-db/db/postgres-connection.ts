import type { DBSchema, DBTable, DBColumn, DBForeignKey, DBIndex, TablePreview, QueryResult } from "./types"
import type { IDBConnection, ConnectionConfig } from "./connections"

export class PostgresConnection implements IDBConnection {
  readonly type = "postgres"
  private _config: ConnectionConfig
  private _pool: any = null

  constructor(config: ConnectionConfig) {
    this._config = config
  }

  get connected(): boolean {
    return this._pool !== null
  }

  private async _getPool(): Promise<any> {
    if (!this._pool) {
      const { default: pg } = await import("pg")
      const { Pool } = pg
      this._pool = new Pool({
        host: this._config.host,
        port: this._config.port || 5432,
        database: this._config.database,
        user: this._config.username,
        password: this._config.password,
      })
    }
    return this._pool
  }

  async getSchema(): Promise<DBSchema> {
    const pool = await this._getPool()
    const tables = await this._getPgTables(pool)
    const views = await this._getPgViews(pool)
    const indexes = await this._getPgIndexes(pool)
    return { tables, views, indexes }
  }

  private async _getPgTables(pool: any): Promise<DBTable[]> {
    const result = await pool.query(`
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)

    const tables: DBTable[] = []
    for (const row of result.rows) {
      const tableName = row.table_name
      const columns = await this._getPgTableInfo(pool, tableName)
      const rowCount = await this._getPgRowCount(pool, tableName)
      const foreignKeys = await this._getPgForeignKeys(pool, tableName)

      tables.push({
        name: tableName,
        columns,
        primaryKey: columns.filter((c) => c.primaryKey).map((c) => c.name),
        foreignKeys,
        rowCount,
      })
    }
    return tables
  }

  private async _getPgTableInfo(pool: any, tableName: string): Promise<DBColumn[]> {
    const result = await pool.query(
      `
      SELECT column_name, data_type, is_nullable, column_default, is_identity
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `,
      [tableName],
    )

    const pkResult = await pool.query(
      `
      SELECT a.attname as column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
    `,
      [tableName],
    )

    const pkColumns = new Set(pkResult.rows.map((r: any) => r.column_name))

    return result.rows.map((col: any) => ({
      name: col.column_name,
      type: col.data_type.toUpperCase(),
      notNull: col.is_nullable === "NO",
      defaultValue: col.column_default || undefined,
      primaryKey: pkColumns.has(col.column_name),
    }))
  }

  private async _getPgRowCount(pool: any, tableName: string): Promise<number> {
    try {
      const result = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`)
      return parseInt(result.rows[0].count) || 0
    } catch {
      return 0
    }
  }

  private async _getPgForeignKeys(pool: any, tableName: string): Promise<DBForeignKey[]> {
    const result = await pool.query(
      `
      SELECT
        kcu.column_name,
        ccu.table_name AS referenced_table,
        kcu.column_name AS referenced_column,
        rc.delete_rule AS on_delete
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = $1
    `,
      [tableName],
    )

    return result.rows.map((row: any) => ({
      table: tableName,
      column: row.column_name,
      referencedTable: row.referenced_table,
      referencedColumn: row.referenced_column,
      onDelete: this._mapPgOnDelete(row.on_delete),
    }))
  }

  private _mapPgOnDelete(rule: string): "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION" {
    switch (rule) {
      case "CASCADE":
        return "CASCADE"
      case "RESTRICT":
        return "RESTRICT"
      case "SET NULL":
        return "SET NULL"
      default:
        return "NO ACTION"
    }
  }

  private async _getPgViews(pool: any): Promise<Array<{ name: string; sql: string }>> {
    const result = await pool.query(`
      SELECT table_name AS name, view_definition
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)

    return result.rows.map((row: any) => ({
      name: row.name,
      sql: row.view_definition || "",
    }))
  }

  private async _getPgIndexes(pool: any): Promise<DBIndex[]> {
    const result = await pool.query(`
      SELECT indexname, tablename, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `)

    return result.rows.map((row: any) => {
      const columns = this._extractPgIndexColumns(row.indexdef)
      return {
        name: row.indexname,
        tableName: row.tablename,
        columns,
        unique: row.indexdef.toUpperCase().includes("UNIQUE"),
      }
    })
  }

  private _extractPgIndexColumns(indexDef: string): string[] {
    const match = indexDef.match(/\(([^)]+)\)/)
    if (!match) return []
    return match[1].split(",").map((c) => c.trim())
  }

  async getTablePreview(tableName: string, limit: number = 10): Promise<TablePreview> {
    const pool = await this._getPool()
    const schema = await this.getSchema()
    const table = schema.tables.find((t) => t.name === tableName)

    if (!table) {
      return { tableName, columns: [], sampleData: [], rowCount: 0 }
    }

    const result = await pool.query(`SELECT * FROM ${tableName} LIMIT $1`, [limit])

    return {
      tableName,
      columns: table.columns,
      sampleData: result.rows as any[],
      rowCount: table.rowCount ?? 0,
    }
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const pool = await this._getPool()
    const startTime = Date.now()

    try {
      const isSelect = sql.trim().toUpperCase().startsWith("SELECT")

      if (isSelect) {
        const result = await pool.query(sql)
        const columns = result.fields.map((f: any) => f.name)

        return {
          columns,
          rows: result.rows as any[],
          rowCount: result.rowCount || 0,
          executionTime: Date.now() - startTime,
        }
      } else {
        const result = await pool.query(sql)
        return {
          columns: ["affected_rows"],
          rows: [{ affected_rows: result.rowCount || 0 }],
          rowCount: 1,
          executionTime: Date.now() - startTime,
        }
      }
    } catch (error) {
      throw new Error(`Query failed: ${error}`)
    }
  }

  async executeCommand(sql: string): Promise<void> {
    const pool = await this._getPool()
    await pool.query(sql)
  }

  async createTable(name: string, columns: DBColumn[], foreignKeys?: DBForeignKey[]): Promise<void> {
    const columnDefs = columns.map((col) => {
      let def = `${col.name} ${col.type}`
      if (col.notNull) def += " NOT NULL"
      if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`
      return def
    })

    const fkDefs =
      foreignKeys?.map(
        (fk) =>
          `FOREIGN KEY (${fk.column}) REFERENCES ${fk.referencedTable}(${fk.referencedColumn}) ON DELETE ${fk.onDelete}`,
      ) || []

    const pkColumns = columns.filter((c) => c.primaryKey).map((c) => c.name)
    const pkDef = pkColumns.length > 0 ? `, PRIMARY KEY (${pkColumns.join(", ")})` : ""

    const sql = `CREATE TABLE ${name} (${columnDefs.concat(fkDefs).join(", ")}${pkDef})`
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
      await this.executeCommand(`ALTER TABLE ${tableName} ALTER COLUMN ${newDef.name} TYPE ${newDef.type}`)
    }
  }

  async getIndexes(): Promise<DBIndex[]> {
    return this._getPgIndexes(await this._getPool())
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
    await this.executeCommand("BEGIN")
  }

  async commit(): Promise<void> {
    await this.executeCommand("COMMIT")
  }

  async rollback(): Promise<void> {
    await this.executeCommand("ROLLBACK")
  }

  async close(): Promise<void> {
    if (this._pool) {
      await this._pool.end()
      this._pool = null
    }
  }

  static async testConnection(config: ConnectionConfig): Promise<boolean> {
    try {
      const { default: pg } = await import("pg")
      const { Pool } = pg
      const pool = new Pool({
        host: config.host,
        port: config.port || 5432,
        database: config.database,
        user: config.username,
        password: config.password,
      })
      await pool.query("SELECT 1")
      await pool.end()
      return true
    } catch {
      return false
    }
  }
}
