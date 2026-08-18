/**
 * Generate-from-description helper for missions.
 *
 * Lives outside the HTTP layer so both the Hono route, the Effect HttpApi
 * slice, and the CLI can share it without pulling server dependencies into
 * their module graphs (mirrors `loop/generate.ts`).
 */
import { Effect } from "effect"
import { Session } from "../session"
import { sessionModelRef } from "../session/model"
import { SessionPrompt } from "../session/prompt"
import { runPromiseWithLayer, withCurrentInstance } from "../effect"
import { definitionFromGenerated, definitionFromGeneratedText, type MissionDefinition } from "./schema"
import { Log } from "@nikcli-ai/util/log"

const log = Log.create({ service: "mission.generate" })

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
}

export const GENERATE_SYSTEM_PROMPT = [
  "You design missions for an autonomous coding agent.",
  "A mission is a brief, a sequence of milestones, and within each milestone a set of features.",
  "Each feature is a single, self-contained piece of work that the agent's `goal` command will drive to completion.",
  "Each milestone may end with a validation pass (`scrutiny` review/fix, `user-test` end-to-end check, or `none`).",
  "Prefer 1–3 milestones with 1–4 features each. Use agent 'ralph' for implementation, 'general' for read-only investigation, 'build' for multi-file edits, 'plan' for design.",
  "Use `dependsOn` to express intra-milestone ordering (each entry is a sibling feature id).",
  "Set `models.worker` / `models.validation` / `models.orchestrator` only when the user explicitly asks for a particular model.",
  "Return ONLY a single JSON object — no prose, no code fences.",
  "",
  "Schema:",
  `{`,
  `  "name": "kebab-or-human-name",`,
  `  "brief": "one-paragraph mission goal",`,
  `  "milestones": [`,
  `    { "name": "milestone", "validation": "scrutiny|user-test|none", "features": [`,
  `      { "name": "feature", "agent": "ralph|general|build|plan", "model": "providerID/modelID"?, "objective": "one-paragraph objective", "tokenBudget": number?, "dependsOn": ["f1_1"?] }`,
  `    ] }`,
  `  ],`,
  `  "models": { "worker"?: "provider/model", "validation"?: "provider/model", "orchestrator"?: "provider/model" }`,
  `}`,
  "",
  "Output exactly one JSON object.",
].join("\n")

export async function generateFromDescription(
  description: string,
  opts: { model?: string; agent?: string; sessionID?: string },
): Promise<MissionDefinition> {
  // Create a throwaway session to ask the configured model to author the plan.
  const session = await runSession(
    Effect.gen(function* () {
      const service = yield* Session.Service
      return yield* service.create({
        title: "mission: generate from description",
        // Parent the drafting session to the one that asked for it, so the
        // model inheritance chain in `SessionPrompt` has something to walk
        // even when the reference below resolves to nothing.
        ...(opts.sessionID ? { parentID: opts.sessionID } : {}),
      })
    }),
  )
  // The user launched this from a session whose footer shows a model; that is
  // the model they expect to draft the plan. An explicit `model` still wins,
  // and an absent one falls through to the agent's own model as before.
  const modelID = opts.model ?? (await sessionModelRef(opts.sessionID)) ?? ""
  const agent = opts.agent ?? "general"

  const userMessage = `${description}\n\nRespond with the JSON object and nothing else. When the JSON is fully emitted, call the update_goal tool with status="complete" and your one-line summary.`

  let text = ""
  try {
    const result = await runSessionPrompt(
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        return yield* prompt.command({
          sessionID: session.id,
          command: "goal",
          arguments: userMessage,
          agent,
          ...(modelID ? { model: modelID } : {}),
        })
      }),
    )
    const parts = result.parts as Array<{ type: string; text?: string }>
    text = parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n")
  } catch (error) {
    log.warn("mission generate failed", { error })
  }

  if (!text.trim()) throw new Error("The model returned no text")
  try {
    return definitionFromGeneratedText(text)
  } catch (jsonError) {
    try {
      const lenient = parseLenient(text)
      return definitionFromGenerated(lenient)
    } catch {
      throw jsonError
    }
  }
}

type LenientGenerated = Parameters<typeof definitionFromGenerated>[0]

function parseLenient(text: string): LenientGenerated {
  const briefMatch = text.match(/"brief"\s*:\s*"([^"]+)"/)
  const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/)
  const milestonesMatch = text.match(/"milestones"\s*:\s*\[([\s\S]*)\]\s*[,}]/)
  if (!milestonesMatch || !briefMatch) {
    throw new Error("Could not extract mission shape from model output")
  }
  const block = milestonesMatch[1]
  // Split on top-level objects via balanced braces.
  const milestones: Array<{
    name?: string
    validation?: "scrutiny" | "user-test" | "none"
    features: Array<{
      name?: string
      agent?: string
      model?: string
      objective: string
      tokenBudget?: number
      dependsOn?: string[]
    }>
  }> = []
  const objRe = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g
  for (const m of block.matchAll(objRe)) {
    const obj = m[0]
    const featuresMatch = obj.match(/"features"\s*:\s*\[([\s\S]*?)\](?=\s*[,}])/)
    if (!featuresMatch) continue
    const features: Array<{
      name?: string
      agent?: string
      model?: string
      objective: string
      tokenBudget?: number
      dependsOn?: string[]
    }> = []
    for (const fm of featuresMatch[1].matchAll(objRe)) {
      const fobj = fm[0]
      const objMatch = fobj.match(/"objective"\s*:\s*"([^"]+)"/)
      if (!objMatch) continue
      const feature: {
        name?: string
        agent?: string
        model?: string
        objective: string
        tokenBudget?: number
        dependsOn?: string[]
      } = {
        objective: objMatch[1],
      }
      const n = fobj.match(/"name"\s*:\s*"([^"]+)"/)
      if (n) feature.name = n[1]
      const a = fobj.match(/"agent"\s*:\s*"([^"]+)"/)
      if (a) feature.agent = a[1]
      const mm = fobj.match(/"model"\s*:\s*"([^"]+)"/)
      if (mm) feature.model = mm[1]
      const tb = fobj.match(/"tokenBudget"\s*:\s*(\d+)/)
      if (tb) feature.tokenBudget = Number(tb[1])
      const deps = fobj.match(/"dependsOn"\s*:\s*\[([^\]]*)\]/)
      if (deps) {
        const list = deps[1]
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""))
          .filter((s) => s.length > 0)
        if (list.length) feature.dependsOn = list
      }
      features.push(feature)
    }
    if (features.length === 0) continue
    const milestone: {
      name?: string
      validation?: "scrutiny" | "user-test" | "none"
      features: typeof features
    } = {
      features,
    }
    const mn = obj.match(/"name"\s*:\s*"([^"]+)"/)
    if (mn) milestone.name = mn[1]
    const mv = obj.match(/"validation"\s*:\s*"([^"]+)"/)
    if (mv && (mv[1] === "scrutiny" || mv[1] === "user-test" || mv[1] === "none")) {
      milestone.validation = mv[1] as "scrutiny" | "user-test" | "none"
    }
    milestones.push(milestone)
  }
  if (milestones.length === 0) throw new Error("No milestones could be extracted")
  const out: LenientGenerated = { brief: briefMatch[1], milestones }
  if (nameMatch) out.name = nameMatch[1]
  return out
}
