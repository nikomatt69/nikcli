import { Effect, Layer } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import { Auth } from "./auth"

/**
 * Authentication as part of the HttpApi contract (H8).
 *
 * Before this, security lived entirely outside the contract: `ServerRouter`
 * authenticated every request imperatively and the bridge repeated the check
 * for direct callers, so OpenAPI could not describe a scheme and a new encoded
 * group was protected only by remembering to route it through the router.
 * Attaching this middleware to a group makes protection a property of the
 * declaration — an endpoint added to a protected group is protected by
 * construction, and the generated OpenAPI says so.
 *
 * **This does not re-implement the acceptance order.** `Auth.authenticate`
 * stays the single implementation of it (identity JWT → capability token →
 * legacy credentials, plus open mode and Tailscale). The middleware is the
 * seam that makes the contract aware of it, not a second copy — which is why
 * it reads the raw `Request` rather than the decoded credential.
 */
export namespace HttpApiAuth {
  /**
   * The credential sources the server accepts, declared so OpenAPI can name
   * them. All three are implemented by the same delegate below: the decoded
   * credential is deliberately ignored, because `Auth.authenticate` reads the
   * request itself and accepts combinations no single scheme describes (a
   * Tailscale identity header, or open mode with no credential at all).
   *
   * Effect tries the schemes in declaration order and stops at the first that
   * does not fail. The delegate answers an unauthorized *response* instead of
   * failing (see `authorize`), so the first entry always decides and the other
   * two never run.
   */
  const bearer = HttpApiSecurity.bearer
  const queryToken = HttpApiSecurity.apiKey({ key: "token", in: "query" })
  const basic = HttpApiSecurity.basic

  export class Middleware extends HttpApiMiddleware.Service<Middleware>()("nikcli/HttpApiAuth", {
    security: { bearerAuth: bearer, auth_token: queryToken, basicAuth: basic },
  }) {}

  /**
   * Run the endpoint if the request is authorized, otherwise answer the
   * response `Auth.authenticate` produced.
   *
   * Returning that `Response` verbatim rather than failing with a declared
   * error schema is deliberate, on two counts. It keeps the 401 wire exactly
   * as it is today — a `text/plain` body and, for the Basic path, the
   * `WWW-Authenticate` challenge header — which a JSON-encoded error schema
   * would have silently replaced. And it keeps the middleware's error union
   * empty, so attaching it does not add a 401 variant to every endpoint's
   * error type in the generated clients.
   */
  const authorize = <A, E, R>(httpEffect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      // The web adapter carries the original `Request`, which is the identity
      // `Auth.remember` keys its WeakMap on.
      const source = request.source as Request

      // One authentication per request. `ServerRouter` and the bridge both
      // authenticate and then `Auth.remember` the principal before the encoded
      // router runs, so in the normal path this short-circuits and no second
      // `Auth.authenticate` is paid. `isUpstreamVerified` covers the other
      // shape of the same statement: a host that settled the question by
      // trusting its own transport rather than by identifying a caller.
      //
      // Those imperative checks stay, because they are the catch-all for what
      // the contract cannot describe — raw routes and unmatched paths have no
      // endpoint and so no middleware. What this adds is enforcement that
      // travels *with the declaration*: a caller reaching an encoded endpoint
      // without having been checked is authenticated here rather than served.
      if (Auth.principal(source) !== undefined || Auth.isUpstreamVerified(source)) return yield* httpEffect

      const result = yield* Effect.promise(() => Auth.authenticate(source, Auth.testOptions()))
      if (!result.ok) return HttpServerResponse.fromWeb(result.response)
      Auth.remember(source, result.principal)
      return yield* httpEffect
    })

  export const layer = Layer.succeed(Middleware, {
    bearerAuth: authorize,
    auth_token: authorize,
    basicAuth: authorize,
  })
}
