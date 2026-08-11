import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"

/** How far back a subcommand reaches. Everything on record unless narrowed. */
type Range = "today" | "week" | "month" | "all"

const RANGE_DAYS: Record<Exclude<Range, "all">, number> = { today: 1, week: 7, month: 30 }

/**
 * The same four flags on both subcommands.
 *
 * The default is `all`: the local database is the whole record, and a command
 * that quietly stopped at a month would make months of it look like they never
 * happened. Narrowing is the thing you ask for.
 */
function rangeOptions(y: Argv) {
  return y
    .option("today", { type: "boolean", describe: "just today", default: false })
    .option("week", { type: "boolean", describe: "the last 7 days", default: false })
    .option("month", { type: "boolean", describe: "the last 30 days", default: false })
    .option("all", { type: "boolean", describe: "every day on record (default)", default: false })
}

function resolveRange(args: { today?: boolean; week?: boolean; month?: boolean; all?: boolean }): Range {
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
async function rangeDays(range: Range): Promise<number> {
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
export const AnalyticsCommand = cmd({
  command: "analytics <subcommand>",
  describe: "inspect and publish local usage rollups",
  builder: (yargs: Argv) =>
    yargs
      .command(
        "show",
        "print the aggregate dataset behind /data for this install",
        (y: Argv) =>
          rangeOptions(y).option("json", { type: "boolean", describe: "print the raw dataset", default: false }),
        async (args) => {
          // The rollups read the project's database through the instance ALS
          // context, which only exists inside bootstrap.
          await bootstrap(process.cwd(), async () => {
            const { AnalyticsData } = await import("@/analytics/data")
            const days = await rangeDays(resolveRange(args))

            const data = await AnalyticsData.refreshed({ days: String(days), seriesDays: String(days) })
            if (!data) {
              UI.println(UI.Style.TEXT_DIM + "No usage recorded yet.")
              return
            }
            if (args.json) {
              UI.println(JSON.stringify(data, null, 2))
              return
            }

            const million = (value: number) => (value / 1_000_000).toFixed(1) + "M"
            const pct = (value: number | null) => (value === null ? "—" : (value * 100).toFixed(0) + "%")

            // Built as one string and printed once. `UI.println` writes to
            // Bun.stderr without awaiting, so a report emitted line by line
            // interleaves with itself.
            const out: string[] = [
              UI.Style.TEXT_NORMAL_BOLD + `Usage ${data.from} → ${data.to}` + UI.Style.TEXT_NORMAL,
              "",
              `  tokens          ${million(data.totals.tokens)}`,
              `  sessions        ${data.totals.sessions}`,
              `  models          ${data.totals.models}`,
              `  cost            $${data.totals.costUsd.toFixed(2)}`,
              `  cost/session    $${data.totals.costPerSession.toFixed(4)}`,
              `  blended $/1M    $${data.totals.pricePerMillion.toFixed(2)}`,
              `  cache hit       ${pct(data.totals.cacheRatio)}`,
              "",
              UI.Style.TEXT_NORMAL_BOLD + "  Top models" + UI.Style.TEXT_NORMAL,
              ...data.models
                .slice(0, 10)
                .map(
                  (model) =>
                    `  ${(model.share * 100).toFixed(1).padStart(5)}%  ${million(model.tokens).padStart(9)}  ${model.model}`,
                ),
              "",
              UI.Style.TEXT_NORMAL_BOLD + "  By day" + UI.Style.TEXT_NORMAL,
              // Every day in the range that saw traffic. Quiet days are dropped
              // because the dense series exists for charts, not for a list — but
              // the range itself is never trimmed: a command asked for a window
              // and silently showing a fortnight of it would be a lie.
              ...data.series
                .filter((entry) => entry.tokens > 0)
                .map((point) => `  ${point.day}  ${million(point.tokens).padStart(9)}`),
              "",
              UI.Style.TEXT_NORMAL_BOLD + "  By month" + UI.Style.TEXT_NORMAL,
              ...data.months.map(
                (month) =>
                  `  ${month.month}     ${million(month.tokens).padStart(9)}  ${String(month.sessions).padStart(5)} sessions  $${month.costUsd.toFixed(2)}`,
              ),
              "",
              UI.Style.TEXT_NORMAL_BOLD +
                `  Total        ${million(data.lifetime.tokens).padStart(9)}  ${String(data.lifetime.sessions).padStart(5)} sessions  $${data.lifetime.costUsd.toFixed(2)}` +
                UI.Style.TEXT_NORMAL,
            ]
            UI.println(out.join("\n"))
          })
        },
      )
      .command("publish", "send this install's rollups to the collector now", rangeOptions, async (args) => {
        await bootstrap(process.cwd(), async () => {
          const { AnalyticsShare } = await import("@/analytics/share")
          const range = resolveRange(args)
          const days = await rangeDays(range)

          // Worth seeing the extent of a send before it goes, especially the
          // default one, which is the whole record.
          const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
          UI.println(UI.Style.TEXT_DIM + `Publishing ${range === "all" ? "everything" : range} from ${since}…`)

          const rows = await AnalyticsShare.run({ force: true, days, includeToday: true })
          if (rows === 0) {
            UI.println(UI.Style.TEXT_DIM + "Nothing to publish. Every day in that range is already reported.")
            return
          }
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Published ${rows} row${rows === 1 ? "" : "s"}.`)
        })
      })
      .demandCommand(1),
  async handler() {},
})
