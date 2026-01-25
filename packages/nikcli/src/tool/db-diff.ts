import * as fs from "fs/promises"
import * as path from "path"
import { detectDBType, DB_EXTENSIONS } from "../cli/cmd/tui/component/table-db/db/types"
import { tableRenderer } from "../cli/cmd/tui/component/table-db/ui/table-renderer"
import type { DBSchema, DBTable, DBColumn, DBForeignKey, TableChange } from "../cli/cmd/tui/component/table-db/db/types"

const DB_EXTENSIONS_LIST = Object.values(DB_EXTENSIONS).flat()

export function isDBFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return DB_EXTENSIONS_LIST.includes(ext) || ext === ".sql"
}

export async function readDBSchema(filePath: string): Promise<DBSchema | null> {
  try {
    const bunSqlite = require("bun:sqlite")
    const db = new bunSqlite.Database(filePath)

    const tables: DBTable[] = []
    const sqliteMaster = db
      .prepare(
        `
      SELECT name, sql FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `,
      )
      .all() as Array<{ name: string; sql: string | null }>

    for (const row of sqliteMaster) {
      const tableName = row.name
      const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all() as Array<{
        name: string
        type: string
        notnull: number
        dflt_value: string | null
        pk: number
      }>

      const primaryKey = columns.filter((c) => c.pk > 0).map((c) => c.name)
      const rowCount = db.prepare(`SELECT COUNT(*) as count FROM '${tableName}'`).get() as { count: number } | undefined

      tables.push({
        name: tableName,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type || "TEXT",
          notNull: c.notnull > 0,
          defaultValue: c.dflt_value ?? undefined,
          primaryKey: c.pk > 0,
        })),
        primaryKey,
        rowCount: rowCount?.count ?? 0,
        sql: row.sql ?? undefined,
      })
    }

    db.close()
    return { tables, views: [], indexes: [] }
  } catch {
    return null
  }
}

export async function generateDBDiff(
  filePath: string,
  newContent?: string,
): Promise<{ schema: DBSchema | null; diff: string; changes: TableChange[] } | null> {
  if (!isDBFile(filePath)) return null

  const oldSchema = await readDBSchema(filePath)

  let newSchema: DBSchema | null = null
  let changes: TableChange[] = []

  if (newContent) {
    if (filePath.endsWith(".sql") || filePath.endsWith(".prisma")) {
      newSchema = await createDBSchemaFromSQL(newContent)
    }
  } else if (oldSchema) {
    newSchema = oldSchema
  }

  if (!oldSchema && !newSchema) {
    return { schema: null, diff: "", changes: [] }
  }

  const schema = oldSchema ?? newSchema!

  if (oldSchema && newSchema) {
    changes = calculateTableChanges(oldSchema.tables, newSchema.tables)
  }

  const diff = oldSchema ? tableRenderer.renderSchemaOverview(oldSchema.tables) : ""

  return { schema, diff, changes }
}

