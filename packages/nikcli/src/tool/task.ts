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
import { Instance } from "../project/instance"
import { Log } from "@/util/log"

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
  delegatorDelegationId?: string
  delegatorSessionId?: string
  background?: boolean
  liveSummary?: string
  kind?: string
  question?: string
  sourceCount?: number
  confidence?: string
  followUpRounds?: number
  reused?: boolean
}

type BackgroundTaskResult = {
  delegationId: string
  delegatorDelegationId: string
  delegatorSessionId: string
  sessionId: string
  kind?: string
  question?: string
  sourceCount?: number
  confidence?: string
  followUpRounds?: number
  reused?: boolean
}

type ResearchRunMetadata = {
  kind: "research"
  question?: string
  sourceCount?: number
  confidence?: string
  followUpRounds?: number
}

const RESEARCH_AGENT = "researcher"
const log = Log.create({ service: "task" })

function extractQuestion(prompt: string) {
  const explicit = prompt.match(/^Question:\s*(.+)$/im)?.[1]?.trim()
  if (explicit) return explicit
  const firstLine = prompt
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine?.slice(0, 160)
}

function extractConfidence(text: string) {
  return text.match(/^Confidence:\s*(.+)$/im)?.[1]?.trim()
}

function extractSourceCount(text: string) {
  const matches = text.match(/https?:\/\/[^\s)\]]+/g) ?? []
  return new Set(matches).size
}

function buildResearchMetadata(
  agentName: string,
  prompt: string,
  extra?: Omit<ResearchRunMetadata, "kind" | "question">,
) {
  if (agentName !== RESEARCH_AGENT) return undefined
  return {
    kind: "research",
    question: extractQuestion(prompt),
    ...extra,
  } satisfies ResearchRunMetadata
}

type ReusableSessionValidation = {
  parentSessionID: string
  parentWorkspaceID?: string
  sessionID: string
  agentName: string
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

async function validateReusableSession({
  parentSessionID,
  parentWorkspaceID,
  sessionID,
  agentName,
}: ReusableSessionValidation) {
  const found = await Session.get(sessionID).catch(() => undefined)
  if (!found) return undefined
  if (found.parentID !== parentSessionID) {
    throw new Error(`Task session \"${sessionID}\" does not belong to the current parent session.`)
  }
  if (parentWorkspaceID && found.workspaceID && found.workspaceID !== parentWorkspaceID) {
    throw new Error(`Task session \"${sessionID}\" belongs to a different workspace.`)
  }

  const messages = await Session.messages({ sessionID: found.id })
  const mismatchedAgent = messages.find(
    (item) => item.info.role === "assistant" && item.info.agent && item.info.agent !== agentName,
  )
  if (mismatchedAgent?.info.role === "assistant") {
    throw new Error(
      `Task session \"${sessionID}\" is already associated with @${mismatchedAgent.info.agent ?? "unknown"}.`,
    )
  }

  return found
}

function buildSubtaskPermission(
  hasTaskPermission: boolean,
  primaryTools: NonNullable<Awaited<ReturnType<typeof Config.get>>["experimental"]>["primary_tools"] | undefined,
) {
  return [
    {
      permission: "todowrite",
      pattern: "*",
      action: "deny" as const,
    },
    {
      permission: "todoread",
      pattern: "*",
      action: "deny" as const,
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
    ...(primaryTools?.map((t) => ({
      pattern: "*",
      action: "allow" as const,
      permission: t,
    })) ?? []),
  ]
}

async function createPromptInput(params: {
  sessionID: string
  prompt: string
  agentName: string
  hasTaskPermission: boolean
  model: {
    modelID: string
    providerID: string
  }
  primaryTools: NonNullable<Awaited<ReturnType<typeof Config.get>>["experimental"]>["primary_tools"] | undefined
}) {
  const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)
  return {
    messageID: Identifier.ascending("message"),
    sessionID: params.sessionID,
    model: params.model,
    agent: params.agentName,
    tools: {
      todowrite: false,
      todoread: false,
      ...(params.hasTaskPermission ? {} : { task: false }),
      ...Object.fromEntries((params.primaryTools ?? []).map((t) => [t, false])),
    },
    parts: promptParts,
  } satisfies SessionPrompt.PromptInput
}

function subscribeDelegationProgress(sessionID: string, delegationID: string) {
  let lastSummary: string | undefined = "Starting background task"
  void Delegation.updateProgress(delegationID, lastSummary)
  return Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
    if (evt.properties.part.sessionID !== sessionID) return
    const part = evt.properties.part
    let nextSummary: string | undefined
    if (part.type === "tool") {
      nextSummary = `Tool ${part.tool}: ${part.state.status}${
        part.state.status === "completed" && part.state.title ? ` (${part.state.title})` : ""
      }`
    } else if (part.type === "text" && !part.synthetic && !part.ignored) {
      nextSummary = summarizeLiveText(part.text)
    }
    if (!nextSummary || nextSummary === lastSummary) return
    lastSummary = nextSummary
    await Delegation.updateProgress(delegationID, nextSummary).catch(() => undefined)
  })
}

