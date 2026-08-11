import { Effect } from "effect"
import { Database } from "@/database/database"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { AnalyticsRollup } from "./rollup"

/**
 * The dataset behind a `/data` page, computed from the local rollups.
 *
 * Shaped after what opencode.ai/data publishes — models ranked by tokens with a
 * daily series, cost per session, blended price per million, cache ratio and
 * share by model author — restricted to what this install can actually measure.
 * There is deliberately no geography section: nothing here knows where a request
 * came from, and adding it would mean collecting something new rather than
 * summarising something already stored.
 *
 * Window totals are not summed out of the day rollups. A session that spans two
 * days is two rows in `analytics_stat`, so adding them up would report it twice;
 * the same reasoning that makes the rollup count distinct sessions per day makes
 * the window count its own query. Token and cost sums are additive and are taken
 * from the rollups.
 */
export namespace AnalyticsData {
  /** Matches the default window of the public page. */
  export const WINDOW_DAYS = 30
  /** Longer series, so a trend is visible before a rank changes. */
  export const SERIES_DAYS = 60
  /** Bands in the stacked series; everything else folds into one. */
  export const SERIES_MODELS = 5

  const MICRO_CENTS_PER_USD = 100_000_000
  const DAY_MS = 86_400_000

  /**
   * Model name to the organisation that made it, by substring — the same shape
   * opencode uses. A model nikcli has never seen still lands somewhere sensible,
   * which matters because the list is provider-supplied and grows without us.
   */
  const AUTHOR_RULES: ReadonlyArray<{ match: string; author: string }> = [
    { match: "claude", author: "anthropic" },
    { match: "gemini", author: "google" },
    { match: "gemma", author: "google" },
    { match: "gpt", author: "openai" },
    { match: "o1", author: "openai" },
    { match: "o3", author: "openai" },
    { match: "deepseek", author: "deepseek" },
    { match: "grok", author: "xai" },
    { match: "llama", author: "meta" },
    { match: "mistral", author: "mistral" },
    { match: "mixtral", author: "mistral" },
    { match: "qwen", author: "qwen" },
    { match: "kimi", author: "moonshot" },
    { match: "glm", author: "zhipu" },
    { match: "minimax", author: "minimax" },
    { match: "nemotron", author: "nvidia" },
    { match: "command", author: "cohere" },
  ]

  /** Provider suffixes that describe routing, not a different model. */
  export function normalizeModel(value: string | undefined): string {
    return (value || "unknown").replace(/(-free|-latest|:global|:free)+$/, "") || "unknown"
  }

  export function modelAuthor(value: string | undefined): string {
    const model = normalizeModel(value).toLowerCase()
    return AUTHOR_RULES.find((rule) => model.includes(rule.match))?.author ?? "unknown"
  }

  export interface ModelStat {
    model: string
    /** Provider that served most of this model's tokens. */
    provider: string
    author: string
    tokens: number
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    /** Distinct sessions over the whole window, not a sum of daily counts. */
    sessions: number
    messages: number
    toolCalls: number
    costUsd: number
    /** Share of window tokens, 0..1. */
    share: number
    /** Blended price of 1M tokens at what was actually billed, USD. */
    pricePerMillion: number
    costPerSession: number
    tokensPerSession: number
    /** Input tokens served from cache, 0..1. `null` when there was no input. */
    cacheRatio: number | null
  }

  export interface AuthorStat {
    author: string
    tokens: number
    sessions: number
    share: number
    models: number
  }

  export interface SeriesPoint {
    day: string
    /** Tokens per model; models absent that day are omitted. */
    byModel: Record<string, number>
    tokens: number
    sessions: number
  }

  export interface Totals {
    tokens: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    sessions: number
    messages: number
    toolCalls: number
    costUsd: number
    models: number
    providers: number
    authors: number
    pricePerMillion: number
    costPerSession: number
    tokensPerSession: number
    cacheRatio: number | null
    /** Token change against the window before. `null` when there is no prior data. */
    change: number | null
  }

  /** One calendar month, or the whole of recorded history when `month` is null. */
  export interface PeriodStat {
    /** `YYYY-MM`, or `null` for the lifetime row. */
    month: string | null
    tokens: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    messages: number
    toolCalls: number
    /** Distinct sessions in the period — counted, never summed from days. */
    sessions: number
    costUsd: number
    models: number
    pricePerMillion: number
    costPerSession: number
    cacheRatio: number | null
  }

