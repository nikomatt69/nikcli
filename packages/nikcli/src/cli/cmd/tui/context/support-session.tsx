import path from "path"
import { createStore, produce } from "solid-js/store"
import { batch } from "solid-js"
import { Global } from "@/global"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

type SupportModel = { providerID: string; modelID: string }

type State = {
  sessionID?: string
  createdAt?: number
  /** Model override for the support conversation; falls back to the app model. */
  model?: SupportModel
}

const STATE_FILE = path.join(Global.Path.state, "support-session.json")

type Persisted = Partial<State>

/**
 * Persistent support session.
 *
 * - Reused across TUI restarts: the sessionID is stored in
 *   `Global.Path.state/support-session.json` so closing/reopening the TUI does
 *   not lose the conversation.
 * - Verified on first use: if the server no longer knows the session (deleted,
 *   expired, …) a new one is created transparently.
 * - `reset()` deletes the old session and clears the cache. Bound to `Ctrl+N`
 *   inside the dialog to start fresh.
 */
export const { use: useSupportSession, provider: SupportSessionProvider } = createSimpleContext({
  name: "SupportSession",
  init: () => {
    const sdk = useSDK()

    const [state, setState] = createStore<State>({})
    const [ready, setReady] = createStore({ value: false })

    // Load persisted state asynchronously. Until it resolves we behave as if
    // there is no session; `ensure()` will then either pick it up or create a
    // new one.
    void Bun.file(STATE_FILE)
      .json()
      .then((raw: Persisted) => {
        if (raw && typeof raw.sessionID === "string" && raw.sessionID.length > 0) {
          batch(() => {
            setState("sessionID", raw.sessionID)
            setState("createdAt", typeof raw.createdAt === "number" ? raw.createdAt : Date.now())
            if (raw.model && typeof raw.model.providerID === "string" && typeof raw.model.modelID === "string") {
              setState("model", { providerID: raw.model.providerID, modelID: raw.model.modelID })
            }
          })
        }
      })
      .catch(() => {
        // File missing or unreadable: nothing to restore.
      })
      .finally(() => setReady("value", true))

    async function persist() {
      try {
        const payload: Persisted = {
          sessionID: state.sessionID,
          createdAt: state.createdAt,
          model: state.model,
        }
        await Bun.write(STATE_FILE, JSON.stringify(payload, null, 2))
      } catch (err) {
        // Best-effort: the dialog can still function, it just won't survive a
        // restart. Log but don't throw — the user is trying to get help.
        console.warn("[support-session] failed to persist state:", err)
      }
    }

    async function sessionExists(id: string): Promise<boolean> {
      try {
        await sdk.client.session.get({ sessionID: id })
        return true
      } catch {
        return false
      }
    }

    return {
      get id() {
        return state.sessionID
      },
      get createdAt() {
        return state.createdAt
      },
      get ready() {
        return ready.value
      },
      get model() {
        return state.model
      },
      /** Pick (or clear) the model used for support prompts. Persisted. */
      async setModel(model: SupportModel | undefined): Promise<void> {
        setState("model", model)
        await persist()
      },
      /**
       * Return the current sessionID, creating a new one if needed.
       * Safe to call repeatedly: the second call is a no-op.
       */
      async ensure(): Promise<string> {
        const existing = state.sessionID
        if (existing) {
          const ok = await sessionExists(existing)
          if (ok) return existing
          // Server no longer knows this session: drop it and fall through.
          setState(
            produce((s) => {
              s.sessionID = undefined
              s.createdAt = undefined
            }),
          )
        }
        const created = await sdk.client.session.create({
          title: "nikcli support",
        })
        if (!created.data) {
          throw new Error("Failed to create support session: empty response")
        }
        const id = created.data.id
        batch(() => {
          setState("sessionID", id)
          setState("createdAt", Date.now())
        })
        await persist()
        return id
      },
      /**
       * Delete the current session server-side and clear local state.
       * The next `ensure()` will create a fresh session.
       */
      async reset(): Promise<void> {
        const existing = state.sessionID
        if (existing) {
          try {
            await sdk.client.session.delete({ sessionID: existing })
          } catch {
            // Best-effort: the server may have already forgotten it.
          }
        }
        batch(() => {
          setState("sessionID", undefined)
          setState("createdAt", undefined)
        })
        await persist()
      },
    }
  },
})
