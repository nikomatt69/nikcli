import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { ModelsDev } from "@/provider/models"
import path from "path"
import os from "os"
import { Global } from "@nikcli-ai/util/global"
import { log, authAll } from "./shared"

export default Runtime.handler(Commands.commands["auth"].commands["list"], async (_input) => {
  UI.empty()
  const authPath = path.join(Global.Path.data, "auth.json")
  const homedir = os.homedir()
  const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
  prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)

  try {
    const results = Object.entries(await authAll())
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
    }

    log.debug("Listed credentials", { count: results.length })
    prompts.outro(`${results.length} credentials`)

    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable${activeEnvVars.length === 1 ? "" : "s"}`)
    }
  } catch (error) {
    log.error("Failed to list credentials", { error })
    prompts.outro("Failed to list credentials")
  }
})
