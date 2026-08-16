/**
 * Does this path belong to the instance-less `/account/*` handlers?
 *
 * Four places decide whether a request skips the instance middleware — the
 * bridge, `Server.fallback`, the router's `global` test, and `PublicRoutes`.
 * `/user/` is spelled out in all four and they have to agree; `/account` adds
 * the wrinkle that the bare path is a route too, so `startsWith("/account/")`
 * alone would send `GET /account` down the instance branch, where it 404s.
 * One predicate, so the four cannot drift.
 */
export function isAccountPath(pathname: string): boolean {
  return pathname === "/account" || pathname.startsWith("/account/")
}
