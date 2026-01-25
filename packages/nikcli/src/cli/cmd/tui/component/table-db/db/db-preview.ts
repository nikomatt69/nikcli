import { DBConnection } from "./db-connection"
import type { DBSchema, TablePreview, TableChange, DBColumn } from "./types"

export class DBPreviewGenerator {
  private _connection: DBConnection | null = null

  constructor(connection: DBConnection) {
    this._connection = connection
  }

  generateSchemaPreview(): TablePreview[] {
    if (!this._connection) {
      return []
    }

    try {
      const schema = this._connection.getSchema()
      return schema.tables.map((table) => ({
        tableName: table.name,
        columns: table.columns,
        sampleData: [],
        rowCount: table.rowCount || 0,
      }))
    } catch {
      return []
    }
  }

  generateTablePreviews(limit: number = 10): TablePreview[] {
    if (!this._connection) {
      return []
    }

    try {
      const schema = this._connection.getSchema()
      return schema.tables.map((table) => {
        const preview = this._connection!.getTablePreview(table.name, limit)
        return preview
      })
    } catch {
      return []
    }
  }

  generateSchemaDiff(oldSchema: DBSchema, newSchema: DBSchema): TableChange[] {
    const changes: TableChange[] = []

    for (const newTable of newSchema.tables) {
      const oldTable = oldSchema.tables.find((t) => t.name === newTable.name)
      if (!oldTable) {
        changes.push({
          type: "add_table",
          tableName: newTable.name,
          newDefinition: {
            name: newTable.name,
            type: "TABLE" as const,
            notNull: false,
            primaryKey: false,
          },
        })
      }
    }

    for (const oldTable of oldSchema.tables) {
      const newTable = newSchema.tables.find((t) => t.name === oldTable.name)
      if (!newTable) {
        changes.push({
          type: "drop_table",
          tableName: oldTable.name,
          oldDefinition: {
            name: oldTable.name,
            type: "TABLE" as const,
            notNull: false,
            primaryKey: false,
          },
        })
      }
    }

    for (const newTable of newSchema.tables) {
      const oldTable = oldSchema.tables.find((t) => t.name === newTable.name)
      if (oldTable) {
        for (const newCol of newTable.columns) {
          const oldCol = oldTable.columns.find((c) => c.name === newCol.name)
          if (!oldCol) {
            changes.push({
              type: "add_column",
              tableName: newTable.name,
              columnName: newCol.name,
              newDefinition: newCol,
            })
          }
        }

        for (const oldCol of oldTable.columns) {
          const newCol = newTable.columns.find((c) => c.name === oldCol.name)
          if (!newCol) {
            changes.push({
              type: "drop_column",
              tableName: newTable.name,
              columnName: oldCol.name,
              oldDefinition: oldCol,
            })
          }
        }
      }
    }

    return changes
  }

  generateSQLPreview(changes: TableChange[]): string {
    const statements: string[] = []

    for (const change of changes) {
      switch (change.type) {
        case "add_table":
          if ((change.newDefinition as unknown as { sql?: string })?.sql) {
            statements.push((change.newDefinition as unknown as { sql: string }).sql)
          } else {
            const columns =
              (
                change.newDefinition as unknown as { columns?: Array<{ name: string; type: string; notNull: boolean }> }
              )?.columns
                ?.map((c) => `${c.name} ${c.type}${c.notNull ? " NOT NULL" : ""}`)
                .join(", ") ?? ""
            statements.push(`CREATE TABLE ${change.tableName} (${columns});`)
          }
          break

        case "drop_table":
          statements.push(`DROP TABLE IF EXISTS ${change.tableName};`)
          break

        case "add_column":
          if (change.newDefinition) {
            const { name, type, notNull, defaultValue } = change.newDefinition
            const parts = [`${name} ${type}`]
            if (notNull) parts.push("NOT NULL")
            if (defaultValue !== undefined) parts.push(`DEFAULT ${defaultValue}`)
            statements.push(`ALTER TABLE ${change.tableName} ADD COLUMN ${parts.join(" ")};`)
          }
          break

        case "drop_column":
          statements.push(`-- Cannot drop column directly in SQLite`)
          statements.push(`-- Table ${change.tableName} column ${change.columnName} would be dropped`)
          break

        case "modify_column":
          statements.push(`-- Column modification requires table recreation`)
          statements.push(`-- ${change.tableName}.${change.columnName}`)
          break
      }
    }

    return statements.join("\n")
  }

  previewFromSQL(sql: string): TablePreview | null {
    if (!this._connection) {
      return null
    }

    try {
      const result = this._connection.executeQuery(sql)

      if (result.columns.length === 0) {
        return null
      }

      const columns: Array<{ name: string; type: string; notNull: boolean; primaryKey: boolean }> = result.columns.map(
        (name) => ({
          name,
          type: "TEXT",
          notNull: false,
          primaryKey: false,
        }),
      )

      return {
        tableName: "Query Result",
        columns,
        sampleData: result.rows.slice(0, 10),
        rowCount: result.rowCount,
      }
    } catch {
      return null
    }
  }

  async previewFromFile(filePath: string): Promise<TablePreview[]> {
    const connection = new DBConnection(filePath)

    try {
      const schema = connection.getSchema()
      return schema.tables.map((table) => connection.getTablePreview(table.name, 10))
    } catch {
      return []
    }
  }
}
