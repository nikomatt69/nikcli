import type { Plugin, PluginInput } from "@nikcli-ai/plugin"
import { tool } from "@nikcli-ai/plugin"

type ConnectionMap = Map<string, any>

const connections: ConnectionMap = new Map()

type DbType = "sqlite" | "postgres" | "mysql"

function parseConnectionString(connStr: string): { type: DbType; config: any } {
  if (
    connStr.startsWith("sqlite://") ||
    connStr.endsWith(".db") ||
    connStr.endsWith(".sqlite") ||
    connStr.endsWith(".sqlite3")
  ) {
    const path = connStr.startsWith("sqlite://") ? connStr.replace("sqlite://", "") : connStr
    return { type: "sqlite", config: { path } }
  }

  if (connStr.startsWith("postgres://") || connStr.startsWith("postgresql://")) {
    const url = new URL(connStr)
    return {
      type: "postgres",
      config: {
        host: url.hostname,
        port: parseInt(url.port || "5432"),
        user: url.username,
        password: url.password,
        database: url.pathname.slice(1),
      },
    }
  }

  if (connStr.startsWith("mysql://")) {
    const url = new URL(connStr)
    return {
      type: "mysql",
      config: {
        host: url.hostname,
        port: parseInt(url.port || "3306"),
        user: url.username,
        password: url.password,
        database: url.pathname.slice(1),
      },
    }
  }

  return { type: "sqlite", config: { path: connStr } }
}