async function launchBackgroundSubtask(params: {
  description: string
  prompt: string
  source: "task" | "model-subtask"
  parentSessionID: string
  agent: Agent.Info
  session: Session.Info
  model: {
    modelID: string
    providerID: string
  }
  hasTaskPermission: boolean
  primaryTools: NonNullable<Awaited<ReturnType<typeof Config.get>>["experimental"]>["primary_tools"] | undefined
  metadata?: Record<string, unknown>
}): Promise<BackgroundTaskResult> {
  const delegatorSession = await Session.create({
    parentID: params.parentSessionID,
    title: `delegator: ${params.description} (@delegator)`,
    permission: buildSubtaskPermission(false, params.primaryTools),
  })

  const delegation = await Delegation.create({
    parentSessionID: params.parentSessionID,
    agent: params.agent.name,
    prompt: params.prompt,
    session: params.session,
    source: params.agent.name === RESEARCH_AGENT ? "research" : params.source,
    metadata: params.metadata,
    delegatorSessionID: delegatorSession.id,
    delegatorEnabled: true,
  })
  Delegation.setSessionID(delegation.id, params.session.id)

  const delegatorDelegation = await Delegation.create({
    parentSessionID: params.parentSessionID,
    agent: "delegator",
    prompt: `Synthesize @${params.agent.name}: ${params.prompt}`,
    session: delegatorSession,
    source: "delegator",
    metadata: params.metadata,
  })
  Delegation.setSessionID(delegatorDelegation.id, delegatorSession.id)
  // Close the forward link advertised by the BackgroundRun schema so callers
  // can resolve a subagent delegation's supervisor in O(1) via its record.
  await Delegation.linkDelegator(delegation.id, delegatorDelegation.id)

  const promptInput = await createPromptInput({
    sessionID: params.session.id,
    prompt: params.prompt,
    agentName: params.agent.name,
    hasTaskPermission: params.hasTaskPermission,
    model: params.model,
    primaryTools: params.primaryTools,
  })
  const unsubProgress = subscribeDelegationProgress(params.session.id, delegation.id)
  Instance.registerDisposer(unsubProgress)

  void SessionPrompt.prompt(promptInput)
    .then(async (result) => {
      unsubProgress()
      const summary = await summarizeSubtaskSession(params.session.id, result)
      const error = summary.assistant?.error
      const status = error ? (MessageV2.AbortedError.isInstance(error) ? "cancelled" : "error") : "complete"
      const errMsg = error ? extractErrorMessage(error) : undefined
      const workerMetadata =
        params.agent.name === RESEARCH_AGENT
          ? buildResearchMetadata(params.agent.name, params.prompt, {
              sourceCount: extractSourceCount(summary.text),
              confidence: extractConfidence(summary.text),
            })
          : params.metadata

      await Delegation.finalize(delegation.id, status, summary.text, errMsg, workerMetadata)

      await Delegation.waitForSettled(params.parentSessionID).catch(() => undefined)
      const synthesisItems = await Delegation.collectResults(params.parentSessionID).catch(() => [])
      const MAX_ITERATIONS = 3
      let accumulatedResults: Delegation.SynthesisItem[] = synthesisItems
      const sessionSummaries: string[] = []
      let lastDelegatorSummary: Awaited<ReturnType<typeof summarizeSubtaskSession>> | null = null

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const resultsText = accumulatedResults
          .map((item) => {
            const details = item.resultSummary ?? item.progressSummary ?? item.error ?? "(no output)"
            return `- ${item.id} [${item.status}] @${item.agent}\n${details}`
          })
          .join("\n\n")

        const isLastRound = iteration === MAX_ITERATIONS - 1

        const wakeText = [
          iteration === 0
            ? `Background task completed with status: **${status}**.`
            : `## Follow-up Round ${iteration + 1}`,
          "",
          `Agent: @${params.agent.name}`,
          `Task: ${params.prompt}`,
          "",
          "## Accumulated Results",
          resultsText || "- none",
          "",
          ...(sessionSummaries.length > 0
            ? ["", "## Previous Synthesis", sessionSummaries[sessionSummaries.length - 1]]
            : []),
          "",
          isLastRound
            ? "**This is the final round. You must finalize.**"
            : "**Analyze results and decide: finalize now or continue with follow-up work.**",
          "",
          "## Your Decision (required)",
          "Respond with: **Action:** finalize | continue",
          "**Reason:** <one sentence>",
        ].join("\n")

        const delegatorResult = await SessionPrompt.prompt({
          messageID: Identifier.ascending("message"),
          sessionID: delegatorSession.id,
          model: params.model,
          agent: "delegator",
          tools: {
            todowrite: false,
            todoread: false,
            task: !isLastRound,
          },
          parts: [{ type: "text" as const, text: wakeText }],
        })

        const delegatorSummary = await summarizeSubtaskSession(delegatorSession.id, delegatorResult)
        lastDelegatorSummary = delegatorSummary
        sessionSummaries.push(delegatorSummary.text)

        const text = delegatorSummary.text ?? ""
        const actionMatch = text.match(/\*\*Action\*\*[\s:]+(finalize|continue)/i)
        const action = (actionMatch?.[1]?.toLowerCase() ?? "finalize") as "finalize" | "continue"
        if (!actionMatch) {
          log.warn("delegator did not respond with expected action format", { text: text.slice(0, 200) })
        }

        if (action === "finalize" || isLastRound) break

        await Delegation.waitForSettled(params.parentSessionID).catch(() => undefined)
        const newResults = await Delegation.collectResults(params.parentSessionID).catch(() => [])
        const seen = new Set(accumulatedResults.map((r) => r.id))
        for (const r of newResults) {
          if (!seen.has(r.id)) accumulatedResults.push(r)
        }
      }

      const finalSummary = sessionSummaries[sessionSummaries.length - 1] ?? ""
      const finalErr = lastDelegatorSummary?.assistant?.error
      const finalStatus = finalErr ? (MessageV2.AbortedError.isInstance(finalErr) ? "cancelled" : "error") : "complete"
      const delegatorMetadata =
        params.agent.name === RESEARCH_AGENT
          ? buildResearchMetadata(params.agent.name, params.prompt, {
              followUpRounds: Math.max(0, sessionSummaries.length - 1),
              sourceCount: extractSourceCount(finalSummary),
              confidence: extractConfidence(finalSummary),
            })
          : params.metadata
      await Delegation.finalize(
        delegatorDelegation.id,
        finalStatus,
        finalSummary,
        finalErr ? extractErrorMessage(finalErr) : undefined,
        delegatorMetadata,
      )
    })
    .catch(async (error) => {
      unsubProgress()
      const errMsg = error instanceof Error ? error.message : String(error)
      await Delegation.finalize(delegation.id, "error", "", errMsg, params.metadata)
      await Delegation.finalize(delegatorDelegation.id, "error", "", `Subagent threw: ${errMsg}`, params.metadata)
    })

  return {
    delegationId: delegation.id,
    delegatorDelegationId: delegatorDelegation.id,
    delegatorSessionId: delegatorSession.id,
    sessionId: params.session.id,
    kind: typeof params.metadata?.kind === "string" ? params.metadata.kind : undefined,
    question: typeof params.metadata?.question === "string" ? params.metadata.question : undefined,
  }
}

