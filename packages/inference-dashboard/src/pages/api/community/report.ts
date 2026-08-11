import type { APIRoute } from "astro"
import { z } from "zod"

/**
 * Receives an opt-in usage report from a nikcli install.
 *
 * This is what puts models people run on their own keys onto nikcli.store/data;
 * `usage_events` only ever sees the inference gateway's own traffic. The CLI
 * sends one row per day, provider and model, and only when the user turned
 * `analytics.share` on.
 *
 * Unauthenticated by design — an install has no account to sign with, and
 * requiring one would restrict the picture to signed-in users. That trade is
 * bounded rather than ignored: the payload is strictly shaped, rows and
 * magnitudes are capped, and only recent days are accepted, so a single caller
 * cannot invent a model with a trillion tokens. It cannot stop a determined
 * flood from many identifiers; the honest mitigation there is that every
 * published figure is an aggregate over installs, so noise from one is small.
 */

/** A day older than this is refused: reports are for the days just gone. */
const MAX_AGE_DAYS = 7
/** One report covers one install's recent days; more than this is not a CLI. */
const MAX_ROWS = 400
/** No single install/day/model plausibly exceeds these. */
const MAX_TOKENS = 100_000_000_000
const MAX_COST = 1_000_000
const MAX_MESSAGES = 1_000_000

const row = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
  messages: z.number().int().nonnegative().max(MAX_MESSAGES),
  tokens: z.number().int().nonnegative().max(MAX_TOKENS),
  cost: z.number().nonnegative().max(MAX_COST),
})

const body = z.object({
  /** Random, install-local, and never published. */
  installID: z.string().min(8).max(64),
  version: z.string().max(32).optional(),
  rows: z.array(row).min(1).max(MAX_ROWS),
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}

export const POST: APIRoute = async (ctx) => {
  const DB = (ctx.locals as any).runtime?.env?.DB as D1Database | undefined
  if (!DB) return json({ error: "database_unavailable" }, 500)

  let parsed
  try {
    parsed = body.parse(await ctx.request.json())
  } catch (e) {
    return json({ error: "invalid_request", message: (e as Error).message }, 400)
  }

  const today = new Date()
  const oldest = new Date(today.getTime() - MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10)
  const newest = today.toISOString().slice(0, 10)
  const rows = parsed.rows.filter((r) => r.day >= oldest && r.day <= newest)
  if (rows.length === 0) return json({ ok: true, accepted: 0 })

  const now = Math.floor(Date.now() / 1000)
  const statement = DB.prepare(
    `INSERT INTO community_usage (install_id, day, provider, model, messages, tokens, cost, version, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(install_id, day, provider, model) DO UPDATE SET
       messages = excluded.messages,
       tokens = excluded.tokens,
       cost = excluded.cost,
       version = excluded.version,
       updated_at = excluded.updated_at`,
  )

  await DB.batch(
    rows.map((r) =>
      statement.bind(
        parsed.installID,
        r.day,
        r.provider,
        r.model,
        r.messages,
        r.tokens,
        r.cost,
        parsed.version ?? null,
        now,
      ),
    ),
  )

  return json({ ok: true, accepted: rows.length })
}
