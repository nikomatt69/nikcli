import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import open from "open"

export default Runtime.handler(Commands.commands["companion"].commands["open"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    port: input["port"],
    session: Option.getOrUndefined(input["session"]),
  }
  const port = args.port as number
  const session = args.session as string | undefined

  let url = `http://localhost:${port}/companion`
  if (session) {
    url += `?session=${session}`
  }

  await open(url)
  console.log(`Opening ${url}`)
})
