import { Auth } from "../../auth"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import type { Hooks } from "@nikcli-ai/plugin"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Log } from "@/util/log"

const log = Log.create({ service: "auth-command" })

type PluginAuth = NonNullable<Hooks["auth"]>

function runAuth<A, E>(effect: Effect.Effect<A, E, Auth.Service>): Promise<A> {
  return runPromiseWithLayer(Auth.defaultLayer, effect)
}

function runPlugin<A, E>(effect: Effect.Effect<A, E, Plugin.Service>): Promise<A> {
  return runPromiseWithLayer(Plugin.defaultLayer, withCurrentInstance(effect))
}

function configGet() {
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

function authSet(key: string, info: Auth.Info) {
  return runAuth(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set(key, info)
    }),
  )
}

function authAll() {
  return runAuth(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      return yield* auth.all()
    }),
  )
}

function pluginList() {
  return runPlugin(
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      return yield* plugin.list()
    }),
  )
}

function handlePromptCancel<T>(value: unknown, fallback: T): T {
  if (prompts.isCancel(value)) {
    throw new UI.CancelledError()
  }
  return value as T
}

/**
 * Handle plugin-based authentication flow.
 * Returns true if auth was handled, false if it should fall through to default handling.
 */
async function handlePluginAuth(plugin: { auth: PluginAuth }, provider: string): Promise<boolean> {
  log.debug("Handling plugin auth", { provider })

  let index = 0
  if (plugin.auth.methods.length > 1) {
    const method = await prompts.select({
      message: "Login method",
      options: [
        ...plugin.auth.methods.map((x, idx) => ({
          label: x.label,
          value: idx.toString(),
        })),
      ],
    })
    if (prompts.isCancel(method)) {
      throw new UI.CancelledError()
    }
    index = parseInt(method, 10)
  }

  if (!plugin.auth.methods[index]) {
    log.error("Invalid auth method index", { index, methodsCount: plugin.auth.methods.length })
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

    if (authorize.method === "code") {
      const code = await prompts.text({
        message: "Paste the authorization code here: ",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(code)) {
        throw new UI.CancelledError()
      }
      const result = await authorize.callback(code)
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

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs.command(AuthLoginCommand).command(AuthLogoutCommand).command(AuthListCommand).demandCommand(),
  async handler() {
    log.debug("Auth command handler called without subcommand")
  },
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)

    try {
      const results = Object.entries(await authAll())
      const database = await ModelsDev.get()

      for (const [providerID, result] of results) {
        const name = database[providerID]?.name || providerID
        prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
      }

      log.debug("Listed credentials", { count: results.length })
      prompts.outro(`${results.length} credentials`)

      const activeEnvVars: Array<{ provider: string; envVar: string }> = []

      for (const [providerID, provider] of Object.entries(database)) {
        for (const envVar of provider.env) {
          if (process.env[envVar]) {
            activeEnvVars.push({
              provider: provider.name || providerID,
              envVar,
            })
          }
        }
      }

      if (activeEnvVars.length > 0) {
        UI.empty()
        prompts.intro("Environment")

        for (const { provider, envVar } of activeEnvVars) {
          prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
        }

        prompts.outro(
          `${activeEnvVars.length} environment variable${activeEnvVars.length === 1 ? "" : "s"}`,
        )
      }
    } catch (error) {
      log.error("Failed to list credentials", { error })
      prompts.outro("Failed to list credentials")
    }
  },
})

