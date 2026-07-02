import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { mapValues } from "remeda"
import path from "node:path"
import fs from "node:fs/promises"
import { errors } from "../error"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"
import { Instance } from "@/project/instance"
import { InstanceReload } from "@/project/reload"

const log = Log.create({ service: "server" })

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, withCurrentInstance(effect))
}

function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
  return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
}

const PROFILE_NAME = /^[a-zA-Z0-9._-]+$/

function profileDir() {
  return path.join(Config.managedConfigDir(), "profiles")
}

function profilePath(name: string) {
  return path.join(profileDir(), `${name}.json`)
}

function activeProfilePath() {
  return path.join(profileDir(), "active")
}

async function ensureProfileDir() {
  await fs.mkdir(profileDir(), { recursive: true })
}

function assertProfileName(name: string) {
  const trimmed = name.trim()
  if (!trimmed || trimmed === "active" || trimmed === "default" || !PROFILE_NAME.test(trimmed)) {
    throw new Error("Profile name can only contain letters, numbers, dots, underscores, and dashes")
  }
  return trimmed
}

function profileInfo(config: any) {
  return {
    mcpCount: Object.keys(config?.mcp ?? {}).length,
    plugins: Array.isArray(config?.plugin)
      ? config.plugin.map((item: unknown) => String(Array.isArray(item) ? item[0] : item))
      : [],
    providerCount: Object.keys(config?.provider ?? {}).length,
  }
}

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current Nikcli configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await runConfig(
          Effect.gen(function* () {
            const service = yield* Config.Service
            return yield* service.get()
          }),
        )
        return c.json(config)
      },
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update Nikcli configuration settings and preferences.",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        await runConfig(
          Effect.gen(function* () {
            const service = yield* Config.Service
            yield* service.update(config)
          }),
        )
        // Config writes that touch `disabled_providers`, `enabled_providers`,
        // `provider`, or `model` must invalidate the Provider state cache so
        // the next listing reflects them without a CLI restart.
        if (
          "disabled_providers" in config ||
          "enabled_providers" in config ||
          "provider" in config ||
          "model" in config
        ) {
          await runProvider(
            Effect.gen(function* () {
              const provider = yield* Provider.Service
              yield* Effect.ignore(provider.refresh())
            }),
          ).catch((err) =>
            log.warn("provider cache refresh after config update failed", {
              error: err instanceof Error ? err.message : String(err),
            }),
          )
        }
        return c.json(config)
      },
    )
    .post(
      "/reload",
      describeRoute({
        summary: "Reload configuration",
        description:
          "Hot-reload the instance: invalidate reloadable per-instance state so the next read reflects config files on disk. Emits instance.reload.started / instance.reloaded on the event stream.",
        operationId: "config.reload",
        responses: {
          200: {
            description: "Instance reloaded",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    reloaded: z.boolean(),
                    directory: z.string(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        await InstanceReload.reload(["api"])
        return c.json({ reloaded: true, directory: Instance.directory })
      },
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    providers: Provider.Info.array(),
                    default: z.record(z.string(), z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        using _ = log.time("providers")
        const providers = await runProvider(
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const list = yield* provider.list()
            return mapValues(list, (item) => item)
          }),
        )
        return c.json({
          providers: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
        })
      },
    )
    .post(
      "/mcp",
      validator(
        "json",
        z.object({
          name: z.string().min(1),
          config: Config.Mcp,
        }),
      ),
      async (c) => {
        const { name, config } = c.req.valid("json")
        await runConfig(
          Effect.gen(function* () {
            const service = yield* Config.Service
            yield* service.update({ mcp: { [name]: config } })
          }),
        )
        return c.json({ success: true })
      },
    )
    .patch(
      "/mcp/:name",
      validator("param", z.object({ name: z.string().min(1) })),
      validator("json", z.record(z.string(), z.unknown())),
      async (c) => {
        const { name } = c.req.valid("param")
        const patch = c.req.valid("json")
        const current = await runConfig(
          Effect.gen(function* () {
            const service = yield* Config.Service
            return yield* service.get()
          }),
        )
        const existing = current.mcp?.[name]
        if (!existing) return c.json({ error: "MCP server not found" }, 404)
        await runConfig(
          Effect.gen(function* () {
            const service = yield* Config.Service
            yield* service.update({ mcp: { [name]: { ...existing, ...patch } as Config.Mcp } })
          }),
        )
        return c.json({ success: true })
      },
    )
    .delete("/mcp/:name", validator("param", z.object({ name: z.string().min(1) })), async (c) => {
      const { name } = c.req.valid("param")
      const current = await runConfig(
        Effect.gen(function* () {
          const service = yield* Config.Service
          return yield* service.get()
        }),
      )
      const nextMcp = { ...current.mcp }
      if (!(name in nextMcp)) return c.json({ error: "MCP server not found" }, 404)
      delete nextMcp[name]
      await Bun.write(
        path.join(Instance.directory, "nikcli.json"),
        JSON.stringify({ ...current, mcp: nextMcp }, null, 2),
      )
      return c.json({ success: true })
    })
    .get("/profiles", async (c) => {
      await ensureProfileDir()
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
      return c.json({ profiles, activeProfile: profiles[activeProfile] ? activeProfile : "default" })
    })
    .post("/profiles", validator("json", z.object({ name: z.string().min(1) })), async (c) => {
      await ensureProfileDir()
      const name = assertProfileName(c.req.valid("json").name)
      const target = profilePath(name)
      if (await Bun.file(target).exists()) return c.json({ error: "Profile already exists" }, 409)
      const current = await runConfig(
        Effect.gen(function* () {
          const service = yield* Config.Service
          return yield* service.get()
        }),
      )
      await Bun.write(target, JSON.stringify(current, null, 2))
      return c.json({ success: true })
    })
    .post("/profiles/activate/:name", validator("param", z.object({ name: z.string().min(1) })), async (c) => {
      await ensureProfileDir()
      const requested = c.req.valid("param").name.trim()
      if (requested === "default") {
        await fs.rm(activeProfilePath(), { force: true })
        return c.json({ success: true })
      }
      const name = assertProfileName(requested)
      const target = profilePath(name)
      const file = Bun.file(target)
      if (!(await file.exists())) return c.json({ error: "Profile not found" }, 404)
      const config = await file.json()
      await Bun.write(path.join(Instance.directory, "nikcli.json"), JSON.stringify(config, null, 2))
      await Bun.write(activeProfilePath(), name)
      return c.json({ success: true })
    }),
)
