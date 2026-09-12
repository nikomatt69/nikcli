import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"

export default Runtime.handler(Commands.commands["github"].commands["run"], async (_input) => {
  prompts.log.error("GitHub agent run is not yet implemented.")
  prompts.log.info("Track progress at: https://github.com/nikcli-ai/nikcli/issues")
  throw new Error("GitHub agent run is not yet implemented")
})
