import { locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionV2 } from "@/session/v2"
import { SessionPending } from "@/session/pending"
import { SessionError } from "@/session/error"
import { Log } from "@/util/log"

/**
 * Prompt routes for the Effect backend — raw streaming responses served by
 * the bridge ahead of the HttpApi router:
 *
 * - `POST /session/:id/message` opens a chunked 200 immediately (clients
 *   see headers while the prompt runs) and writes the final message JSON
 *   as a single body when the prompt completes.
 * - `POST /session/:id/prompt_async` validates, persists the user message
 *   (admission), then starts the model loop in the background and returns
 *   204 so clients can read the submitted message immediately.
 *
 * Payload validation failures return `{ data, error, success: false }` with
 * status 400. Both routes go through `SessionV2` so persistence shares the
 * entry write helper with `SessionV2.prompt`.
 */
export namespace HttpApiPrompt {
  const log = Log.create({ service: "httpapi.prompt" })

  const PromptBody = SessionV2.PromptInput.omit({ sessionID: true })

  function captureContext(): InstanceContext {
    return {
      directory: Instance.directory,
      worktree: Instance.worktree,
      project: Instance.project,
    }
  }

  function run(ctx: InstanceContext, sessionID: string, body: Record<string, unknown>) {
    return runPromiseWithLayer(
      SessionPrompt.defaultLayer,
      locallyInstance(
        ctx,
        SessionV2.promptEffect({
          ...body,
          sessionID,
        } as SessionV2.PromptInput),
      ),
    )
  }

  function admit(ctx: InstanceContext, sessionID: string, body: Record<string, unknown>) {
    return runPromiseWithLayer(
      SessionPrompt.defaultLayer,
      locallyInstance(
        ctx,
        SessionV2.admitEffect({
          ...body,
          sessionID,
        } as SessionV2.PromptInput),
      ),
    )
  }

  function loop(ctx: InstanceContext, sessionID: string, admission?: SessionPrompt.Admission) {
    return runPromiseWithLayer(
      SessionPrompt.defaultLayer,
      locallyInstance(
        ctx,
        SessionV2.loopEffect(sessionID, {
          controller: admission?.controller,
          messageID: admission?.messageID,
        }),
      ),
    )
  }

  async function parse(
    request: Request,
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
    const raw = await request.json().catch(() => undefined)
    const parsed = PromptBody.safeParse(raw)
    if (!parsed.success) {
      return {
        ok: false,
        response: Response.json({ data: raw, error: parsed.error.issues, success: false }, { status: 400 }),
      }
    }
    return { ok: true, body: parsed.data as Record<string, unknown> }
  }

  function errorBody(error: unknown): {
    status: number
    body: { name: string; data: Record<string, unknown> }
  } {
    if (error instanceof Session.BusyError) {
      return {
        status: 409,
        body: {
          name: error._tag,
          data: { sessionID: error.sessionID, message: error.message },
        },
      }
    }
    if (error instanceof SessionPending.ConflictError) {
      return {
        status: 409,
        body: {
          name: error.name,
          data: {
            sessionID: error.sessionID,
            messageID: error.messageID,
            message: error.message,
          },
        },
      }
    }
    if (SessionError.isNotFound(error)) {
      return {
        status: 404,
        body: { name: "NotFoundError", data: { message: error.message } },
      }
    }
    const message = error instanceof Error && error.stack ? error.stack : String(error)
    return { status: 500, body: { name: "Unknown", data: { message } } }
  }

  export async function prompt(request: Request, sessionID: string): Promise<Response> {
    const parsed = await parse(request)
    if (!parsed.ok) return parsed.response
    const ctx = captureContext()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void run(ctx, sessionID, parsed.body)
          .then((msg) => {
            controller.enqueue(encoder.encode(JSON.stringify(msg)))
          })
          .catch((error) => {
            // The 200 header is already on the wire (the Hono route has the
            // same constraint) — the typed error body is all we can deliver.
            log.error("prompt failed mid-stream", { sessionID, error })
            controller.enqueue(encoder.encode(JSON.stringify(errorBody(error).body)))
          })
          .finally(() => {
            try {
              controller.close()
            } catch {}
          })
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  export async function promptAsync(request: Request, sessionID: string): Promise<Response> {
    const parsed = await parse(request)
    if (!parsed.ok) return parsed.response
    const ctx = captureContext()
    try {
      // Await admission so the user message is durable before the 204.
      // Only the model loop runs in the background.
      const admission = await admit(ctx, sessionID, parsed.body)
      if (parsed.body.noReply !== true) {
        void loop(ctx, sessionID, admission).catch((error) => {
          log.warn("async prompt loop failed", { sessionID, error })
        })
      }
    } catch (error) {
      const { status, body } = errorBody(error)
      return Response.json(body, { status })
    }
    return new Response(null, {
      status: 204,
      headers: { "content-type": "application/json" },
    })
  }
}
