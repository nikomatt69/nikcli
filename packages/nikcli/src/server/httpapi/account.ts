import type { JsonValue } from "@/util/json"
import { Effect } from "effect"
import z from "zod"
import { Account } from "@/account"
import type { DeviceCode } from "@/account/schema"
import { runPromiseWithLayer } from "@/effect"
import { errorMessage } from "@nikcli-ai/util/error-format"
import { Auth } from "./auth"

/**
 * Instance-less `/account/*` handlers for the browser sign-in flow.
 *
 * Raw `Response` handlers for the same reason as `/user/*`: the flow has eight
 * tagged error cases that a dialog only ever renders as one string, and the
 * `HttpApi` error encoder discriminates by value, so eight schemas sharing one
 * body shape cannot round-trip. Account state is global — no project directory
 * is bound here, which is why `runPromiseWithLayer` runs without
 * `withCurrentInstance`, exactly as the terminal used to.
 */
export namespace AccountHttp {
  const CompleteInput = z.object({
    deviceCode: z.string(),
    expiresIn: z.number().optional(),
  })

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }

  function runAccount<A, E>(effect: Effect.Effect<A, E, Account.Service>): Promise<A> {
    return runPromiseWithLayer(Account.defaultLayer, effect)
  }

  async function readJson(request: Request): Promise<JsonValue | undefined> {
    try {
      return await request.json()
    } catch {
      return undefined
    }
  }

  /**
   * The signed-in account, or `null`.
   *
   * `null` and not 401 for an unauthenticated caller: "who is signed in" and
   * "nobody is" are the same answer to a dialog, and the terminal asks this on
   * mount, before any sign-in has happened. The bearer check exists because
   * this route carries an email address and the server can be listening on a
   * port — in process, nothing was reachable to ask.
   */
  async function active(request: Request): Promise<Response> {
    const principal = await Auth.resolveBearer(request).catch(() => undefined)
    if (principal?.type !== "user") return json(null)

    const info = await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        return yield* account.active()
      }),
    )
    return json(info ?? null)
  }

  async function login(): Promise<Response> {
    try {
      const result = await runAccount(
        Effect.gen(function* () {
          const account = yield* Account.Service
          return yield* account.login()
        }),
      )
      return json(result)
    } catch (cause) {
      return json({ error: errorMessage(cause) }, 502)
    }
  }

  /**
   * Wait for the browser approval and hand back the issuer session.
   *
   * Deliberately stops there. The access token *is* the bearer — `identity-auth`
   * provisions the local user from it on the first authenticated request — so
   * minting a second `nku_` session here would create a parallel identity for
   * the same person. The terminal stores the token and asks `GET /user/me`.
   *
   * `email` rides along because the toast names it and the caller would
   * otherwise need a second round trip for a string it has no other use for.
   *
   * The request blocks until the user approves, refuses, or the code expires.
   * A client that walks away aborts its own request; the poll here still runs
   * until the device code lapses, which is bounded and harmless.
   */
  async function complete(request: Request): Promise<Response> {
    const parsed = CompleteInput.safeParse(await readJson(request))
    if (!parsed.success) return json({ error: "Invalid device code payload" }, 400)

    try {
      const session = await runAccount(
        Effect.gen(function* () {
          const account = yield* Account.Service
          return yield* account.poll(parsed.data.deviceCode as DeviceCode, {
            expiresIn: parsed.data.expiresIn,
          })
        }),
      )
      const info = await runAccount(
        Effect.gen(function* () {
          const account = yield* Account.Service
          return yield* account.get(session.accountID)
        }),
      )

      return json({
        accountID: session.accountID,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
        email: info?.email ?? null,
      })
    } catch (cause) {
      return json({ error: errorMessage(cause) }, 502)
    }
  }

  /** Route an instance-less `/account/*` request. Returns null when unmatched. */
  export async function handle(request: Request): Promise<Response | null> {
    const pathname = new URL(request.url).pathname
    const method = request.method.toUpperCase()

    if (method === "GET" && pathname === "/account") return active(request)
    if (method === "POST" && pathname === "/account/login") return login()
    if (method === "POST" && pathname === "/account/login/complete") return complete(request)

    return null
  }
}
