import { table, getBorderCharacters } from "table"
import type { DBTable, DBColumn, TablePreview, TableChange, DBSchema } from "../db/types"

export class TableRenderer {
  private config: Parameters<typeof table>[1]
  private defaultTerminalWidth: number = 80

  constructor() {
    this.config = {
      border: getBorderCharacters("honeywell"),
      columnDefault: {
        paddingLeft: 1,
        paddingRight: 1,
      },
      drawHorizontalLine: (rowIndex, rowCount) => {
        return rowIndex === 0 || rowIndex === 1 || rowIndex === rowCount - 1 || rowIndex === rowCount
      },
    }
  }

  private green(text: string): string {
    return `\x1b[32m${text}\x1b[0m`
  }

  private red(text: string): string {
    return `\x1b[31m${text}\x1b[0m`
  }

  private yellow(text: string): string {
    return `\x1b[33m${text}\x1b[0m`
  }

  private cyan(text: string): string {
    return `\x1b[36m${text}\x1b[0m`
  }

  private magenta(text: string): string {
    return `\x1b[35m${text}\x1b[0m`
  }

  private white(text: string): string {
    return `\x1b[37m${text}\x1b[0m`
  }

  private gray(text: string): string {
    return `\x1b[90m${text}\x1b[0m`
  }

  private truncate(text: string, maxWidth: number): string {
    if (text.length <= maxWidth) return text
    return text.slice(0, maxWidth - 3) + "..."
  }

  private getTerminalWidth(): number {
    return process.stdout.columns || this.defaultTerminalWidth
  }

  renderTableList(tables: DBTable[], maxTables: number = 10, terminalWidth?: number): string {
    const width = terminalWidth || this.getTerminalWidth()
    const nameWidth = Math.min(20, Math.max(10, width - 50))

    const data: string[][] = [[this.cyan("Table"), this.cyan("Cols"), this.cyan("Rows"), this.cyan("Type")]]

    for (const t of tables.slice(0, maxTables)) {
      data.push([
        this.green("▦ ") + this.white(this.truncate(t.name, nameWidth)),
        String(t.columns.length),
        this.yellow(String(t.rowCount || "?")),
        this.gray("Table"),
      ])
    }

    return table(data, {
      ...this.config,
      columns: {
        0: { width, alignment: "left" as const },
        1: { width: 5, alignment: "center" as const },
        2: { width: 6, alignment: "center" as const },
        3: { width: 7 },
      },
    })
  }

  renderColumns(tableName: string, columns: DBColumn[], terminalWidth?: number): string {
    const width = terminalWidth || this.getTerminalWidth()
    const nameWidth = Math.min(15, Math.max(8, width - 45))

    const data: string[][] = [[this.cyan("Column"), this.cyan("Type"), this.cyan("Nullable"), this.cyan("Key")]]

    for (const col of columns) {
      const type = this.white(col.type)
      const nullable = col.notNull ? this.red("NOT NULL") : this.green("nullable")
      const key = col.primaryKey ? this.magenta("PRI") : this.gray("")

      data.push([this.truncate(col.name, nameWidth), type, nullable, key])
    }

    return table(data, {
      ...this.config,
      columns: {
        0: { width: nameWidth + 2 },
        1: { width: 10 },
        2: { width: 12 },
        3: { width: 5, alignment: "center" as const },
      },
    })
  }

  renderPreview(preview: TablePreview, terminalWidth?: number): string {
    const width = terminalWidth || this.getTerminalWidth()
    const colWidth = Math.max(8, Math.min(15, Math.floor((width - 10) / preview.columns.length)))

    const data: string[][] = [preview.columns.map((c) => this.cyan(this.truncate(c.name, colWidth)))]

    for (const row of preview.sampleData.slice(0, 5)) {
      data.push(preview.columns.map((c) => this.truncate(String(row[c.name] ?? "NULL"), colWidth)))
    }

    return table(data, {
      ...this.config,
      columns: preview.columns.map(() => ({ width: colWidth, alignment: "left" as const })),
    })
  }

