import { Effect } from "effect"
import { locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"

/**
 * Prompt routes for the Effect backend — raw streaming responses served by
 * the bridge ahead of the HttpApi router, with the exact Hono wire shape:
 *
 * - `POST /session/:id/message` opens a chunked 200 immediately (clients
 *   see headers while the prompt runs) and writes the final message JSON
 *   as a single body when the prompt completes.
 * - `POST /session/:id/prompt_async` validates, kicks the prompt off in
 *   the background, and returns 204 right away.
 *
 * Payload validation mirrors @hono/standard-validator's failure contract:
 * `{ data, error, success: false }` with status 400.
 */
export namespace HttpApiPrompt {
  const log = Log.create({ service: "httpapi.prompt" })

  const PromptBody = SessionPrompt.PromptInput.omit({ sessionID: true })

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
        Effect.gen(function* () {
          const sessionPrompt = yield* SessionPrompt.Service
          return yield* sessionPrompt.prompt({ ...body, sessionID } as SessionPrompt.PromptInput)
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

  function errorBody(error: unknown): { status: number; body: { name: string; data: Record<string, unknown> } } {
    if (error instanceof Session.BusyError) {
      return { status: 409, body: { name: error._tag, data: { sessionID: error.sessionID, message: error.message } } }
    }
    if (error instanceof Storage.NotFoundError) {
      return { status: 404, body: { name: error._tag, data: { message: error.message } } }
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
    return new Response(stream, { status: 200, headers: { "content-type": "application/json" } })
  }

  export async function promptAsync(request: Request, sessionID: string): Promise<Response> {
    const parsed = await parse(request)
    if (!parsed.ok) return parsed.response
    const ctx = captureContext()
    void run(ctx, sessionID, parsed.body).catch((error) => {
      log.warn("async prompt failed", { sessionID, error })
    })
    return new Response(null, { status: 204, headers: { "content-type": "application/json" } })
  }
}