function calculateTableChanges(oldTables: DBTable[], newTables: DBTable[]): TableChange[] {
  const changes: TableChange[] = []
  const oldTableNames = new Set(oldTables.map((t) => t.name))
  const newTableNames = new Set(newTables.map((t) => t.name))

  for (const newTable of newTables) {
    const oldTable = oldTables.find((t) => t.name === newTable.name)

    if (!oldTable) {
      changes.push({ type: "add_table", tableName: newTable.name })

      for (const col of newTable.columns) {
        changes.push({
          type: "add_column",
          tableName: newTable.name,
          columnName: col.name,
          newDefinition: col,
        })
      }
    } else {
      const oldColumns = new Set(oldTable.columns.map((c) => c.name))
      const newColumns = new Set(newTable.columns.map((c) => c.name))

      for (const col of newTable.columns) {
        if (!oldColumns.has(col.name)) {
          changes.push({
            type: "add_column",
            tableName: newTable.name,
            columnName: col.name,
            newDefinition: col,
          })
        }
      }

      for (const oldCol of oldTable.columns) {
        if (!newColumns.has(oldCol.name)) {
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

  for (const oldTable of oldTables) {
    if (!newTableNames.has(oldTable.name)) {
      changes.push({ type: "drop_table", tableName: oldTable.name })
    }
  }

  return changes
}

export async function createDBSchemaFromSQL(sqlContent: string): Promise<DBSchema> {
  const tables: DBTable[] = []

  const createTableRegex = /CREATE\s+TABLE\s+["`]?(\w+)["`]?\s*\(\s*([^;]*)\s*\)/gi
  let match

  while ((match = createTableRegex.exec(sqlContent)) !== null) {
    const tableName = match[1]
    const columnsDef = match[2]
    const { columns, foreignKeys } = parseColumnsFromDefinition(columnsDef, tableName)
    tables.push({
      name: tableName,
      columns,
      primaryKey: columns.filter((c) => c.primaryKey).map((c) => c.name),
      foreignKeys,
    })
  }

  if (tables.length === 0) {
    const prismaModels = parsePrismaSchema(sqlContent)
    for (const model of prismaModels) {
      tables.push({
        name: model.name,
        columns: model.columns,
        primaryKey: model.columns.filter((c) => c.primaryKey).map((c) => c.name),
        foreignKeys: model.foreignKeys,
      })
    }
  }

  return { tables, views: [], indexes: [] }
}

function parseColumnsFromDefinition(
  columnsDef: string,
  tableName: string,
): { columns: DBColumn[]; foreignKeys: DBForeignKey[] } {
  const columns: DBColumn[] = []
  const foreignKeys: DBForeignKey[] = []

  if (!columnsDef.trim()) {
    return { columns, foreignKeys }
  }

  const columnLines = columnsDef.split(",")

  for (const line of columnLines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const colMatch = trimmed.match(/^["`]?(\w+)["`]?\s+(\w+)(?:\([^)]+\))?/i)
    if (colMatch) {
      const colName = colMatch[1]
      const colType = colMatch[2].toUpperCase()
      const isNotNull = trimmed.toUpperCase().includes("NOT NULL")
      const isPk = trimmed.toUpperCase().includes("PRIMARY KEY")

      const defaultMatch = trimmed.match(/DEFAULT\s+(?:'([^']*)'|"([^"]*)"|(\S+))/i)
      const defaultValue = defaultMatch ? defaultMatch[1] || defaultMatch[2] || defaultMatch[3] : undefined

      columns.push({
        name: colName,
        type: colType,
        notNull: isNotNull,
        primaryKey: isPk,
        defaultValue,
      })

      const fkMatch = trimmed.match(
        /REFERENCES\s+["`]?(\w+)["`]?\s*\(\s*["`]?(\w+)["`]?\s*\)(?:\s+ON\s+DELETE\s+(\w+(?:\s+\w+)?))?/i,
      )
      if (fkMatch) {
        const refTable = fkMatch[1]
        const refColumn = fkMatch[2]
        const onDeleteStr = fkMatch[3]?.toUpperCase().replace(/\s+/g, " ") || "NO ACTION"
        const onDelete =
          onDeleteStr === "CASCADE"
            ? "CASCADE"
            : onDeleteStr === "RESTRICT"
              ? "RESTRICT"
              : onDeleteStr === "SET NULL"
                ? "SET NULL"
                : "NO ACTION"

        foreignKeys.push({
          table: tableName,
          column: colName,
          referencedTable: refTable,
          referencedColumn: refColumn,
          onDelete,
        })
      }
    }
  }

  return { columns, foreignKeys }
}

interface PrismaModel {
  name: string
  columns: DBColumn[]
  foreignKeys: DBForeignKey[]
}

function parsePrismaSchema(content: string): PrismaModel[] {
  const models: PrismaModel[] = []
  const relations: Array<{
    fromModel: string
    fromField: string
    toModel: string
    toField: string
    onDelete?: "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION"
  }> = []

  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/gi
  let match

  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1]
    const body = match[2]
    const columns: DBColumn[] = []

    const lines = body.split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("//")) continue

      if (trimmed.startsWith("@@")) {
        const tableLevelMatch = trimmed.match(/@@\s*(\w+)(?:\([^)]+\))?/)
        if (tableLevelMatch) {
          if (tableLevelMatch[1] === "id") {
            const idFields = extractFieldsFromAttribute(trimmed)
            for (const field of idFields) {
              const col = columns.find((c) => c.name === field)
              if (col) col.primaryKey = true
            }
          } else if (tableLevelMatch[1] === "unique") {
            const uniqueFields = extractFieldsFromAttribute(trimmed)
            for (const field of uniqueFields) {
              const col = columns.find((c) => c.name === field)
              if (col) col.defaultValue = "(unique)"
            }
          }
        }
        continue
      }

      const fieldMatch = trimmed.match(/^(\w+)\s+(\w+(?:\[\])?)(?:\??)(?:\s+@.*)?$/)
      if (fieldMatch) {
        const name = fieldMatch[1]
        const originalType = fieldMatch[2]
        let type = originalType.toUpperCase()
        const isArray = type.includes("[]")
        type = type.replace("[]", "")

        const isId = trimmed.includes("@id")
        const hasDefault = trimmed.includes("@default")
        const isOptional = trimmed.includes("?")

        const relationMatch = trimmed.match(/@relation\("([^"]+)"\)/)
        const relationName = relationMatch?.[1]

        const fieldsMatch = trimmed.match(/fields\s*[:=]\s*\[([^\]]+)\]/i)
        const relationParts = relationName ? relationName.split(",").map((s) => s.trim()) : []

        columns.push({
          name,
          type: mapPrismaType(type),
          notNull: !isOptional || hasDefault || isArray,
          primaryKey: isId,
          defaultValue: hasDefault ? "(default)" : undefined,
        })

        if (relationName && !relationName.includes("fields=") && !relationName.includes("fields:")) {
          const toModel = relationParts.find((p: string) => p.startsWith("to="))?.slice(3) || originalType
          const toField = relationParts.find((p: string) => p.startsWith("references="))?.slice(11) || "id"
          const onDeleteStr = relationParts.find((p: string) => p.startsWith("onDelete="))?.slice(9) || "NO ACTION"
          const onDelete = mapOnDeleteAction(onDeleteStr)

          relations.push({
            fromModel: modelName,
            fromField: name,
            toModel,
            toField,
            onDelete,
          })
        }

        if (fieldsMatch && !isArray) {
          const referencedModel = originalType
          const referencedField = relationParts.find((p: string) => p.startsWith("references="))?.slice(11) || "id"
          const onDeleteStr = relationParts.find((p: string) => p.startsWith("onDelete="))?.slice(9) || "NO ACTION"
          const onDelete = mapOnDeleteAction(onDeleteStr)

          const fkFieldName = fieldsMatch[1].split(",")[0].trim()
          relations.push({
            fromModel: modelName,
            fromField: fkFieldName,
            toModel: referencedModel,
            toField: referencedField,
            onDelete,
          })
        }
      }
    }

    models.push({ name: modelName, columns, foreignKeys: [] })
  }

  for (const rel of relations) {
    const fromModel = models.find((m) => m.name === rel.fromModel)
    if (fromModel) {
      fromModel.foreignKeys.push({
        table: rel.fromModel,
        column: rel.fromField,
        referencedTable: rel.toModel,
        referencedColumn: rel.toField,
        onDelete: rel.onDelete || "NO ACTION",
      })
    }
  }

  return models
}

