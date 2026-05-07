import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { File } from "@/file"
import { SearchBackend } from "@/file/searchBackend"
import { InstanceState } from "@/effect"

export namespace FileHttpApi {
  const TextSearchParams = Schema.Struct({
    pattern: Schema.String,
  })

  const FileSearchParams = Schema.Struct({
    query: Schema.String,
    dirs: Schema.optional(Schema.Literal("true", "false")),
    type: Schema.optional(Schema.Literal("file", "directory")),
    limit: Schema.optional(Schema.NumberFromString),
  })

  const SymbolSearchParams = Schema.Struct({
    query: Schema.String,
  })

  const PathParams = Schema.Struct({
    path: Schema.String,
  })

  const WritePayload = Schema.Struct({
    path: Schema.String,
    content: Schema.String,
  }).annotations({ identifier: "FileWritePayload" })

  const WriteSuccess = Schema.Struct({
    success: Schema.Boolean,
  }).annotations({ identifier: "FileWriteResult" })

  const SearchMatch = Schema.Struct({
    path: Schema.Struct({
      text: Schema.String,
    }),
    lines: Schema.Struct({
      text: Schema.String,
    }),
    line_number: Schema.Number,
    absolute_offset: Schema.Number,
    submatches: Schema.Array(
      Schema.Struct({
        match: Schema.Struct({
          text: Schema.String,
        }),
        start: Schema.Number,
        end: Schema.Number,
      }),
    ),
  }).annotations({ identifier: "SearchMatch" })

  const Range = Schema.Struct({
    start: Schema.Struct({
      line: Schema.Number,
      character: Schema.Number,
    }),
    end: Schema.Struct({
      line: Schema.Number,
      character: Schema.Number,
    }),
  })

  const SymbolInfo = Schema.Struct({
    name: Schema.String,
    kind: Schema.Number,
    location: Schema.Struct({
      uri: Schema.String,
      range: Range,
    }),
  }).annotations({ identifier: "Symbol" })

  const FileNode = Schema.Struct({
    name: Schema.String,
    path: Schema.String,
    absolute: Schema.String,
    type: Schema.Literal("file", "directory"),
    ignored: Schema.Boolean,
  }).annotations({ identifier: "FileNode" })

  const Patch = Schema.Struct({
    oldFileName: Schema.String,
    newFileName: Schema.String,
    oldHeader: Schema.optional(Schema.String),
    newHeader: Schema.optional(Schema.String),
    hunks: Schema.Array(
      Schema.Struct({
        oldStart: Schema.Number,
        oldLines: Schema.Number,
        newStart: Schema.Number,
        newLines: Schema.Number,
        lines: Schema.Array(Schema.String),
      }),
    ),
    index: Schema.optional(Schema.String),
  })

  const FileContent = Schema.Struct({
    type: Schema.Literal("text"),
    content: Schema.String,
    diff: Schema.optional(Schema.String),
    patch: Schema.optional(Patch),
    encoding: Schema.optional(Schema.Literal("base64")),
    mimeType: Schema.optional(Schema.String),
  }).annotations({ identifier: "FileContent" })

  const FileInfo = Schema.Struct({
    path: Schema.String,
    added: Schema.Number,
    removed: Schema.Number,
    status: Schema.Literal("added", "deleted", "modified"),
  }).annotations({ identifier: "File" })

  export const Group = HttpApiGroup.make("file")
    .add(HttpApiEndpoint.get("findText", "/find").setUrlParams(TextSearchParams).addSuccess(Schema.Array(SearchMatch)))
    .add(HttpApiEndpoint.get("findFile", "/find/file").setUrlParams(FileSearchParams).addSuccess(Schema.Array(Schema.String)))
    .add(
      HttpApiEndpoint.get("findSymbol", "/find/symbol")
        .setUrlParams(SymbolSearchParams)
        .addSuccess(Schema.Array(SymbolInfo)),
    )
    .add(HttpApiEndpoint.get("list", "/file").setUrlParams(PathParams).addSuccess(Schema.Array(FileNode)))
    .add(HttpApiEndpoint.get("content", "/file/content").setUrlParams(PathParams).addSuccess(FileContent))
    .add(HttpApiEndpoint.put("write", "/file/content").setPayload(WritePayload).addSuccess(WriteSuccess))
    .add(HttpApiEndpoint.get("status", "/file/status").addSuccess(Schema.Array(FileInfo)))

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.api(Api)

  export const handlers = {
    findText: ({ urlParams }: { urlParams: typeof TextSearchParams.Type }) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const result = yield* Effect.promise(() =>
          SearchBackend.search({
            cwd: ctx.directory,
            pattern: urlParams.pattern,
            limit: 10,
          }),
        )
        return result.matches
      }).pipe(Effect.orDie),
    findFile: ({ urlParams }: { urlParams: typeof FileSearchParams.Type }) =>
      Effect.gen(function* () {
        const file = yield* File.Service
        return yield* file.search({
          query: urlParams.query,
          limit: urlParams.limit ?? 10,
          dirs: urlParams.dirs !== "false",
          type: urlParams.type,
        })
      }).pipe(Effect.orDie),
    findSymbol: (_: { urlParams: typeof SymbolSearchParams.Type }) => Effect.succeed([]),
    list: ({ urlParams }: { urlParams: typeof PathParams.Type }) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const requestedPath = urlParams.path
        const absolutePath = path.isAbsolute(requestedPath) ? requestedPath : path.join(ctx.directory, requestedPath)
        const normalizedPath = path.normalize(absolutePath)
        const file = yield* File.Service
        return yield* file.list(normalizedPath)
      }).pipe(Effect.orDie),
    content: ({ urlParams }: { urlParams: typeof PathParams.Type }) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const requestedPath = urlParams.path
        const absolutePath = path.isAbsolute(requestedPath) ? requestedPath : path.join(ctx.directory, requestedPath)
        const normalizedPath = path.normalize(absolutePath)
        const file = yield* File.Service
        return yield* file.read(normalizedPath)
      }).pipe(Effect.orDie),
    write: ({ payload }: { payload: typeof WritePayload.Type }) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const requestedPath = payload.path
        const absolutePath = path.isAbsolute(requestedPath) ? requestedPath : path.join(ctx.directory, requestedPath)
        const normalizedPath = path.normalize(absolutePath)
        yield* Effect.promise(() => Bun.write(normalizedPath, payload.content))
        return { success: true }
      }).pipe(Effect.orDie),
    status: () =>
      Effect.gen(function* () {
        const file = yield* File.Service
        return yield* file.status()
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "file", (builder) =>
    builder
      .handle("findText", handlers.findText)
      .handle("findFile", handlers.findFile)
      .handle("findSymbol", handlers.findSymbol)
      .handle("list", handlers.list)
      .handle("content", handlers.content)
      .handle("write", handlers.write)
      .handle("status", handlers.status),
  )

  export const DependenciesLive = File.defaultLayer

  export const layer = ApiLive.pipe(
    Layer.provide(HandlersLive),
    Layer.provide(DependenciesLive),
  )
}
