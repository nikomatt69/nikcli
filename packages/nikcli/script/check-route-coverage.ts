/**
 * Diff Hono `Server.App().routes` against `HttpApiBridge.listImplemented()`.
 *
 * Default mode (advisory): print uncovered Hono API routes and exit 0.
 * `--strict`: exit 1 when any non-excluded Hono route lacks bridge support.
 *
 * Always fails when a bridge pattern's sample path does not match
 * `supports` / `supportsGlobal` (bridge table regression).
 *
 * Usage:
 *   bun run script/check-route-coverage.ts
 *   bun run script/check-route-coverage.ts --strict
 */
import { HttpApiBridge } from "../src/server/httpapi/bridge.ts"
import { Server } from "../src/server/server.ts"

const strict = process.argv.includes("--strict")

/** Paths that stay on Hono-only (share pages, middleware, sync legacy, WS/SSE, etc.). */
const EXCLUDE_PREFIXES = [
  "/s/",
  "/share/",
  "/api/share/",
  "/doc",
  "/companion",
  "/mobile",
  "/sync",
  "/websocket",
  "/ws",
]

/** Exact method+path templates that are intentional Hono specials / dual-mounted. */
const EXCLUDE_EXACT = new Set([
  // WebSocket upgrade — see ServerBackend.honoDeletionGroups pty-websocket
  "GET /pty/:ptyID/connect",
  // SSE / streaming experimental workspace events
  "GET /experimental/workspace/:id/events",
  // Config profiles are bridged at /profiles (not /config/profiles)
  "GET /config/profiles",
  "POST /config/profiles",
  "POST /config/profiles/activate/:name",
  // Legacy provider credential store — contract-extra only; not in bridge allowlist yet
  "PUT /auth/:providerID",
  "DELETE /auth/:providerID",
])

function isExcluded(path: string, method = "GET"): boolean {
  if (path === "/*" || path === "*") return true
  if (EXCLUDE_EXACT.has(`${method.toUpperCase()} ${path}`)) return true
  return EXCLUDE_PREFIXES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix))
}

function concreteFromHono(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "x").replace(/\*/g, "x")
}

const bridge = HttpApiBridge.listImplemented()
let bridgeFailures = 0
for (const route of bridge) {
  const sample = HttpApiBridge.samplePathFor(route.pattern)
  const ok =
    route.scope === "global"
      ? HttpApiBridge.supportsGlobal(sample, route.method)
      : HttpApiBridge.supports(sample, route.method)
  if (!ok) {
    bridgeFailures++
    console.error(`FAIL bridge ${route.method} ${route.pattern} sample=${sample}`)
  }
}

const app = Server.App()
const seen = new Set<string>()
const uncovered: string[] = []

for (const route of (app as { routes: Array<{ method: string; path: string }> }).routes) {
  if (route.method === "ALL") continue
  if (isExcluded(route.path, route.method)) continue
  const key = `${route.method.toUpperCase()} ${route.path}`
  if (seen.has(key)) continue
  seen.add(key)

  const sample = concreteFromHono(route.path)
  const supported = HttpApiBridge.supports(sample, route.method) || HttpApiBridge.supportsGlobal(sample, route.method)
  if (!supported) uncovered.push(key)
}

console.log(`bridge patterns: ${bridge.length} (${bridgeFailures} sample failures)`)
console.log(`hono api routes checked: ${seen.size}`)
console.log(`hono without bridge support: ${uncovered.length}`)
if (uncovered.length > 0) {
  const preview = uncovered.slice(0, 40)
  for (const line of preview) console.log(`  gap ${line}`)
  if (uncovered.length > preview.length) console.log(`  ... +${uncovered.length - preview.length} more`)
}

if (bridgeFailures > 0) {
  process.exit(1)
}
if (strict && uncovered.length > 0) {
  console.error(`\n--strict: ${uncovered.length} uncovered Hono route(s)`)
  process.exit(1)
}

console.log(strict ? "\nstrict coverage ok" : "\nadvisory coverage ok (pass --strict to fail on gaps)")