export async function runSubtask(params: TaskParams, ctx: Tool.Context<TaskMetadata>) {
  const config = await Config.get()
  // SECURITY: bypassAgentCheck should only be true when set by internal system code
  // (e.g., when processing SubtaskPart from model). It should NEVER be derived from
  // user-controllable data like message parts. See session/prompt.ts for proper usage.
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
  const parentSession = await Session.get(ctx.sessionID)
  const researchMetadata = buildResearchMetadata(agent.name, params.prompt)

  if (params.background && agent.name === RESEARCH_AGENT) {
    const existing = await Delegation.findRunningForParent(ctx.sessionID, agent.name)
    if (existing) {
      const metadata: TaskMetadata = {
        background: true,
        delegationId: existing.id,
        delegatorDelegationId: existing.delegatorID,
        delegatorSessionId: existing.delegatorSessionID,
        sessionId: existing.sessionID ?? "unknown",
        kind: "research",
        question:
          (typeof existing.metadata?.question === "string" ? existing.metadata.question : undefined) ??
          researchMetadata?.question,
        reused: true,
      }
      ctx.metadata({ title: params.description, metadata })
      return {
        title: params.description,
        metadata,
        output: formatTaskOutput(
          `Reusing running @${agent.name} background task.\nDelegator: ${existing.delegatorID ?? "N/A"}`,
          existing.sessionID ?? "unknown",
          existing.id,
        ),
      }
    }
  }

  const session = await iife(async () => {
    if (params.session_id) {
      const found = await validateReusableSession({
        parentSessionID: ctx.sessionID,
        parentWorkspaceID: parentSession.workspaceID,
        sessionID: params.session_id,
        agentName: agent.name,
      })
      if (found) return found
    }

    return await Session.create({
      parentID: ctx.sessionID,
      title: params.description + ` (@${agent.name} subagent)`,
      permission: buildSubtaskPermission(hasTaskPermission, config.experimental?.primary_tools),
    })
  })

  const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
  if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

  ctx.metadata({
    title: params.description,
    metadata: {
      sessionId: session.id,
      kind: researchMetadata?.kind,
      question: researchMetadata?.question,
    },
  })

  const model = agent.model ?? {
    modelID: msg.info.modelID,
    providerID: msg.info.providerID,
  }

  if (params.background) {
    const backgroundTask = await launchBackgroundSubtask({
      description: params.description,
      prompt: params.prompt,
      source: ctx.extra?.backgroundSource === "model-subtask" ? "model-subtask" : "task",
      parentSessionID: ctx.sessionID,
      agent,
      session,
      model: {
        modelID: model.modelID,
        providerID: model.providerID,
      },
      hasTaskPermission,
      primaryTools: config.experimental?.primary_tools,
      metadata: researchMetadata,
    })

    ctx.metadata({
      title: params.description,
      metadata: {
        background: true,
        delegationId: backgroundTask.delegationId,
        delegatorDelegationId: backgroundTask.delegatorDelegationId,
        delegatorSessionId: backgroundTask.delegatorSessionId,
        sessionId: backgroundTask.sessionId,
        kind: backgroundTask.kind,
        question: backgroundTask.question,
        sourceCount: backgroundTask.sourceCount,
        confidence: backgroundTask.confidence,
        followUpRounds: backgroundTask.followUpRounds,
        reused: backgroundTask.reused,
      },
    })

    return {
      title: params.description,
      metadata: {
        background: true,
        delegationId: backgroundTask.delegationId,
        delegatorDelegationId: backgroundTask.delegatorDelegationId,
        delegatorSessionId: backgroundTask.delegatorSessionId,
        sessionId: backgroundTask.sessionId,
        kind: backgroundTask.kind,
        question: backgroundTask.question,
        sourceCount: backgroundTask.sourceCount,
        confidence: backgroundTask.confidence,
        followUpRounds: backgroundTask.followUpRounds,
        reused: backgroundTask.reused,
      },
      output: formatTaskOutput(
        `Background task started for @${agent.name}. Delegator will synthesize results.\nDelegator: ${backgroundTask.delegatorDelegationId}`,
        backgroundTask.sessionId,
        backgroundTask.delegationId,
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
        kind: researchMetadata?.kind,
        question: researchMetadata?.question,
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
    const promptInput = await createPromptInput({
      sessionID: session.id,
      prompt: params.prompt,
      agentName: agent.name,
      hasTaskPermission,
      model: {
        modelID: model.modelID,
        providerID: model.providerID,
      },
      primaryTools: config.experimental?.primary_tools,
    })
    const result = await SessionPrompt.prompt(promptInput)
    const summary = await summarizeSubtaskSession(session.id, result)

    return {
      title: params.description,
      metadata: {
        summary: summary.summary,
        sessionId: session.id,
        liveSummary: summarizeLiveText(summary.text),
        kind: researchMetadata?.kind,
        question: researchMetadata?.question,
        sourceCount: agent.name === RESEARCH_AGENT ? extractSourceCount(summary.text) : undefined,
        confidence: agent.name === RESEARCH_AGENT ? extractConfidence(summary.text) : undefined,
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
