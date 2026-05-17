import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"
import { Log } from "@/util/log"

const log = Log.create({ service: "upgrade" })

type InstallationMethod = Installation.Method

function runInstallation<A, E>(effect: Effect.Effect<A, E, Installation.Service>): Promise<A> {
  return runPromiseWithLayer(Installation.defaultLayer, effect)
}

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>): Promise<A> {
  return runPromiseWithLayer(Config.defaultLayer, effect)
}

export async function upgrade(): Promise<void> {
  log.debug("Starting upgrade check")

  const config = await runConfig(
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.getGlobal()
    }),
  ).catch((error) => {
    log.warn("Failed to load config for upgrade check", { error })
    return null
  })

  if (config === null) {
    log.debug("Skipping upgrade - no config available")
    return
  }

  const method = await runInstallation(
    Effect.gen(function* () {
      const installation = yield* Installation.Service
      return yield* installation.method()
    }),
  ).catch((error) => {
    log.error("Failed to determine installation method", { error })
    return "unknown" as const
  })

  if (method === "unknown") {
    log.debug("Skipping upgrade - unknown installation method")
    return
  }

  const latest = await runInstallation(
    Effect.gen(function* () {
      const installation = yield* Installation.Service
      return yield* installation.latest(method)
    }),
  ).catch((error) => {
    log.debug("Failed to check for latest version", { error })
    return null
  })

  if (!latest) {
    log.debug("No latest version available")
    return
  }

  if (Installation.VERSION === latest) {
    log.debug("Already at latest version", { version: latest })
    return
  }

  log.info("Update available", { current: Installation.VERSION, latest })

  if (config.autoupdate === false || Flag.NIKCLI_DISABLE_AUTOUPDATE) {
    log.debug("Auto-update disabled in config")
    return
  }

  const kind = Installation.getReleaseType(Installation.VERSION, latest)
  log.debug("Release type", { kind, current: Installation.VERSION, latest })

  if (config.autoupdate === "notify" || kind !== "patch") {
    log.debug("Notifying update available (non-patch or notify mode)", { kind })
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  try {
    await runInstallation(
      Effect.gen(function* () {
        const installation = yield* Installation.Service
        return yield* installation.upgrade(method, latest)
      }),
    )
    log.info("Upgrade completed", { version: latest })
    await Bus.publish(Installation.Event.Updated, { version: latest })
  } catch (error) {
    log.error("Upgrade failed", { error, version: latest })
  }
}
