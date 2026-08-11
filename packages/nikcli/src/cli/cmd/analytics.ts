import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"

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
          y
            .option("days", { type: "number", describe: "window in days", default: 30 })
            .option("all", { type: "boolean", describe: "cover every day on record", default: false })
            .option("json", { type: "boolean", describe: "print the raw dataset", default: false }),
        async (args) => {
          // The rollups read the project's database through the instance ALS
          // context, which only exists inside bootstrap.
          await bootstrap(process.cwd(), async () => {
            const { AnalyticsData } = await import("@/analytics/data")

            // `--all` widens the window to the first day on record. Months and the
            // lifetime total always cover everything; this is for the headline
            // figures and the day series, which are windowed.
            let days = args.days
            if (args.all) {
              const { AnalyticsRollup } = await import("@/analytics/rollup")
              const { earliestDay } = await AnalyticsRollup.bounds().catch(() => ({ earliestDay: undefined }))
              if (earliestDay) {
                const span = Math.ceil((Date.now() - Date.parse(`${earliestDay}T00:00:00Z`)) / 86_400_000) + 1
                days = Math.max(span, 1)
              }
            }

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
              // Only days that saw traffic; the dense series is for charts.
              ...data.series
                .filter((entry) => entry.tokens > 0)
                .slice(-14)
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
      .command(
        "publish",
        "send this install's rollups to the collector now",
        (y: Argv) =>
          y
            .option("today", {
              type: "boolean",
              describe: "include the day in progress (it is replaced when the day completes)",
              default: false,
            })
            .option("all", {
              type: "boolean",
              describe: "send every day on record, not just the last week",
              default: false,
            }),
        async (args) => {
          await bootstrap(process.cwd(), async () => {
            const { AnalyticsShare } = await import("@/analytics/share")
            // A backfill is worth seeing the extent of before it goes.
            if (args.all) {
              const { AnalyticsRollup } = await import("@/analytics/rollup")
              const { earliestDay } = await AnalyticsRollup.bounds().catch(() => ({ earliestDay: undefined }))
              if (earliestDay) UI.println(UI.Style.TEXT_DIM + `Backfilling from ${earliestDay}…`)
            }

            const rows = await AnalyticsShare.run({
              force: true,
              includeToday: args.today || args.all,
              all: args.all,
            })
            if (rows === 0) {
              UI.println(
                UI.Style.TEXT_DIM +
                  "Nothing to publish. Every day on record is already reported" +
                  (args.all ? "." : " — pass --all to resend the whole history, --today for the day in progress."),
              )
              return
            }
            UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Published ${rows} row${rows === 1 ? "" : "s"}.`)
          })
        },
      )
      .demandCommand(1),
  async handler() {},
})
