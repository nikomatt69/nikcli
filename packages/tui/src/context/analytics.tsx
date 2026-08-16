import { createSignal } from "solid-js"
import { useSDK } from "./sdk"
import { createSimpleContext } from "./helper"
import { Log } from "@nikcli-ai/util/log"
import {
  mergeDailyAnalyticsLists,
  mergeGlobalAnalytics,
  mergeSessionAnalyticsLists,
  type DailyAnalytics,
  type GlobalAnalytics,
  type SessionAnalytics,
} from "@tui/util/analytics-merge"

const log = Log.create({ service: "analytics-context" })

const EMPTY_GLOBAL: GlobalAnalytics = {
  version: 1,
  updatedAt: 0,
  totals: {
    sessions: 0,
    messages: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    toolCalls: 0,
  },
  byProvider: {},
  byModel: {},
  byProject: {},
}

export const { use: useAnalytics, provider: AnalyticsProvider } = createSimpleContext({
  name: "Analytics",
  init: () => {
    const sdk = useSDK()

    const [global, setGlobal] = createSignal<GlobalAnalytics>(EMPTY_GLOBAL)
    const [daily, setDaily] = createSignal<DailyAnalytics[]>([])
    const [sessions, setSessions] = createSignal<SessionAnalytics[]>([])
    const [loading, setLoading] = createSignal(false)
    const [sessionsLoading, setSessionsLoading] = createSignal(false)

    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    // Every endpoint below is a multi-second scan on the server worker, so two
    // overlapping refreshes do not just waste work — the second one queues
    // behind the first and the panel that asked for it never sees an answer.
    let inflight: Promise<boolean> | null = null
    let sessionsInflight: Promise<SessionAnalytics[]> | null = null
    // The analytics panel is the only consumer. This provider wraps the whole
    // app, so without a gate the session-message listener below would run a
    // full history scan after every assistant reply, panel open or not.
    let watchers = 0

    /**
     * Everything goes through `sdk.client`, never a bare `fetch` on `sdk.url`.
     *
     * The TUI runs its server in a worker and hands the SDK its own transport,
     * so a raw request built from `sdk.url` never reaches the router — the
     * panel silently fell back to live-sync data and reported "no history".
     */
    async function load(): Promise<boolean> {
      // Overview/Tokens/Models all read these two. The session list is the
      // expensive one and is fetched separately so a slow list cannot keep the
      // totals off the screen.
      const [gRes, dRes] = await Promise.all([
        sdk.client.analytics.global().catch(() => undefined),
        // 365 rather than 90 so the Overview activity heatmap gets a full year.
        sdk.client.analytics.daily({ days: "365" }).catch(() => undefined),
      ])

      let gotHistorical = false

      if (gRes?.data) {
        setGlobal((current) => mergeGlobalAnalytics(current, gRes.data as GlobalAnalytics))
        gotHistorical = true
      }
      if (dRes?.data) {
        setDaily((current) => mergeDailyAnalyticsLists(current, dRes.data as DailyAnalytics[]))
        gotHistorical = true
      }

      // Deliberately partial: totals are worth showing even when the daily
      // series failed, and vice versa.
      return gotHistorical
    }

    function refresh(): Promise<boolean> {
      if (inflight) return inflight
      setLoading(true)
      inflight = load()
        .catch((e) => {
          log.debug("Analytics refresh failed", { error: e })
          return false
        })
        .finally(() => {
          inflight = null
          setLoading(false)
        })
      return inflight
    }

    /** The slowest of the three, so it is loaded on its own after the totals. */
    function refreshSessions(): Promise<SessionAnalytics[]> {
      if (sessionsInflight) return sessionsInflight

      setSessionsLoading(true)
      sessionsInflight = (async () => {
        const res = await sdk.client.analytics.sessions().catch(() => undefined)
        if (!res?.data) return sessions()
        const merged = mergeSessionAnalyticsLists(sessions(), res.data as SessionAnalytics[])
        setSessions(merged)
        return merged
      })()
        .catch((e) => {
          log.debug("Analytics session refresh failed", { error: e })
          return sessions()
        })
        .finally(() => {
          sessionsInflight = null
          setSessionsLoading(false)
        })
      return sessionsInflight
    }

    /**
     * Called by the panel while it is open. Returns a disposer, so live updates
     * stop as soon as it closes.
     */
    function watch(): () => void {
      watchers++
      return () => {
        watchers = Math.max(0, watchers - 1)
        if (watchers === 0 && refreshTimer) {
          clearTimeout(refreshTimer)
          refreshTimer = null
        }
      }
    }

    function debouncedRefresh() {
      if (watchers === 0) return
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        if (watchers === 0) return
        refresh().catch(() => {})
      }, 2000)
    }

    // Keep an open panel current, but never pay for it while it is closed.
    sdk.event.listen((e) => {
      const event = e.details
      if (event.type === "message.updated" && event.properties.info.role === "assistant") {
        debouncedRefresh()
      }
    })

    return {
      global,
      daily,
      sessions,
      loading,
      sessionsLoading,
      refresh,
      refreshSessions,
      watch,
    }
  },
})
