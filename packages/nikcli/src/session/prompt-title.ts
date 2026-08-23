import { Effect } from "effect"
import { Log } from "@nikcli-ai/util/log"
import { Agent } from "../agent/agent"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { Provider } from "../provider/provider"
import { Session } from "."
import { iife } from "@nikcli-ai/util/iife"

const log = Log.create({ service: "session.prompt.title" })

/**
 * `ensureTitle` is the model-driven title generation step that runs after
 * the first real user message. It lives in its own module because the
 * generated title is a side-channel persisted via `sessionUpdate`, not a
 * normal prompt result, and pulling the wiring through deps injection
 * keeps the parent module from carrying yet another dedicated service.
 */
export namespace PromptTitle {
  export interface Deps {
    agentGet(name: string): Promise<Agent.Info | undefined>
    providerGetModel(providerID: string, modelID: string): Promise<Provider.Model>
    providerGetSmallModel(providerID: string): Promise<Provider.Model | undefined>
    sessionUpdate(
      sessionID: string,
      editor: (session: Session.Info) => void,
      options?: { touch?: boolean },
    ): Promise<Session.Info>
  }

  export interface Input {
    session: Session.Info
    history: MessageV2.WithParts[]
    providerID: string
    modelID: string
  }

  /**
   * Generate a session title via the `title` agent or the small model of the
   * session's main provider, then write the trimmed result back to the
   * session. Re-titles are guarded: a sub-session, an already-titled
   * session, or a session whose first real user message is missing is
   * left alone. The re-check inside `sessionUpdate` also lets a rename
   * that landed during the title stream win.
   */
  export async function ensure(deps: Deps, input: Input): Promise<void> {
    if (input.session.parentID) return
    if (!Session.isDefaultTitle(input.session.title)) return

    const firstRealUserIdx = input.history.findIndex(
      (m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic),
    )
    if (firstRealUserIdx === -1) return

    // Titling is driven by the first real user message but is not restricted to
    // the first turn: when generation failed (provider hiccup, no small model),
    // the session keeps its default title and the next prompt retries. The
    // default-title guard above is what stops a titled session from re-titling.
    const contextMessages = input.history.slice(0, firstRealUserIdx + 1)
    const firstRealUser = contextMessages[firstRealUserIdx]

    const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
    const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

    const agent = await deps.agentGet("title")
    if (!agent) return
    const model = await iife(async () => {
      if (agent.model) return await deps.providerGetModel(agent.model.providerID, agent.model.modelID)
      return (
        (await deps.providerGetSmallModel(input.providerID)) ??
        (await deps.providerGetModel(input.providerID, input.modelID))
      )
    })
    const result = await LLM.stream({
      agent,
      user: firstRealUser.info as MessageV2.User,
      system: [],
      small: true,
      tools: {},
      model,
      abort: new AbortController().signal,
      sessionID: input.session.id,
      retries: 2,
      messages: [
        {
          role: "user",
          content: "Generate a title for this conversation:\n",
        },
        ...(hasOnlySubtaskParts
          ? [
              {
                role: "user" as const,
                content: subtaskParts.map((p) => p.prompt).join("\n"),
              },
            ]
          : MessageV2.toModelMessages(contextMessages, model)),
      ],
    })
    const text = await result.text.catch((err) => log.error("failed to generate title", { error: err }))
    if (text)
      await deps.sessionUpdate(
        input.session.id,
        (draft) => {
          // Re-checked inside the update: a rename that landed while the title
          // model was streaming must win over the generated title.
          if (!Session.isDefaultTitle(draft.title)) return

          const cleaned = text
            .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.length > 0)
          if (!cleaned) return

          const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
          draft.title = title
        },
        { touch: false },
      )
  }
}
