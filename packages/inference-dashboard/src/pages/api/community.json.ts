import type { APIRoute } from "astro"

/**
 * Public, aggregate-only feed of what nikcli installs report running — the
 * community half of nikcli.store/data.
 *
 * `install_id` never leaves this route. It is grouped away everywhere, and the
 * only thing derived from it is `COUNT(DISTINCT install_id)`, so the feed can
 * say how many installs were active on a day without saying which.
 */

const DAY = 86_400_000
/** Window the leaderboard is measured over. */
const WINDOW_DAYS = 30
/** Longer window for the daily series. */
const SERIES_DAYS = 60

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}
const ok = "public, max-age=60, s-maxage=900, stale-while-revalidate=86400, stale-if-error=86400"
const failed = "public, max-age=1, s-maxage=60, stale-while-revalidate=600"

function json(data: unknown, status: number, cache: string) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cache, ...cors },
  })
}

function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

interface Bucket {
  model: string
  provider: string
  messages: number
  tokens: number
  cost: number
  installs: number
}

export const GET: APIRoute = async (ctx) => {
  const DB = (ctx.locals as any).runtime?.env?.DB as D1Database | undefined
  if (!DB) return json({ error: "database_unavailable" }, 503, failed)

  const now = Date.now()
  const windowStart = dayKey(now - WINDOW_DAYS * DAY)
  const previousStart = dayKey(now - WINDOW_DAYS * 2 * DAY)
  const seriesStart = dayKey(now - SERIES_DAYS * DAY)

  const bucketSQL = `
    SELECT model, provider,
           SUM(messages)               AS messages,
           SUM(tokens)                 AS tokens,
           SUM(cost)                   AS cost,
           COUNT(DISTINCT install_id)  AS installs
    FROM community_usage
    WHERE day >= ? AND day < ?
    GROUP BY model, provider`

  try {
    // Distinct installs cannot be summed out of the per-model buckets — one
    // install running three models is counted in each — so the window total is
    // its own query.
    const [current, previous, daily, installs, reach] = await Promise.all([
      DB.prepare(bucketSQL).bind(windowStart, dayKey(now + DAY)).all<Bucket>(),
      DB.prepare(bucketSQL).bind(previousStart, windowStart).all<Bucket>(),
      DB.prepare(
        `SELECT day, model, SUM(tokens) AS tokens, SUM(messages) AS messages
         FROM community_usage WHERE day >= ? GROUP BY day, model ORDER BY day ASC`,
      )
        .bind(seriesStart)
        .all<{ day: string; model: string; tokens: number; messages: number }>(),
      DB.prepare(
        `SELECT day, COUNT(DISTINCT install_id) AS installs
         FROM community_usage WHERE day >= ? GROUP BY day ORDER BY day ASC`,
      )
        .bind(seriesStart)
        .all<{ day: string; installs: number }>(),
      DB.prepare(`SELECT COUNT(DISTINCT install_id) AS installs FROM community_usage WHERE day >= ?`)
        .bind(windowStart)
        .first<{ installs: number }>(),
    ])

    return json(
      {
        generatedAt: Math.floor(now / 1000),
        windowDays: WINDOW_DAYS,
        seriesDays: SERIES_DAYS,
        installsInWindow: reach?.installs ?? 0,
        current: current.results ?? [],
        previous: previous.results ?? [],
        daily: daily.results ?? [],
        installs: installs.results ?? [],
      },
      200,
      ok,
    )
  } catch {
    return json({ error: "unavailable" }, 503, failed)
  }
}

export const OPTIONS: APIRoute = async () => new Response(null, { status: 200, headers: cors })
