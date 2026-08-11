/**
 * Public, aggregate-only view of real nikcli usage — the data behind /data.
 *
 * Two sources, both real, neither modelled or back-filled:
 *
 *   1. `usage_events` in the `nikcli-inference` D1 database. The inference
 *      gateway writes exactly one row per `/v1/chat/completions` call
 *      (packages/inference/src/server.ts -> packages/inference-dashboard
 *      /src/pages/api/usage/ingest.ts), and that same table is what billing
 *      reads. Every token, cost and cache number on the page is a SUM over it.
 *   2. STATS.md at the repo root, appended by the download-stats workflow.
 *      That is the adoption series.
 *
 * Only aggregates leave this module. Rows carry `user_id`, `api_key_id` and
 * `rid`; none of them are selected, so nothing here can identify an account or
 * a request. `upstream_usd` is deliberately not exposed either: publishing it
 * next to `billed_usd` would publish the gateway's margin. Cache savings, the
 * number that belongs to the user, are exposed instead.
 *
 * When the database is unbound or empty the page renders an explicit "no rows
 * yet" state — a zero is never presented as a measurement.
 */
import { and, count, gte, lt, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import { UsageEvents } from "./usage.sql"

/** Rolling window the headline metrics and the leaderboard are measured over. */
export const WINDOW_DAYS = 30
/** Longer window for the daily time series, so trend is visible before rank. */
export const SERIES_DAYS = 60

const DAY_SECONDS = 86_400

/** One `GROUP BY model, provider` bucket, straight out of D1. */
export interface UsageBucket {
  model: string
  provider: string | null
  requests: number
  input_tokens: number
  output_tokens: number
  billed_usd: number
  saved_usd: number
  cache_hits: number
  cache_reported: number
}

/** One `GROUP BY day, model` bucket, straight out of D1. */
export interface DailyBucket {
  day: string
  model: string
  tokens: number
  requests: number
}

export interface ModelStat {
  model: string
  /** Provider that served the most tokens for this model. `null` = cache-served. */
  provider: string | null
  tokens: number
  inputTokens: number
  outputTokens: number
  requests: number
  billedUsd: number
  savedUsd: number
  /** Share of this window's tokens, 0..1. */
  share: number
  /** Token change against the previous window, 0..1-based ratio. `null` = no prior data. */
  change: number | null
  /** Mean billed cost of one request, USD. */
  costPerRequest: number
  /** Mean tokens in one request. */
  tokensPerRequest: number
  /** Blended price of 1M tokens at what was actually billed, USD. */
  pricePerMillion: number
  /** Share of requests served from cache, 0..1. `null` = gateway reported no cache state. */
  cacheRatio: number | null
}

export interface ProviderStat {
  provider: string
  tokens: number
  requests: number
  /** Share of the tokens that reached an upstream at all, 0..1. */
  share: number
}

export interface TotalsStat {
  tokens: number
  inputTokens: number
  outputTokens: number
  requests: number
  billedUsd: number
  savedUsd: number
  models: number
  providers: number
  costPerRequest: number
  tokensPerRequest: number
  pricePerMillion: number
  cacheRatio: number | null
  /**
   * Tokens on rows with no provider. The gateway leaves `provider` null exactly
   * when it answered from cache, so these never reached an upstream — which is
   * why they are held out of the provider shares rather than listed as one.
   */
  cacheServedTokens: number
  /** Token change against the previous window. `null` = no prior data. */
  change: number | null
}

export interface SeriesPoint {
  day: string
  /** Tokens per model on this day; models absent that day are omitted. */
  byModel: Record<string, number>
  tokens: number
  requests: number
}

export interface DownloadPoint {
  date: string
  github: number
  npm: number
  total: number
}

export interface GatewayStats {
  totals: TotalsStat
  models: ModelStat[]
  providers: ProviderStat[]
  series: SeriesPoint[]
  /** Models ordered as the stacked series draws them, largest first. */
  seriesModels: string[]
  windowDays: number
  seriesDays: number
}

export interface PublicStats {
  /** `null` when D1 is unbound or holds no rows in the window. */
  gateway: GatewayStats | null
  downloads: DownloadPoint[]
  /** Unix seconds the page was rendered at. */
  generatedAt: number
}

/**
 * The three time bounds every query on this page is scoped to, in unix seconds:
 * the reported window, the one before it that `change` compares against, and
 * the longer window the daily series is drawn over.
 */
export function usageWindows(now: number) {
  const windowStart = now - WINDOW_DAYS * DAY_SECONDS
  return {
    windowStart,
    previousStart: windowStart - WINDOW_DAYS * DAY_SECONDS,
    seriesStart: now - SERIES_DAYS * DAY_SECONDS,
  }
}

/** The `usage_events` columns the page reads, summed per model and provider. */
function bucketColumns() {
  return {
    model: UsageEvents.resolvedModel,
    provider: UsageEvents.provider,
    requests: count(),
    input_tokens: sql<number>`coalesce(sum(${UsageEvents.promptTokens}), 0)`,
    output_tokens: sql<number>`coalesce(sum(${UsageEvents.completionTokens}), 0)`,
    billed_usd: sql<number>`coalesce(sum(${UsageEvents.billedUsd}), 0)`,
    saved_usd: sql<number>`coalesce(sum(${UsageEvents.savedUsd}), 0)`,
    cache_hits: sql<number>`sum(case when ${UsageEvents.cache} = 'hit' then 1 else 0 end)`,
    cache_reported: sql<number>`sum(case when ${UsageEvents.cache} is not null then 1 else 0 end)`,
  }
}

/** SQLite returns SUMs as numbers, but a null SUM or a string driver would not. */
function numeric(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeBucket(row: Record<string, unknown>): UsageBucket {
  return {
    model: String(row.model),
    provider: row.provider === null || row.provider === undefined ? null : String(row.provider),
    requests: numeric(row.requests),
    input_tokens: numeric(row.input_tokens),
    output_tokens: numeric(row.output_tokens),
    billed_usd: numeric(row.billed_usd),
    saved_usd: numeric(row.saved_usd),
    cache_hits: numeric(row.cache_hits),
    cache_reported: numeric(row.cache_reported),
  }
}

/**
 * Reads the three aggregates the page needs from the real gateway database:
 * this window, the window before it (for change %), and the daily series.
 *
 * Returns `null` on an unbound database or a query error — a public page must
 * not 500 because a preview deployment has no binding.
 */
export async function queryGateway(binding: D1Database | undefined, now: number): Promise<GatewayStats | null> {
  if (!binding) return null
  const db = drizzle(binding)
  const { windowStart, previousStart, seriesStart } = usageWindows(now)
  const day = sql<string>`date(${UsageEvents.createdAt}, 'unixepoch')`

  const window = (from: number, to: number) =>
    db
      .select(bucketColumns())
      .from(UsageEvents)
      .where(and(gte(UsageEvents.createdAt, from), lt(UsageEvents.createdAt, to)))
      .groupBy(UsageEvents.resolvedModel, UsageEvents.provider)

  try {
    const [current, previous, daily] = await Promise.all([
      window(windowStart, now),
      window(previousStart, windowStart),
      db
        .select({
          day,
          model: UsageEvents.resolvedModel,
          tokens: sql<number>`coalesce(sum(${UsageEvents.promptTokens} + ${UsageEvents.completionTokens}), 0)`,
          requests: count(),
        })
        .from(UsageEvents)
        .where(gte(UsageEvents.createdAt, seriesStart))
        .groupBy(day, UsageEvents.resolvedModel)
        .orderBy(day),
    ])
    const series: DailyBucket[] = daily.map((row) => ({
      day: String(row.day),
      model: String(row.model),
      tokens: numeric(row.tokens),
      requests: numeric(row.requests),
    }))
    return summarize(current.map(normalizeBucket), previous.map(normalizeBucket), series, now)
  } catch {
    return null
  }
}

function bucketTokens(b: UsageBucket): number {
  return b.input_tokens + b.output_tokens
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

/**
 * Turns raw D1 buckets into everything the page renders. Pure, so the whole
 * aggregation is testable without a database.
 *
 * Returns `null` when the current window has no rows: the page then says the
 * gateway has published nothing yet rather than drawing an axis of zeroes.
 */
export function summarize(
  current: UsageBucket[],
  previous: UsageBucket[],
  daily: DailyBucket[],
  now: number,
): GatewayStats | null {
  if (current.length === 0) return null

  const totalTokens = current.reduce((sum, b) => sum + bucketTokens(b), 0)
  if (totalTokens === 0) return null

  const previousByModel = new Map<string, number>()
  for (const b of previous) previousByModel.set(b.model, (previousByModel.get(b.model) ?? 0) + bucketTokens(b))
  const previousTotal = previous.reduce((sum, b) => sum + bucketTokens(b), 0)

  // Per model: sum across providers, and remember which provider carried most
  // of the tokens so the leaderboard can name one.
  const perModel = new Map<string, ModelStat & { providerTokens: Map<string | null, number> }>()
  for (const b of current) {
    const tokens = bucketTokens(b)
    let row = perModel.get(b.model)
    if (!row) {
      row = {
        model: b.model,
        provider: null,
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        requests: 0,
        billedUsd: 0,
        savedUsd: 0,
        share: 0,
        change: null,
        costPerRequest: 0,
        tokensPerRequest: 0,
        pricePerMillion: 0,
        cacheRatio: null,
        providerTokens: new Map(),
      }
      perModel.set(b.model, row)
    }
    row.tokens += tokens
    row.inputTokens += b.input_tokens
    row.outputTokens += b.output_tokens
    row.requests += b.requests
    row.billedUsd += b.billed_usd
    row.savedUsd += b.saved_usd
    row.providerTokens.set(b.provider, (row.providerTokens.get(b.provider) ?? 0) + tokens)
  }

  // Cache state is optional in the ingest payload, so the ratio is hits over
  // the requests that reported a state — not over every request. Both sides are
  // summed across providers before dividing.
  const cacheHits = new Map<string, number>()
  const cacheReported = new Map<string, number>()
  for (const b of current) {
    cacheHits.set(b.model, (cacheHits.get(b.model) ?? 0) + b.cache_hits)
    cacheReported.set(b.model, (cacheReported.get(b.model) ?? 0) + b.cache_reported)
  }

  const models: ModelStat[] = [...perModel.values()]
    .map((row) => {
      const before = previousByModel.get(row.model)
      const reported = cacheReported.get(row.model) ?? 0
      let dominantProvider: string | null = null
      let dominantTokens = -1
      for (const [provider, tokens] of row.providerTokens) {
        if (tokens > dominantTokens) {
          dominantProvider = provider
          dominantTokens = tokens
        }
      }
      const { providerTokens: _drop, ...rest } = row
      return {
        ...rest,
        provider: dominantProvider,
        share: ratio(row.tokens, totalTokens),
        change: before && before > 0 ? (row.tokens - before) / before : null,
        costPerRequest: ratio(row.billedUsd, row.requests),
        tokensPerRequest: ratio(row.tokens, row.requests),
        pricePerMillion: ratio(row.billedUsd, row.tokens) * 1_000_000,
        cacheRatio: reported > 0 ? ratio(cacheHits.get(row.model) ?? 0, reported) : null,
      }
    })
    .sort((a, b) => b.tokens - a.tokens)

  // Rows with no provider were answered from cache and never reached an
  // upstream, so they are reported on their own rather than ranked as if some
  // vendor called "cache" had served them.
  const cacheServedTokens = current
    .filter((b) => b.provider === null)
    .reduce((sum, b) => sum + bucketTokens(b), 0)
  const perProvider = new Map<string, { tokens: number; requests: number }>()
  for (const b of current) {
    if (b.provider === null) continue
    const row = perProvider.get(b.provider) ?? { tokens: 0, requests: 0 }
    row.tokens += bucketTokens(b)
    row.requests += b.requests
    perProvider.set(b.provider, row)
  }
  const upstreamTokens = totalTokens - cacheServedTokens
  const providers: ProviderStat[] = [...perProvider.entries()]
    .map(([provider, row]) => ({ provider, ...row, share: ratio(row.tokens, upstreamTokens) }))
    .sort((a, b) => b.tokens - a.tokens)

  const totalRequests = current.reduce((sum, b) => sum + b.requests, 0)
  const totalBilled = current.reduce((sum, b) => sum + b.billed_usd, 0)
  const totalSaved = current.reduce((sum, b) => sum + b.saved_usd, 0)
  const totalHits = current.reduce((sum, b) => sum + b.cache_hits, 0)
  const totalReported = current.reduce((sum, b) => sum + b.cache_reported, 0)

  const totals: TotalsStat = {
    tokens: totalTokens,
    inputTokens: current.reduce((sum, b) => sum + b.input_tokens, 0),
    outputTokens: current.reduce((sum, b) => sum + b.output_tokens, 0),
    requests: totalRequests,
    billedUsd: totalBilled,
    savedUsd: totalSaved,
    models: models.length,
    providers: providers.length,
    costPerRequest: ratio(totalBilled, totalRequests),
    tokensPerRequest: ratio(totalTokens, totalRequests),
    pricePerMillion: ratio(totalBilled, totalTokens) * 1_000_000,
    cacheRatio: totalReported > 0 ? ratio(totalHits, totalReported) : null,
    cacheServedTokens,
    change: previousTotal > 0 ? (totalTokens - previousTotal) / previousTotal : null,
  }

  return {
    totals,
    models,
    providers,
    windowDays: WINDOW_DAYS,
    seriesDays: SERIES_DAYS,
    ...buildSeries(daily, models, now),
  }
}

/**
 * Densifies the daily rows into one point per day across the whole series
 * window, so a gap in traffic reads as a gap and not as a missing column.
 * Only the five largest models get their own band; the rest stack as "other".
 * Five is not the palette's limit — it is where a band stays thick enough to
 * see: past it the tail renders as 1–2px stripes that read as a barcode, and
 * the leaderboard already carries those models at full precision.
 */
const SERIES_BANDS = 5

function buildSeries(
  daily: DailyBucket[],
  models: ModelStat[],
  now: number,
): { series: SeriesPoint[]; seriesModels: string[] } {
  const named = new Set(models.slice(0, SERIES_BANDS).map((m) => m.model))
  const byDay = new Map<string, SeriesPoint>()
  for (const row of daily) {
    let point = byDay.get(row.day)
    if (!point) {
      point = { day: row.day, byModel: {}, tokens: 0, requests: 0 }
      byDay.set(row.day, point)
    }
    const band = named.has(row.model) ? row.model : "other"
    point.byModel[band] = (point.byModel[band] ?? 0) + row.tokens
    point.tokens += row.tokens
    point.requests += row.requests
  }

  const series: SeriesPoint[] = []
  const start = Math.floor((now - SERIES_DAYS * DAY_SECONDS) / DAY_SECONDS) * DAY_SECONDS
  for (let i = 0; i <= SERIES_DAYS; i++) {
    const day = new Date((start + i * DAY_SECONDS) * 1000).toISOString().slice(0, 10)
    series.push(byDay.get(day) ?? { day, byModel: {}, tokens: 0, requests: 0 })
  }

  const seriesModels = models.slice(0, SERIES_BANDS).map((m) => m.model)
  if (daily.some((row) => !named.has(row.model))) seriesModels.push("other")
  return { series, seriesModels }
}

/**
 * Axis ticks that land on clean numbers: the step is rounded up to 1, 2, 2.5 or
 * 5 times a power of ten, so a reader sees 0 / 2M / 4M rather than 0 / 1.7M /
 * 3.4M. `count` is the target number of steps, not a promise — once the step is
 * clean the axis stops at the first tick that covers the data, so a 52.7K
 * series gets an axis to 60K rather than a mostly empty one to 80K.
 */
export function axisTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1]
  const magnitude = 10 ** Math.floor(Math.log10(max / count))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate * count >= max)!
  const steps = Math.ceil(max / step)
  return Array.from({ length: steps + 1 }, (_, i) => i * step)
}

/**
 * Parses STATS.md, the download log the release workflow appends to. Rows look
 * like `| 2026-08-08 | 2,743 (+76) | 48,656 (+2,328) | 51,399 (+2,404) |`; the
 * parenthesised deltas are recomputed from the totals rather than trusted, so a
 * hand-edited row cannot put a wrong delta on the page.
 */
export function parseDownloads(markdown: string): DownloadPoint[] {
  const points: DownloadPoint[] = []
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim())
    // ["", date, github, npm, total, ""]
    if (cells.length < 6) continue
    const date = cells[1]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const value = (cell: string): number => Number(cell.split("(")[0].replace(/[,\s]/g, ""))
    const github = value(cells[2])
    const npm = value(cells[3])
    if (!Number.isFinite(github) || !Number.isFinite(npm)) continue
    points.push({ date, github, npm, total: github + npm })
  }
  return points.sort((a, b) => a.date.localeCompare(b.date))
}
