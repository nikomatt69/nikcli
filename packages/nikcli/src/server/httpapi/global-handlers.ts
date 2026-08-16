import { AccountHttp } from "./account"
import type { InstanceLessDispatch } from "./instance-less"
import { UsersHttp } from "./users"

/**
 * Raw (non schema-encoded) handlers for the instance-less roots.
 *
 * `/user` and `/account` sit outside the OpenAPI surface and reuse one
 * `{ error }` body across statuses — eight tagged login errors for `/account` —
 * which the HttpApi error encoder cannot discriminate, so they answer ahead of
 * the router. `/global` has no raw handler: its one special case is the
 * `/global/event` SSE stream, which each dispatcher serves before consulting
 * this table because it is not a handler-shaped response.
 *
 * `undefined` means "no raw handler; fall through to the encoded router".
 *
 * Two dispatchers use this — `HttpApiBridge.handleGlobal` and
 * `PublicRoutes.globalRequest`. They are the two live serving stacks roadmap H4
 * exists to collapse; until it does, they share one table rather than two
 * copies that can disagree. It lives here and not in `instance-less.ts` so that
 * `server.ts` and `server-router.ts`, which need only the path predicate, do not
 * pull `UsersHttp` and `AccountHttp` into their module graph.
 *
 * Declared as a full `InstanceLessDispatch` record: adding a root to
 * `INSTANCE_LESS_ROOTS` fails `bun run typecheck` here until it says what
 * answers it.
 */
export const rawGlobalHandlers: InstanceLessDispatch = {
  "/global": undefined,
  "/user": (request) => UsersHttp.handle(request),
  "/account": (request) => AccountHttp.handle(request),
}