export const AuthLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "nikcli auth provider",
      type: "string",
    }),
  async handler(args) {
    await withInstanceAsync({ directory: process.cwd() }, async () => {
      {
        UI.empty()
        prompts.intro("Add credential")

        if (args.url) {
          const url = args.url
          log.debug("Login with well-known URL", { url })

          const wellknownResponse = await runAuth(
            Effect.gen(function* () {
              const auth = yield* Auth.Service
              return yield* auth.fetchWellKnown(url)
            }),
          )
            .then((x) => (x.ok ? x.json() : null))
            .catch(() => null)

          const wellknown = Auth.WellKnownAuthResponse.safeParse(wellknownResponse)

          if (!wellknown.success) {
            prompts.log.error("Invalid auth response from server")
            prompts.outro("Done")
            return
          }

          let token: string
          try {
            token = await runAuth(
              Effect.gen(function* () {
                const auth = yield* Auth.Service
                return yield* auth.fetchWellKnownToken(url, [...wellknown.data.auth.command])
              }),
            )
          } catch (error) {
            log.error("Failed to fetch well-known token", { error })
            prompts.log.error(error instanceof Error ? error.message : "Failed")
            prompts.outro("Done")
            return
          }

          await authSet(url, {
            type: "wellknown",
            key: wellknown.data.auth.env,
            token: token.trim(),
          })
          prompts.log.success("Logged into " + url)
          log.info("Well-known login successful", { url })
          prompts.outro("Done")
          return
        }

        await ModelsDev.refresh().catch(() => {})

        const config = await configGet()

        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const providers = await ModelsDev.get().then((x) => {
          const filtered: Record<string, (typeof x)[string]> = {}
          for (const [key, value] of Object.entries(x)) {
            if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
              filtered[key] = value
            }
          }
          return filtered
        })

        const priority: Record<string, number> = {
          nikcli: 0,
          anthropic: 1,
          "github-copilot": 2,
          openai: 3,
          google: 4,
          openrouter: 5,
          vercel: 6,
        }
        let provider = await prompts.autocomplete({
          message: "Select provider",
          maxItems: 8,
          options: [
            ...pipe(
              providers,
              values(),
              sortBy(
                (x) => priority[x.id] ?? 99,
                (x) => x.name ?? x.id,
              ),
              map((x) => ({
                label: x.name,
                value: x.id,
                hint: {
                  nikcli: "recommended",
                  anthropic: "Claude Max or API key",
                  openai: "ChatGPT Plus/Pro or API key",
                }[x.id],
              })),
            ),
            {
              value: "other",
              label: "Other",
            },
          ],
        })

        if (prompts.isCancel(provider)) {
          prompts.outro("Done")
          return
        }

        const plugin = await pluginList().then((x) =>
          x.find((x) => x.auth?.provider === provider),
        )
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider)
          if (handled) return
        }

        if (provider === "other") {
          provider = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(provider)) {
            prompts.outro("Done")
            return
          }
          provider = provider.replace(/^@ai-sdk\//, "")

          const customPlugin = await pluginList().then((x) =>
            x.find((x) => x.auth?.provider === provider),
          )
          if (customPlugin && customPlugin.auth) {
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider)
            if (handled) return
          }

          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need configure it in nikcli.json, check the docs for examples.`,
          )
        }

        if (provider === "amazon-bedrock") {
          prompts.log.info(
            "Amazon Bedrock authentication priority:\n" +
              "  1. Bearer token (AWS_BEARER_TOKEN_BEDROCK or /connect)\n" +
              "  2. AWS credential chain (profile, access keys, IAM roles, EKS IRSA)\n\n" +
              "Configure via nikcli.json options (profile, region, endpoint) or\n" +
              "AWS environment variables (AWS_PROFILE, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_WEB_IDENTITY_TOKEN_FILE).",
          )
        }

        if (provider === "nikcli") {
          prompts.log.info("Create an api key at https://nikcli.store/auth")
        }

        if (provider === "vercel") {
          prompts.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
        }

        if (["cloudflare", "cloudflare-ai-gateway"].includes(provider)) {
          prompts.log.info(
            "Cloudflare AI Gateway can be configured with CLOUDFLARE_GATEWAY_ID, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN environment variables. Read more: https://nikcli.store/docs/providers/#cloudflare-ai-gateway",
          )
        }

        const key = await prompts.password({
          message: "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) {
          prompts.outro("Done")
          return
        }

        log.info("Setting API key", { provider })
        await authSet(provider, {
          type: "api",
          key,
        })

        prompts.outro("Done")
      }
    })
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler() {
    UI.empty()
    try {
      const credentials = await authAll().then((x) => Object.entries(x))
      prompts.intro("Remove credential")

      if (credentials.length === 0) {
        prompts.log.error("No credentials found")
        return
      }

      const database = await ModelsDev.get()
      const providerID = await prompts.select({
        message: "Select provider",
        options: credentials.map(([key, value]) => ({
          label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
          value: key,
        })),
      })

      if (prompts.isCancel(providerID)) {
        prompts.outro("Done")
        return
      }

      log.info("Logging out provider", { provider: providerID })
      await runAuth(
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          yield* auth.remove(providerID)
        }),
      )
      prompts.outro("Logout successful")
    } catch (error) {
      log.error("Logout failed", { error })
      prompts.outro("Done")
    }
  },
})
