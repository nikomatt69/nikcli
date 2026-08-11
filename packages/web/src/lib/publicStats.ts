/**
 * Public, aggregate-only view of real nikcli usage — the data behind /data.
 *
 * Two sources, both real, neither modelled or back-filled:
 *
 *   1. The gateway's own billing table, reached through the aggregate feed at
 *      `/data.json` on the console deployment (see
 *      packages/console/app/src/routes/data.json.ts). One row of `usage` is one
 *      completion the gateway billed; every token and dollar here is a SUM over
 *      it. The site fetches rather than queries so the database credentials stay
 *      in the deployment that already has them.
 *   2. STATS.md at the repo root, appended by the download-stats workflow. That
 *      is the adoption series.
 *
 * Only aggregates cross the wire — no workspace, key or user column is ever
 * selected, and upstream cost is not published, since printing it beside the
 * billed figure would publish the gateway's margin.
 *
 * When the feed is unreachable or empty the page renders an explicit "no rows
 * yet" state — a zero is never presented as a measurement.
 */
import { buildActivityGrid, computeActivityStats, type ActivityGrid, type ActivityStats } from "@nikcli-ai/util/activity"

/** Rolling window the headline metrics and the leaderboard are measured over. */
export const WINDOW_DAYS = 30
/** Longer window for the daily time series, so trend is visible before rank. */
export const SERIES_DAYS = 60
/** Lookback for the activity grid. */
export const ACTIVITY_DAYS = 365

