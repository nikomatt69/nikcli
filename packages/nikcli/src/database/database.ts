import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import fs from "fs"
import nodePath from "path"
import { Context, Effect, Layer } from "effect"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { DatabaseMigration } from "./migration"
import * as schema from "./schema"

export namespace Database {
  const log = Log.create({ service: "database" })

  export type Schema = typeof schema
  export type Client = BunSQLiteDatabase<Schema>

  export interface Interface {
    readonly db: Client
    readonly native: BunDatabase
    readonly filename: string
  }

  export class Service extends Context.Service<Service, Interface>()("Database.Service") {}

  export function path() {
    const configured = process.env.NIKCLI_DB
    if (configured) {
      if (configured === ":memory:" || nodePath.isAbsolute(configured)) return configured
      return nodePath.join(Global.Path.data, configured)
    }
    return nodePath.join(Global.Path.data, "nikcli.db")
  }

  function open(filename: string): Interface {
    if (filename !== ":memory:") fs.mkdirSync(nodePath.dirname(filename), { recursive: true })

    log.info("opening database", { filename })
    const native = new BunDatabase(filename, { create: true })
    native.exec("PRAGMA journal_mode = WAL")
    native.exec("PRAGMA synchronous = NORMAL")
    native.exec("PRAGMA busy_timeout = 5000")
    native.exec("PRAGMA cache_size = -64000")
    native.exec("PRAGMA foreign_keys = ON")
    DatabaseMigration.apply(native)
    native.exec("PRAGMA wal_checkpoint(PASSIVE)")

    return {
      db: drizzle(native, { schema }),
      native,
      filename,
    }
  }

  export function layerFromPath(filename: string) {
    return Layer.effect(
      Service,
      Effect.gen(function* () {
        const service = yield* Effect.sync(() => open(filename))
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            service.native.close()
          }),
        )
        return Service.of(service)
      }),
    )
  }

  export const defaultLayer = Layer.unwrap(Effect.sync(() => layerFromPath(path())))
}
