import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"
import { bootstrap } from "@/cli/bootstrap"
import { publicRoutes, type PublicRoute } from "@/server/httpapi/inventory"
import { Server } from "@/server/server"

/**
 * `nikcli api` — call one endpoint of the contract from the command line.
 *
 * The repository generates 336 client endpoints and gates their inventory with `check:routes`, but
 * nothing reached one from a terminal: C3's release-identity probe had to hand-roll a `fetch` against
 * `/global/health` for exactly this reason. Ported in intent from opencode v2's `api` command.
 *
 * **There is no second list of endpoints here.** Everything — the operation ids, the methods, the
 * paths, the "did you mean" — is derived from `publicRoutes()`, which reads the assembled `PublicApi`
 * through `OpenApi.fromApi`. That is the same source the clients are generated from, so this command
 * cannot drift from the contract: an endpoint that is not declared cannot be called, and one that is
 * renamed stops resolving on the next build rather than silently 404ing at runtime.
 *
 * Requests go through `Server.fetch` in-process, so no server has to be running and no port has to be
 * guessed — the same path the HTTP tests take.
 */
export const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const

/** Levenshtein distance, bounded use: only ever run against the route table to rank suggestions. */
export function distance(a: string, b: string): number {
  if (a === b) return 0
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1]
    for (let j = 0; j < b.length; j++) {
      current.push(Math.min(previous[j + 1]! + 1, current[j]! + 1, previous[j]! + (a[i] === b[j] ? 0 : 1)))
    }
    previous = current
  }
  return previous[b.length]!
}

/**
 * The closest declared operations to what was typed.
 *
 * A bare "unknown operation" leaves the caller to grep the contract; naming the nearest matches is the
 * difference between a dead end and a next command. Substring hits come first because a partial name
 * is the common typo, then edit distance for genuine misspellings.
 */
export function suggest(input: string, routes: readonly PublicRoute[], limit = 5): string[] {
  const needle = input.toLowerCase()
  const ids = routes.map((route) => route.operationId).filter(Boolean)
  const contains = ids.filter((id) => id.toLowerCase().includes(needle))
  const near = ids
    .filter((id) => !contains.includes(id))
    .map((id) => ({ id, score: distance(needle, id.toLowerCase()) }))
    .filter((item) => item.score <= Math.max(3, Math.floor(needle.length / 2)))
    .sort((a, b) => a.score - b.score)
    .map((item) => item.id)
  return [...new Set([...contains, ...near])].slice(0, limit)
}

/** Fill `{param}` placeholders from `--param name=value`, and report any the path still needs. */
export function fillPath(template: string, params: Record<string, string>): { path: string; missing: string[] } {
  const missing: string[] = []
  const path = template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = params[name]
    if (value === undefined) {
      missing.push(name)
      return `{${name}}`
    }
    return encodeURIComponent(value)
  })
  return { path, missing }
}

/**
 * Resolve what the caller typed to a declared route.
 *
 * Two spellings, both checked against the same table: an operation id (`sessionList`), or a method and
 * a path (`GET /session`). Exported so the resolution rules can be tested without booting an instance.
 */
export function resolveRoute(
  request: readonly string[],
  routes: readonly PublicRoute[],
): { route: PublicRoute } | { error: string; suggestions: string[] } {
  if (request.length === 0) return { error: "No operation given.", suggestions: [] }

  if (request.length >= 2) {
    const method = request[0]!.toUpperCase()
    const path = request[1]!
    if (!METHODS.includes(method as (typeof METHODS)[number])) {
      return { error: `Unknown HTTP method '${request[0]}'. Expected one of ${METHODS.join(", ")}.`, suggestions: [] }
    }
    const wanted = path.startsWith("/") ? path : `/${path}`
    const route = routes.find((item) => item.method === method && item.path === wanted)
    if (route) return { route }
    return {
      error: `No declared route for ${method} ${wanted}.`,
      // A path typed without its `{param}` braces is the usual miss, so rank by path rather than id.
      suggestions: routes
        .filter((item) => item.method === method)
        .map((item) => `${item.method} ${item.path}`)
        .filter((key) => key.toLowerCase().includes(wanted.toLowerCase().split("/")[1] ?? ""))
        .slice(0, 5),
    }
  }

  const id = request[0]!
  const exact = routes.find((route) => route.operationId === id)
  if (exact) return { route: exact }
  const insensitive = routes.find((route) => route.operationId.toLowerCase() === id.toLowerCase())
  if (insensitive) return { route: insensitive }
  return { error: `Unknown operation '${id}'.`, suggestions: suggest(id, routes) }
}

export default Runtime.handler(Commands.commands["api"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    request: input["request"],
    data: Option.getOrUndefined(input["data"]),
    param: [...input["param"]],
    header: [...input["header"]],
    list: Option.getOrUndefined(input["list"]),
    directory: Option.getOrUndefined(input["directory"]),
  }
  const routes = publicRoutes().filter((route) => route.operationId)
  const directory = args.directory ?? process.cwd()

  if (args.list) {
    for (const route of [...routes].sort((a, b) => a.operationId.localeCompare(b.operationId))) {
      console.log(`${route.operationId.padEnd(34)} ${route.method.padEnd(6)} ${route.path}`)
    }
    return
  }

  const resolved = resolveRoute(args.request as string[], routes)
  if ("error" in resolved) {
    console.error(resolved.error)
    if (resolved.suggestions.length > 0) {
      console.error("Did you mean:")
      for (const item of resolved.suggestions) console.error(`  ${item}`)
    } else {
      console.error("Run `nikcli api --list` to see every declared operation.")
    }
    process.exitCode = 1
    return
  }

  const params: Record<string, string> = {}
  for (const entry of args.param as string[]) {
    const index = entry.indexOf("=")
    if (index === -1) {
      console.error(`--param expects name=value, got '${entry}'.`)
      process.exitCode = 1
      return
    }
    params[entry.slice(0, index)] = entry.slice(index + 1)
  }

  const { path, missing } = fillPath(resolved.route.path, params)
  if (missing.length > 0) {
    console.error(`${resolved.route.method} ${resolved.route.path} needs: ${missing.join(", ")}`)
    console.error(`Pass each one as --param ${missing[0]}=<value>.`)
    process.exitCode = 1
    return
  }

  const headers = new Headers()
  for (const entry of args.header as string[]) {
    const index = entry.indexOf(":")
    if (index === -1) {
      console.error(`--header expects name:value, got '${entry}'.`)
      process.exitCode = 1
      return
    }
    headers.set(entry.slice(0, index).trim(), entry.slice(index + 1).trim())
  }
  if (args.data !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")

  await bootstrap(directory, async () => {
    // `http://nikcli.local` is the synthetic origin the in-process server answers on; the directory
    // query is how every request selects its instance (see `server-router.ts`).
    const url = new URL(path, "http://nikcli.local")
    // Anything not consumed by the path template is a query parameter, which is what the contract
    // expects for the endpoints that take one.
    for (const [name, value] of Object.entries(params)) {
      if (!resolved.route.path.includes(`{${name}}`)) url.searchParams.set(name, value)
    }
    if (!url.searchParams.has("directory")) url.searchParams.set("directory", directory)

    const response = await Server.fetch(new Request(url, { method: resolved.route.method, headers, body: args.data }))
    const text = await response.text()

    if (!response.ok) {
      console.error(`${response.status} ${response.statusText}`)
      if (text) console.error(text)
      process.exitCode = 1
      return
    }
    if (!text) return
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2))
    } catch {
      // Not every endpoint answers JSON — `/vcs/diff/raw` is declared as text.
      console.log(text)
    }
  })
})
