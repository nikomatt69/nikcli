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
import { AnalyticsRollup } from "./rollup"
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
  /** Rollups store micro-cent integers; the wire keeps a USD number for older collectors. */
  const MICRO_CENTS_PER_USD = 100_000_000

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

  /**
   * A random v4 UUID — 122 bits of entropy and nothing else.
   *
   * Deliberately not `Identifier.ascending`, which nikcli uses for ids elsewhere:
   * those embed a timestamp, so the identifier itself would carry the moment the
   * install first reported. This one is drawn from the CSPRNG and encodes no
   * machine, no user and no clock.
   */
  function newInstallID(): string {
    return crypto.randomUUID()
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
  /** How often a long-lived server re-publishes while it stays up. */
  const REFRESH_MS = 6 * 60 * 60 * 1000

  let timer: ReturnType<typeof setInterval> | undefined

  /**
   * Start reporting in the background, and keep it going.
   *
   * A run at startup is what makes this automatic for the common case: most
   * nikcli processes are short-lived, and every start catches up whatever days
   * are still unpublished. The interval is for the ones that stay up for days,
   * which would otherwise report once and go quiet.
   *
   * `includeToday` is on: the day in progress is sent too, so a page reading this
   * is current rather than always a day behind. Resending it is free — the
   * collector keys on (install, day, provider, model), so each send replaces the
   * last, and tomorrow's run replaces the partial day with the complete one.
   */
  export function start(): void {
    const tick = () => void run({ includeToday: true }).catch(() => undefined)
    tick()
    if (timer) return
    timer = setInterval(tick, REFRESH_MS)
    // Never hold the process open on account of reporting.
    timer.unref?.()
  }

  /** Stop the background timer. Safe to call when it was never started. */
  export function stop(): void {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
  }

  export async function run(options?: { force?: boolean; includeToday?: boolean }): Promise<number> {
    const analytics = await settings()
    // `force` is for an explicit `nikcli analytics publish`: the user asked for it
    // in that moment, which is the consent the config flag stands in for otherwise.
    if (analytics?.share !== true && options?.force !== true) return 0

    const state = await readState()
    // Yesterday is the newest whole day; today is still accumulating, so it is
    // only sent when asked for — a partial day would be replaced by the complete
    // one tomorrow, which the (install, day, model) key makes safe.
    const newest = options?.includeToday ? dayKey(Date.now()) : dayKey(Date.now() - DAY_MS)
    const from = dayKey(Date.now() - MAX_CATCHUP_DAYS * DAY_MS)
    if (from > newest) return 0
    const yesterday = newest

    // Recompute before reading: the rollup for a day is derived from that day's
    // messages, so rebuilding is what makes a resumed session or a late message
    // land in the numbers that get sent.
    await AnalyticsRollup.rebuild({ from, to: yesterday }).catch(() => 0)

    // Which days still need sending is asked of the rollups, not tracked as a
    // high-water mark: a day that gained messages after it was first reported
    // becomes pending again, where "last day sent" would have kept the stale
    // numbers forever.
    const periods = await AnalyticsRollup.pending({ from, to: yesterday }).catch((): string[] => [])
    if (periods.length === 0) return 0

    const wanted = new Set(periods)
    const rollups = await AnalyticsRollup.read({ from, to: yesterday })
      .then((all) => all.filter((stat) => wanted.has(stat.periodKey)))
      .catch((): AnalyticsRollup.Row[] => [])

    const rows = rollups.map((stat) => ({
      day: stat.periodKey,
      // Provider and model are separate columns in the rollup, taken from the
      // message that produced them. They used to be recovered by splitting a
      // `provider/model` key, which produced "unknown" whenever the key was a
      // bare model id.
      provider: stat.provider,
      model: stat.model,
      messages: stat.messages,
      tokens: stat.totalTokens,
      cost: stat.costMicroCents / MICRO_CENTS_PER_USD,
      // Richer aggregates for collectors that understand them. Older ones ignore
      // unknown fields, so both can read the same report.
      sessions: stat.sessions,
      toolCalls: stat.toolCalls,
      inputTokens: stat.inputTokens,
      outputTokens: stat.outputTokens,
      reasoningTokens: stat.reasoningTokens,
      cacheReadTokens: stat.cacheReadTokens,
      cacheWriteTokens: stat.cacheWriteTokens,
      costMicroCents: stat.costMicroCents,
      durationMs: stat.durationMs,
    }))

    // A pending day with no rows ran nothing. Marking it published is what stops
    // the catch-up window re-reading it on every startup.
    if (rows.length === 0) {
      await AnalyticsRollup.markPublished(periods).catch(() => undefined)
      return 0
    }

    try {
      const response = await fetch(analytics?.endpoint ?? DEFAULT_ENDPOINT, {
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

    // Only after the collector accepted them, and stamped with the revision that
    // was actually sent — a rebuild after this point makes the day pending again.
    await AnalyticsRollup.markPublished(periods).catch(() => undefined)
    log.info("reported", { days: periods.length, rows: rows.length })
    return rows.length
  }
}
