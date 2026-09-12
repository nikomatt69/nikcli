import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { Global } from "@nikcli-ai/util/global"

export default Runtime.handler(Commands.commands["debug"].commands["paths"], async (_input) => {
  for (const [key, value] of Object.entries(Global.Path)) {
    console.log(key.padEnd(10), value)
  }
})
