/**
 * Opt-in usage reporting.
 *
 * nikcli.store/data can only show what the inference gateway served, which is a
 * small slice of what nikcli actually runs: most people bring their own
 * provider keys, and those models never reach the gateway. This sends the
 * per-day, per-model totals the CLI already keeps locally, so the public page
 * reflects the models developers really use.
 *
 * It is off unless `analytics.share` is true in the config. When it is on:
 *
 *   - only aggregates leave the machine — day, provider, model, message count,
 *     token count, cost. No prompt, no file path, no repository, no session
 *     title, no account, no environment;
 *   - the install identifier is a random string generated here, kept locally,
 *     and used by the server only to replace a day rather than double it and to
 *     count distinct installs. It is never published;
 *   - only whole days are sent, never the day in progress, and each day is sent
 *     once;
 *   - a failure is silent and the day is retried tomorrow. Reporting must never
 *     be something the user notices.
 */
import { Effect } from "effect"
import { Analytics } from "./analytics"
import { Config } from "@/config/config"
import { Installation } from "@/installation"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { runPromiseWithLayer } from "@/effect"

export namespace AnalyticsShare {
  const log = Log.create({ service: "analytics-share" })

  const DEFAULT_ENDPOINT = "https://dashboard.nikcli.store/api/community/report"
  /** How far back to catch up when an install has been offline. */
  const MAX_CATCHUP_DAYS = 7
  const DAY_MS = 86_400_000

  const STATE_KEY = ["analytics", "share-state"]

  interface State {
    /** Random, local, never published. */
    installID: string
    /** Last day already reported, `YYYY-MM-DD`. */
    lastDay?: string
  }

  function storage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
    return runPromiseWithLayer(Storage.defaultLayer, effect)
  }

  function dayKey(at: number): string {
    return new Date(at).toISOString().slice(0, 10)
  }

  function newInstallID(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  }

  async function readState(): Promise<State> {
    const existing = await storage(
      Effect.gen(function* () {
        const store = yield* Storage.Service
        return yield* store.read<State>(STATE_KEY)
      }),
    ).catch(() => undefined)
    if (existing?.installID) return existing
    const fresh: State = { installID: newInstallID() }
    await writeState(fresh)
    return fresh
  }

  async function writeState(state: State): Promise<void> {
    await storage(
      Effect.gen(function* () {
        const store = yield* Storage.Service
        yield* store.write(STATE_KEY, state)
      }),
    ).catch(() => undefined)
  }

  /** The `analytics` block of the global config, or nothing if it is unreadable. */
  async function settings() {
    return runPromiseWithLayer(
      Config.defaultLayer,
      Effect.gen(function* () {
        const config = yield* Config.Service
        return (yield* config.getGlobal()).analytics
      }),
    ).catch(() => undefined)
  }

  /**
   * Sends every whole day since the last report, up to a week back. Returns the
   * number of rows accepted locally — zero when sharing is off, when there is
   * nothing new, or when the request failed.
   */
  export async function run(): Promise<number> {
    const analytics = await settings()
    if (analytics?.share !== true) return 0

    const state = await readState()
    // Yesterday is the newest whole day; today is still accumulating.
    const yesterday = dayKey(Date.now() - DAY_MS)
    if (state.lastDay && state.lastDay >= yesterday) return 0

    const earliest = dayKey(Date.now() - MAX_CATCHUP_DAYS * DAY_MS)
    const from = state.lastDay && state.lastDay > earliest ? dayKey(Date.parse(state.lastDay) + DAY_MS) : earliest
    if (from > yesterday) return 0

    const days = await Analytics.getDaily(from, yesterday).catch(() => [])
    const rows = days.flatMap((day) =>
      Object.entries(day.models).map(([model, stats]) => ({
        day: day.date,
        // Model keys are stored as `provider/model`; the provider half is the
        // routing decision and the rest is the model, which can contain slashes.
        provider: model.includes("/") ? model.slice(0, model.indexOf("/")) : "unknown",
        model: model.includes("/") ? model.slice(model.indexOf("/") + 1) : model,
        messages: stats.messages,
        tokens: stats.tokens,
        cost: stats.cost,
      })),
    )

    if (rows.length === 0) {
      // Nothing ran on those days, but they are still done with: recording that
      // stops the catch-up window re-reading them every startup.
      await writeState({ ...state, lastDay: yesterday })
      return 0
    }

    try {
      const response = await fetch(analytics.endpoint ?? DEFAULT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installID: state.installID, version: Installation.VERSION, rows }),
      })
      if (!response.ok) {
        log.info("report rejected", { status: response.status })
        return 0
      }
    } catch (error) {
      log.info("report failed", { error: String(error) })
      return 0
    }

    await writeState({ ...state, lastDay: yesterday })
    log.info("reported", { days: days.length, rows: rows.length })
    return rows.length
  }
}