  export interface Data {
    totals: Totals
    models: ModelStat[]
    authors: AuthorStat[]
    series: SeriesPoint[]
    /** Every calendar month with usage, oldest first. */
    months: PeriodStat[]
    /** Everything ever recorded, not just the window. */
    lifetime: PeriodStat
    /** Models the stacked series draws, largest first, plus `other`. */
    seriesModels: string[]
    windowDays: number
    seriesDays: number
    from: string
    to: string
    generatedAt: number
  }

  function dayKey(at: number): string {
    return new Date(at).toISOString().slice(0, 10)
  }

  /**
   * Read a day count off a query string. Bounded because it reaches SQL: an
   * unchecked value would let one request scan a decade of messages.
   */
  export function clampDays(value: string | undefined, fallback: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback
    return Math.min(Math.trunc(parsed), 365)
  }

  /**
   * Rebuild the rollups the window needs, then build. Both HTTP surfaces call
   * this so neither can serve a page that is missing a session which ran since
   * the last publish.
   */
  export async function refreshed(input?: { days?: string; seriesDays?: string }): Promise<Data | null> {
    const windowDays = clampDays(input?.days, WINDOW_DAYS)
    const seriesDays = clampDays(input?.seriesDays, SERIES_DAYS)
    const now = Date.now()
    const to = dayKey(now)
    // Twice the widest window, so the previous-window comparison is rebuilt too.
    const recent = dayKey(now - (Math.max(windowDays, seriesDays) * 2 - 1) * DAY_MS)

    // First run backfills everything, so the lifetime total covers the whole
    // history rather than starting the day this feature was first used. After
    // that only the recent window is recomputed — older days are already rolled
    // up and their messages will not change.
    const { earliestDay, rollupRows } = await AnalyticsRollup.bounds().catch(() => ({
      earliestDay: undefined,
      rollupRows: 1,
    }))
    const from = rollupRows === 0 && earliestDay && earliestDay < recent ? earliestDay : recent

    await AnalyticsRollup.rebuild({ from, to }).catch(() => 0)
    return build({ now, windowDays, seriesDays })
  }

  function ratio(part: number, whole: number): number {
    return whole > 0 ? part / whole : 0
  }

