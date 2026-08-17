import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Instance } from "@/project/instance"
import { InstanceReload } from "@/project/reload"
import { Provider } from "@/provider/provider"
import { Workspace } from "@/workspace"

const PROFILE_NAME = /^[a-zA-Z0-9._-]+$/

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

async function body(request: Request): Promise<Record<string, unknown> | undefined> {
  const value = await request.json().catch(() => undefined)
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function profileDir() {
  return path.join(Config.managedConfigDir(), "profiles")
}

function profilePath(name: string) {
  return path.join(profileDir(), `${name}.json`)
}

function activeProfilePath() {
  return path.join(profileDir(), "active")
}

function profileName(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const name = value.trim()
  if (!name || name === "active" || name === "default" || !PROFILE_NAME.test(name)) return
  return name
}

function runAuth<A, E>(effect: Effect.Effect<A, E, Auth.Service>) {
  return runPromiseWithLayer(Auth.defaultLayer, withCurrentInstance(effect))
}

function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
  return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
}

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, withCurrentInstance(effect))
}

function profileInfo(config: unknown) {
  const value = config as { mcp?: object; plugin?: unknown; provider?: object } | undefined
  return {
    mcpCount: Object.keys(value?.mcp ?? {}).length,
    plugins: Array.isArray(value?.plugin)
      ? value.plugin.map((item: unknown) => String(Array.isArray(item) ? item[0] : item))
      : [],
    providerCount: Object.keys(value?.provider ?? {}).length,
  }
}

async function refreshProviders() {
  await runProvider(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      yield* Effect.ignore(provider.refresh())
    }),
  )
}

