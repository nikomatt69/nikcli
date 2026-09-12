import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { Account } from "@/account"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Effect } from "effect"
import { log, runAccount } from "./shared"

export default Runtime.handler(Commands.commands["account"].commands["list"], async (_input) => {
  UI.empty()
  prompts.intro("Accounts")

  try {
    const { accounts, active } = await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        return {
          accounts: yield* account.list(),
          active: yield* account.active(),
        }
      }),
    )

    if (accounts.length === 0) {
      prompts.log.warn("No accounts found")
      prompts.outro("Run `nikcli account login` to add one")
      return
    }

    for (const account of accounts) {
      const isActive = active?.id === account.id
      const marker = isActive ? UI.Style.TEXT_SUCCESS + " *" + UI.Style.TEXT_NORMAL : ""
      prompts.log.info(`${account.email || account.id}${marker}`)
      prompts.log.info(UI.Style.TEXT_DIM + `  Server: ${account.url}`)
      prompts.log.info(`  ID: ${account.id}`)
    }

    log.debug("Listed accounts", { count: accounts.length })
    prompts.outro(`${accounts.length} account${accounts.length === 1 ? "" : "s"}`)
  } catch (error) {
    log.error("Failed to list accounts", { error })
    prompts.outro("Failed to list accounts")
  }
})