function extractFieldsFromAttribute(attr: string): string[] {
  const match = attr.match(/\(([^)]+)\)/)
  if (!match) return []
  return match[1].split(",").map((s) => s.trim().replace(/[\[\]"]/g, ""))
}

function mapOnDeleteAction(action: string): "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION" {
  switch (action.toUpperCase()) {
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

function mapPrismaType(prismaType: string): string {
  const typeMap: Record<string, string> = {
    INT: "INTEGER",
    INTEGER: "INTEGER",
    BIGINT: "INTEGER",
    SMALLINT: "INTEGER",
    FLOAT: "REAL",
    DOUBLE: "REAL",
    DECIMAL: "REAL",
    BOOLEAN: "INTEGER",
    DATETIME: "TEXT",
    DATE: "TEXT",
    TIME: "TEXT",
    TIMESTAMP: "TEXT",
    STRING: "TEXT",
    TEXT: "TEXT",
    VARCHAR: "TEXT",
    CHAR: "TEXT",
    BYTES: "BLOB",
    JSON: "TEXT",
    JSONB: "TEXT",
    UUID: "TEXT",
    BYTEA: "BLOB",
  }
  return typeMap[prismaType] || prismaType
}

export function renderDBPreview(schema: DBSchema, terminalWidth?: number): string {
  if (!schema.tables.length) return "Empty database"
  return tableRenderer.renderSchemaOverview(schema.tables, terminalWidth)
}

export function renderDBChanges(changes: TableChange[], terminalWidth?: number): string {
  if (!changes.length) return "No schema changes"
  return tableRenderer.renderDiffSummary(changes, terminalWidth)
}
