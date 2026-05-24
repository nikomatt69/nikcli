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

/**
 * Checks for available updates and publishes an event so the TUI can
 * show an interactive upgrade dialog. The actual upgrade is triggered
 * by the user from the dialog (see upgradeNow).
 */
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

  if (config.autoupdate === false || Flag.NIKCLI_DISABLE_AUTOUPDATE) {
    log.debug("Auto-update disabled in config")
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

  log.info("Update available", { current: Installation.VERSION, latest, method })

  // Always notify the TUI — the dialog handles the user choice
  await Bus.publish(Installation.Event.UpdateAvailable, { version: latest, method })
}

/**
 * Performs the actual upgrade for the given method and version.
 * Called from the TUI dialog after the user confirms.
 */
export async function upgradeNow(method: InstallationMethod, version: string): Promise<void> {
  log.info("Upgrading", { method, version })

  await runInstallation(
    Effect.gen(function* () {
      const installation = yield* Installation.Service
      return yield* installation.upgrade(method, version)
    }),
  )

  log.info("Upgrade completed", { version })
  await Bus.publish(Installation.Event.Updated, { version })
}
