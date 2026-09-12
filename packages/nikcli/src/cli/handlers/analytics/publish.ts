import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { bootstrap } from "@/cli/bootstrap"
import { UI } from "@/cli/ui"
import { resolveRange, rangeDays } from "./shared"

export default Runtime.handler(Commands.commands["analytics"].commands["publish"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    today: input["today"],
    week: input["week"],
    month: input["month"],
    all: input["all"],
  }
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
