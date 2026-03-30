import type { Plugin, PluginInput } from "@nikcli-ai/plugin"
import { tool } from "@nikcli-ai/plugin"
import { randomUUID } from "crypto"

type AgentEntry = {
  agentID: string
  sessionID: string
  task: string
  startedAt: number
  done: boolean
  result?: string
  error?: string
}

const agents = new Map<string, AgentEntry>()

async function pollUntilDone(
  client: PluginInput["client"],
  sessionID: string,
  entry: AgentEntry,
): Promise<void> {
  const maxAttempts = 300
  let attempts = 0
  while (attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const { data } = await client.session.messages({ path: { id: sessionID } })
      if (!data) { attempts++; continue }

      // Find the last assistant message after the user prompt
      const assistantMessages = data.filter(
        (m: { info: { role: string } }) => m.info.role === "assistant",
      )
      const last = assistantMessages[assistantMessages.length - 1]
      if (!last) { attempts++; continue }

      const assistantInfo = last.info as { finish?: string }
      if (assistantInfo.finish) {
        const textParts = last.parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text as string)
          .join("\n")
        entry.done = true
        entry.result = textParts || "(agent completed with no text output)"
        return
      }
    } catch {}
    attempts++
  }
  entry.done = true
  entry.error = "Timed out after 10 minutes"
}

export const BackgroundAgentsPlugin: Plugin = async (input) => {
  const { client } = input

  return {
    tool: {
      agent_spawn: tool({
        description:
          "Delegate a task to a background agent running in its own session. Returns immediately with an agentID. Check progress with agent_status.",
        args: {
          task: tool.schema.string().describe("The task or prompt for the agent to work on"),
          context: tool.schema
            .string()
            .optional()
            .describe("Optional additional context to prepend to the task"),
          parentID: tool.schema
            .string()
            .optional()
            .describe("Optional parent session ID to fork from"),
        },
        async execute(args) {
          const agentID = randomUUID().slice(0, 8)
          const prompt = args.context ? `Context:\n${args.context}\n\nTask:\n${args.task}` : args.task

          const { data: session } = await client.session.create({
            body: { title: `Agent ${agentID}: ${args.task.slice(0, 50)}`, parentID: args.parentID },
          })

          if (!session) return `Failed to create agent session`

          const entry: AgentEntry = {
            agentID,
            sessionID: session.id,
            task: args.task,
            startedAt: Date.now(),
            done: false,
          }
          agents.set(agentID, entry)

          // Fire-and-forget: send prompt then poll until done
          ;(async () => {
            try {
              await client.session.prompt({
                path: { id: session.id },
                body: { parts: [{ type: "text", text: prompt }] },
              })
              await pollUntilDone(client, session.id, entry)
            } catch (err) {
              entry.done = true
              entry.error = String(err)
            }
          })()

          return [
            `Spawned agent "${agentID}"`,
            `  Session: ${session.id}`,
            `  Task:    ${args.task.slice(0, 80)}`,
            ``,
            `Use agent_status("${agentID}") to check progress.`,
            `Use agent_result("${agentID}") once done.`,
          ].join("\n")
        },
      }),

      agent_status: tool({
        description: "Check the current status of a background agent.",
        args: {
          agentID: tool.schema.string().describe("The agent ID returned by agent_spawn"),
        },
        async execute(args) {
          const entry = agents.get(args.agentID)
          if (!entry) return `No agent with ID "${args.agentID}"`

          const elapsed = Math.floor((Date.now() - entry.startedAt) / 1000)

          if (entry.error) return `Agent "${args.agentID}": error after ${elapsed}s\n  ${entry.error}`
          if (entry.done) return `Agent "${args.agentID}": done (${elapsed}s)\n  Use agent_result to retrieve the output.`
          return `Agent "${args.agentID}": running (${elapsed}s)\n  Task: ${entry.task.slice(0, 80)}`
        },
      }),

      agent_result: tool({
        description: "Retrieve the result of a completed background agent.",
        args: {
          agentID: tool.schema.string().describe("The agent ID returned by agent_spawn"),
        },
        async execute(args) {
          const entry = agents.get(args.agentID)
          if (!entry) return `No agent with ID "${args.agentID}"`
          if (!entry.done) return `Agent "${args.agentID}" is still running. Use agent_status to check.`
          if (entry.error) return `Agent "${args.agentID}" failed:\n${entry.error}`
          return `Result from agent "${args.agentID}":\n\n${entry.result ?? "(no output)"}`
        },
      }),

      agent_list: tool({
        description: "List all background agents and their current statuses.",
        args: {},
        async execute() {
          if (agents.size === 0) return "No background agents"

          const header = `${"ID".padEnd(12)}${"STATUS".padEnd(16)}TASK`
          const rows = [...agents.values()].map((e) => {
            const elapsed = Math.floor((Date.now() - e.startedAt) / 1000)
            const status = e.error ? "error" : e.done ? `done(${elapsed}s)` : `running ${elapsed}s`
            return `${e.agentID.padEnd(12)}${status.padEnd(16)}${e.task.slice(0, 60)}`
          })

          return [header, ...rows].join("\n")
        },
      }),

      agent_cancel: tool({
        description: "Cancel a running background agent.",
        args: {
          agentID: tool.schema.string().describe("The agent ID to cancel"),
        },
        async execute(args) {
          const entry = agents.get(args.agentID)
          if (!entry) return `No agent with ID "${args.agentID}"`
          if (entry.done) return `Agent "${args.agentID}" has already finished`

          try {
            await client.session.abort({ path: { id: entry.sessionID } })
          } catch {}

          entry.done = true
          entry.error = "Cancelled"
          return `Cancelled agent "${args.agentID}"`
        },
      }),
    },
  }
}

export default { server: BackgroundAgentsPlugin }
