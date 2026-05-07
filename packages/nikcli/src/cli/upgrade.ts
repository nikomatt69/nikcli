import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"

function runInstallation<A, E>(effect: Effect.Effect<A, E, Installation.Service>) {
  return runPromiseWithLayer(Installation.defaultLayer, effect)
}

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, effect)
}

export async function upgrade() {
  const config = await runConfig(
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.getGlobal()
    }),
  )
  const method = await runInstallation(
    Effect.gen(function* () {
      const installation = yield* Installation.Service
      return yield* installation.method()
    }),
  )
  const latest = await runInstallation(
    Effect.gen(function* () {
      const installation = yield* Installation.Service
      return yield* installation.latest(method)
    }),
  ).catch(() => {})
  if (!latest) return
  if (Installation.VERSION === latest) return

  if (config.autoupdate === false || Flag.NIKCLI_DISABLE_AUTOUPDATE) {
    return
  }
  if (config.autoupdate === "notify") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  if (method === "unknown") return
  await runInstallation(
    Effect.gen(function* () {
      const installation = yield* Installation.Service
      return yield* installation.upgrade(method, latest)
    }),
  )
    .then(() => Bus.publish(Installation.Event.Updated, { version: latest }))
    .catch(() => {})
}
