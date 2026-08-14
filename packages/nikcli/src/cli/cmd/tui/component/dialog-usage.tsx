import { ScrollBoxRenderable, TextAttributes, RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { useSync } from "@tui/context/sync"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, onCleanup, onMount, For, Show } from "solid-js"
import { Usage } from "../util/usage"
import { useEditorContext } from "../context/editor"
import { useKV } from "../context/kv"
import { Token } from "@/util/token"
import type { SessionContextResponse, AssistantMessage, Session } from "@nikcli-ai/sdk/httpapi"
import {
  BrailleSparkline,
  StackedBarChartV2,
  KPICard,
  RankedBarList,
  Gauge,
  getChartColors,
} from "./chart-braille-line"
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  buildCategoryBreakdown,
  categoryColor,
  computeFreeTokens,
  computeUsageRatio,
  computeUsedTokens,
  healthStatus,
  turnTotalFromMessage,
  type HealthStatus,
} from "../util/context-usage"
import { useDialog } from "@tui/ui/dialog"

const EDITOR_SOURCE_ID = "system:editor"
const EDITOR_TOGGLE_KEY = "editor_context_visibility"
const EDITOR_TOGGLE_KIND = "editor"

// "current" is the route-bound session; any other value is a child / subagent
// session ID picked from the segmented control. The panel re-fetches the
// breakdown whenever this changes.
type SessionTarget = string

