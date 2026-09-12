import { Account } from "@/account"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Effect } from "effect"
import { runPromiseWithLayer } from "@/effect"
import { Log } from "@nikcli-ai/util/log"
import open from "open"

/** Helpers shared by the `account` commands. */

export const log = Log.create({ service: "account-command" })

export function runAccount<A, E>(effect: Effect.Effect<A, E, Account.Service>): Promise<A> {
  return runPromiseWithLayer(Account.defaultLayer, effect)
}

export async function loginAccount(serverUrl?: string) {
  UI.empty()
  prompts.intro("Account login")

  const spinner = prompts.spinner()

  try {
    log.debug("Starting device code login flow", { serverUrl })

    const loginResult = await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        return yield* account.login({ serverUrl })
      }),
    )

    // Always hand out the prefilled link: the issuer fills the code in for the
    // user, so approving is a click rather than eight digits retyped by hand.
    prompts.log.info(`Visit: ${loginResult.verificationUrlComplete}`)
    prompts.log.info(`Code (if asked): ${UI.Style.TEXT_SUCCESS}${loginResult.userCode}${UI.Style.TEXT_NORMAL}`)
    const opened = await open(loginResult.verificationUrlComplete).then(
      () => true,
      (error) => {
        log.debug("Failed to open verification URL", { error })
        return false
      },
    )
    if (!opened) prompts.log.warn("Could not open a browser automatically — open the link above.")

    spinner.start("Waiting for authorization...")

    const result = await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        return yield* account.poll(loginResult.deviceCode, {
          serverUrl,
          expiresIn: loginResult.expiresIn,
          onPending() {
            spinner.message("Waiting for authorization... (press Ctrl+C to cancel)")
          },
        })
      }),
    )

    spinner.stop("Login successful")
    log.info("Login successful", { accountID: result.accountID })

    prompts.log.success(`Account ID: ${result.accountID}`)

    const accountInfo = await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        return yield* account.get(result.accountID)
      }),
    ).catch((error) => {
      log.debug("Failed to fetch account info", { error })
      return null
    })

    if (accountInfo?.email) {
      prompts.log.info(`Email: ${accountInfo.email}`)
    }

    prompts.outro("Done")
  } catch (error) {
    spinner.stop("Login failed", 1)

    if (error instanceof UI.CancelledError) {
      prompts.outro("Done")
      return
    }

    if (error instanceof Error) {
      log.error("Login failed", { error: error.message })
      prompts.log.error(error.message)
    } else {
      log.error("Login failed with unknown error", { error })
      prompts.log.error("Unknown error")
    }

    prompts.outro("Done")
  }
}
