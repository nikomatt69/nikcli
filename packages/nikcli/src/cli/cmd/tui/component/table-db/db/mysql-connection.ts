import type { DBSchema, DBTable, DBColumn, DBForeignKey, DBIndex, TablePreview, QueryResult } from "./types"
import type { IDBConnection, ConnectionConfig } from "./connections"

export class MySQLConnection implements IDBConnection {
  readonly type = "mysql"
  private _config: ConnectionConfig
  private _connection: any = null

  constructor(config: ConnectionConfig) {
    this._config = config
  }

  get connected(): boolean {
    return this._connection !== null
  }

  private async _getConnection(): Promise<any> {
    if (!this._connection) {
      const mysql = await import("mysql2/promise")
      this._connection = await mysql.default.createConnection({
        host: this._config.host,
        port: this._config.port || 3306,
        database: this._config.database,
        user: this._config.username,
        password: this._config.password,
      })
    }
    return this._connection
  }

  async getSchema(): Promise<DBSchema> {
    const conn = await this._getConnection()
    const tables = await this._getMySQLTables(conn)
    const views = await this._getMySQLViews(conn)
    const indexes = await this._getMySQLIndexes(conn)
    return { tables, views, indexes }
  }

  private async _getMySQLTables(conn: any): Promise<DBTable[]> {
    const [rows] = await conn.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)

