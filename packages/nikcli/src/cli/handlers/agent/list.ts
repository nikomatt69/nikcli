import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { Agent } from "@/agent/agent"
import { EOL } from "os"
import { withInstanceAsync } from "@/effect"
import { log, agentList } from "./shared"

export default Runtime.handler(Commands.commands["agent"].commands["list"], async (_input) => {
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    const agents = await agentList()
    const sortedAgents = agents.sort((a: Agent.Info, b: Agent.Info) => {
      if (a.native !== b.native) {
        return a.native ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    log.debug("Listed agents", { count: agents.length })

    for (const agent of sortedAgents) {
      process.stdout.write(`${agent.name} (${agent.mode})` + EOL)
      process.stdout.write(`  ${JSON.stringify(agent.permission, null, 2)}` + EOL)
    }
  })
})
