import { createSignal } from "solid-js"
import { useSDK } from "./sdk"
import { createSimpleContext } from "./helper"
import { Log } from "@/util/log"
import type { DailyAnalytics, GlobalAnalytics, SessionAnalytics } from "@/analytics/analytics"

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

    async function load(): Promise<boolean> {
      const base = sdk.url
      if (!base) return false

      const { mergeGlobalAnalytics, mergeDailyAnalyticsLists } = await import("@/analytics/analytics")

      // Overview/Tokens/Models/Tools/Projects all read these two. The session
      // list is the expensive one and is fetched separately, on demand, so a
      // slow list can no longer keep the totals off the screen.
      const [gRes, dRes] = await Promise.all([
        fetch(`${base}/analytics/global`).catch(() => null),
        // Bumped 90 → 365 so the Overview activity heatmap can render a full year.
        fetch(`${base}/analytics/daily?days=365`).catch(() => null),
      ])

      let gotHistorical = false

      if (gRes?.ok) {
        const api = (await gRes.json()) as GlobalAnalytics
        setGlobal((current) => mergeGlobalAnalytics(current, api))
        gotHistorical = true
      }
      if (dRes?.ok) {
        const apiDaily = (await dRes.json()) as DailyAnalytics[]
        setDaily((current) => mergeDailyAnalyticsLists(current, apiDaily))
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

    /** Lazy: only the Sessions tab needs this, and it is the slowest query. */
    function refreshSessions(): Promise<SessionAnalytics[]> {
      if (sessionsInflight) return sessionsInflight
      const base = sdk.url
      if (!base) return Promise.resolve(sessions())

      setSessionsLoading(true)
      sessionsInflight = (async () => {
        const { mergeSessionAnalyticsLists } = await import("@/analytics/analytics")
        const res = await fetch(`${base}/analytics/sessions`).catch(() => null)
        if (!res?.ok) return sessions()
        const api = (await res.json()) as SessionAnalytics[]
        const merged = mergeSessionAnalyticsLists(sessions(), api)
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