    const tables: DBTable[] = []
    for (const row of rows as any[]) {
      const tableName = row.TABLE_NAME
      const columns = await this._getMySQLTableInfo(conn, tableName)
      const rowCount = await this._getMySQLRowCount(conn, tableName)
      const foreignKeys = await this._getMySQLForeignKeys(conn, tableName)

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

  private async _getMySQLTableInfo(conn: any, tableName: string): Promise<DBColumn[]> {
    const [rows] = await conn.query(
      `
      SELECT column_name, data_type, is_nullable, column_default, extra
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY ordinal_position
    `,
      [tableName],
    )

    const pkResult = await conn.query(
      `
      SELECT column_name
      FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = 'PRIMARY'
    `,
      [tableName],
    )

    const pkColumns = new Set((pkResult[0] as any[]).map((r: any) => r.column_name))

    return (rows as any[]).map((col: any) => ({
      name: col.COLUMN_NAME,
      type: col.DATA_TYPE.toUpperCase(),
      notNull: col.IS_NULLABLE === "NO",
      defaultValue: col.COLUMN_DEFAULT || undefined,
      primaryKey: pkColumns.has(col.COLUMN_NAME),
    }))
  }

  private async _getMySQLRowCount(conn: any, tableName: string): Promise<number> {
    try {
      const [rows] = await conn.query(`SELECT COUNT(*) as count FROM ${tableName}`)
      return (rows as any[])[0]?.count || 0
    } catch {
      return 0
    }
  }

  private async _getMySQLForeignKeys(conn: any, tableName: string): Promise<DBForeignKey[]> {
    const [rows] = await conn.query(
      `
      SELECT
        column_name,
        referenced_table_name,
        referenced_column_name,
        delete_rule
      FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND referenced_table_name IS NOT NULL
    `,
      [tableName],
    )

    return (rows as any[]).map((row: any) => ({
      table: tableName,
      column: row.COLUMN_NAME,
      referencedTable: row.REFERENCED_TABLE_NAME,
      referencedColumn: row.REFERENCED_COLUMN_NAME,
      onDelete: this._mapMySQLOnDelete(row.DELETE_RULE),
    }))
  }

  private _mapMySQLOnDelete(rule: string): "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION" {
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

  private async _getMySQLViews(conn: any): Promise<Array<{ name: string; sql: string }>> {
    const [rows] = await conn.query(`
      SELECT table_name AS name, view_definition
      FROM information_schema.views
      WHERE table_schema = DATABASE()
      ORDER BY table_name
    `)

    return (rows as any[]).map((row: any) => ({
      name: row.name,
      sql: row.view_definition || "",
    }))
  }

  private async _getMySQLIndexes(conn: any): Promise<DBIndex[]> {
    const [rows] = await conn.query(`
      SELECT index_name, table_name, non_unique, index_columns
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
      ORDER BY table_name, index_name
    `)

    const indexMap = new Map<string, DBIndex>()
    for (const row of rows as any[]) {
      const key = `${row.TABLE_NAME}_${row.INDEX_NAME}`
      if (!indexMap.has(key)) {
        indexMap.set(key, {
          name: row.INDEX_NAME,
          tableName: row.TABLE_NAME,
          columns: [],
          unique: row.NON_UNIQUE === 0,
        })
      }
      indexMap.get(key)!.columns.push(row.COLUMN_NAME)
    }

    return Array.from(indexMap.values())
  }

  async getTablePreview(tableName: string, limit: number = 10): Promise<TablePreview> {
    const conn = await this._getConnection()
    const schema = await this.getSchema()
    const table = schema.tables.find((t) => t.name === tableName)

    if (!table) {
      return { tableName, columns: [], sampleData: [], rowCount: 0 }
    }

    const [rows] = await conn.query(`SELECT * FROM ${tableName} LIMIT ?`, [limit])

    return {
      tableName,
      columns: table.columns,
      sampleData: rows as any[],
      rowCount: table.rowCount ?? 0,
    }
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const conn = await this._getConnection()
    const startTime = Date.now()

    try {
      const isSelect = sql.trim().toUpperCase().startsWith("SELECT")

      if (isSelect) {
        const [rows, fields] = await conn.query(sql)
        const columns = fields ? fields.map((f: any) => f.name) : []

        return {
          columns,
          rows: rows as any[],
          rowCount: Array.isArray(rows) ? rows.length : 0,
          executionTime: Date.now() - startTime,
        }
      } else {
        const [result] = await conn.query(sql)
        return {
          columns: ["affected_rows"],
          rows: [{ affected_rows: (result as any).affectedRows || 0 }],
          rowCount: 1,
          executionTime: Date.now() - startTime,
        }
      }
    } catch (error) {
      throw new Error(`Query failed: ${error}`)
    }
  }

  async executeCommand(sql: string): Promise<void> {
    const conn = await this._getConnection()
    await conn.query(sql)
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
    await this.executeCommand(`ALTER TABLE ${tableName} CHANGE ${columnName} ${newDef.name} ${newDef.type}`)
  }

  async getIndexes(): Promise<DBIndex[]> {
    return this._getMySQLIndexes(await this._getConnection())
  }

  async createIndex(name: string, tableName: string, columns: string[], unique: boolean = false): Promise<void> {
    const uniqueStr = unique ? " UNIQUE" : ""
    const cols = columns.join(", ")
    await this.executeCommand(`CREATE${uniqueStr} INDEX ${name} ON ${tableName} (${cols})`)
  }

  async dropIndex(name: string): Promise<void> {
    await this.executeCommand(`DROP INDEX IF EXISTS ${name}`)
  }

  async beginTransaction(): Promise<void> {
    const conn = await this._getConnection()
    await conn.beginTransaction()
  }

  async commit(): Promise<void> {
    const conn = await this._getConnection()
    await conn.commit()
  }

  async rollback(): Promise<void> {
    const conn = await this._getConnection()
    await conn.rollback()
  }

  async close(): Promise<void> {
    if (this._connection) {
      await this._connection.end()
      this._connection = null
    }
  }

  static async testConnection(config: ConnectionConfig): Promise<boolean> {
    try {
      const mysql = await import("mysql2/promise")
      const conn = await mysql.default.createConnection({
        host: config.host,
        port: config.port || 3306,
        database: config.database,
        user: config.username,
        password: config.password,
      })
      await conn.query("SELECT 1")
      await conn.end()
      return true
    } catch {
      return false
    }
  }
}
