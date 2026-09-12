import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { bootstrap } from "@/cli/bootstrap"
import { Artifact } from "@/artifact"
import { UI } from "@/cli/ui"

export default Runtime.handler(Commands.commands["artifact"].commands["list"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "session-id": Option.getOrUndefined(input["session-id"]),
    sessionId: Option.getOrUndefined(input["session-id"]),
  }
  await bootstrap(process.cwd(), async () => {
    UI.empty()
    prompts.intro("Artifacts")

    if (!args.sessionId) {
      prompts.log.error("Pass a session ID: nikcli artifact list <session-id>")
      prompts.outro("Done")
      return
    }

    const artifacts = await Artifact.list(args.sessionId)
    if (artifacts.length === 0) {
      prompts.log.warn("No artifacts published from this session")
      prompts.outro("Done")
      return
    }

    for (const artifact of artifacts) {
      prompts.log.info(`${artifact.title} ${UI.Style.TEXT_DIM}(${artifact.kind}, v${artifact.version})`)
      prompts.log.info(`  ${Artifact.viewerUrl(artifact)}`)
    }
    prompts.outro(`${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}`)
  })
})
