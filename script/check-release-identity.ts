#!/usr/bin/env bun

export {} // mark as module so top-level await is allowed

/**
 * check-release-identity.ts — turns a detached upload into a release decision.
 *
 * `railway up --detach` exits 0 when the *upload* is accepted. It says nothing about whether the
 * image built, whether the container started, or whether the instance answering traffic is the one
 * that just passed validation. The package version cannot settle it either: two uploads of the same
 * release both report `1.330.0`, and so does the older container that never got replaced.
 *
 * So the identity that is compared here is the commit, baked into the binary at compile time
 * (`NIKCLI_REVISION` → `@nikcli-ai/util/version`) and served on the already-public
 * `GET /global/health`. This script waits a bounded time for the observed revision to equal the
 * expected one, and treats anything else — unhealthy, absent revision, a different revision still
 * serving when the deadline passes — as a failed release, not as a pending one.
 *
 * Three failure shapes it is meant to catch, all of which used to look like a green deploy:
 *   1. The image never built. The old container keeps answering with the old revision.
 *   2. The upload landed on the wrong service or environment. Same symptom, different cause.
 *   3. The instance is older than this check itself, so `revision` is absent from health.
 *
 * Usage:
 *   bun run script/check-release-identity.ts --url https://host [--expect <sha>] [--timeout 600]
 *
 * `--expect` defaults to NIKCLI_REVISION, then to the current git HEAD.
 */

interface Observation {
  at: number
  status: "unreachable" | "http-error" | "unparseable" | "unhealthy" | "no-revision" | "revision"
  detail: string
}

function arg(name: string): string | undefined {
  const flag = `--${name}`
  const index = process.argv.indexOf(flag)
  if (index !== -1 && index + 1 < process.argv.length) return process.argv[index + 1]
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`))
  return inline?.slice(flag.length + 1)
}

function seconds(name: string, fallback: number): number {
  const raw = arg(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number of seconds`)
  return value
}

const base = (arg("url") ?? process.env["NIKCLI_HEALTH_URL"] ?? "").trim().replace(/\/+$/, "")
if (!base) {
  console.error("✗ No health URL. Pass --url https://host or set NIKCLI_HEALTH_URL.")
  process.exit(2)
}

const expected = await (async () => {
  const explicit = (arg("expect") ?? process.env["NIKCLI_REVISION"] ?? "").trim()
  if (explicit) return explicit
  try {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" })
    const out = (await new Response(proc.stdout).text()).trim()
    return (await proc.exited) === 0 ? out : ""
  } catch {
    // No git, or not a checkout. An absent expectation is reported below, not guessed at.
    return ""
  }
})()

if (!expected) {
  console.error("✗ No expected revision. Pass --expect <sha>, set NIKCLI_REVISION, or run in a git checkout.")
  process.exit(2)
}

const timeoutSeconds = seconds("timeout", 600)
const intervalSeconds = seconds("interval", 10)
const healthUrl = `${base}/global/health`

console.log(`→ Expecting revision ${expected}`)
console.log(`→ Probing ${healthUrl} for up to ${timeoutSeconds}s (every ${intervalSeconds}s)`)

/** One probe. Never throws: an unreachable host mid-rollout is an observation, not a crash. */
async function probe(): Promise<Observation> {
  const at = Date.now()
  let response: Response
  try {
    response = await fetch(healthUrl, {
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    return { at, status: "unreachable", detail: error instanceof Error ? error.message : String(error) }
  }
  if (!response.ok) return { at, status: "http-error", detail: `HTTP ${response.status}` }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { at, status: "unparseable", detail: "response body is not JSON" }
  }

  const record = body as { healthy?: unknown; version?: unknown; revision?: unknown }
  if (record.healthy !== true) return { at, status: "unhealthy", detail: JSON.stringify(body).slice(0, 200) }

  const version = typeof record.version === "string" ? record.version : "unknown"
  if (typeof record.revision !== "string" || record.revision.length === 0) {
    // Not a contract violation: `revision` is optional precisely so a current probe can read an
    // instance that predates it. It does mean the upload has not replaced that instance yet.
    return { at, status: "no-revision", detail: `version=${version} (instance predates revision identity)` }
  }
  return { at, status: "revision", detail: `${record.revision} version=${version}` }
}

const deadline = Date.now() + timeoutSeconds * 1_000
let last: Observation | undefined
let attempts = 0

while (true) {
  attempts++
  const observation = await probe()
  last = observation

  if (observation.status === "revision") {
    const observed = observation.detail.split(" ")[0]!
    if (observed === expected) {
      const elapsed = Math.round((Date.now() - (deadline - timeoutSeconds * 1_000)) / 1_000)
      console.log(`  ✓ observed ${observation.detail} after ${elapsed}s (${attempts} probes)`)
      console.log(`✓ Release identity matches: ${expected}`)
      process.exit(0)
    }
    console.log(`  · still serving ${observation.detail} — waiting for ${expected}`)
  } else {
    console.log(`  · ${observation.status}: ${observation.detail}`)
  }

  if (Date.now() + intervalSeconds * 1_000 >= deadline) break
  await Bun.sleep(intervalSeconds * 1_000)
}

console.error(`✗ Release identity not confirmed within ${timeoutSeconds}s (${attempts} probes)`)
console.error(`  expected: ${expected}`)
console.error(`  last observed: ${last ? `${last.status} — ${last.detail}` : "nothing"}`)
console.error("  A detached upload that is never confirmed is a failed release, not a pending one.")
process.exit(1)
