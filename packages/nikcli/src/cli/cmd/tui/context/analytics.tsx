import { createSignal, onMount } from "solid-js"
import { useSDK } from "./sdk"
import { createSimpleContext } from "./helper"
import { Log } from "@/util/log"
import { Global } from "@/global"
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
    const [loading, setLoading] = createSignal(true)

    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    async function refresh(): Promise<boolean> {
      setLoading(true)
      let gotHistorical = false
      try {
        // Lazy: analytics.ts pulls the session/message repos (drizzle chain),
        // which must not be evaluated during TUI module load.
        const { loadPersistedAnalyticsFromDataRoot, mergeGlobalAnalytics, mergeDailyAnalyticsLists, mergeSessionAnalyticsLists } =
          await import("@/analytics/analytics")
        const dataRoot = Global.Path.data
        const disk = await loadPersistedAnalyticsFromDataRoot(dataRoot)
        if (disk.global) gotHistorical = true
        if (disk.daily.length > 0) gotHistorical = true
        if (disk.sessions.length > 0) gotHistorical = true

        let mergedGlobal: GlobalAnalytics = disk.global ?? EMPTY_GLOBAL
        let mergedDaily: DailyAnalytics[] = disk.daily
        let mergedSessions: SessionAnalytics[] = disk.sessions

        const base = sdk.url
        if (base) {
          const [gRes, dRes, sRes] = await Promise.all([
            fetch(`${base}/analytics/global`).catch(() => null),
            // Bumped 90 → 365 so the Overview activity heatmap can render a full year.
            fetch(`${base}/analytics/daily?days=365`).catch(() => null),
            fetch(`${base}/analytics/sessions`).catch(() => null),
          ])

          if (gRes?.ok) {
            const api = (await gRes.json()) as GlobalAnalytics
            mergedGlobal = mergeGlobalAnalytics(mergedGlobal, api)
            gotHistorical = true
          }
          if (dRes?.ok) {
            const apiDaily = (await dRes.json()) as DailyAnalytics[]
            mergedDaily = mergeDailyAnalyticsLists(mergedDaily, apiDaily)
            gotHistorical = true
          }
          if (sRes?.ok) {
            const apiSessions = (await sRes.json()) as SessionAnalytics[]
            mergedSessions = mergeSessionAnalyticsLists(mergedSessions, apiSessions)
          }
        }

        setGlobal(mergedGlobal)
        setDaily(mergedDaily)
        setSessions(mergedSessions)
      } catch (e) {
        log.debug("Analytics refresh failed", { error: e })
      } finally {
        setLoading(false)
      }
      return gotHistorical
    }

    function debouncedRefresh() {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        refresh().catch(() => {})
      }, 2000)
    }

    // Listen for message events to auto-refresh
    sdk.event.listen((e) => {
      const event = e.details
      if (event.type === "message.updated" && event.properties.info.role === "assistant") {
        debouncedRefresh()
      }
    })

    onMount(() => {
      refresh().catch(() => {})
    })

    return {
      global,
      daily,
      sessions,
      loading,
      refresh,
    }
  },
})
