import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Routine } from "@/mobile/routine"

function formatDate(ts: number) {
  return new Date(ts).toLocaleString()
}

function formatTriggers(triggers: Routine.Trigger[]) {
  if (!triggers.length) return "none"
  return triggers
    .map((t) => {
      if (t.type === "schedule") return `schedule(${t.cron})${t.enabled ? "" : " [disabled]"}`
      return `api${t.enabled ? "" : " [disabled]"}`
    })
    .join(", ")
}

export const RoutineCommand = cmd({
  command: "routine",
  describe: "manage routines — scheduled and API-triggered AI workflows",
  builder: (yargs) =>
    yargs
      .command(RoutineListCommand)
      .command(RoutineCreateCommand)
      .command(RoutineGetCommand)
      .command(RoutineRunCommand)
      .command(RoutinePauseCommand)
      .command(RoutineResumeCommand)
      .command(RoutineDeleteCommand)
      .demandCommand(),
  async handler() {},
})

export const RoutineListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list all routines for the current project",
  builder: (yargs) =>
    yargs.option("format", {
      type: "string",
      choices: ["table", "json"] as const,
      default: "table",
      describe: "output format",
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const routines = await Routine.list()

      if (args.format === "json") {
        console.log(JSON.stringify(routines, null, 2))
        return
      }

      if (!routines.length) {
        console.log("No routines found. Create one with: nikcli routine create")
        return
      }

      const idW = Math.max(10, ...routines.map((r) => r.id.length))
      const nameW = Math.max(10, ...routines.map((r) => r.name.length))

      const header = `${"ID".padEnd(idW)}  ${"Name".padEnd(nameW)}  Status    Triggers`
      console.log(header)
      console.log("─".repeat(header.length))
      for (const r of routines) {
        const status = r.paused ? "paused   " : "active   "
        console.log(`${r.id.padEnd(idW)}  ${r.name.padEnd(nameW)}  ${status} ${formatTriggers(r.triggers)}`)
      }
    })
  },
})

export const RoutineCreateCommand = cmd({
  command: "create",
  describe: "create a new routine interactively",
  builder: (yargs) =>
    yargs
      .option("name", { type: "string", alias: "n", describe: "routine name" })
      .option("prompt", { type: "string", alias: "p", describe: "prompt to run" })
      .option("cron", {
        type: "string",
        describe: "cron schedule (e.g. @hourly, @daily, */30, 0 */6 * * *)",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      prompts.intro("Create routine")

      const name =
        args.name ??
        (await prompts.text({
          message: "Routine name",
          placeholder: "Daily code review",
          validate: (v) => (v?.trim() ? undefined : "Name is required"),
        }))

      if (prompts.isCancel(name)) {
        prompts.cancel("Cancelled.")
        return
      }

      const prompt =
        args.prompt ??
        (await prompts.text({
          message: "Prompt",
          placeholder: "Review recent changes and summarize any risks.",
          validate: (v) => (v?.trim() ? undefined : "Prompt is required"),
        }))

      if (prompts.isCancel(prompt)) {
        prompts.cancel("Cancelled.")
        return
      }

      const cronInput =
        args.cron ??
        (await prompts.text({
          message: "Cron schedule (optional — leave blank for manual-only)",
          placeholder: "@hourly",
        }))

      if (prompts.isCancel(cronInput)) {
        prompts.cancel("Cancelled.")
        return
      }

      const triggers: Routine.Trigger[] = []
      const cronStr = typeof cronInput === "string" ? cronInput.trim() : ""
      if (cronStr) {
        const ms = Routine.parseCronInterval(cronStr)
        if (!ms) {
          prompts.log.warn(
            `Cron pattern "${cronStr}" is not recognised — routine will be created but the schedule will not fire. Supported: @hourly, @daily, @weekly, */N (minutes), 0 */N * * * (hours).`,
          )
        }
        triggers.push({ type: "schedule", cron: cronStr, enabled: true })
      }

      const spinner = prompts.spinner()
      spinner.start("Creating routine…")
      try {
        const routine = await Routine.create({
          name: String(name).trim(),
          prompt: String(prompt).trim(),
          triggers,
        })
        spinner.stop(`Routine created: ${routine.id}`)

        const apiTrigger = routine.triggers.find((t) => t.type === "api")
        if (apiTrigger && apiTrigger.type === "api") {
          prompts.log.info(`API trigger token: ${apiTrigger.token}`)
          prompts.log.info(`POST /mobile/routines/trigger/${apiTrigger.token}`)
        }
        prompts.outro(`Run it now: nikcli routine run ${routine.id}`)
      } catch (error) {
        spinner.stop("Failed")
        throw error
      }
    })
  },
})

