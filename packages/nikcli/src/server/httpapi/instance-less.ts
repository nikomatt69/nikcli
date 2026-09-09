/**
 * Which paths are served **without** an instance bound?
 *
 * Four places decide this — `HttpApiBridge` (`handleGlobal`), `Server.fallback`,
 * `ServerRouter.dispatch`'s `global` test, and `PublicRoutes.globalRequest`.
 * They have to agree, and until this table existed nothing checked that they
 * did: `/global/` and `/user/` were spelled out in all four, so adding a root
 * meant remembering four edits, and forgetting one sends the request down the
 * instance branch where it 404s with no directory bound. That failure reads as
 * a legitimate "not found", so nothing reports it.
 *
 * The bare path is the case a `startsWith("/account/")` test silently gets
 * wrong — `GET /account` is a route, `GET /account/` is not. Every root here
 * claims both its bare path and its subtree.
 *
 * This is the routing decision only. Which handler answers (`UsersHttp`,
 * `AccountHttp`, the encoded router) stays at the call site.
 */
// `/instance` holds one route — `POST /instance/dispose` — and it is here for a reason the other
// three do not share: a request served *inside* an instance scope cannot await the destruction of
// that scope. The handler's own fiber runs on the instance runtime `Instance.dispose` tears down, so
// disposing from within interrupted the responder and the endpoint answered 500 (H11). Served
// without an instance bound, the disposal can be awaited and the 200 means what it says.
const INSTANCE_LESS_ROOTS = ["/global", "/user", "/account", "/instance"] as const

export type InstanceLessRoot = (typeof INSTANCE_LESS_ROOTS)[number]

function claims(root: string, pathname: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`)
}

/** Does this path skip the instance/workspace middleware? */
export function isInstanceLessPath(pathname: string): boolean {
  return INSTANCE_LESS_ROOTS.some((root) => claims(root, pathname))
}

/** Which root claims this path, if any. */
export function instanceLessRoot(pathname: string): InstanceLessRoot | undefined {
  return INSTANCE_LESS_ROOTS.find((root) => claims(root, pathname))
}

/** Does this path belong to the instance-less `/account` handlers? */
export function isAccountPath(pathname: string): boolean {
  return claims("/account", pathname)
}

/**
 * A raw (non schema-encoded) handler for one root, or `undefined` when that
 * root is served by the encoded router.
 *
 * Declaring the dispatch table as a full `Record` is what makes adding a root
 * one edit: a new entry in `INSTANCE_LESS_ROOTS` fails `bun run typecheck` at
 * every dispatcher until that dispatcher says what answers it.
 */
export type InstanceLessDispatch = Record<
  InstanceLessRoot,
  ((request: Request) => Promise<Response | null | undefined>) | undefined
>

/** The roots, for tests and coverage scripts. Do not branch on this at runtime. */
export function instanceLessRoots(): readonly InstanceLessRoot[] {
  return INSTANCE_LESS_ROOTS
}

/**
 * The directory a request names, before any workspace or session resolution.
 *
 * Lives here rather than in `server-router.ts` because the instance-less `POST /instance/dispose`
 * handler needs it, and importing the router into an httpapi group closes an initialization cycle
 * (`top-level` → `server-router` → … → `public` → `top-level`), which surfaces as
 * "Cannot access 'PublicApi' before initialization". This module imports nothing, so it cannot.
 *
 * `ServerRouter.context` uses the same function, so the rule has one definition.
 */
export function requestedDirectory(request: Request, parsed?: URL): string {
  const url = parsed ?? new URL(request.url)
  const raw = url.searchParams.get("directory") || request.headers.get("x-nikcli-directory") || process.cwd()
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
