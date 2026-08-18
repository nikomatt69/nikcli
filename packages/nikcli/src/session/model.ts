/**
 * "Which model should this run use?" for work spawned outside a chat turn.
 *
 * Missions, loops and the Brain all start from a session the user is looking
 * at — the model shown in that session's footer is the one they expect the
 * spawned work to use, including the LLM call that drafts a mission or a
 * pipeline from a description. Resolution order mirrors
 * `SessionPrompt`'s `inheritedModel`:
 *
 *  1. the session's persisted `lastModel` column, set on every prompt
 *     resolution, so it survives a CLI restart
 *  2. the session's message stream, for sessions written before that column
 *     existed or whose only model came from the caller
 *  3. the global provider default
 *
 * Keep this free of `SessionPrompt` imports: the callers are engines and
 * route handlers that must not pull the prompt pipeline into their module
 * graph.
 */
import { Effect } from "effect"
import { MessageV2 } from "@/session/message-v2"
import { Provider } from "@/provider/provider"
import { SessionRepo } from "@/session/repo"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

export type ModelRef = { providerID: string; modelID: string }

function providerDefaultModel(): Promise<ModelRef> {
  return runPromiseWithLayer(
    Provider.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        return yield* provider.defaultModel()
      }),
    ),
  )
}

/**
 * The model this session carries, or `undefined` when it carries none.
 *
 * Callers that treat "no model" as "decide for me" want this rather than
 * `sessionModel`: an inherited model outranks an agent's configured model in
 * `prepareUserMessage`, so substituting the global default here would
 * silently override an agent that was deliberately pinned to something else.
 */
export async function sessionModelOwn(sessionID: string | undefined): Promise<ModelRef | undefined> {
  if (!sessionID) return undefined
  const persisted = SessionRepo.get(sessionID)?.lastModel
  if (persisted) return persisted
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return undefined
}

/** The model `sessionID` last resolved, falling back to the global default. */
export async function sessionModel(sessionID: string): Promise<ModelRef> {
  return (await sessionModelOwn(sessionID)) ?? providerDefaultModel()
}

/**
 * `sessionModelOwn` formatted as the `"providerID/modelID"` reference the
 * prompt pipeline and the loop/mission schemas take. Callers pass it straight
 * through to a `model?: string` field, where absent means "decide for me".
 */
export async function sessionModelRef(sessionID: string | undefined): Promise<string | undefined> {
  const model = await sessionModelOwn(sessionID)
  if (model) return `${model.providerID}/${model.modelID}`
  return undefined
}
