import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { Account } from "@/account"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Effect } from "effect"
import { log, runAccount } from "./shared"

export default Runtime.handler(Commands.commands["account"].commands["switch"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "account-id": Option.getOrUndefined(input["account-id"]),
    "accountId": Option.getOrUndefined(input["account-id"]),
  }
  UI.empty()
  prompts.intro("Switch account")

  try {
    const accounts = await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        return yield* account.list()
      }),
    )

    if (accounts.length === 0) {
      prompts.log.error("No accounts found")
      prompts.outro("Done")
      return
    }

    let accountId: string

    if (args.accountId) {
      accountId = args.accountId
    } else {
      const selected = await prompts.select({
        message: "Select account",
        options: accounts.map((a) => ({
          label: a.email || a.id,
          value: a.id,
        })),
      })

      if (prompts.isCancel(selected)) {
        prompts.outro("Done")
        return
      }
      accountId = selected
    }

    log.info("Switching to account", { accountId })
    await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        yield* account.use(accountId)
      }),
    )
    prompts.log.success(`Switched to ${accountId}`)

    prompts.outro("Done")
  } catch (error) {
    log.error("Failed to switch account", { error })
    prompts.outro("Done")
  }
})