export async function extraRequest(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url)
  const pathname = url.pathname
  const method = request.method.toUpperCase()
  // `url` is reused below for decodeURIComponent on path segments — keep it
  // single-source so `ServerRouter.dispatch` / `HttpApiBridge.handle` and
  // this raw route share one parse.

  const auth = pathname.match(/^\/auth\/([^/]+)\/?$/)
  if (auth) {
    const providerID = decodeURIComponent(auth[1])
    if (method === "PUT") {
      const input = await body(request)
      const parsed = Auth.Info.safeParse(input)
      if (!parsed.success) return json({ error: "Invalid auth payload" }, 400)
      await runAuth(
        Effect.gen(function* () {
          const authService = yield* Auth.Service
          yield* authService.set(providerID, parsed.data)
        }),
      )
      await refreshProviders()
      return json(true)
    }
    if (method === "DELETE") {
      await runAuth(
        Effect.gen(function* () {
          const authService = yield* Auth.Service
          yield* authService.remove(providerID)
        }),
      )
      await refreshProviders()
      return json(true)
    }
  }

  if (pathname === "/config/reload" && method === "POST") {
    await InstanceReload.reload(["api"])
    return json({ reloaded: true, directory: Instance.directory })
  }

  if (pathname === "/config/mcp" && method === "POST") {
    const input = await body(request)
    const name = typeof input?.name === "string" ? input.name : ""
    const parsed = Config.Mcp.safeParse(input?.config)
    if (!name || !parsed.success) return json({ error: "Invalid MCP server configuration" }, 400)
    await runConfig(
      Effect.gen(function* () {
        const service = yield* Config.Service
        yield* service.update({ mcp: { [name]: parsed.data } })
      }),
    )
    return json({ success: true })
  }

  const mcp = pathname.match(/^\/config\/mcp\/([^/]+)\/?$/)
  if (mcp) {
    const name = decodeURIComponent(mcp[1])
    if (method === "PATCH") {
      const patch = await body(request)
      if (!name || !patch) return json({ error: "Invalid MCP server configuration" }, 400)
      const current = await runConfig(
        Effect.gen(function* () {
          const service = yield* Config.Service
          return yield* service.get()
        }),
      )
      const existing = current.mcp?.[name]
      if (!existing) return json({ error: "MCP server not found" }, 404)
      const parsed = Config.Mcp.safeParse({ ...existing, ...patch })
      if (!parsed.success) return json({ error: "Invalid MCP server configuration" }, 400)
      await runConfig(
        Effect.gen(function* () {
          const service = yield* Config.Service
          yield* service.update({ mcp: { [name]: parsed.data } })
        }),
      )
      return json({ success: true })
    }
    if (method === "DELETE") {
      const current = await runConfig(
        Effect.gen(function* () {
          const service = yield* Config.Service
          return yield* service.get()
        }),
      )
      const next = { ...current.mcp }
      if (!(name in next)) return json({ error: "MCP server not found" }, 404)
      delete next[name]
      await Bun.write(path.join(Instance.directory, "nikcli.json"), JSON.stringify({ ...current, mcp: next }, null, 2))
      return json({ success: true })
    }
  }

  if (pathname === "/config/profiles" && method === "GET") {
    await fs.mkdir(profileDir(), { recursive: true })
    const current = await runConfig(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )
    const profiles: Record<string, ReturnType<typeof profileInfo>> = {
      default: profileInfo(current),
    }
    for (const entry of await fs.readdir(profileDir(), { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue
      const name = entry.name.slice(0, -".json".length)
      const raw = await Bun.file(path.join(profileDir(), entry.name))
        .json()
        .catch(() => undefined)
      profiles[name] = profileInfo(raw)
    }
    const activeProfile = await Bun.file(activeProfilePath())
      .text()
      .then((value) => value.trim() || "default")
      .catch(() => "default")
    return json({ profiles, activeProfile: profiles[activeProfile] ? activeProfile : "default" })
  }

  if (pathname === "/config/profiles" && method === "POST") {
    const input = await body(request)
    const name = profileName(input?.name)
    if (!name)
      return json({ error: "Profile name can only contain letters, numbers, dots, underscores, and dashes" }, 400)
    await fs.mkdir(profileDir(), { recursive: true })
    const target = profilePath(name)
    if (await Bun.file(target).exists()) return json({ error: "Profile already exists" }, 409)
    const current = await runConfig(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )
    await Bun.write(target, JSON.stringify(current, null, 2))
    return json({ success: true })
  }

  const activate = pathname.match(/^\/config\/profiles\/activate\/([^/]+)\/?$/)
  if (activate && method === "POST") {
    const requested = decodeURIComponent(activate[1]).trim()
    await fs.mkdir(profileDir(), { recursive: true })
    if (requested === "default") {
      await fs.rm(activeProfilePath(), { force: true })
      return json({ success: true })
    }
    const name = profileName(requested)
    if (!name)
      return json({ error: "Profile name can only contain letters, numbers, dots, underscores, and dashes" }, 400)
    const file = Bun.file(profilePath(name))
    if (!(await file.exists())) return json({ error: "Profile not found" }, 404)
    await Bun.write(path.join(Instance.directory, "nikcli.json"), JSON.stringify(await file.json(), null, 2))
    await Bun.write(activeProfilePath(), name)
    return json({ success: true })
  }

  const events = pathname.match(/^\/experimental\/workspace\/([^/]+)\/events\/?$/)
  if (events && method === "GET") {
    const from = url.searchParams.get("from")
    const parsed = from === null ? undefined : Number(from)
    if (parsed !== undefined && (!Number.isInteger(parsed) || parsed < 0)) return json({ error: "Invalid query" }, 400)
    return json(
      await Workspace.events({
        workspaceID: decodeURIComponent(events[1] ?? ""),
        from: parsed,
      }),
    )
  }

  const warp = pathname.match(/^\/experimental\/workspace\/session\/([^/]+)\/warp\/?$/)
  if (warp && method === "POST") {
    const input = await body(request)
    return json(
      await Workspace.sessionWarp({
        sessionID: decodeURIComponent(warp[1] ?? ""),
        workspaceID: (input?.workspaceID ?? null) as string | null,
        copyChanges: typeof input?.copyChanges === "boolean" ? input.copyChanges : undefined,
        timeoutMs: typeof input?.timeoutMs === "number" ? input.timeoutMs : 30_000,
      }),
    )
  }
}
