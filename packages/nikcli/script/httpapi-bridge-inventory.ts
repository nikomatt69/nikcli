/**
 * Prints HttpApiBridge.supports() for paths called out in specs/httpapi-bridge-inventory.md.
 * Run: bun run script/httpapi-bridge-inventory.ts
 */
import { HttpApiBridge } from "../src/server/httpapi/bridge.ts"

type Case = { method: string; path: string; expect: boolean; note?: string }

const cases: Case[] = [
  { method: "GET", path: "/event", expect: true, note: "SSE special" },
  {
    method: "POST",
    path: "/session/ses_test/message",
    expect: true,
    note: "prompt special",
  },
  { method: "POST", path: "/session/ses_test/prompt_async", expect: true },
  { method: "GET", path: "/session/ses_test/v2/entries", expect: true },
  { method: "GET", path: "/session/ses_test/v2/state", expect: true },
  { method: "GET", path: "/session/ses_test/v2/events", expect: true },
  { method: "POST", path: "/tui/append-prompt", expect: true },
  { method: "GET", path: "/tui/control/next", expect: true },
  {
    method: "GET",
    path: "/session/ses_test/instructions",
    expect: false,
    note: "Hono-only",
  },
  { method: "GET", path: "/session/ses_test/background", expect: false },
  { method: "GET", path: "/loop", expect: true, note: "loop HttpApi" },
  { method: "POST", path: "/loop/loop_1/abort", expect: true },
  { method: "GET", path: "/mission", expect: false },
  { method: "GET", path: "/pty", expect: false, note: "pty + WS" },
  { method: "GET", path: "/vcs/status", expect: false },
  { method: "POST", path: "/sync/start", expect: false, note: "planned" },
]

let failed = 0
for (const c of cases) {
  const got = HttpApiBridge.supports(c.path, c.method)
  const ok = got === c.expect
  if (!ok) failed++
  const mark = ok ? "ok" : "FAIL"
  const suffix = c.note ? ` (${c.note})` : ""
  console.log(`${mark} ${c.method} ${c.path} => ${got}${suffix}`)
}

if (failed > 0) {
  console.error(`\n${failed} mismatch(es)`)
  process.exit(1)
}

console.log(`\n${cases.length} checks passed`)
