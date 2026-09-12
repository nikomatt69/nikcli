import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { bootstrap } from "@/cli/bootstrap"
import { Routine } from "@/mobile/routine"
import { generateApiToken } from "./shared"

export default Runtime.handler(Commands.commands["routine"].commands["create"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": Option.getOrUndefined(input["name"]),
    "prompt": Option.getOrUndefined(input["prompt"]),
    "cron": Option.getOrUndefined(input["cron"]),
    "api": Option.getOrUndefined(input["api"]),
    "api-token": Option.getOrUndefined(input["api-token"]),
    "apiToken": Option.getOrUndefined(input["api-token"]),
  }
  await bootstrap(process.cwd(), async (instance) => {
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
          `Cron pattern "${cronStr}" is not recognised — routine will be created but the schedule will not fire. ${Routine.SUPPORTED_CRON_HELP}`,
        )
      }
      triggers.push({ type: "schedule", cron: cronStr, enabled: true })
    }

    if (args.api || args.apiToken) {
      triggers.push({ type: "api", token: args.apiToken?.trim() || generateApiToken(), enabled: true })
    }

    const spinner = prompts.spinner()
    spinner.start("Creating routine…")
    try {
      const routine = await Routine.create(instance, {
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
})
