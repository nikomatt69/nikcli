import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { Account } from "@/account"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Effect } from "effect"
import { log, runAccount } from "./shared"

export default Runtime.handler(Commands.commands["account"].commands["orgs"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "account-id": Option.getOrUndefined(input["account-id"]),
    accountId: Option.getOrUndefined(input["account-id"]),
  }
  UI.empty()
  prompts.intro("Organizations")

  const spinner = prompts.spinner()
  spinner.start("Fetching organizations...")

  try {
    const activeAccount = await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        return args.accountId ? yield* account.get(args.accountId) : yield* account.active()
      }),
    )

    if (!activeAccount) {
      spinner.stop()
      prompts.log.error("No account found")
      prompts.outro("Done")
      return
    }

    const orgs = await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        return yield* account.orgs(activeAccount.id)
      }),
    )
    spinner.stop()

    if (orgs.length === 0) {
      prompts.log.warn("No organizations found")
    } else {
      for (const org of orgs) {
        const isActive = activeAccount.active_org_id === org.id
        const marker = isActive ? UI.Style.TEXT_SUCCESS + " *" + UI.Style.TEXT_NORMAL : ""
        prompts.log.info(`${org.name}${marker}`)
        prompts.log.info(UI.Style.TEXT_DIM + `  Role: ${org.role}`)
        prompts.log.info(`  Slug: ${org.slug}`)
      }
    }

    log.debug("Listed organizations", { count: orgs.length })
    prompts.outro(`${orgs.length} organization${orgs.length === 1 ? "" : "s"}`)
  } catch (error) {
    spinner.stop("Failed to fetch organizations", 1)

    if (error instanceof UI.CancelledError) {
      prompts.outro("Done")
      return
    }

    if (error instanceof Error) {
      log.error("Failed to fetch organizations", { error: error.message })
      prompts.log.error(error.message)
    } else {
      log.error("Failed to fetch organizations", { error })
      prompts.log.error("Unknown error")
    }

    prompts.outro("Done")
  }
})
