import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { LSPClient } from "./client"
import path from "path"
import { pathToFileURL } from "url"
import { LSPServer } from "./server"
import z from "zod"
import { Config } from "../config/config"
import { spawn } from "child_process"
import { Flag } from "@/flag/flag"
import { InstanceState, locallyInstance, runPromiseWithLayer } from "@/effect"
import type { InstanceContext } from "@/effect"
import { Context, Effect, Layer } from "effect"

export namespace LSP {
  const log = Log.create({ service: "lsp" })

  // Re-export Diagnostic type for external consumers
  export type Diagnostic = LSPClient.Diagnostic

  export const Event = {
    Updated: BusEvent.define("lsp.updated", z.object({})),
  }

  export const Range = z
    .object({
      start: z.object({
        line: z.number(),
        character: z.number(),
      }),
      end: z.object({
        line: z.number(),
        character: z.number(),
      }),
    })
    .meta({
      ref: "Range",
    })
  export type Range = z.infer<typeof Range>

  export const Symbol = z
    .object({
      name: z.string(),
      kind: z.number(),
      location: z.object({
        uri: z.string(),
        range: Range,
      }),
    })
    .meta({
      ref: "Symbol",
    })
  export type Symbol = z.infer<typeof Symbol>

  export const DocumentSymbol = z
    .object({
      name: z.string(),
      detail: z.string().optional(),
      kind: z.number(),
      range: Range,
      selectionRange: Range,
    })
    .meta({
      ref: "DocumentSymbol",
    })
  export type DocumentSymbol = z.infer<typeof DocumentSymbol>

  const filterExperimentalServers = (servers: Record<string, LSPServer.Info>) => {
    if (Flag.NIKCLI_EXPERIMENTAL_LSP_TY) {
      if (servers["pyright"]) {
        log.info("LSP server pyright is disabled because NIKCLI_EXPERIMENTAL_LSP_TY is enabled")
        delete servers["pyright"]
      }
    } else {
      if (servers["ty"]) {
        delete servers["ty"]
      }
    }
  }

  type State = {
    broken: Set<string>
    servers: Record<string, LSPServer.Info>
    clients: LSPClient.Info[]
    spawning: Map<string, Promise<LSPClient.Info | undefined>>
    context: InstanceContext
  }

  export interface Interface {
    init(): Effect.Effect<void, unknown>
    status(): Effect.Effect<Status[], unknown>
    hasClients(file: string): Effect.Effect<boolean, unknown>
    touchFile(input: string, waitForDiagnostics?: boolean): Effect.Effect<void, unknown>
    diagnostics(): Effect.Effect<Record<string, LSPClient.Diagnostic[]>, unknown>
    hover(input: { file: string; line: number; character: number }): Effect.Effect<unknown[], unknown>
    workspaceSymbol(query: string): Effect.Effect<Symbol[], unknown>
    documentSymbol(uri: string): Effect.Effect<(DocumentSymbol | Symbol)[], unknown>
    definition(input: { file: string; line: number; character: number }): Effect.Effect<unknown[], unknown>
    references(input: { file: string; line: number; character: number }): Effect.Effect<unknown[], unknown>
    implementation(input: { file: string; line: number; character: number }): Effect.Effect<unknown[], unknown>
    prepareCallHierarchy(input: { file: string; line: number; character: number }): Effect.Effect<unknown[], unknown>
    incomingCalls(input: { file: string; line: number; character: number }): Effect.Effect<unknown[], unknown>
    outgoingCalls(input: { file: string; line: number; character: number }): Effect.Effect<unknown[], unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("LSP.Service") {}