  renderSchemaOverview(tables: DBTable[], terminalWidth?: number): string {
    if (!tables.length) return this.gray("Empty database")

    const width = terminalWidth || this.getTerminalWidth()
    const isCompact = width < 70
    const nameWidth = isCompact ? 12 : 18

    const headers = isCompact
      ? [this.cyan("▦"), this.cyan("Table"), this.cyan("Cols"), this.cyan("PK")]
      : [this.cyan("▦"), this.cyan("Table Name"), this.cyan("Columns"), this.cyan("Primary Key"), this.cyan("FKs")]

    const data: string[][] = [headers]

    for (const t of tables) {
      if (isCompact) {
        data.push([
          this.green("◈"),
          this.white(this.truncate(t.name, nameWidth)),
          String(t.columns.length),
          t.primaryKey.length > 0 ? this.yellow(t.primaryKey.join(",")) : this.gray("-"),
        ])
      } else {
        data.push([
          this.green("◈"),
          this.white(this.truncate(t.name, nameWidth)),
          String(t.columns.length),
          t.primaryKey.length > 0 ? this.yellow(this.truncate(t.primaryKey.join(","), 12)) : this.gray("-"),
          t.foreignKeys?.length ? this.cyan(String(t.foreignKeys.length)) : this.gray("-"),
        ])
      }
    }

    const columnConfig: Record<number, any> = { 0: { alignment: "center" as const } }
    if (!isCompact) {
      columnConfig[4] = { alignment: "center" as const }
    }

    return table(data, { ...this.config, columns: columnConfig })
  }

  renderDiffSummary(changes: TableChange[], terminalWidth?: number): string {
    const width = terminalWidth || this.getTerminalWidth()
    const objWidth = Math.min(40, width - 25)

    const data: string[][] = [[this.cyan("Action"), this.cyan("Object")]]

    for (const c of changes) {
      let icon = ""
      let color = (s: string) => this.white(s)

      switch (c.type) {
        case "add_table":
          icon = "+"
          color = (s: string) => this.green(s)
          break
        case "drop_table":
          icon = "-"
          color = (s: string) => this.red(s)
          break
        case "add_column":
          icon = "+"
          color = (s: string) => this.green(s)
          break
        case "drop_column":
          icon = "-"
          color = (s: string) => this.red(s)
          break
        case "modify_column":
          icon = "~"
          color = (s: string) => this.yellow(s)
          break
      }

      const obj = c.columnName ? `${c.tableName}.${c.columnName}` : c.tableName

      data.push([color(icon + " " + c.type), color(this.truncate(obj, objWidth))])
    }

    return table(data, {
      ...this.config,
      columns: {
        0: { width: 20 },
        1: { width: objWidth },
      },
    })
  }

  renderSQLContent(sql: string, maxLines: number = 15, terminalWidth?: number): string {
    const width = terminalWidth || this.getTerminalWidth()
    const result: string[] = []

    const lines = sql.split("\n").slice(0, maxLines)
    for (const line of lines) {
      const truncated = this.truncate(line, width - 5)
      const trimmed = truncated.trim()

      if (trimmed.startsWith("CREATE")) {
        result.push(this.green(truncated))
      } else if (trimmed.startsWith("DROP")) {
        result.push(this.red(truncated))
      } else if (trimmed.startsWith("ALTER")) {
        result.push(this.yellow(truncated))
      } else {
        result.push(this.white(truncated))
      }
    }

    if (sql.split("\n").length > maxLines) {
      result.push(this.gray("... more lines"))
    }

    return result.join("\n")
  }

  renderStats(tables: DBTable[]): { tables: number; columns: number; rows: number; pks: number } {
    return {
      tables: tables.length,
      columns: tables.reduce((sum, t) => sum + t.columns.length, 0),
      rows: tables.reduce((sum, t) => sum + (t.rowCount || 0), 0),
      pks: tables.filter((t) => t.primaryKey.length > 0).length,
    }
  }

  renderCompact(tables: DBTable[], terminalWidth?: number): string {
    const width = terminalWidth || this.getTerminalWidth()
    const isSmall = width < 50

    if (isSmall) {
      const data: string[][] = [[this.cyan("▦"), this.cyan("Table")]]
      for (const t of tables) {
        data.push([this.green("◈"), this.white(this.truncate(t.name, 15))])
      }
      return table(data, { ...this.config, columns: { 0: { alignment: "center" as const } } })
    }

    return this.renderSchemaOverview(tables, width)
  }

