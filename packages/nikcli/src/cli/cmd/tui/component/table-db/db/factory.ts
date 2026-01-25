import type { IDBConnection, ConnectionConfig } from "./connections"
import { parseConnectionString } from "./connections"
import { SQLiteConnection } from "./sqlite-connection"
import { PostgresConnection } from "./postgres-connection"
import { MySQLConnection } from "./mysql-connection"

export class ConnectionFactory {
  private static _instances = new Map<string, IDBConnection>()

  static async create(config: string | ConnectionConfig): Promise<IDBConnection> {
    const resolvedConfig = typeof config === "string" ? parseConnectionString(config) : config

    const key = this._getConnectionKey(resolvedConfig)
    if (this._instances.has(key)) {
      const existing = this._instances.get(key)!
      if (existing.connected) {
        return existing
      }
    }

    let connection: IDBConnection

    switch (resolvedConfig.type) {
      case "postgres":
        connection = new PostgresConnection(resolvedConfig)
        break
      case "mysql":
        connection = new MySQLConnection(resolvedConfig)
        break
      case "sqlite":
      default:
        connection = new SQLiteConnection(resolvedConfig)
        break
    }

    this._instances.set(key, connection)
    return connection
  }

  private static _getConnectionKey(config: ConnectionConfig): string {
    if (config.path) return `sqlite:${config.path}`
    return `${config.type}://${config.host}:${config.port}/${config.database}`
  }

  static async get(key: string): Promise<IDBConnection | undefined> {
    return this._instances.get(key)
  }

  static async close(key: string): Promise<void> {
    const conn = this._instances.get(key)
    if (conn) {
      conn.close()
      this._instances.delete(key)
    }
  }

  static async closeAll(): Promise<void> {
    for (const conn of this._instances.values()) {
      conn.close()
    }
    this._instances.clear()
  }
}

export function createConnection(connStr: string): Promise<IDBConnection> {
  return ConnectionFactory.create(connStr)
}

export { parseConnectionString }

export function getConnection(key: string): Promise<IDBConnection | undefined> {
  return ConnectionFactory.get(key)
}

export function closeConnection(key: string): Promise<void> {
  return ConnectionFactory.close(key)
}