export function DialogUsage() {
  type Breakdown = SessionContextResponse
  type ServerSource = Breakdown["sources"][number]
  type EditorToggleKind = "editor"
  type Source = Omit<ServerSource, "toggleKind"> & {
    toggleKind?: ServerSource["toggleKind"] | EditorToggleKind
  }

  function buildEditorNote(
    selection: NonNullable<ReturnType<ReturnType<typeof useEditorContext>["selection"]>>,
  ): string {
    const start = selection.selection.start
    const end = selection.selection.end
    if (start.line === end.line && start.character === end.character) {
      return `Note: The user opened the file "${selection.filePath}".`
    }
    if (start.line === end.line) {
      return `Note: The user selected line ${start.line} from "${selection.filePath}": ${selection.text}`
    }
    return `Note: The user selected lines ${start.line} to ${end.line} from "${selection.filePath}": ${selection.text}`
  }

  const { theme } = useTheme()
  const route = useRoute()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const editor = useEditorContext()
  const kv = useKV()

  // Rich, chart-heavy dashboard needs the same room as /analytics.
  onMount(() => dialog.setSize("xlarge"))

  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const [data, { mutate, refetch }] = createResource(sessionID, async (sid) => {
    if (!sid) return undefined
    const result = await sdk.client.session.context({ sessionID: sid })
    return result.data as Breakdown | undefined
  })

  const [selected, setSelected] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  let scroll: ScrollBoxRenderable | undefined

  // Editor context (IDE selection) is a client-side signal mirrored from the
  // prompt footer. Surface it as a regular togglable source so users can switch
  // it on/off from this dialog like every other context source.
  const editorContextVisible = createMemo(() => kv.get(EDITOR_TOGGLE_KEY, true) as boolean)
  const editorSource = createMemo<Source>(() => {
    const selection = editor.selection()
    const enabled = editorContextVisible()
    if (!selection) {
      return {
        id: EDITOR_SOURCE_ID,
        category: "system",
        label: "Editor context",
        detail: editor.connected() ? "No active selection" : "No editor connected",
        tokens: 0,
        enabled,
        togglable: true,
        toggleKind: EDITOR_TOGGLE_KIND,
        toggleKey: EDITOR_TOGGLE_KEY,
      }
    }
    const note = buildEditorNote(selection)
    const label = (() => {
      const filename = selection.filePath.split("/").pop() ?? selection.filePath
      const start = selection.selection.start
      const end = selection.selection.end
      const range =
        start.line === end.line && start.character === end.character
          ? `:${start.line + 1}`
          : `:${start.line + 1}-${end.line + 1}`
      return `Editor · ${filename}${range}`
    })()
    return {
      id: EDITOR_SOURCE_ID,
      category: "system",
      label,
      detail: selection.filePath,
      tokens: Token.estimate(note),
      enabled,
      togglable: true,
      toggleKind: EDITOR_TOGGLE_KIND,
      toggleKey: EDITOR_TOGGLE_KEY,
    }
  })

  // Sources ordered by category, in a stable display order. The editor source
  // is prepended so it always leads the "System prompt" section.
  const sources = createMemo(() => {
    const all = data()?.sources ?? []
    const sorted = [...all].sort((a, b) => {
      const ca = CATEGORY_ORDER.indexOf(a.category)
      const cb = CATEGORY_ORDER.indexOf(b.category)
      if (ca !== cb) return ca - cb
      return b.tokens - a.tokens
    })
    return [editorSource(), ...sorted]
  })

  const contextLimit = createMemo(() => data()?.model?.contextLimit ?? 0)

  // Per-turn token history — derive a sparkline series from the live sync
  // store so the trend reflects what's already happened in this session.
  // We use `total` when present and the input+output+cache+reasoning sum
  // otherwise, mirroring the aggregator in `app.tsx`.
  const assistantMessages = createMemo<AssistantMessage[]>(() => {
    const sid = sessionID()
    if (!sid) return []
    const list = sync.data.message[sid] ?? []
    return list.filter((m): m is AssistantMessage => m.role === "assistant")
  })

  // The server "reported" breakdown is a one-shot context fetch, not a live
  // subscription — left alone it freezes at whatever it was when the dialog
  // opened, so cache/usage figures stop tracking new turns (unlike
  // /analytics, which reads straight from the live message store). Prefer
  // the latest assistant message's real usage instead, falling back to the
  // one-shot fetch only before any assistant message exists.
  const reportedLive = createMemo(() => {
    const last = assistantMessages().at(-1)
    if (!last) return data()?.reported
    return {
      total: turnTotalFromMessage(last),
      input: last.tokens.input,
      output: last.tokens.output,
      cacheRead: last.tokens.cache.read,
      cacheWrite: last.tokens.cache.write,
      reasoning: last.tokens.reasoning,
    }
  })

  const reportedTotal = createMemo(() => reportedLive()?.total ?? 0)
  // Cache hit rate = share of the input-side prompt served from cache this turn.
  // cacheRead are hits (~0.1x cost); cacheWrite are fresh writes (~1.25x/2x); input
  // is the uncached remainder (full price). 0% read across turns with a stable
  // prefix means a silent invalidator (model/tool switch, volatile system prompt).
  const cacheHitRate = createMemo(() => {
    const r = reportedLive()
    if (!r) return undefined
    const inputSide = r.cacheRead + r.cacheWrite + r.input
    if (inputSide <= 0) return undefined
    return r.cacheRead / inputSide
  })
  // The editor source lives client-side and is not part of the server-side
  // breakdown, so add its enabled token cost to the local total.
  const editorTokens = createMemo(() => {
    const source = editorSource()
    return source.enabled ? source.tokens : 0
  })
  const estimatedTotal = createMemo(() => (data()?.estimatedTotal ?? 0) + editorTokens())

  // Reserve a buffer for auto-compaction, matching the conversation runtime.
  const autocompactReserved = createMemo(() => (contextLimit() > 0 ? Math.min(20_000, contextLimit()) : 0))

  // Headline ratio = how much of the context window the prompt currently
  // occupies. We prefer the live `reported.total` because it reflects what
  // the model actually processed; fall back to the static `estimatedTotal`
  // when there's no assistant message yet (first-turn cold start).
  const usagePct = createMemo(() => computeUsageRatio(reportedTotal(), estimatedTotal(), contextLimit()))
  const usedAbs = createMemo(() => computeUsedTokens(reportedTotal(), estimatedTotal(), contextLimit()))
  const freeAbs = createMemo(() => computeFreeTokens(reportedTotal(), estimatedTotal(), contextLimit()))

  // Aggregate sources by category for the stacked composition chart.
  const categoryBreakdown = createMemo(() => buildCategoryBreakdown(theme, sources()))

  // Top-N tools — the largest contributors to the prompt. Each gets a
  // dedicated bar in the ranked list so the user can spot oversized tool
  // schemas (e.g. agent+skill combos) at a glance.
  const rankedSources = createMemo(() => {
    const enabled = sources().filter((s) => s.enabled && s.tokens > 0)
    enabled.sort((a, b) => b.tokens - a.tokens)
    return enabled.slice(0, 8).map((s) => ({
      name: s.label,
      value: s.tokens,
      subValue: `${CATEGORY_LABEL[s.category].split("·")[0]!.trim()}`,
      color: categoryColor(theme, s.category),
    }))
  })

  const turnTokens = createMemo(() => {
    const series = assistantMessages().map((m) => turnTotalFromMessage(m))
    return series.length > 0 ? series : [reportedTotal() > 0 ? reportedTotal() : estimatedTotal()]
  })
  const turnInput = createMemo(() => assistantMessages().map((m) => m.tokens.input))
  const turnCacheRead = createMemo(() => assistantMessages().map((m) => m.tokens.cache.read))
  const turnOutput = createMemo(() => assistantMessages().map((m) => m.tokens.output))

  // Stable sparkline widths. We clamp to 24 cells so the chart fits inside
  // the analytics-style card row regardless of how long the session runs.
  const chartW = createMemo(() => Math.max(20, Math.min(56, dimensions().width - 24)))

  // Operational health for the status grid.
  const health = createMemo(() => {
    const pct = usagePct()
    const cache = (cacheHitRate() ?? 0) * 100
    const free = contextLimit() > 0 ? Math.max(0, 100 - pct) : 0
    const fragmentation = (() => {
      // Fragmentation heuristic: when many sources >0 but no single category
      // dominates, the prompt is "fragmented" and harder for the model to
      // cache effectively. <35% top-category share on >20k prompts = warning.
      const breakdown = categoryBreakdown()
      const total = breakdown.reduce((sum, b) => sum + b.value, 0)
      if (total < 5_000 || breakdown.length === 0) return 0
      const top = Math.max(...breakdown.map((b) => b.value))
      return Math.round((1 - top / total) * 100)
    })()
    return {
      usage: healthStatus(pct, 90, 70),
      cache: healthStatus(cache, 30, 50, true),
      headroom: healthStatus(free, 5, 15, true),
      fragmentation: healthStatus(fragmentation, 70, 50, true),
    }
  })

  const viz = createMemo(() => getChartColors(theme))

  function rowID(index: number) {
    return "ctx-row-" + index
  }

  function clamp(index: number) {
    const length = sources().length
    if (length === 0) return 0
    return Math.max(0, Math.min(index, length - 1))
  }

  function scrollToSelected(index: number) {
    if (!scroll) return
    const target = scroll.getChildren().find((child) => child.id === rowID(index))
    if (!target) return
    const y = target.y - scroll.y
    if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
    if (y < 0) scroll.scrollBy(y)
  }

  function move(direction: number) {
    const length = sources().length
    if (length === 0) return
    let next = selected() + direction
    if (next < 0) next = length - 1
    if (next >= length) next = 0
    setSelected(next)
    scrollToSelected(next)
  }

  async function toggle(source: Source) {
    if (!source.togglable || !source.toggleKind || !source.toggleKey) return
    const sid = sessionID()
    if (busy()) return
    const nextEnabled = !source.enabled

    // Client-side editor context toggle: persist to the local kv store and let
    // the prompt component pick up the change reactively.
    if (source.toggleKind === EDITOR_TOGGLE_KIND) {
      setBusy(true)
      try {
        kv.set(source.toggleKey, nextEnabled)
        toast.show({
          message: `${source.label} ${nextEnabled ? "enabled" : "disabled"}`,
          variant: "success",
        })
      } catch (err: any) {
        toast.show({
          message: `Failed to toggle ${source.label}: ${err?.message ?? err}`,
          variant: "error",
        })
      } finally {
        setBusy(false)
      }
      return
    }

    if (!sid) return
    setBusy(true)
    try {
      const result = await sdk.client.session.contextToggle({
        sessionID: sid,
        kind: source.toggleKind,
        key: source.toggleKey,
        enabled: nextEnabled,
      })
      if (result.data) mutate(result.data as Breakdown)
      toast.show({
        message: `${source.label} ${nextEnabled ? "enabled" : "disabled"}`,
        variant: "success",
      })
    } catch (err: any) {
      toast.show({
        message: `Failed to toggle ${source.label}: ${err?.message ?? err}`,
        variant: "error",
      })
      void refetch()
    } finally {
      setBusy(false)
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p") || evt.name === "k") {
      move(-1)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n") || evt.name === "j") {
      move(1)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "space" || evt.name === "return") {
      const source = sources()[clamp(selected())]
      if (source) {
        evt.preventDefault()
        evt.stopPropagation()
        void toggle(source)
      }
    }
  })

  // The whole dashboard (KPI cards, charts, source list) can be taller than
  // the terminal once every section is enabled, so it scrolls as one unit
  // instead of spilling past the viewport. Reserve header (~3) + dialog
  // chrome/padding (~4) + a small margin.
  const bodyHeight = createMemo(() => Math.max(10, dimensions().height - 10))

  function tokenPct(value: number) {
    const limit = contextLimit()
    if (limit > 0) return Usage.formatPct(value, limit)
    const total = estimatedTotal()
    return total > 0 ? Usage.formatPct(value, total) : "—"
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      {/* Header — mirrors the analytics panel: title chip + live summary. */}
      <box flexDirection="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
        <box flexDirection="column" gap={0}>
          <text fg={theme.accent.alt} attributes={TextAttributes.BOLD} wrapMode="none">
            ◈ CONTEXT USAGE
          </text>
          <Show when={data()?.model}>
            <text fg={theme.foreground.muted} wrapMode="none">
              {data()!.model!.name} · {data()!.model!.providerID}/{data()!.model!.modelID} ·{" "}
              {Usage.formatTokens(usedAbs())} / {Usage.formatTokens(contextLimit())} ({usagePct().toFixed(1)}%)
            </text>
          </Show>
        </box>
        <text fg={theme.foreground.muted} wrapMode="none">
          esc close
        </text>
      </box>

      <Show
        when={data()?.model}
        fallback={
          <box>
            <Show when={!data.loading} fallback={<text fg={theme.foreground.muted}>Computing context breakdown…</text>}>
              <text fg={theme.foreground.muted}>No active session or no assistant messages yet.</text>
              <text fg={theme.foreground.muted}>Send a message to populate context usage.</text>
            </Show>
          </box>
        }
      >
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          height={bodyHeight()}
          paddingRight={1}
          scrollbarOptions={{ visible: true }}
        >
          {/* KPI row — 4 cards, each carries the sparkline of one metric over
            the conversation so the trend is visible without leaving the
            panel. Wraps to 2×2 on narrow terminals. */}
          <box flexDirection="row" gap={1} flexWrap="wrap" flexShrink={0}>
            <KPICard
              label="USED"
              value={Usage.formatTokens(usedAbs())}
              color={viz().input}
              subtitle={`${usagePct().toFixed(1)}% of ${Usage.formatTokens(contextLimit())}`}
              sparkline={turnTokens()}
              width={20}
            />
            <KPICard
              label="FREE"
              value={Usage.formatTokens(freeAbs())}
              color={viz().cache}
              subtitle={`${(100 - usagePct()).toFixed(1)}% headroom`}
              sparkline={turnInput().map((v) => Math.max(0, contextLimit() - v))}
              width={20}
            />
            <KPICard
              label="RESERVED"
              value={Usage.formatTokens(autocompactReserved())}
              color={viz().alert}
              subtitle="auto-compaction buffer"
              width={20}
            />
            <KPICard
              label="CACHE HIT"
              value={cacheHitRate() === undefined ? "—" : `${(cacheHitRate()! * 100).toFixed(0)}%`}
              color={viz().cache}
              subtitle={
                data()?.reported
                  ? `read ${Usage.formatTokens(data()!.reported.cacheRead)} · write ${Usage.formatTokens(
                      data()!.reported.cacheWrite,
                    )}`
                  : "no traffic yet"
              }
              sparkline={turnCacheRead()}
              width={20}
            />
          </box>

          {/* Pressure gauge — single line that reads as "how close am I to
            the limit" without any extra chrome. 70% = warning, 90% = error. */}
          <Show when={contextLimit() > 0}>
            <box flexDirection="row" gap={2} flexWrap="wrap" flexShrink={0}>
              <Gauge
                label="Context window pressure"
                value={usagePct()}
                max={100}
                width={Math.max(20, Math.min(48, chartW()))}
                color={
                  usagePct() >= 90
                    ? theme.status.error.fg
                    : usagePct() >= 70
                      ? theme.status.warning.fg
                      : theme.accent.fg
                }
                thresholds={[70, 90]}
                format={(v) => `${v.toFixed(0)}%`}
              />
              <Gauge
                label="Cache efficiency"
                value={(cacheHitRate() ?? 0) * 100}
                max={100}
                width={Math.max(20, Math.min(36, chartW() - 16))}
                color={
                  (cacheHitRate() ?? 0) >= 0.5
                    ? theme.status.success.fg
                    : (cacheHitRate() ?? 0) > 0
                      ? theme.status.warning.fg
                      : theme.status.error.fg
                }
                format={(v) => `${v.toFixed(0)}%`}
              />
            </box>
          </Show>

          {/* Composition chart — one segment per category, sized by enabled
            token share. Mirrors the analytics panel's `Usage composition`
            stacked bar. */}
          <Show when={categoryBreakdown().length > 0}>
            <box flexDirection="column" gap={0}>
              <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
                Prompt composition
              </text>
              <StackedBarChartV2 segments={categoryBreakdown()} width={chartW()} showLabels />
            </box>
          </Show>

          {/* Top sources — ranked bars highlight the largest single
            contributors so the user can decide which to disable / lazy-load. */}
          <Show when={rankedSources().length > 0}>
            <box flexDirection="column" gap={0}>
              <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
                Top sources
              </text>
              <RankedBarList
                items={rankedSources()}
                maxValue={Math.max(...rankedSources().map((s) => s.value), 1)}
                nameWidth={20}
                barWidth={Math.max(10, chartW() - 38)}
                highlight={5}
              />
            </box>
          </Show>

          {/* Per-turn trend — braille sparklines (input / cache / output)
            stacked so the conversation arc is visible at a glance. Only
            render when there's at least one assistant message. */}
          <Show when={assistantMessages().length > 0}>
            <box flexDirection="column" gap={0}>
              <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
                Tokens per turn · last {assistantMessages().length} turn
                {assistantMessages().length === 1 ? "" : "s"}
              </text>
              <text fg={theme.foreground.muted} wrapMode="none">
                input · cache · output
              </text>
              <box flexDirection="column" gap={0} paddingTop={1}>
                <BrailleSparkline data={turnInput()} width={Math.min(chartW(), 64)} color={viz().input} />
                <BrailleSparkline data={turnCacheRead()} width={Math.min(chartW(), 64)} color={viz().cache} />
                <BrailleSparkline data={turnOutput()} width={Math.min(chartW(), 64)} color={viz().output} />
              </box>
            </box>
          </Show>

          {/* Operational health — 4-cell status grid derived from the
            headline ratios. Mirrors analytics. */}
          <box flexDirection="column" gap={0}>
            <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
              Context health
            </text>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <HealthCard
                label="Usage"
                detail={usagePct() > 0 ? `${usagePct().toFixed(0)}% of window used` : "No traffic yet"}
                status={health().usage}
              />
              <HealthCard
                label="Cache"
                detail={
                  cacheHitRate() === undefined
                    ? "no traffic yet"
                    : `${(cacheHitRate()! * 100).toFixed(0)}% cached input`
                }
                status={health().cache}
              />
              <HealthCard
                label="Headroom"
                detail={`${(100 - usagePct()).toFixed(0)}% remaining`}
                status={health().headroom}
              />
              <HealthCard
                label="Fragmentation"
                detail={
                  categoryBreakdown().length > 1 ? `${categoryBreakdown().length} categories active` : "Single source"
                }
                status={health().fragmentation}
              />
            </box>
          </box>

          {/* Source list — same toggle-by-row interaction as before, but now
            sits below the analytics-style summary rather than being the
            whole panel. Header line hints at the keyboard model. Scrolling
            is handled by the outer scrollbox that wraps the whole body. */}
          <box flexDirection="column" gap={0}>
            <For each={sources()}>
              {(source, index) => {
                const active = createMemo(() => index() === selected())
                const prev = createMemo(() => sources()[index() - 1])
                const showHeader = createMemo(() => index() === 0 || prev()?.category !== source.category)
                const indicator = () => {
                  if (!source.togglable) return "•"
                  return source.enabled ? "[x]" : "[ ]"
                }
                const indicatorColor = () => {
                  if (!source.togglable) return theme.foreground.muted
                  return source.enabled ? theme.status.success.fg : theme.foreground.muted
                }
                const labelColor = () => (source.enabled ? theme.foreground.default : theme.foreground.muted)
                return (
                  <>
                    <Show when={showHeader()}>
                      <box paddingTop={index() > 0 ? 1 : 0}>
                        <text fg={theme.accent.alt} attributes={TextAttributes.BOLD} wrapMode="none">
                          {CATEGORY_LABEL[source.category]}
                        </text>
                      </box>
                    </Show>
                    <box
                      id={rowID(index())}
                      flexDirection="row"
                      gap={1}
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={active() ? theme.surface.offset : undefined}
                      onMouseUp={() => {
                        setSelected(index())
                        void toggle(source)
                      }}
                    >
                      <text flexShrink={0} fg={indicatorColor()} wrapMode="none">
                        {indicator()}
                      </text>
                      <box flexGrow={1} flexShrink={1} flexDirection="row" justifyContent="space-between" gap={2}>
                        <text flexShrink={1} wrapMode="none" fg={labelColor()}>
                          <Show
                            when={source.enabled}
                            fallback={<span style={{ fg: theme.foreground.muted }}>{source.label}</span>}
                          >
                            <b>{source.label}</b>
                          </Show>
                          <Show when={source.detail}>
                            <span style={{ fg: theme.foreground.muted }}> — {source.detail}</span>
                          </Show>
                        </text>
                        <text
                          flexShrink={0}
                          fg={source.enabled ? theme.foreground.default : theme.foreground.muted}
                          wrapMode="none"
                        >
                          {Usage.formatTokens(source.tokens)}
                          <span style={{ fg: theme.foreground.muted }}>
                            {" "}
                            {source.enabled ? tokenPct(source.tokens) : "(off)"}
                          </span>
                        </text>
                      </box>
                    </box>
                  </>
                )
              }}
            </For>
          </box>

          {/* Footer — same keybind hint as before, plus a meta line with the
            cache-hit colour hint so the user can correlate it with the KPI. */}
          <Show when={data()?.reported && reportedTotal() > 0}>
            <box flexDirection="row" flexWrap="wrap" gap={2}>
              <text fg={theme.foreground.muted} wrapMode="none">
                cache read {Usage.formatTokens(data()!.reported.cacheRead)}
              </text>
              <text fg={theme.foreground.muted} wrapMode="none">
                cache write {Usage.formatTokens(data()!.reported.cacheWrite)}
              </text>
              <Show when={cacheHitRate() !== undefined}>
                <text
                  fg={
                    cacheHitRate()! >= 0.5
                      ? theme.status.success.fg
                      : cacheHitRate()! > 0
                        ? theme.status.warning.fg
                        : theme.status.error.fg
                  }
                  wrapMode="none"
                >
                  cache hit{" "}
                  {Usage.formatPct(
                    data()!.reported.cacheRead,
                    data()!.reported.cacheRead + data()!.reported.cacheWrite + data()!.reported.input,
                  )}
                </text>
              </Show>
              <text fg={theme.foreground.muted} wrapMode="none">
                output {Usage.formatTokens(data()!.reported.output)}
              </text>
              <Show when={data()!.reported.reasoning > 0}>
                <text fg={theme.foreground.muted} wrapMode="none">
                  reasoning {Usage.formatTokens(data()!.reported.reasoning)}
                </text>
              </Show>
            </box>
          </Show>

          <box paddingTop={1} flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
            <text fg={theme.foreground.muted} wrapMode="none">
              ↑↓ navigate
            </text>
            <text fg={theme.border.subtle} wrapMode="none">
              ·
            </text>
            <text fg={busy() ? theme.status.warning.fg : theme.foreground.muted} wrapMode="none">
              {busy() ? "saving…" : "space toggle"}
            </text>
            <text fg={theme.border.subtle} wrapMode="none">
              ·
            </text>
            <text fg={theme.foreground.muted} wrapMode="none">
              esc close
            </text>
          </box>
        </scrollbox>
      </Show>
    </box>
  )
}

// ===== Local subcomponents =====

const HEALTH_ICON: Record<HealthStatus, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✗",
}

function HealthCard(props: { label: string; detail: string; status: HealthStatus }) {
  const { theme } = useTheme()
  return (
    <box
      border
      borderColor={
        props.status === "success"
          ? theme.status.success.fg
          : props.status === "warning"
            ? theme.status.warning.fg
            : props.status === "error"
              ? theme.status.error.fg
              : theme.status.info.fg
      }
      paddingLeft={1}
      paddingRight={1}
      minWidth={18}
      flexGrow={1}
      flexShrink={1}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <text
          fg={
            props.status === "success"
              ? theme.status.success.fg
              : props.status === "warning"
                ? theme.status.warning.fg
                : props.status === "error"
                  ? theme.status.error.fg
                  : theme.status.info.fg
          }
          attributes={TextAttributes.BOLD}
          wrapMode="none"
        >
          {HEALTH_ICON[props.status]}
        </text>
        <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
          {props.label}
        </text>
      </box>
      <text fg={theme.foreground.muted} wrapMode="word">
        {props.detail}
      </text>
    </box>
  )
}
