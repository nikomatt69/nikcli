import { Account } from "../../account"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Effect } from "effect"
import { runPromiseWithLayer } from "@/effect"

function runAccount<A, E>(effect: Effect.Effect<A, E, Account.Service>) {
  return runPromiseWithLayer(Account.defaultLayer, effect)
}

export const AccountCommand = cmd({
  command: "account",
  describe: "manage accounts",
  builder: (yargs) =>
    yargs
      .command(AccountLoginCommand)
      .command(AccountLogoutCommand)
      .command(AccountListCommand)
      .command(AccountSwitchCommand)
      .command(AccountOrgsCommand)
      .demandCommand(),
  async handler() {},
})

export const AccountLoginCommand = cmd({
  command: "login",
  describe: "log in with device code",
  builder: (yargs) =>
    yargs.option("server", {
      alias: "s",
      type: "string",
      description: "Auth server URL",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Account login")

    const spinner = prompts.spinner()

    try {
      // Start device code flow
      const loginResult = await runAccount(
        Effect.gen(function* () {
          const account = yield* Account.Service
          return yield* account.login({ serverUrl: args.server })
        }),
      )

      prompts.log.info(`Visit: ${loginResult.verificationUrl}`)
      prompts.log.info(`Enter code: ${UI.Style.TEXT_SUCCESS}${loginResult.userCode}${UI.Style.TEXT_NORMAL}`)

      // Poll for completion
      spinner.start("Waiting for authorization...")

      const result = await runAccount(
        Effect.gen(function* () {
          const account = yield* Account.Service
          return yield* account.poll(loginResult.deviceCode, {
            serverUrl: args.server,
            onPending() {
              spinner.message("Waiting for authorization... (press Ctrl+C to cancel)")
            },
          })
        }),
      )

      spinner.stop("Login successful")

      prompts.log.success(`Account ID: ${result.accountID}`)

      // Fetch and display user info if available
      try {
        const accountInfo = await runAccount(
          Effect.gen(function* () {
            const account = yield* Account.Service
            return yield* account.get(result.accountID)
          }),
        )
        if (accountInfo?.email) {
          prompts.log.info(`Email: ${accountInfo.email}`)
        }
      } catch {
        // Ignore
      }

      prompts.outro("Done")
    } catch (error) {
      spinner.stop("Login failed", 1)

      if (error instanceof Error) {
        prompts.log.error(error.message)
      } else {
        prompts.log.error("Unknown error")
      }

      prompts.outro("Done")
    }
  },
})

export const AccountLogoutCommand = cmd({
  command: "logout",
  describe: "log out from an account",
  builder: (yargs) =>
    yargs.positional("account-id", {
      type: "string",
      description: "Account ID to log out from",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Account logout")

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

      if (prompts.isCancel(selected)) throw new UI.CancelledError()
      accountId = selected
    }

    const confirmed = await prompts.confirm({
      message: `Remove account ${accountId}?`,
      initialValue: false,
    })

    if (prompts.isCancel(confirmed)) throw new UI.CancelledError()

    if (confirmed) {
      await runAccount(
        Effect.gen(function* () {
          const account = yield* Account.Service
          yield* account.remove(accountId)
        }),
      )
      prompts.log.success("Account removed")
    }

    prompts.outro("Done")
  },
})

export const AccountListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list accounts",
  async handler() {
    UI.empty()
    prompts.intro("Accounts")

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

    prompts.outro(`${accounts.length} account${accounts.length === 1 ? "" : "s"}`)
  },
})

export const AccountSwitchCommand = cmd({
  command: "switch",
  describe: "switch active account",
  builder: (yargs) =>
    yargs.positional("account-id", {
      type: "string",
      description: "Account ID to switch to",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Switch account")

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

      if (prompts.isCancel(selected)) throw new UI.CancelledError()
      accountId = selected
    }

    await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        yield* account.use(accountId)
      }),
    )
    prompts.log.success(`Switched to ${accountId}`)

    prompts.outro("Done")
  },
})

export const AccountOrgsCommand = cmd({
  command: "orgs",
  describe: "list organizations for an account",
  builder: (yargs) =>
    yargs.positional("account-id", {
      type: "string",
      description: "Account ID to list orgs for (defaults to active)",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Organizations")

    const activeAccount = await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        return args.accountId ? yield* account.get(args.accountId) : yield* account.active()
      }),
    )

    if (!activeAccount) {
      prompts.log.error("No account found")
      prompts.outro("Done")
      return
    }

    const spinner = prompts.spinner()
    spinner.start("Fetching organizations...")

    try {
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

      prompts.outro(`${orgs.length} organization${orgs.length === 1 ? "" : "s"}`)
    } catch (error) {
      spinner.stop("Failed to fetch organizations", 1)

      if (error instanceof Error) {
        prompts.log.error(error.message)
      } else {
        prompts.log.error("Unknown error")
      }

      prompts.outro("Done")
    }
  },
})