  /**
   * Distinct sessions per model over a whole window, and the overall total.
   *
   * Both come straight from the messages because neither is recoverable from the
   * day rollups: a session running across three days appears in three of them.
   */
  function windowSessions(from: string, to: string) {
    return runPromiseWithLayer(
      Database.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const { native } = yield* Database.Service
          return yield* Effect.sync(() => {
            const day = "date(created_at / 1000, 'unixepoch')"
            const where = `role = 'assistant'
              AND json_extract(info, '$.modelID') IS NOT NULL
              AND json_extract(info, '$.modelID') != ''
              AND ${day} BETWEEN ? AND ?`

            const perModel = native
              .query<{ model: string; sessions: number }, [string, string]>(
                `SELECT json_extract(info, '$.modelID') AS model, COUNT(DISTINCT session_id) AS sessions
                 FROM message_info WHERE ${where} GROUP BY 1`,
              )
              .all(from, to)

            const overall = native
              .query<
                { sessions: number },
                [string, string]
              >(`SELECT COUNT(DISTINCT session_id) AS sessions FROM message_info WHERE ${where}`)
              .get(from, to)

            // Sessions per calendar month, and over all of recorded history.
            // Neither is the sum of the day counts: a session running from the
            // 31st into the 1st belongs to one month, and to one lifetime.
            const monthWhere = `role = 'assistant'
              AND json_extract(info, '$.modelID') IS NOT NULL
              AND json_extract(info, '$.modelID') != ''`

            const perMonth = native
              .query<{ month: string; sessions: number }, []>(
                `SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch') AS month,
                        COUNT(DISTINCT session_id) AS sessions
                 FROM message_info WHERE ${monthWhere} GROUP BY 1 ORDER BY 1 ASC`,
              )
              .all()

            const lifetime = native
              .query<
                { sessions: number },
                []
              >(`SELECT COUNT(DISTINCT session_id) AS sessions FROM message_info WHERE ${monthWhere}`)
              .get()

            return {
              byModel: new Map(perModel.map((row) => [normalizeModel(row.model), row.sessions])),
              total: overall?.sessions ?? 0,
              byMonth: new Map(perMonth.map((row) => [row.month, row.sessions])),
              lifetime: lifetime?.sessions ?? 0,
            }
          })
        }),
      ),
    )
  }

  /**
   * Build the dataset for the window ending today.
   *
   * Returns `null` when the window holds no tokens — a page must render an
   * explicit empty state rather than present zeroes as a measurement.
   */
  export async function build(input?: {
    now?: number
    windowDays?: number
    seriesDays?: number
  }): Promise<Data | null> {
    const now = input?.now ?? Date.now()
    const windowDays = input?.windowDays ?? WINDOW_DAYS
    const seriesDays = input?.seriesDays ?? SERIES_DAYS

    const to = dayKey(now)
    const from = dayKey(now - (windowDays - 1) * DAY_MS)
    const previousFrom = dayKey(now - (windowDays * 2 - 1) * DAY_MS)
    const previousTo = dayKey(now - windowDays * DAY_MS)
    const seriesFrom = dayKey(now - (seriesDays - 1) * DAY_MS)

    const [current, previous, series, sessions, everything] = await Promise.all([
      AnalyticsRollup.read({ from, to }),
      AnalyticsRollup.read({ from: previousFrom, to: previousTo }),
      AnalyticsRollup.read({ from: seriesFrom, to }),
      windowSessions(from, to),
      // Month and lifetime rows cover all of recorded history, not the window.
      AnalyticsRollup.read({ from: "0000-01-01", to: "9999-12-31" }),
    ])

    const totalTokens = current.reduce((sum, row) => sum + row.totalTokens, 0)
    // Only "nothing was ever recorded" is nothing to show. A quiet month still
    // has a lifetime total behind it, and returning null for an empty window
    // would hide every month and the total along with it.
    if (everything.length === 0) return null

    // Per model, summed across the providers that served it.
    const byModel = new Map<string, ModelStat & { providerTokens: Map<string, number> }>()
    for (const row of current) {
      const model = normalizeModel(row.model)
      let stat = byModel.get(model)
      if (!stat) {
        stat = {
          model,
          provider: row.provider,
          author: modelAuthor(model),
          tokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          sessions: 0,
          messages: 0,
          toolCalls: 0,
          costUsd: 0,
          share: 0,
          pricePerMillion: 0,
          costPerSession: 0,
          tokensPerSession: 0,
          cacheRatio: null,
          providerTokens: new Map(),
        }
        byModel.set(model, stat)
      }
      stat.tokens += row.totalTokens
      stat.inputTokens += row.inputTokens
      stat.outputTokens += row.outputTokens
      stat.reasoningTokens += row.reasoningTokens
      stat.cacheReadTokens += row.cacheReadTokens
      stat.cacheWriteTokens += row.cacheWriteTokens
      stat.messages += row.messages
      stat.toolCalls += row.toolCalls
      stat.costUsd += row.costMicroCents / MICRO_CENTS_PER_USD
      stat.providerTokens.set(row.provider, (stat.providerTokens.get(row.provider) ?? 0) + row.totalTokens)
    }

    const models: ModelStat[] = [...byModel.values()]
      .map(({ providerTokens, ...stat }) => {
        const provider = [...providerTokens.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? stat.provider
        // Distinct over the window, so it is never the sum of daily counts.
        const sessionCount = sessions.byModel.get(stat.model) ?? 0
        // Output tokens cannot be cached, so the denominator is input only.
        const cacheable = stat.inputTokens + stat.cacheReadTokens
        return {
          ...stat,
          provider,
          sessions: sessionCount,
          share: ratio(stat.tokens, totalTokens),
          pricePerMillion: stat.tokens > 0 ? (stat.costUsd / stat.tokens) * 1_000_000 : 0,
          costPerSession: ratio(stat.costUsd, sessionCount),
          tokensPerSession: ratio(stat.tokens, sessionCount),
          cacheRatio: cacheable > 0 ? stat.cacheReadTokens / cacheable : null,
        }
      })
      .sort((a, b) => b.tokens - a.tokens || (a.model < b.model ? -1 : 1))

    // Share by the organisation that made the model.
    const byAuthor = new Map<string, { tokens: number; sessions: number; models: Set<string> }>()
    for (const model of models) {
      const entry = byAuthor.get(model.author) ?? { tokens: 0, sessions: 0, models: new Set<string>() }
      entry.tokens += model.tokens
      // Sessions are not additive across models either: this is an upper bound on
      // an author's reach, not a distinct count, so it is reported as sessions
      // observed rather than sessions unique to the author.
      entry.sessions += model.sessions
      entry.models.add(model.model)
      byAuthor.set(model.author, entry)
    }
    const authors: AuthorStat[] = [...byAuthor.entries()]
      .map(([author, entry]) => ({
        author,
        tokens: entry.tokens,
        sessions: entry.sessions,
        models: entry.models.size,
        share: ratio(entry.tokens, totalTokens),
      }))
      .sort((a, b) => b.tokens - a.tokens || (a.author < b.author ? -1 : 1))

    // Only the largest models get their own band; the tail folds into `other` so
    // the stack stays readable.
    const seriesModels = models.slice(0, SERIES_MODELS).map((model) => model.model)
    const banded = new Set(seriesModels)
    const points = new Map<string, SeriesPoint>()
    for (let offset = seriesDays - 1; offset >= 0; offset--) {
      const day = dayKey(now - offset * DAY_MS)
      points.set(day, { day, byModel: {}, tokens: 0, sessions: 0 })
    }
    for (const row of series) {
      const point = points.get(row.periodKey)
      if (!point) continue
      const model = normalizeModel(row.model)
      const band = banded.has(model) ? model : "other"
      point.byModel[band] = (point.byModel[band] ?? 0) + row.totalTokens
      point.tokens += row.totalTokens
      // Per day this is a distinct count already; across models on one day it can
      // still double a session that used two, so it reads as activity, not reach.
      point.sessions += row.sessions
    }

    // Months and lifetime. Token and cost columns are additive so they come from
    // the day rollups; the session count for each period does not, so it comes
    // from the distinct queries above.
    const buildPeriod = (month: string | null, rows: AnalyticsRollup.Row[], sessionCount: number): PeriodStat => {
      const sum = (pick: (row: AnalyticsRollup.Row) => number) => rows.reduce((total, row) => total + pick(row), 0)
      const tokens = sum((row) => row.totalTokens)
      const input = sum((row) => row.inputTokens)
      const cacheRead = sum((row) => row.cacheReadTokens)
      const cost = sum((row) => row.costMicroCents) / MICRO_CENTS_PER_USD
      const cacheable = input + cacheRead
      return {
        month,
        tokens,
        inputTokens: input,
        outputTokens: sum((row) => row.outputTokens),
        cacheReadTokens: cacheRead,
        messages: sum((row) => row.messages),
        toolCalls: sum((row) => row.toolCalls),
        sessions: sessionCount,
        costUsd: cost,
        models: new Set(rows.map((row) => normalizeModel(row.model))).size,
        pricePerMillion: tokens > 0 ? (cost / tokens) * 1_000_000 : 0,
        costPerSession: ratio(cost, sessionCount),
        cacheRatio: cacheable > 0 ? cacheRead / cacheable : null,
      }
    }

    const rowsByMonth = new Map<string, AnalyticsRollup.Row[]>()
    for (const row of everything) {
      const month = row.periodKey.slice(0, 7)
      const bucket = rowsByMonth.get(month)
      if (bucket) bucket.push(row)
      else rowsByMonth.set(month, [row])
    }
    const months = [...rowsByMonth.entries()]
      .sort((left, right) => (left[0] < right[0] ? -1 : 1))
      .map(([month, rows]) => buildPeriod(month, rows, sessions.byMonth.get(month) ?? 0))
    const lifetime = buildPeriod(null, everything, sessions.lifetime)

    const inputTokens = models.reduce((sum, model) => sum + model.inputTokens, 0)
    const cacheReadTokens = models.reduce((sum, model) => sum + model.cacheReadTokens, 0)
    const costUsd = models.reduce((sum, model) => sum + model.costUsd, 0)
    const cacheable = inputTokens + cacheReadTokens
    const previousTokens = previous.reduce((sum, row) => sum + row.totalTokens, 0)

    return {
      totals: {
        tokens: totalTokens,
        inputTokens,
        outputTokens: models.reduce((sum, model) => sum + model.outputTokens, 0),
        cacheReadTokens,
        sessions: sessions.total,
        messages: models.reduce((sum, model) => sum + model.messages, 0),
        toolCalls: models.reduce((sum, model) => sum + model.toolCalls, 0),
        costUsd,
        models: models.length,
        providers: new Set(current.map((row) => row.provider)).size,
        authors: authors.length,
        pricePerMillion: totalTokens > 0 ? (costUsd / totalTokens) * 1_000_000 : 0,
        costPerSession: ratio(costUsd, sessions.total),
        tokensPerSession: ratio(totalTokens, sessions.total),
        cacheRatio: cacheable > 0 ? cacheReadTokens / cacheable : null,
        change: previousTokens > 0 ? (totalTokens - previousTokens) / previousTokens : null,
      },
      models,
      authors,
      months,
      lifetime,
      series: [...points.values()],
      seriesModels: [...seriesModels, "other"],
      windowDays,
      seriesDays,
      from,
      to,
      generatedAt: Math.floor(now / 1000),
    }
  }
}