/** One `GROUP BY model, provider` bucket, as the console feed publishes it. */
export interface UsageBucket {
  model: string
  provider: string
  requests: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

/** One `GROUP BY day, model` bucket. */
export interface DailyBucket {
  day: string
  model: string
  tokens: number
  requests: number
}

/** One row per calendar day, for the activity grid. */
export interface ActivityBucket {
  date: string
  tokens: number
  requests: number
  costUsd: number
}

export interface ModelStat {
  model: string
  /** Provider that served the most tokens for this model. */
  provider: string
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  requests: number
  costUsd: number
  /** Share of this window's tokens, 0..1. */
  share: number
  /** Token change against the previous window, as a ratio. `null` = no prior data. */
  change: number | null
  /** Mean billed cost of one completion, USD. */
  costPerRequest: number
  /** Mean tokens in one completion. */
  tokensPerRequest: number
  /** Blended price of 1M tokens at what was actually billed, USD. */
  pricePerMillion: number
  /** Share of input tokens that were read from cache, 0..1. `null` = no input tokens. */
  cacheRatio: number | null
}

export interface ProviderStat {
  provider: string
  tokens: number
  requests: number
  share: number
}

export interface TotalsStat {
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  requests: number
  costUsd: number
  models: number
  providers: number
  costPerRequest: number
  tokensPerRequest: number
  pricePerMillion: number
  cacheRatio: number | null
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
  activity: ActivityBucket[]
  activityGrid: ActivityGrid
  activityStats: ActivityStats
  windowDays: number
  seriesDays: number
  activityDays: number
  /** Unix seconds the feed was generated at, upstream of this render. */
  generatedAt: number
}

const DAY_SECONDS = 86_400

/**
 * Reads the console aggregate feed. Returns `null` when the URL is unset, the
 * request fails, or the window holds no rows — a public page must not 500
 * because a deployment has no feed configured.
 */
export async function fetchGateway(
  url: string | undefined,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<GatewayStats | null> {
  if (!url) return null
  try {
    const response = await fetcher(url, { headers: { accept: "application/json" } })
    if (!response.ok) return null
    return summarize(await response.json(), now)
  } catch {
    return null
  }
}

function tokensOf(bucket: UsageBucket): number {
  return (
    bucket.inputTokens +
    bucket.outputTokens +
    bucket.reasoningTokens +
    bucket.cacheReadTokens +
    bucket.cacheWriteTokens
  )
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toBucket(row: Record<string, unknown>): UsageBucket {
  return {
    model: String(row.model ?? "unknown"),
    provider: String(row.provider ?? "unknown"),
    requests: number(row.requests),
    inputTokens: number(row.inputTokens),
    outputTokens: number(row.outputTokens),
    reasoningTokens: number(row.reasoningTokens),
    cacheReadTokens: number(row.cacheReadTokens),
    cacheWriteTokens: number(row.cacheWriteTokens),
    costUsd: number(row.costUsd),
  }
}

/**
 * Turns the feed into everything the page renders. Pure and total: it validates
 * as it goes, so a feed that changes shape degrades to the empty state rather
 * than to a page of NaN.
 *
 * Returns `null` when the current window has no rows.
 */
export function summarize(feed: unknown, now: number): GatewayStats | null {
  if (typeof feed !== "object" || feed === null) return null
  const body = feed as Record<string, unknown>
  const asArray = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value.filter((row) => typeof row === "object" && row !== null) as Record<string, unknown>[]) : []

  const current = asArray(body.current).map(toBucket)
  const previous = asArray(body.previous).map(toBucket)
  const daily: DailyBucket[] = asArray(body.daily).map((row) => ({
    day: String(row.day ?? ""),
    model: String(row.model ?? "unknown"),
    tokens: number(row.tokens),
    requests: number(row.requests),
  }))
  const reported: ActivityBucket[] = asArray(body.activity).map((row) => ({
    date: String(row.date ?? ""),
    tokens: number(row.tokens),
    requests: number(row.requests),
    costUsd: number(row.costUsd),
  }))

  if (current.length === 0) return null
  const totalTokens = current.reduce((sum, bucket) => sum + tokensOf(bucket), 0)
  if (totalTokens === 0) return null

  const previousByModel = new Map<string, number>()
  for (const bucket of previous) {
    previousByModel.set(bucket.model, (previousByModel.get(bucket.model) ?? 0) + tokensOf(bucket))
  }
  const previousTotal = previous.reduce((sum, bucket) => sum + tokensOf(bucket), 0)

  // Per model: sum across providers, and remember which provider carried most
  // of the tokens so the leaderboard can name one.
  type Accumulator = Omit<ModelStat, "provider" | "share" | "change" | "costPerRequest" | "tokensPerRequest" | "pricePerMillion" | "cacheRatio"> & {
    providerTokens: Map<string, number>
  }
  const perModel = new Map<string, Accumulator>()
  for (const bucket of current) {
    const tokens = tokensOf(bucket)
    let row = perModel.get(bucket.model)
    if (!row) {
      row = {
        model: bucket.model,
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        requests: 0,
        costUsd: 0,
        providerTokens: new Map(),
      }
      perModel.set(bucket.model, row)
    }
    row.tokens += tokens
    row.inputTokens += bucket.inputTokens
    row.outputTokens += bucket.outputTokens
    row.cacheReadTokens += bucket.cacheReadTokens
    row.requests += bucket.requests
    row.costUsd += bucket.costUsd
    row.providerTokens.set(bucket.provider, (row.providerTokens.get(bucket.provider) ?? 0) + tokens)
  }

  const models: ModelStat[] = [...perModel.values()]
    .map(({ providerTokens, ...row }) => {
      const before = previousByModel.get(row.model)
      let dominantProvider = "unknown"
      let dominantTokens = -1
      for (const [provider, tokens] of providerTokens) {
        if (tokens > dominantTokens) {
          dominantProvider = provider
          dominantTokens = tokens
        }
      }
      // Cache ratio is taken over input tokens, the only ones a cache can
      // serve — an output token is generated every time, by definition.
      const readable = row.inputTokens + row.cacheReadTokens
      return {
        ...row,
        provider: dominantProvider,
        share: ratio(row.tokens, totalTokens),
        change: before && before > 0 ? (row.tokens - before) / before : null,
        costPerRequest: ratio(row.costUsd, row.requests),
        tokensPerRequest: ratio(row.tokens, row.requests),
        pricePerMillion: ratio(row.costUsd, row.tokens) * 1_000_000,
        cacheRatio: readable > 0 ? ratio(row.cacheReadTokens, readable) : null,
      }
    })
    .sort((a, b) => b.tokens - a.tokens)

  const perProvider = new Map<string, { tokens: number; requests: number }>()
  for (const bucket of current) {
    const row = perProvider.get(bucket.provider) ?? { tokens: 0, requests: 0 }
    row.tokens += tokensOf(bucket)
    row.requests += bucket.requests
    perProvider.set(bucket.provider, row)
  }
  const providers: ProviderStat[] = [...perProvider.entries()]
    .map(([provider, row]) => ({ provider, ...row, share: ratio(row.tokens, totalTokens) }))
    .sort((a, b) => b.tokens - a.tokens)

  const totalRequests = current.reduce((sum, bucket) => sum + bucket.requests, 0)
  const totalCost = current.reduce((sum, bucket) => sum + bucket.costUsd, 0)
  const totalInput = current.reduce((sum, bucket) => sum + bucket.inputTokens, 0)
  const totalCacheRead = current.reduce((sum, bucket) => sum + bucket.cacheReadTokens, 0)
  const readable = totalInput + totalCacheRead

  const totals: TotalsStat = {
    tokens: totalTokens,
    inputTokens: totalInput,
    outputTokens: current.reduce((sum, bucket) => sum + bucket.outputTokens, 0),
    cacheReadTokens: totalCacheRead,
    requests: totalRequests,
    costUsd: totalCost,
    models: models.length,
    providers: providers.length,
    costPerRequest: ratio(totalCost, totalRequests),
    tokensPerRequest: ratio(totalTokens, totalRequests),
    pricePerMillion: ratio(totalCost, totalTokens) * 1_000_000,
    cacheRatio: readable > 0 ? ratio(totalCacheRead, readable) : null,
    change: previousTotal > 0 ? (totalTokens - previousTotal) / previousTotal : null,
  }

  const windowDays = number(body.windowDays) || WINDOW_DAYS
  const seriesDays = number(body.seriesDays) || SERIES_DAYS
  const activityDays = number(body.activityDays) || ACTIVITY_DAYS
  const activity = densify(reported, now, activityDays)

  return {
    totals,
    models,
    providers,
    windowDays,
    seriesDays,
    activityDays,
    generatedAt: number(body.generatedAt) || now,
    activity,
    // The same grid the CLI's own analytics view draws, from the same helper.
    activityGrid: buildActivityGrid(activity, activityDays, (row) => row.tokens),
    activityStats: computeActivityStats(activity, (row) => row.tokens),
    ...buildSeries(daily, models, now, seriesDays),
  }
}

// ── Community reports ────────────────────────────────────────────────────────
// What nikcli installs report running on their own provider keys. The gateway
// table above only ever sees traffic that went through the gateway, which is a
// slice of what nikcli actually runs; this is the rest, and it is opt-in.

export interface CommunityModel {
  model: string
  provider: string
  tokens: number
  messages: number
  costUsd: number
  /** Installs that ran this model in the window. */
  installs: number
  share: number
  change: number | null
}

export interface CommunityStats {
  models: CommunityModel[]
  providers: ProviderStat[]
  series: SeriesPoint[]
  seriesModels: string[]
  /** Installs active per day, over the series window. */
  installs: { day: string; installs: number }[]
  totals: {
    tokens: number
    messages: number
    costUsd: number
    models: number
    providers: number
    /** Distinct installs that reported anything in the window. */
    installs: number
    change: number | null
  }
  windowDays: number
  seriesDays: number
  generatedAt: number
}

/** Reads the community feed. `null` when it is unset, failing, or empty. */
export async function fetchCommunity(
  url: string | undefined,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<CommunityStats | null> {
  if (!url) return null
  try {
    const response = await fetcher(url, { headers: { accept: "application/json" } })
    if (!response.ok) return null
    return summarizeCommunity(await response.json(), now)
  } catch {
    return null
  }
}

/** Pure half of {@link fetchCommunity}, so the aggregation is testable alone. */
export function summarizeCommunity(feed: unknown, now: number): CommunityStats | null {
  if (typeof feed !== "object" || feed === null) return null
  const body = feed as Record<string, unknown>
  const rows = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value)
      ? (value.filter((row) => typeof row === "object" && row !== null) as Record<string, unknown>[])
      : []

  const bucket = (row: Record<string, unknown>) => ({
    model: String(row.model ?? "unknown"),
    provider: String(row.provider ?? "unknown"),
    tokens: number(row.tokens),
    messages: number(row.messages),
    costUsd: number(row.cost ?? row.costUsd),
    installs: number(row.installs),
  })

  const current = rows(body.current).map(bucket)
  const previous = rows(body.previous).map(bucket)
  const totalTokens = current.reduce((sum, row) => sum + row.tokens, 0)
  if (totalTokens === 0) return null

  const previousByModel = new Map<string, number>()
  for (const row of previous) previousByModel.set(row.model, (previousByModel.get(row.model) ?? 0) + row.tokens)
  const previousTotal = previous.reduce((sum, row) => sum + row.tokens, 0)

  // A model reached through more than one provider is one row on the page.
  const perModel = new Map<string, CommunityModel & { providerTokens: Map<string, number> }>()
  for (const row of current) {
    let model = perModel.get(row.model)
    if (!model) {
      model = {
        model: row.model,
        provider: row.provider,
        tokens: 0,
        messages: 0,
        costUsd: 0,
        installs: 0,
        share: 0,
        change: null,
        providerTokens: new Map(),
      }
      perModel.set(row.model, model)
    }
    model.tokens += row.tokens
    model.messages += row.messages
    model.costUsd += row.costUsd
    // Installs cannot be summed across providers without double-counting an
    // install that used both, so the largest single count is the safe floor.
    model.installs = Math.max(model.installs, row.installs)
    model.providerTokens.set(row.provider, (model.providerTokens.get(row.provider) ?? 0) + row.tokens)
  }

  const models: CommunityModel[] = [...perModel.values()]
    .map(({ providerTokens, ...model }) => {
      const before = previousByModel.get(model.model)
      let dominant = model.provider
      let dominantTokens = -1
      for (const [provider, tokens] of providerTokens) {
        if (tokens > dominantTokens) {
          dominant = provider
          dominantTokens = tokens
        }
      }
      return {
        ...model,
        provider: dominant,
        share: ratio(model.tokens, totalTokens),
        change: before && before > 0 ? (model.tokens - before) / before : null,
      }
    })
    .sort((a, b) => b.tokens - a.tokens)

  const perProvider = new Map<string, { tokens: number; requests: number }>()
  for (const row of current) {
    const entry = perProvider.get(row.provider) ?? { tokens: 0, requests: 0 }
    entry.tokens += row.tokens
    entry.requests += row.messages
    perProvider.set(row.provider, entry)
  }
  const providers: ProviderStat[] = [...perProvider.entries()]
    .map(([provider, entry]) => ({ provider, ...entry, share: ratio(entry.tokens, totalTokens) }))
    .sort((a, b) => b.tokens - a.tokens)

  const seriesDays = number(body.seriesDays) || SERIES_DAYS
  const daily: DailyBucket[] = rows(body.daily).map((row) => ({
    day: String(row.day ?? ""),
    model: String(row.model ?? "unknown"),
    tokens: number(row.tokens),
    requests: number(row.messages),
  }))
  const ranked = models.map((model) => ({ model: model.model }) as ModelStat)

  return {
    models,
    providers,
    installs: rows(body.installs).map((row) => ({ day: String(row.day ?? ""), installs: number(row.installs) })),
    totals: {
      tokens: totalTokens,
      messages: current.reduce((sum, row) => sum + row.messages, 0),
      costUsd: current.reduce((sum, row) => sum + row.costUsd, 0),
      models: models.length,
      providers: providers.length,
      installs: number(body.installsInWindow),
      change: previousTotal > 0 ? (totalTokens - previousTotal) / previousTotal : null,
    },
    windowDays: number(body.windowDays) || WINDOW_DAYS,
    seriesDays,
    generatedAt: number(body.generatedAt) || now,
    ...buildSeries(daily, ranked, now, seriesDays),
  }
}

/** The `YYYY-MM-DD` day a unix-second timestamp falls in, in UTC. */
function isoDay(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/**
 * One row per calendar day, ending today, filling quiet days with zeroes.
 *
 * The feed only returns days that had traffic, but the activity grid lays cells
 * out by position: a sparse list would shift every square after the first quiet
 * day onto the wrong weekday.
 */
function densify(rows: ActivityBucket[], now: number, days: number): ActivityBucket[] {
  const byDate = new Map(rows.map((row) => [row.date, row]))
  const start = Math.floor(now / DAY_SECONDS) * DAY_SECONDS - (days - 1) * DAY_SECONDS
  return Array.from({ length: days }, (_, i) => {
    const date = isoDay(start + i * DAY_SECONDS)
    return byDate.get(date) ?? { date, tokens: 0, requests: 0, costUsd: 0 }
  })
}

/**
 * Densifies the daily rows into one point per day across the whole series
 * window, so a gap in traffic reads as a gap and not as a missing column.
 * Only the five largest models get their own band; the rest stack as "other".
 * Five is not the palette's limit — it is where a band stays thick enough to
 * see, and the leaderboard already carries the tail at full precision.
 */
const SERIES_BANDS = 5

function buildSeries(
  daily: DailyBucket[],
  models: ModelStat[],
  now: number,
  seriesDays: number,
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
  const start = Math.floor((now - seriesDays * DAY_SECONDS) / DAY_SECONDS) * DAY_SECONDS
  for (let i = 0; i <= seriesDays; i++) {
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
