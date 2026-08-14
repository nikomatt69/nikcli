import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Flag } from "@nikcli-ai/util/flag"
import { Installation } from "@/installation"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"
import { Log } from "@nikcli-ai/util/log"
import semver from "semver"

const log = Log.create({ service: "upgrade" })

type InstallationMethod = Installation.Method

function runInstallation<A, E>(effect: Effect.Effect<A, E, Installation.Service>): Promise<A> {
  return runPromiseWithLayer(Installation.defaultLayer, effect)
}

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>): Promise<A> {
  return runPromiseWithLayer(Config.defaultLayer, effect)
}

/**
 * Returns true when an update dialog should be surfaced to the user.
 *
 * "current" is the version embedded in the running build (which may be
 * "local", a git short SHA, or a prerelease tag). "latest" is the version
 * published to the install method's registry, which is always a clean
 * semver string.
 *
 * Uses `semver.parse` (strict, preserves prereleases such as
 * `1.137.0-beta.1`) so git short SHAs and labels like "local" are not
 * misread. When either side cannot be parsed as semver we fall back to
 * strict string inequality so dev / CI builds still get the prompt.
 */
export function shouldNotifyUpdate(current: string, latest: string): boolean {
  if (current === latest) return false

  const parsedCurrent = (() => {
    try {
      return semver.valid(semver.parse(current))
    } catch {
      return null
    }
  })()
  const parsedLatest = (() => {
    try {
      return semver.valid(semver.parse(latest))
    } catch {
      return null
    }
  })()

  if (parsedCurrent && parsedLatest) {
    try {
      return semver.lt(parsedCurrent, parsedLatest)
    } catch {
      // fall through to strict inequality
    }
  }

  // Either side could not be parsed as semver. Treat any difference as
  // an update opportunity so dev / local / non-standard builds are still
  // surfaced to the user.
  return current !== latest
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
    log.debug("Auto-update disabled in config or env")
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

  // Unknown install methods still get a chance to surface a hint: the
  // upgrade itself will be a no-op against the runtime, but downstream
  // the TUI can show the user what version is available and ask them
  // to update manually through their package manager.
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

  if (!shouldNotifyUpdate(Installation.VERSION, latest)) {
    log.debug("Already at latest version", {
      current: Installation.VERSION,
      latest,
    })
    return
  }

  log.info("Update available", {
    current: Installation.VERSION,
    latest,
    method,
  })

  // Always notify the TUI — it surfaces a dialog with the method-specific upgrade hint
  await Bus.publish(Installation.Event.UpdateAvailable, {
    version: latest,
    method: method === "unknown" ? undefined : method,
    current: Installation.VERSION,
  })
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
