import { Auth } from "@/auth"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import type { Hooks } from "@nikcli-ai/plugin"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Log } from "@nikcli-ai/util/log"

/** Helpers shared by the `auth` commands. */

export const log = Log.create({ service: "auth-command" })

export type PluginAuth = NonNullable<Hooks["auth"]>

export function runAuth<A, E>(effect: Effect.Effect<A, E, Auth.Service>): Promise<A> {
  return runPromiseWithLayer(Auth.defaultLayer, effect)
}

export function runPlugin<A, E>(effect: Effect.Effect<A, E, Plugin.Service>): Promise<A> {
  return runPromiseWithLayer(Plugin.defaultLayer, withCurrentInstance(effect))
}

export function configGet() {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    ),
  )
}

export function authSet(key: string, info: Auth.Info) {
  return runAuth(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set(key, info)
    }),
  )
}

export function authAll() {
  return runAuth(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      return yield* auth.all()
    }),
  )
}

export function pluginList() {
  return runPlugin(
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      return yield* plugin.list()
    }),
  )
}

/**
 * Handle plugin-based authentication flow.
 * Returns true if auth was handled, false if it should fall through to default handling.
 */
export async function handlePluginAuth(plugin: { auth: PluginAuth }, provider: string): Promise<boolean> {
  log.debug("Handling plugin auth", { provider })

  let index = 0
  if (plugin.auth.methods.length > 1) {
    const method = await prompts.select({
      message: "Login method",
      options: plugin.auth.methods.map((x, idx) => ({
        label: x.label,
        value: idx.toString(),
      })),
    })
    if (prompts.isCancel(method)) {
      throw new UI.CancelledError()
    }
    index = parseInt(method, 10)
  }

  if (!plugin.auth.methods[index]) {
    log.error("Invalid auth method index", {
      index,
      methodsCount: plugin.auth.methods.length,
    })
    return false
  }

  const method = plugin.auth.methods[index]

  await Bun.sleep(10)
  const inputs: Record<string, string> = {}
  if (method.prompts) {
    for (const prompt of method.prompts) {
      if (prompt.condition && !prompt.condition(inputs)) {
        continue
      }
      if (prompt.type === "select") {
        const value = await prompts.select({
          message: prompt.message,
          options: prompt.options,
        })
        if (prompts.isCancel(value)) {
          throw new UI.CancelledError()
        }
        inputs[prompt.key] = value
      } else {
        const value = await prompts.text({
          message: prompt.message,
          placeholder: prompt.placeholder,
          validate: prompt.validate ? (v) => prompt.validate!(v ?? "") : undefined,
        })
        if (prompts.isCancel(value)) {
          throw new UI.CancelledError()
        }
        inputs[prompt.key] = value
      }
    }
  }

  if (method.type === "oauth") {
    const authorize = await method.authorize(inputs)

    if (authorize.url) {
      prompts.log.info("Go to: " + authorize.url)
    }

    if (authorize.method === "auto") {
      if (authorize.instructions) {
        prompts.log.info(authorize.instructions)
      }
      const spinner = prompts.spinner()
      spinner.start("Waiting for authorization...")
      const result = await authorize.callback()
      if (result.type === "failed") {
        spinner.stop("Failed to authorize", 1)
        log.error("OAuth authorization failed", { provider })
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await authSet(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        if ("key" in result) {
          await authSet(saveProvider, {
            type: "api",
            key: result.key,
          })
        }
        spinner.stop("Login successful")
        log.info("OAuth login successful", { provider: saveProvider })
      }
    }

    if (authorize.method === "code" || authorize.method === "auto-code") {
      const code = await prompts.text({
        message:
          authorize.method === "auto-code"
            ? "Paste the authorization code if shown, or press Enter to wait: "
            : "Paste the authorization code here: ",
        validate: (x) => (authorize.method === "auto-code" || (x && x.length > 0) ? undefined : "Required"),
      })
      if (prompts.isCancel(code)) {
        throw new UI.CancelledError()
      }
      const result =
        authorize.method === "auto-code" ? await authorize.callback(code || undefined) : await authorize.callback(code)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
        log.error("OAuth code authorization failed", { provider })
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await authSet(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        if ("key" in result) {
          await authSet(saveProvider, {
            type: "api",
            key: result.key,
          })
        }
        prompts.log.success("Login successful")
        log.info("OAuth code login successful", { provider: saveProvider })
      }
    }

    prompts.outro("Done")
    return true
  }

  if (method.type === "api") {
    if (method.authorize) {
      const result = await method.authorize(inputs)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
        log.error("API authorization failed", { provider })
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        await authSet(saveProvider, {
          type: "api",
          key: result.key,
        })
        prompts.log.success("Login successful")
        log.info("API login successful", { provider: saveProvider })
      }
      prompts.outro("Done")
      return true
    }
  }

  return false
}
