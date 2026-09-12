import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { bootstrap } from "@/cli/bootstrap"
import { UI } from "@/cli/ui"
import { resolveRange, rangeDays } from "./shared"

export default Runtime.handler(Commands.commands["analytics"].commands["show"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "today": input["today"],
    "week": input["week"],
    "month": input["month"],
    "all": input["all"],
    "json": input["json"],
  }
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
})