export const DatabasePlugin: Plugin = async (_input: PluginInput) => {
  return {
    tool: {
    db_connect: tool({
        description: "Connect to a database and store the connection for future use",
        args: {
          name: tool.schema.string().describe("Connection name/alias"),
          connectionString: tool.schema
            .string()
            .describe(
              "Connection string (e.g., sqlite:./db.sqlite, postgres://user:pass@host/db, mysql://user:pass@host/db)",
            ),
        },
        async execute(args, _ctx) {
          try {
            const { type, config } = parseConnectionString(args.connectionString)

            if (type === "sqlite") {
              const { Database } = await import("bun:sqlite")
              const db = new Database(config.path)
              connections.set(args.name, { type, db })
              return `Connected to SQLite: ${config.path}`
            }

            if (type === "postgres") {
              const postgres = await import("postgres")
              const client = postgres.default(config)
              connections.set(args.name, { type, client })
              return `Connected to PostgreSQL: ${config.host}/${config.database}`
            }

            if (type === "mysql") {
              const mysql = await import("mysql2/promise")
              const client = await mysql.default.createConnection(config)
              connections.set(args.name, { type, client })
              return `Connected to MySQL: ${config.host}/${config.database}`
            }

            return "Unknown database type"
          } catch (err) {
            return `Connection failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      db_query: tool({
        description: "Execute a SELECT query on a connected database",
        args: {
          connection: tool.schema.string().describe("Connection name from db_connect"),
          query: tool.schema.string().describe("SQL SELECT query"),
        },
        async execute(args, _ctx) {
          const conn = connections.get(args.connection)
          if (!conn) return `Error: Connection "${args.connection}" not found. Use db_connect first.`

          try {
            let result: any

            if (conn.type === "sqlite") {
              const stmt = conn.db.prepare(args.query)
              result = stmt.all()
            } else if (conn.type === "postgres") {
              result = await conn.client.unsafe(args.query)
            } else if (conn.type === "mysql") {
              const [rows] = await conn.client.query(args.query)
              result = rows
            }

            if (!result?.length) return "No results"

            const formatted = result
              .slice(0, 20)
              .map((row: any) => {
                const cols = Object.entries(row)
                  .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                  .join(", ")
                return `{ ${cols} }`
              })
              .join("\n")

            const more = result.length > 20 ? `\n... and ${result.length - 20} more rows` : ""
            return `Results (${result.length}):\n${formatted}${more}`
          } catch (err) {
            return `Query error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      db_execute: tool({
        description: "Execute a DML or DDL statement (INSERT, UPDATE, DELETE, CREATE, ALTER)",
        args: {
          connection: tool.schema.string().describe("Connection name from db_connect"),
          sql: tool.schema.string().describe("SQL statement to execute"),
        },
        async execute(args, _ctx) {
          const conn = connections.get(args.connection)
          if (!conn) return `Error: Connection "${args.connection}" not found. Use db_connect first.`

          try {
            let result: any

            if (conn.type === "sqlite") {
              const stmt = conn.db.prepare(args.sql)
              result = { changes: stmt.run(), lastInsertRowid: conn.db.lastInsertRowid }
            } else if (conn.type === "postgres") {
              const res = await conn.client.unsafe(args.sql)
              result = { rowCount: res.count }
            } else if (conn.type === "mysql") {
              const [resultSet] = await conn.client.query(args.sql)
              result = { affectedRows: resultSet.affectedRows, insertId: resultSet.insertId }
            }

            return `Executed successfully.\n${JSON.stringify(result, null, 2)}`
          } catch (err) {
            return `Execution error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      db_tables: tool({
        description: "List all tables in a connected database",
        args: {
          connection: tool.schema.string().describe("Connection name from db_connect"),
        },
        async execute(args, _ctx) {
          const conn = connections.get(args.connection)
          if (!conn) return `Error: Connection "${args.connection}" not found. Use db_connect first.`

          try {
            let tables: string[] = []

            if (conn.type === "sqlite") {
              const stmt = conn.db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
              )
              tables = stmt.all().map((r: any) => r.name)
            } else if (conn.type === "postgres") {
              const result = await conn.client.unsafe("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
              tables = result.map((r: any) => r.tablename)
            } else if (conn.type === "mysql") {
              const [rows] = await conn.client.query("SHOW TABLES")
              tables = rows.map((r: any) => Object.values(r)[0])
            }

            if (!tables.length) return "No tables found"

            return `Tables:\n${tables.map((t) => `- ${t}`).join("\n")}`
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      db_describe: tool({
        description: "Describe the structure of a table (columns, types, constraints)",
        args: {
          connection: tool.schema.string().describe("Connection name from db_connect"),
          table: tool.schema.string().describe("Table name"),
        },
        async execute(args, _ctx) {
          const conn = connections.get(args.connection)
          if (!conn) return `Error: Connection "${args.connection}" not found. Use db_connect first.`

          try {
            let columns: any[] = []

            if (conn.type === "sqlite") {
              const stmt = conn.db.prepare(`PRAGMA table_info("${args.table}")`)
              columns = stmt.all().map((r: any) => ({
                name: r.name,
                type: r.type,
                notnull: r.notnull ? "YES" : "NO",
                dflt_value: r.dflt_value,
                pk: r.pk ? "YES" : "NO",
              }))
            } else if (conn.type === "postgres") {
              const result = await conn.client`
                SELECT column_name, data_type, is_nullable, column_default, is_primary
                FROM information_schema.columns c
                LEFT JOIN (
                  SELECT kcu.column_name as is_primary
                  FROM information_schema.table_constraints tc
                  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
                  WHERE tc.table_name = ${args.table} AND tc.constraint_type = 'PRIMARY KEY'
                ) p ON c.column_name = p.is_primary
                WHERE c.table_name = ${args.table}
              `
              columns = result
            } else if (conn.type === "mysql") {
              const [rows] = await conn.client.query(`DESCRIBE \`${args.table}\``)
              columns = rows.map((r: any) => ({
                name: r.Field,
                type: r.Type,
                notnull: r.Null,
                dflt_value: r.Default,
                pk: r.Key === "PRI" ? "YES" : "NO",
              }))
            }

            if (!columns.length) return `Table "${args.table}" not found or empty`

            const formatted = columns
              .map((c) => {
                const pk = c.pk === "YES" || c.pk === true ? " [PK]" : ""
                return `- ${c.name}: ${c.type}${pk}`
              })
              .join("\n")

            return `Table: ${args.table}\n\nColumns:\n${formatted}`
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      db_disconnect: tool({
        description: "Close a database connection",
        args: {
          connection: tool.schema.string().describe("Connection name to close"),
        },
        async execute(args, _ctx) {
          const conn = connections.get(args.connection)
          if (!conn) return `Error: Connection "${args.connection}" not found.`

          try {
            if (conn.type === "sqlite") {
              conn.db.close()
            } else if (conn.type === "postgres") {
              await conn.client.end()
            } else if (conn.type === "mysql") {
              await conn.client.end()
            }

            connections.delete(args.connection)
            return `Disconnected from ${args.connection}`
          } catch (err) {
            return `Error closing connection: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),
    },
  }
}

export default DatabasePlugin
