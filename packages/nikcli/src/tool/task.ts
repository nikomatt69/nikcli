import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { Delegation } from "@/delegation/manager"

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  background: z.boolean().describe("Run the subagent in background and return immediately").optional(),
  session_id: z.string().describe("Existing Task session to continue").optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export type TaskParams = z.infer<typeof parameters>

type ToolSummaryItem = { id: string; tool: string; state: { status: string; title?: string } }

type TaskMetadata = {
  summary?: ToolSummaryItem[]
  sessionId: string
  delegationId?: string
  background?: boolean
  liveSummary?: string
}

function extractErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const value = error as {
    message?: string
    data?: {
      message?: string
    }
  }
  return value.data?.message ?? value.message
}

async function summarizeSubtaskSession(sessionID: string, result?: MessageV2.WithParts) {
  const messages = await Session.messages({ sessionID })
  const summary = messages
    .filter((x) => x.info.role === "assistant")
    .flatMap((msg) => msg.parts.filter((x): x is MessageV2.ToolPart => x.type === "tool"))
    .map((part) => ({
      id: part.id,
      tool: part.tool,
      state: {
        status: part.state.status,
        title: part.state.status === "completed" ? part.state.title : undefined,
      },
    }))

  const assistant =
    result?.info.role === "assistant" ? result : messages.findLast((item) => item.info.role === "assistant")
  const text = assistant?.parts.findLast((part): part is MessageV2.TextPart => part.type === "text")?.text ?? ""

  return {
    summary,
    text,
    assistant: assistant?.info.role === "assistant" ? assistant.info : undefined,
  }
}

function formatTaskOutput(text: string, sessionID: string, delegationID?: string) {
  const metadata = ["<task_metadata>", `session_id: ${sessionID}`]
  if (delegationID) metadata.push(`delegation_id: ${delegationID}`)
  metadata.push("</task_metadata>")
  const body = text.trim()
  return (body ? body + "\n\n" : "") + metadata.join("\n")
}

function summarizeLiveText(text: string) {
  const cleaned = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^<[^>]+>$/.test(line))

  if (cleaned.length === 0) return undefined
  const summary = cleaned.slice(-2).join(" ")
  return summary.length > 180 ? summary.slice(0, 177).trimEnd() + "..." : summary
}

export async function runSubtask(params: TaskParams, ctx: Tool.Context<TaskMetadata>) {
  const config = await Config.get()
  const bypass = Boolean(ctx.extra?.bypassAgentCheck)

  if (!bypass) {
    await ctx.ask({
      permission: "task",
      patterns: [params.subagent_type],
      always: ["*"],
      metadata: {
        description: params.description,
        subagent_type: params.subagent_type,
      },
    })
  }

  const agent = await Agent.get(params.subagent_type)
  if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

  const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

  const session = await iife(async () => {
    if (params.session_id) {
      const found = await Session.get(params.session_id).catch(() => {})
      if (found) return found
    }

    return await Session.create({
      parentID: ctx.sessionID,
      title: params.description + ` (@${agent.name} subagent)`,
      permission: [
        {
          permission: "todowrite",
          pattern: "*",
          action: "deny",
        },
        {
          permission: "todoread",
          pattern: "*",
          action: "deny",
        },
        ...(hasTaskPermission
          ? []
          : [
              {
                permission: "task" as const,
                pattern: "*" as const,
                action: "deny" as const,
              },
            ]),
        ...(config.experimental?.primary_tools?.map((t) => ({
          pattern: "*",
          action: "allow" as const,
          permission: t,
        })) ?? []),
      ],
    })
  })

  const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
  if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

  ctx.metadata({
    title: params.description,
    metadata: {
      sessionId: session.id,
    },
  })

  const messageID = Identifier.ascending("message")
  const model = agent.model ?? {
    modelID: msg.info.modelID,
    providerID: msg.info.providerID,
  }

  const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)
  const promptInput = {
    messageID,
    sessionID: session.id,
    model: {
      modelID: model.modelID,
      providerID: model.providerID,
    },
    agent: agent.name,
    tools: {
      todowrite: false,
      todoread: false,
      ...(hasTaskPermission ? {} : { task: false }),
      ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
    },
    parts: promptParts,
  } satisfies SessionPrompt.PromptInput

  if (params.background) {
    const delegation = await Delegation.create({
      parentSessionID: ctx.sessionID,
      agent: agent.name,
      prompt: params.prompt,
      session,
    })

    Delegation.setSessionID(delegation.id, session.id)

    ctx.metadata({
      title: params.description,
      metadata: {
        background: true,
        delegationId: delegation.id,
        sessionId: session.id,
      },
    })

    void SessionPrompt.prompt(promptInput)
      .then(async (result) => {
        const summary = await summarizeSubtaskSession(session.id, result)
        const error = summary.assistant?.error
        if (error) {
          const status = MessageV2.AbortedError.isInstance(error) ? "cancelled" : "error"
          await Delegation.finalize(delegation.id, status, summary.text, extractErrorMessage(error))
          return
        }
        await Delegation.finalize(delegation.id, "complete", summary.text)
      })
      .catch(async (error) => {
        await Delegation.finalize(delegation.id, "error", "", error instanceof Error ? error.message : String(error))
      })

    return {
      title: params.description,
      metadata: {
        background: true,
        delegationId: delegation.id,
        sessionId: session.id,
      },
      output: formatTaskOutput(
        `Background task started for @${agent.name}. Open the linked subagent session to follow progress.`,
        session.id,
        delegation.id,
      ),
    }
  }

  function cancel() {
    SessionPrompt.cancel(session.id)
  }
  ctx.abort.addEventListener("abort", cancel)
  using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
  const parts: Record<string, ToolSummaryItem> = {}
  let liveSummary: string | undefined
  const updateForegroundMetadata = () => {
    ctx.metadata({
      title: params.description,
      metadata: {
        summary: Object.values(parts).sort((a, b) => a.id.localeCompare(b.id)),
        sessionId: session.id,
        liveSummary,
      },
    })
  }
  const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
    if (evt.properties.part.sessionID !== session.id) return
    const part = evt.properties.part
    if (part.type === "tool") {
      parts[part.id] = {
        id: part.id,
        tool: part.tool,
        state: {
          status: part.state.status,
          title: part.state.status === "completed" ? part.state.title : undefined,
        },
      }
      updateForegroundMetadata()
      return
    }
    if (part.type !== "text" || part.synthetic || part.ignored) return
    const nextLiveSummary = summarizeLiveText(part.text)
    if (!nextLiveSummary || nextLiveSummary === liveSummary) return
    liveSummary = nextLiveSummary
    updateForegroundMetadata()
  })
  try {
    const result = await SessionPrompt.prompt(promptInput)
    const summary = await summarizeSubtaskSession(session.id, result)

    return {
      title: params.description,
      metadata: {
        summary: summary.summary,
        sessionId: session.id,
        liveSummary: summarizeLiveText(summary.text),
      },
      output: formatTaskOutput(summary.text, session.id),
    }
  } finally {
    unsub()
  }
}

export const TaskTool = Tool.define<typeof parameters, TaskMetadata>("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      return runSubtask(params, ctx)
    },
  }
})
