// @ts-nocheck

import { OpenCode } from "@nikcli-ai/core"
import { ReadTool } from "@nikcli-ai/core/tools"

const nikcli = OpenCode.make({})

nikcli.tool.add(ReadTool)

nikcli.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

nikcli.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

nikcli.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await nikcli.session.create({
  agent: "build",
})

nikcli.subscribe((event) => {
  console.log(event)
})

await nikcli.session.prompt({
  sessionID,
  text: "hey what is up",
})

await nikcli.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await nikcli.session.wait()

console.log(await nikcli.session.messages(sessionID))
