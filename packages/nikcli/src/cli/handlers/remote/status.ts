import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { withInstanceAsync } from "@/effect"
import { UI } from "@/cli/ui"
import { remoteService, qrRenderer } from "@nikcli-ai/util/remote-tunnel"
import { ensureRemoteService } from "./shared"

export default Runtime.handler(Commands.commands["remote"].commands["status"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "json": Option.getOrUndefined(input["json"]),
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      await ensureRemoteService()
      const session = remoteService.getSession()

      if (!session || session.status === "stopped") {
        if (args.json) {
          process.stdout.write(JSON.stringify({ active: false }))
        } else {
          UI.println("No active remote session")
          UI.println('Use "nikcli remote start" to create one.')
        }
        return
      }

      if (args.json) {
        process.stdout.write(
          JSON.stringify(
            {
              active: true,
              id: session.id,
              name: session.name,
              status: session.status,
              qrUrl: session.qrUrl,
              connectedDevices: session.connectedDevices.length,
              startedAt: session.startedAt.toISOString(),
              lastActivity: session.lastActivity.toISOString(),
            },
            null,
            2,
          ),
        )
        return
      }

      await qrRenderer.render(session)
    }
  })
})
