import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { withInstanceAsync } from "@/effect"
import { connectorAuthAll, connectorAuthRemove } from "./shared"

export default Runtime.handler(Commands.commands["connectors"].commands["logout"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": Option.getOrUndefined(input["name"]),
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Connector Logout")

      const credentials = await connectorAuthAll()
      const connectorNames = Object.keys(credentials)

      if (connectorNames.length === 0) {
        prompts.log.warn("No connector credentials stored")
        prompts.outro("Done")
        return
      }

      let connectorName = args.name
      if (!connectorName) {
        const selected = await prompts.select({
          message: "Select connector to logout",
          options: connectorNames.map((name) => ({
            label: name,
            value: name,
          })),
        })
        if (prompts.isCancel(selected)) throw new UI.CancelledError()
        connectorName = selected
      }

      if (!credentials[connectorName]) {
        prompts.log.error(`No credentials found for: ${connectorName}`)
        prompts.outro("Done")
        return
      }

      await connectorAuthRemove(connectorName)
      prompts.log.success(`Removed credentials for ${connectorName}`)
      prompts.outro("Done")
    }
  })
})
