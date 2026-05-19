import { realpathSync, statSync } from "fs"
import path from "path"
import { FileSystem as PlatformFileSystem } from "effect"
import { BunFileSystem } from "@effect/platform-bun"
import { Context, Effect, Layer, Stream } from "effect"

export namespace AppFileSystem {
  function isContained(parent: string, child: string) {
    const rel = path.relative(parent, child)
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
  }

  export interface Interface {
    readonly raw: PlatformFileSystem.FileSystem
    readonly exists: (filepath: string) => Effect.Effect<boolean>
    readonly isDir: (filepath: string) => Effect.Effect<boolean>
    readonly readText: (filepath: string) => Effect.Effect<string, Error>
    readonly readJson: <T>(filepath: string) => Effect.Effect<T, Error>
    readonly writeText: (filepath: string, data: string | Uint8Array) => Effect.Effect<void, Error>
    readonly writeJson: (filepath: string, data: unknown) => Effect.Effect<void, Error>
    readonly findUp: (target: string, start: string, stop?: string) => Effect.Effect<string[]>
    readonly up: (options: { targets: string[]; start: string; stop?: string }) => Stream.Stream<string>
    readonly globUp: (pattern: string, start: string, stop?: string) => Effect.Effect<string[]>
    readonly contains: (parent: string, child: string) => boolean
    readonly containsCanonical: (parent: string, child: string) => boolean
    readonly overlaps: (a: string, b: string) => boolean
    readonly normalizePath: (filepath: string) => string
    readonly statSafe: (filepath: string) => Effect.Effect<import("fs").Stats | undefined>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/AppFileSystem") {}

  function contains(parent: string, child: string) {
    return isContained(parent, child)
  }

  function containsCanonical(parent: string, child: string): boolean {
    try {
      const canonicalParent = realpathSync.native(parent)
      const canonicalChild = realpathSync.native(child)
      return isContained(canonicalParent, canonicalChild)
    } catch {
      return contains(parent, child)
    }
  }

  function overlaps(a: string, b: string) {
    return isContained(a, b) || isContained(b, a)
  }

  function normalizePath(p: string): string {
    if (process.platform !== "win32") return p
    try {
      return realpathSync.native(p)
    } catch {
      return p
    }
  }

  function statSafe(filepath: string) {
    return Effect.sync(() => {
      try {
        return statSync(filepath)
      } catch {
        return undefined
      }
    })
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const raw = yield* PlatformFileSystem.FileSystem

      const exists = (filepath: string) => raw.exists(filepath).pipe(Effect.catch(() => Effect.succeed(false)))

      const isDir = (filepath: string) =>
        raw.stat(filepath).pipe(
          Effect.map((info) => info.type === "Directory"),
          Effect.catch(() => Effect.succeed(false)),
        )

      const readText = Effect.fn("AppFileSystem.readText")(function* (filepath: string) {
        return yield* raw
          .readFileString(filepath)
          .pipe(Effect.mapError((cause) => new Error(`failed to read ${filepath}: ${cause.message}`, { cause })))
      })

      const readJson = Effect.fn("AppFileSystem.readJson")(function* <T>(filepath: string) {
        const text = yield* readText(filepath)
        return yield* Effect.try({
          try: () => JSON.parse(text) as T,
          catch: (cause) => new Error(`failed to parse JSON at ${filepath}`, { cause: cause as Error }),
        })
      })

      const writeText = Effect.fn("AppFileSystem.writeText")(function* (filepath: string, data: string | Uint8Array) {
        yield* raw.makeDirectory(path.dirname(filepath), { recursive: true }).pipe(Effect.ignore)
        const payload = typeof data === "string" ? data : Buffer.from(data).toString("utf8")
        yield* raw
          .writeFileString(filepath, payload)
          .pipe(Effect.mapError((cause) => new Error(`failed to write ${filepath}: ${cause.message}`, { cause })))
      })

      const writeJson = Effect.fn("AppFileSystem.writeJson")(function* (filepath: string, data: unknown) {
        yield* writeText(filepath, JSON.stringify(data, null, 2))
      })

      const findUp = Effect.fn("AppFileSystem.findUp")(function* (target: string, start: string, stop?: string) {
        const result: string[] = []
        let current = start
        while (true) {
          const search = path.join(current, target)
          if (yield* exists(search)) result.push(search)
          if (stop === current) break
          const parent = path.dirname(current)
          if (parent === current) break
          current = parent
        }
        return result
      })

      const up = (options: { targets: string[]; start: string; stop?: string }): Stream.Stream<string> =>
        Stream.unfold(options.start as string | null, (current: string | null) => {
          if (current === null) return Effect.succeed(undefined)
          return Effect.gen(function* () {
            const matches: string[] = []
            for (const target of options.targets) {
              const search = path.join(current, target)
              if (yield* exists(search)) matches.push(search)
            }
            const next: string | null =
              options.stop === current ? null : current === path.dirname(current) ? null : path.dirname(current)
            return [matches, next] as const
          })
        }).pipe(Stream.flatMap((batch) => Stream.fromIterable(batch as string[])))

      const globUp = (pattern: string, start: string, stop?: string) =>
        Effect.promise(async () => {
          const result: string[] = []
          let current = start
          while (true) {
            try {
              const glob = new Bun.Glob(pattern)
              for await (const match of glob.scan({
                cwd: current,
                absolute: true,
                onlyFiles: true,
                followSymlinks: true,
                dot: true,
              })) {
                result.push(match)
              }
            } catch {
              // Skip invalid glob patterns
            }
            if (stop === current) break
            const parent = path.dirname(current)
            if (parent === current) break
            current = parent
          }
          return result
        })

      return Service.of({
        raw,
        exists,
        isDir,
        readText,
        readJson,
        writeText,
        writeJson,
        findUp,
        up,
        globUp,
        contains,
        containsCanonical,
        overlaps,
        normalizePath,
        statSafe,
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(BunFileSystem.layer))
}