  function configGet(ctx: InstanceContext) {
    return runPromiseWithLayer(
      Config.defaultLayer,
      locallyInstance(
        ctx,
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.get()
        }),
      ),
    )
  }

  const state = InstanceState.make<State>((ctx) =>
    Effect.gen(function* () {
      const clients: LSPClient.Info[] = []
      const servers: Record<string, LSPServer.Info> = {}
      const cfg = yield* Effect.promise(() => configGet(ctx))

      if (cfg.lsp === false) {
        log.info("all LSPs are disabled")
        const disabledState = {
          broken: new Set<string>(),
          servers,
          clients,
          spawning: new Map<string, Promise<LSPClient.Info | undefined>>(),
          context: ctx,
        }
        yield* Effect.addFinalizer(() => Effect.promise(() => shutdown(disabledState)))
        return disabledState
      }

      for (const server of Object.values(LSPServer)) {
        servers[server.id] = server
      }

      filterExperimentalServers(servers)

      for (const [name, item] of Object.entries(cfg.lsp ?? {})) {
        const existing = servers[name]
        if (item.disabled) {
          log.info(`LSP server ${name} is disabled`)
          delete servers[name]
          continue
        }
        servers[name] = {
          ...existing,
          id: name,
          root: existing?.root ?? (async () => ctx.directory),
          extensions: item.extensions ?? existing?.extensions ?? [],
          spawn: async (root) => {
            return {
              process: spawn(item.command[0], item.command.slice(1), {
                cwd: root,
                env: {
                  ...process.env,
                  ...item.env,
                },
              }),
              initialization: item.initialization,
            }
          },
        }
      }

      log.info("enabled LSP servers", {
        serverIds: Object.values(servers)
          .map((server) => server.id)
          .join(", "),
      })

      const initializedState = {
        broken: new Set<string>(),
        servers,
        clients,
        spawning: new Map<string, Promise<LSPClient.Info | undefined>>(),
        context: ctx,
      }
      yield* Effect.addFinalizer(() => Effect.promise(() => shutdown(initializedState)))
      return initializedState
    }),
  )

  async function shutdown(state: Pick<State, "clients">) {
    await Promise.all(state.clients.map((client) => client.shutdown()))
  }

  export const Status = z
    .object({
      id: z.string(),
      name: z.string(),
      root: z.string(),
      status: z.union([z.literal("connected"), z.literal("error")]),
    })
    .meta({
      ref: "LSPStatus",
    })
  export type Status = z.infer<typeof Status>

  async function statusImpl(s: State) {
    const result: Status[] = []
    for (const client of s.clients) {
      result.push({
        id: client.serverID,
        name: s.servers[client.serverID].id,
        root: path.relative(s.context.directory, client.root),
        status: "connected",
      })
    }
    return result
  }

  async function getClients(s: State, file: string) {
    const extension = path.parse(file).ext || file
    const result: LSPClient.Info[] = []

    async function schedule(server: LSPServer.Info, root: string, key: string) {
      const handle = await server
        .spawn(root)
        .then((value) => {
          if (!value) s.broken.add(key)
          return value
        })
        .catch((err) => {
          s.broken.add(key)
          log.error(`Failed to spawn LSP server ${server.id}`, { error: err })
          return undefined
        })

      if (!handle) return undefined
      log.info("spawned lsp server", { serverID: server.id })

      const client = await LSPClient.create({
        serverID: server.id,
        server: handle,
        root,
      }).catch((err) => {
        s.broken.add(key)
        handle.process.kill()
        log.error(`Failed to initialize LSP client ${server.id}`, { error: err })
        return undefined
      })

      if (!client) {
        handle.process.kill()
        return undefined
      }

      const existing = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (existing) {
        handle.process.kill()
        return existing
      }

      s.clients.push(client)
      return client
    }

    for (const server of Object.values(s.servers)) {
      if (server.extensions.length && !server.extensions.includes(extension)) continue

      const root = await server.root(file)
      if (!root) continue
      if (s.broken.has(root + server.id)) continue

      const match = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (match) {
        result.push(match)
        continue
      }

      const inflight = s.spawning.get(root + server.id)
      if (inflight) {
        const client = await inflight
        if (!client) continue
        result.push(client)
        continue
      }

      const task = schedule(server, root, root + server.id)
      s.spawning.set(root + server.id, task)

      task.finally(() => {
        if (s.spawning.get(root + server.id) === task) {
          s.spawning.delete(root + server.id)
        }
      })

      const client = await task
      if (!client) continue

      result.push(client)
      Bus.publish(Event.Updated, {})
    }

    return result
  }

  async function hasClientsImpl(s: State, file: string) {
    const extension = path.parse(file).ext || file
    for (const server of Object.values(s.servers)) {
      if (server.extensions.length && !server.extensions.includes(extension)) continue
      const root = await server.root(file)
      if (!root) continue
      if (s.broken.has(root + server.id)) continue
      return true
    }
    return false
  }

  async function touchFileImpl(s: State, input: string, waitForDiagnostics?: boolean) {
    log.info("touching file", { file: input })
    const clients = await getClients(s, input)
    await Promise.all(
      clients.map(async (client) => {
        const wait = waitForDiagnostics ? client.waitForDiagnostics({ path: input }) : Promise.resolve()
        await client.notify.open({ path: input })
        return wait
      }),
    ).catch((err) => {
      log.error("failed to touch file", { err, file: input })
    })
  }

  async function diagnosticsImpl(s: State) {
    const results: Record<string, LSPClient.Diagnostic[]> = {}
    for (const result of await runAll(s, async (client) => client.diagnostics)) {
      for (const [path, diagnostics] of result.entries()) {
        const arr = results[path] || []
        arr.push(...diagnostics)
        results[path] = arr
      }
    }
    return results
  }

  async function hoverImpl(s: State, input: { file: string; line: number; character: number }) {
    return run(s, input.file, (client) => {
      return client.connection
        .sendRequest("textDocument/hover", {
          textDocument: {
            uri: pathToFileURL(input.file).href,
          },
          position: {
            line: input.line,
            character: input.character,
          },
        })
        .catch(() => null)
    })
  }

  enum SymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26,
  }

  const kinds = [
    SymbolKind.Class,
    SymbolKind.Function,
    SymbolKind.Method,
    SymbolKind.Interface,
    SymbolKind.Variable,
    SymbolKind.Constant,
    SymbolKind.Struct,
    SymbolKind.Enum,
  ]

  async function workspaceSymbolImpl(s: State, query: string) {
    return runAll(s, (client) =>
      client.connection
        .sendRequest("workspace/symbol", {
          query,
        })
        .then((result: any) => result.filter((x: LSP.Symbol) => kinds.includes(x.kind)))
        .then((result: any) => result.slice(0, 10))
        .catch(() => []),
    ).then((result) => result.flat() as LSP.Symbol[])
  }

  async function documentSymbolImpl(s: State, uri: string) {
    const file = new URL(uri).pathname
    return run(s, file, (client) =>
      client.connection
        .sendRequest("textDocument/documentSymbol", {
          textDocument: {
            uri,
          },
        })
        .catch(() => []),
    )
      .then((result) => result.flat() as (LSP.DocumentSymbol | LSP.Symbol)[])
      .then((result) => result.filter(Boolean))
  }

  async function definitionImpl(s: State, input: { file: string; line: number; character: number }) {
    return run(s, input.file, (client) =>
      client.connection
        .sendRequest("textDocument/definition", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => null),
    ).then((result) => result.flat().filter(Boolean))
  }

  async function referencesImpl(s: State, input: { file: string; line: number; character: number }) {
    return run(s, input.file, (client) =>
      client.connection
        .sendRequest("textDocument/references", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
          context: { includeDeclaration: true },
        })
        .catch(() => []),
    ).then((result) => result.flat().filter(Boolean))
  }

  async function implementationImpl(s: State, input: { file: string; line: number; character: number }) {
    return run(s, input.file, (client) =>
      client.connection
        .sendRequest("textDocument/implementation", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => null),
    ).then((result) => result.flat().filter(Boolean))
  }

  async function prepareCallHierarchyImpl(s: State, input: { file: string; line: number; character: number }) {
    return run(s, input.file, (client) =>
      client.connection
        .sendRequest("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => []),
    ).then((result) => result.flat().filter(Boolean))
  }

  async function incomingCallsImpl(s: State, input: { file: string; line: number; character: number }) {
    return run(s, input.file, async (client) => {
      const items = (await client.connection
        .sendRequest("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => [])) as any[]
      if (!items?.length) return []
      return client.connection.sendRequest("callHierarchy/incomingCalls", { item: items[0] }).catch(() => [])
    }).then((result) => result.flat().filter(Boolean))
  }

  async function outgoingCallsImpl(s: State, input: { file: string; line: number; character: number }) {
    return run(s, input.file, async (client) => {
      const items = (await client.connection
        .sendRequest("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => [])) as any[]
      if (!items?.length) return []
      return client.connection.sendRequest("callHierarchy/outgoingCalls", { item: items[0] }).catch(() => [])
    }).then((result) => result.flat().filter(Boolean))
  }

  async function runAll<T>(s: State, input: (client: LSPClient.Info) => Promise<T>): Promise<T[]> {
    const tasks = s.clients.map((x) => input(x))
    return Promise.all(tasks)
  }

  async function run<T>(s: State, file: string, input: (client: LSPClient.Info) => Promise<T>): Promise<T[]> {
    const clients = await getClients(s, file)
    const tasks = clients.map((x) => input(x))
    return Promise.all(tasks)
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const scopedState = yield* state
      const getState = InstanceState.get(scopedState)

      const init = Effect.fn("LSP.init")(function* () {
        yield* getState
      })

      const status = Effect.fn("LSP.status")(function* () {
        const s = yield* getState
        return yield* Effect.tryPromise(() => statusImpl(s))
      })

      const hasClients = Effect.fn("LSP.hasClients")(function* (file: string) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => hasClientsImpl(s, file))
      })

      const touchFile = Effect.fn("LSP.touchFile")(function* (input: string, waitForDiagnostics?: boolean) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => touchFileImpl(s, input, waitForDiagnostics))
      })

      const diagnostics = Effect.fn("LSP.diagnostics")(function* () {
        const s = yield* getState
        return yield* Effect.tryPromise(() => diagnosticsImpl(s))
      })

      const hover = Effect.fn("LSP.hover")(function* (input: { file: string; line: number; character: number }) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => hoverImpl(s, input))
      })

      const workspaceSymbol = Effect.fn("LSP.workspaceSymbol")(function* (query: string) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => workspaceSymbolImpl(s, query))
      })

      const documentSymbol = Effect.fn("LSP.documentSymbol")(function* (uri: string) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => documentSymbolImpl(s, uri))
      })

      const definition = Effect.fn("LSP.definition")(function* (input: {
        file: string
        line: number
        character: number
      }) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => definitionImpl(s, input))
      })

      const references = Effect.fn("LSP.references")(function* (input: {
        file: string
        line: number
        character: number
      }) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => referencesImpl(s, input))
      })

      const implementation = Effect.fn("LSP.implementation")(function* (input: {
        file: string
        line: number
        character: number
      }) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => implementationImpl(s, input))
      })

      const prepareCallHierarchy = Effect.fn("LSP.prepareCallHierarchy")(function* (input: {
        file: string
        line: number
        character: number
      }) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => prepareCallHierarchyImpl(s, input))
      })

      const incomingCalls = Effect.fn("LSP.incomingCalls")(function* (input: {
        file: string
        line: number
        character: number
      }) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => incomingCallsImpl(s, input))
      })

      const outgoingCalls = Effect.fn("LSP.outgoingCalls")(function* (input: {
        file: string
        line: number
        character: number
      }) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => outgoingCallsImpl(s, input))
      })

      return Service.of({
        init,
        status,
        hasClients,
        touchFile,
        diagnostics,
        hover,
        workspaceSymbol,
        documentSymbol,
        definition,
        references,
        implementation,
        prepareCallHierarchy,
        incomingCalls,
        outgoingCalls,
      })
    }),
  )

  export const defaultLayer = layer

  export namespace Diagnostic {
    export function pretty(diagnostic: LSPClient.Diagnostic) {
      const severityMap = {
        1: "ERROR",
        2: "WARN",
        3: "INFO",
        4: "HINT",
      }

      const severity = severityMap[diagnostic.severity || 1]
      const line = diagnostic.range.start.line + 1
      const col = diagnostic.range.start.character + 1

      return `${severity} [${line}:${col}] ${diagnostic.message}`
    }
  }
}