  renderForeignKeys(
    foreignKeys: Array<{
      column: string
      referencedTable: string
      referencedColumn: string
      onDelete: "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION"
    }>,
    terminalWidth?: number,
  ): string {
    if (!foreignKeys.length) return this.gray("No foreign keys")

    const width = terminalWidth || this.getTerminalWidth()
    const colWidth = Math.min(20, Math.max(12, Math.floor((width - 30) / 3)))

    const data: string[][] = [[this.cyan("Column"), this.cyan("References"), this.cyan("On Delete")]]

    for (const fk of foreignKeys) {
      const col = this.white(this.truncate(fk.column, colWidth))
      const ref = this.cyan(`${this.truncate(fk.referencedTable, colWidth)}.${fk.referencedColumn}`)
      const onDelete =
        fk.onDelete === "CASCADE"
          ? this.yellow(fk.onDelete)
          : fk.onDelete === "RESTRICT"
            ? this.red(fk.onDelete)
            : fk.onDelete === "SET NULL"
              ? this.cyan(fk.onDelete)
              : this.gray(fk.onDelete)

      data.push([col, ref, onDelete])
    }

    return table(data, {
      ...this.config,
      columns: {
        0: { width: colWidth + 2 },
        1: { width: colWidth + 15 },
        2: { width: 12, alignment: "center" as const },
      },
    })
  }

  renderERDiagram(schema: DBSchema, terminalWidth?: number): string {
    if (!schema.tables.length) return "Empty schema"

    const width = terminalWidth || this.getTerminalWidth()
    const tableWidth = Math.min(30, Math.max(28, Math.floor((width - 10) / 2)))
    const lines: string[] = []

    for (const table of schema.tables) {
      const titleLine = this.cyan(table.name)
      const pkCols = table.columns.filter((c) => c.primaryKey)
      const pkDisplay = pkCols.length > 0 ? this.yellow(`[${pkCols.map((c) => c.name).join(", ")}]`) : ""

      lines.push(this.cyan("┌" + "═".repeat(tableWidth - 2) + "┐"))
      lines.push(this.cyan("│") + " " + this.padToWidth(titleLine, tableWidth - 4) + this.cyan(" │"))
      if (pkDisplay) {
        lines.push(this.cyan("│") + " " + this.padToWidth(pkDisplay, tableWidth - 4) + this.cyan(" │"))
      }
      lines.push(this.cyan("├" + "─".repeat(tableWidth - 2) + "┤"))

      for (const col of table.columns) {
        const isPk = col.primaryKey ? this.yellow("◉") : " "
        const isNotNull = col.notNull ? this.red("*") : " "
        const name = this.white(this.truncate(col.name, 10))
        const type = this.gray(this.truncate(col.type, 6))
        const nullable = col.notNull ? "" : this.green("?")
        const defaultVal = col.defaultValue ? this.cyan(`=${this.truncate(col.defaultValue, 4)}`) : ""

        const colLine = `${isPk}${isNotNull} ${name} ${type}${nullable}${defaultVal}`
        lines.push(this.cyan("│") + " " + this.padToWidth(colLine, tableWidth - 4) + this.cyan(" │"))
      }

      if (table.foreignKeys && table.foreignKeys.length > 0) {
        lines.push(this.cyan("├" + "─".repeat(tableWidth - 2) + "┤"))
        for (const fk of table.foreignKeys) {
          const arrow = this.magenta("→")
          const fkLine = `${arrow} ${this.truncate(fk.referencedTable, 10)}.${fk.referencedColumn}`
          const onDelete = fk.onDelete !== "NO ACTION" ? this.yellow(` (${fk.onDelete})`) : ""

          const fullLine = `${fkLine}${onDelete}`
          lines.push(this.cyan("│") + " " + this.padToWidth(fullLine, tableWidth - 4) + this.cyan(" │"))
        }
      }

      lines.push(this.cyan("└" + "─".repeat(tableWidth - 2) + "┘"))
      lines.push("")
    }

    const relLines = this._renderRelations(schema, width, tableWidth)
    lines.push(...relLines)

    lines.push(this.gray("\nLegend: ◉ PK  * NOT NULL  ? Optional  → FK Reference"))

    return lines.join("\n")
  }

  private _renderRelations(schema: DBSchema, width: number, tableWidth: number): string[] {
    const lines: string[] = []
    const relations: string[] = []

    for (const table of schema.tables) {
      if (table.foreignKeys) {
        for (const fk of table.foreignKeys) {
          const rel = `${table.name}.${fk.column} → ${fk.referencedTable}.${fk.referencedColumn}`
          relations.push(rel)
        }
      }
    }

    if (relations.length > 0) {
      lines.push(this.cyan("═".repeat(40)))
      lines.push(this.cyan(" Relationships "))
      lines.push(this.cyan("═".repeat(40)))

      for (const rel of relations) {
        lines.push(this.magentalight(`  ${rel}`))
      }
    }

    return lines
  }