export const RoutineGetCommand = cmd({
  command: "get <id>",
  describe: "show details of a routine",
  builder: (yargs) =>
    yargs.positional("id", { type: "string", demandOption: true, describe: "routine ID" }).option("format", {
      type: "string",
      choices: ["text", "json"] as const,
      default: "text",
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const routine = await Routine.get(String(args.id))

      if (args.format === "json") {
        console.log(JSON.stringify(routine, null, 2))
        return
      }

      console.log(`ID:         ${routine.id}`)
      console.log(`Name:       ${routine.name}`)
      console.log(`Status:     ${routine.paused ? "paused" : "active"}`)
      console.log(`Created:    ${formatDate(routine.createdAt)}`)
      console.log(`Updated:    ${formatDate(routine.updatedAt)}`)
      if (routine.lastRunAt) console.log(`Last run:   ${formatDate(routine.lastRunAt)}`)
      if (routine.lastSessionID) console.log(`Last session: ${routine.lastSessionID}`)
      console.log(`Triggers:   ${formatTriggers(routine.triggers)}`)
      console.log(`\nPrompt:\n${routine.prompt}`)
    })
  },
})

export const RoutineRunCommand = cmd({
  command: "run <id>",
  describe: "trigger an immediate run of a routine",
  builder: (yargs) => yargs.positional("id", { type: "string", demandOption: true, describe: "routine ID" }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const spinner = prompts.spinner()
      spinner.start("Running routine…")
      try {
        const session = await Routine.run(String(args.id))
        spinner.stop(`Session created: ${session.id}`)
        console.log(`Monitor with: nikcli session list`)
      } catch (error) {
        spinner.stop("Failed")
        throw error
      }
    })
  },
})

export const RoutinePauseCommand = cmd({
  command: "pause <id>",
  describe: "pause a routine (disables scheduled triggers)",
  builder: (yargs) => yargs.positional("id", { type: "string", demandOption: true, describe: "routine ID" }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const routine = await Routine.pause(String(args.id))
      console.log(`Paused: ${routine.id} (${routine.name})`)
    })
  },
})

export const RoutineResumeCommand = cmd({
  command: "resume <id>",
  describe: "resume a paused routine",
  builder: (yargs) => yargs.positional("id", { type: "string", demandOption: true, describe: "routine ID" }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const routine = await Routine.resume(String(args.id))
      console.log(`Resumed: ${routine.id} (${routine.name})`)
    })
  },
})

export const RoutineDeleteCommand = cmd({
  command: "delete <id>",
  aliases: ["rm"],
  describe: "delete a routine",
  builder: (yargs) =>
    yargs
      .positional("id", { type: "string", demandOption: true, describe: "routine ID" })
      .option("yes", { type: "boolean", alias: "y", describe: "skip confirmation" }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      if (!args.yes) {
        const routine = await Routine.get(String(args.id))
        const confirmed = await prompts.confirm({
          message: `Delete routine "${routine.name}" (${routine.id})?`,
          initialValue: false,
        })
        if (prompts.isCancel(confirmed) || !confirmed) {
          console.log("Cancelled.")
          return
        }
      }
      await Routine.remove(String(args.id))
      console.log(`Deleted routine ${args.id}`)
    })
  },
})
