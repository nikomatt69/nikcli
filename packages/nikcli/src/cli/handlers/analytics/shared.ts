import type { Argv } from "@/cli/cmd/argv"

/** Helpers shared by the `analytics` commands. */

/** How far back a subcommand reaches. Everything on record unless narrowed. */
export type Range = "today" | "week" | "month" | "all"

export const RANGE_DAYS: Record<Exclude<Range, "all">, number> = { today: 1, week: 7, month: 30 }

/**
 * The same four flags on both subcommands.
 *
 * The default is `all`: the local database is the whole record, and a command
 * that quietly stopped at a month would make months of it look like they never
 * happened. Narrowing is the thing you ask for.
 */
export function rangeOptions(y: Argv) {
  return y
    .option("today", { type: "boolean", describe: "just today", default: false })
    .option("week", { type: "boolean", describe: "the last 7 days", default: false })
    .option("month", { type: "boolean", describe: "the last 30 days", default: false })
    .option("all", { type: "boolean", describe: "every day on record (default)", default: false })
}

/** The range flags `rangeOptions` declares, named so handlers can annotate them. */
export type RangeArgs = { today?: boolean; week?: boolean; month?: boolean; all?: boolean }

export function resolveRange(args: RangeArgs): Range {
  // First match wins, narrowest first, so `--today --all` is not ambiguous.
  if (args.today) return "today"
  if (args.week) return "week"
  if (args.month) return "month"
  return "all"
}

/**
 * Days from today back to the start of `range`.
 *
 * `all` resolves against the first day that has a message rather than a fixed
 * ceiling, so the window is exactly the history and never a guess at it.
 */
export async function rangeDays(range: Range): Promise<number> {
  if (range !== "all") return RANGE_DAYS[range]
  const { AnalyticsRollup } = await import("@/analytics/rollup")
  const { earliestDay } = await AnalyticsRollup.bounds().catch(() => ({ earliestDay: undefined }))
  if (!earliestDay) return RANGE_DAYS.month
  const span = Math.ceil((Date.now() - Date.parse(`${earliestDay}T00:00:00Z`)) / 86_400_000) + 1
  return Math.max(span, 1)
}

/**
 * Inspect and publish the local usage rollups.
 *
 * `publish` exists because the background reporter only sends whole days that
 * have finished: an install that turns sharing on today contributes nothing
 * until tomorrow, which makes the feature impossible to verify when you set it
 * up. Running it by hand is also the clearest consent there is, so it works
 * without `analytics.share` being on.
 */
