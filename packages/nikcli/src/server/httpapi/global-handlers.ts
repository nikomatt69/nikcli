import type { InstanceLessDispatch } from "./instance-less"
import { UsersHttp } from "./users"

/**
 * Raw (non schema-encoded) handlers for the instance-less roots.
 *
 * `/user` sits outside the OpenAPI surface because its shared `{ error }` body
 * across statuses cannot round-trip the HttpApi error encoder. `/account` is
 * now on `PublicApi` via `ContractExtraHttpApi.AccountGroup` (H4 landed the
 * shape; the handlers stay raw for the same encode-error reason). With the
 * account path on the encoded router, the `/account` entry here is `undefined`
 * so it falls through to that group, and `/global` is served by the encoded
 * router directly.
 *
 * `undefined` means "no raw handler; fall through to the encoded router".
 *
 * Two dispatchers use this — `HttpApiBridge.handleGlobal` and
 * `PublicRoutes.globalRequest`. Until `/user` joins the encoded router, they
 * share one table rather than two copies that can disagree. It lives here and
 * not in `instance-less.ts` so that `server.ts` and `server-router.ts`, which
 * need only the path predicate, do not pull `UsersHttp` into their module
 * graph.
 *
 * Declared as a full `InstanceLessDispatch` record: adding a root to
 * `INSTANCE_LESS_ROOTS` fails `bun run typecheck` here until it says what
 * answers it.
 */
export const rawGlobalHandlers: InstanceLessDispatch = {
  "/global": undefined,
  "/user": (request) => UsersHttp.handle(request),
  "/account": undefined,
}
