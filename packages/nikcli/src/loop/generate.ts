/**
 * AI-assisted loop definition authoring (shared by Hono and HttpApi).
 */
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "../effect"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Log } from "../util/log"
import { definitionFromGenerated, definitionFromGeneratedText, type LoopDefinition } from "./schema"

const log = Log.create({ service: "loop.generate" })

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
}

export async function generateFromDescription(
  description: string,
  opts: { model?: string; agent?: string },
): Promise<LoopDefinition> {
  const session = await runSession(
    Effect.gen(function* () {
      const service = yield* Session.Service
      return yield* service.create({
        title: "loop: generate from description",
      })
    }),
  )
  const modelID = opts.model ?? ""
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
    log.warn("generate failed", { error })
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

function parseLenient(text: string): Parameters<typeof definitionFromGenerated>[0] {
  const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/)
  const stagesMatch = text.match(/"stages"\s*:\s*\[([\s\S]*?)\]\s*[,}]/)
  const intervalMatch = text.match(/"intervalMs"\s*:\s*(\d+)/)
  const maxRunsMatch = text.match(/"maxRuns"\s*:\s*(\d+)/)
  if (!stagesMatch) throw new Error("Could not extract stages from model output")
  const stages: Array<{
    name?: string
    agent?: string
    model?: string
    objective: string
    tokenBudget?: number
  }> = []
  const stageRe = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g
  for (const m of stagesMatch[1].matchAll(stageRe)) {
    const obj = m[0]
    const objMatch = obj.match(/"objective"\s*:\s*"([^"]+)"/)
    if (!objMatch) continue
    const stage: {
      name?: string
      agent?: string
      model?: string
      objective: string
      tokenBudget?: number
    } = {
      objective: objMatch[1],
    }
    const n = obj.match(/"name"\s*:\s*"([^"]+)"/)
    if (n) stage.name = n[1]
    const a = obj.match(/"agent"\s*:\s*"([^"]+)"/)
    if (a) stage.agent = a[1]
    const m2 = obj.match(/"model"\s*:\s*"([^"]+)"/)
    if (m2) stage.model = m2[1]
    const tb = obj.match(/"tokenBudget"\s*:\s*(\d+)/)
    if (tb) stage.tokenBudget = Number(tb[1])
    stages.push(stage)
  }
  if (stages.length === 0) throw new Error("No stages could be extracted")
  return {
    stages,
    ...(nameMatch ? { name: nameMatch[1] } : {}),
    ...(intervalMatch ? { intervalMs: Number(intervalMatch[1]) } : {}),
    ...(maxRunsMatch ? { maxRuns: Number(maxRunsMatch[1]) } : {}),
  }
}