  private magentalight(text: string): string {
    return `\x1b[95m${text}\x1b[0m`
  }

  renderCompactDiagram(schema: DBSchema, terminalWidth?: number): string {
    if (!schema.tables.length) return "Empty schema"

    const width = terminalWidth || this.getTerminalWidth()
    const lines: string[] = []
    lines.push(this.cyan("═".repeat(width)))

    for (const table of schema.tables) {
      const pk = table.primaryKey.length > 0 ? this.yellow(`PK:${table.primaryKey[0]}`) : this.gray("PK:-")
      const fkCount = table.foreignKeys?.length || 0
      const fks = fkCount > 0 ? this.cyan(`${fkCount} FKs`) : this.gray("0 FKs")

      const name = this.white(table.name)
      const cols = this.gray(`${table.columns.length} cols`)

      const line = `│ ${name} │ ${cols} │ ${pk} │ ${fks} │`
      lines.push(line)
    }

    lines.push(this.cyan("═".repeat(width)))

    return lines.join("\n")
  }

  private stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "")
  }

  private visibleLength(text: string): number {
    return this.stripAnsi(text).length
  }

  private padToWidth(text: string, width: number): string {
    const visibleLen = this.visibleLength(text)
    const padding = Math.max(0, width - visibleLen)
    return text + " ".repeat(padding)
  }

  renderFullERDiagram(schema: DBSchema, terminalWidth?: number): string {
    if (!schema.tables.length) return "Empty schema"

    const tableWidth = 52
    const colWidth = 14
    const typeWidth = 10
    const attrWidth = 10

    const lines: string[] = []

    for (const table of schema.tables) {
      const pkCols = table.columns.filter((c) => c.primaryKey)
      const fkCols = table.columns.filter((c) => table.foreignKeys?.some((fk) => fk.column === c.name))

      const titleLine = this.white(table.name)
      const pkLine = pkCols.length > 0 ? this.yellow(`[${pkCols.map((c) => c.name).join(", ")}]`) : ""

      lines.push(this.cyan("┌" + "═".repeat(tableWidth - 2) + "┐"))
      lines.push(this.cyan("│") + " " + this.padToWidth(titleLine, tableWidth - 4) + this.cyan(" │"))
      if (pkLine) {
        lines.push(this.cyan("│") + " " + this.padToWidth(pkLine, tableWidth - 4) + this.cyan(" │"))
      }
      lines.push(this.cyan("├" + "─".repeat(tableWidth - 2) + "┤"))

      const header =
        " " +
        this.yellow("COLUMN").padEnd(colWidth) +
        " " +
        this.cyan("TYPE").padEnd(typeWidth) +
        " " +
        this.cyan("ATTRS")
      lines.push(this.cyan("│") + this.padToWidth(header, tableWidth - 2) + this.cyan("│"))

      for (const col of table.columns) {
        const isPk = col.primaryKey ? this.yellow("PK") : "  "
        const isFk = fkCols.includes(col) ? this.magenta("FK") : "  "
        const nn = col.notNull ? this.red(" NN") : "   "
        const attrs = `${isPk}${isFk}${nn}`.trimEnd()
        const name = this.white(col.name)
        const type = this.gray(col.type)

        const colPart = this.padToWidth(name, colWidth)
        const typePart = this.padToWidth(type, typeWidth)
        const content = ` ${colPart} ${typePart} ${attrs}`
        lines.push(this.cyan("│") + this.padToWidth(content, tableWidth - 2) + this.cyan("│"))
      }

      if (table.foreignKeys && table.foreignKeys.length > 0) {
        lines.push(this.cyan("├" + "─".repeat(tableWidth - 2) + "┤"))
        for (const fk of table.foreignKeys) {
          const arrow = this.magenta("└─▶")
          const ref = this.cyan(`${fk.referencedTable}.${fk.referencedColumn}`)
          const onDelete = fk.onDelete !== "NO ACTION" ? this.yellow(` [${fk.onDelete}]`) : ""

          const content = ` ${arrow} ${ref}${onDelete}`
          lines.push(this.cyan("│") + this.padToWidth(content, tableWidth - 2) + this.cyan("│"))
        }
      }

      lines.push(this.cyan("└" + "─".repeat(tableWidth - 2) + "┘"))
      lines.push("")
    }

    lines.push(this.cyan("═".repeat(50)))
    lines.push(this.cyan(" RELATIONSHIPS "))
    lines.push(this.cyan("═".repeat(50)))

    for (const table of schema.tables) {
      if (table.foreignKeys) {
        for (const fk of table.foreignKeys) {
          lines.push(
            this.magenta(`  ${table.name}.${fk.column}`) +
              this.gray(" ──▶ ") +
              this.cyan(`${fk.referencedTable}.${fk.referencedColumn}`) +
              (fk.onDelete !== "NO ACTION" ? this.yellow(` (${fk.onDelete})`) : ""),
          )
        }
      }
    }

    return lines.join("\n")
  }

  renderDependencyTree(schema: DBSchema, maxDepth: number = 3): string {
    if (!schema.tables.length) return "Empty schema"

    const lines: string[] = []
    const visited = new Map<string, number>()

    const getDepth = (tableName: string): number => {
      if (visited.has(tableName)) return visited.get(tableName)!
      const table = schema.tables.find((t) => t.name === tableName)
      if (!table || !table.foreignKeys || table.foreignKeys.length === 0) {
        visited.set(tableName, 0)
        return 0
      }
      let maxChildDepth = 0
      for (const fk of table.foreignKeys) {
        maxChildDepth = Math.max(maxChildDepth, getDepth(fk.referencedTable))
      }
      visited.set(tableName, maxChildDepth + 1)
      return maxChildDepth + 1
    }

    for (const table of schema.tables) {
      getDepth(table.name)
    }

    const sortedTables = [...schema.tables].sort((a, b) => (visited.get(b.name) || 0) - (visited.get(a.name) || 0))

    const renderTable = (
      tableName: string,
      depth: number,
      prefix: string,
      isLast: boolean,
      siblingIndex: number,
      totalSiblings: number,
    ) => {
      if (depth > maxDepth) return

      const table = schema.tables.find((t) => t.name === tableName)
      if (!table) return

      const fkCount = table.foreignKeys?.length || 0
      const rowCount = table.rowCount || 0
      const meta = this.gray(`(${table.columns.length} cols, ${rowCount} rows)`)

      const icon = fkCount > 0 ? this.cyan("◉") : this.green("◈")
      const name = this.white(tableName)

      lines.push(`${prefix}${isLast ? "└─ " : "├─ "}${icon} ${name} ${meta}`)

      if (table.foreignKeys && table.foreignKeys.length > 0) {
        const newPrefix = prefix + (isLast ? "    " : "│   ")

        for (let i = 0; i < table.foreignKeys.length; i++) {
          const fk = table.foreignKeys[i]
          const isLastFk = i === table.foreignKeys.length - 1
          const fkPrefix = newPrefix + (isLastFk ? "    " : "│   ")

          const relIcon = this.magenta("→")
          const relTarget = this.cyan(fk.referencedTable)
          const relMeta = this.gray(`(${fk.column} → ${fk.referencedColumn})`)

          lines.push(`${fkPrefix}└─ ${relIcon} ${relTarget} ${relMeta}`)

          renderTable(fk.referencedTable, depth + 1, fkPrefix + "    ", true, 0, 0)
        }
      }
    }

    for (let i = 0; i < sortedTables.length; i++) {
      const table = sortedTables[i]
      if (table.foreignKeys?.length === 0) {
        const isLast = i === sortedTables.length - 1
        const meta = this.gray(`(${table.columns.length} cols, ${table.rowCount || 0} rows)`)
        lines.push(`${isLast ? "└─ " : "├─ "}${this.green("◈")} ${this.white(table.name)} ${meta}`)
      }
    }

    const rootTables = sortedTables.filter((t) => !t.foreignKeys || t.foreignKeys.length === 0)
    const dependentTables = sortedTables.filter((t) => t.foreignKeys && t.foreignKeys.length > 0)

    if (dependentTables.length > 0 && rootTables.length > 0) {
      lines.push("")
    }

    for (let i = 0; i < dependentTables.length; i++) {
      const table = dependentTables[i]
      const isLast = i === dependentTables.length - 1
      renderTable(table.name, 0, "", isLast, i, dependentTables.length)
    }

    lines.push("")
    lines.push(this.gray("Legend: ◉ Has FKs  ◈ No FKs  → References"))

    return lines.join("\n")
  }
}

export const tableRenderer = new TableRenderer()
