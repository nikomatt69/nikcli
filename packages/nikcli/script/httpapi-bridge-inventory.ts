/**
 * Prints HttpApiBridge.supports() (and supportsGlobal) for paths called out
 * in `specs/httpapi-bridge-inventory.md`. Run with
 * `bun run script/httpapi-bridge-inventory.ts`.
 */
import { HttpApiBridge } from "../src/server/httpapi/bridge.ts"

type Case = {
  method: string
  path: string
  expect: boolean
  note?: string
  scope?: "main" | "global"
}

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
    expect: true,
    note: "SessionHttpApi",
  },
  {
    method: "GET",
    path: "/session/ses_test/background",
    expect: true,
    note: "SessionHttpApi",
  },
  { method: "GET", path: "/loop", expect: true, note: "loop HttpApi" },
  { method: "POST", path: "/loop/loop_1/abort", expect: true },
  {
    method: "GET",
    path: "/mission",
    expect: true,
    note: "MissionHttpApi (closed 2026-07-08)",
  },
  {
    method: "GET",
    path: "/pty",
    expect: true,
    note: "PtyHttpApi (Wave 4 Path B)",
  },
  { method: "POST", path: "/pty", expect: true, note: "PtyHttpApi (create)" },
  { method: "GET", path: "/pty/pty_1", expect: true, note: "PtyHttpApi (get)" },
  {
    method: "PUT",
    path: "/pty/pty_1",
    expect: true,
    note: "PtyHttpApi (update)",
  },
  {
    method: "DELETE",
    path: "/pty/pty_1",
    expect: true,
    note: "PtyHttpApi (remove)",
  },
  {
    method: "GET",
    path: "/vcs/status",
    expect: true,
    note: "vcsStatus (TopLevelHttpApi)",
  },
  {
    method: "POST",
    path: "/sync/start",
    expect: true,
    note: "SyncHttpApi (Wave 4)",
  },
  {
    method: "POST",
    path: "/sync/replay",
    expect: true,
    note: "SyncHttpApi (replay push)",
  },
  {
    method: "GET",
    path: "/sync/history",
    expect: true,
    note: "SyncHttpApi (outbox)",
  },
  {
    method: "GET",
    path: "/sync/snapshot",
    expect: true,
    note: "SyncHttpApi (snapshot)",
  },
  // Wave 3a — JSON parity for groups added in 2026-07.
  { method: "GET", path: "/brain", expect: true, note: "BrainHttpApi" },
  { method: "POST", path: "/brain/trigger", expect: true },
  { method: "GET", path: "/connectors", expect: true },
  {
    method: "POST",
    path: "/connectors/git/auth",
    expect: true,
    note: "ConnectorsHttpApi",
  },
  {
    method: "POST",
    path: "/connectors/invalidate",
    expect: true,
    note: "ConnectorsHttpApi",
  },
  {
    method: "POST",
    path: "/chatbot/discord/notify",
    expect: true,
    note: "ChatbotHttp special",
  },
  // Wave 3a: managed-worktree (CoW experimental engine)
  { method: "POST", path: "/experimental/managed-worktree", expect: true },
  {
    method: "DELETE",
    path: "/experimental/managed-worktree",
    expect: true,
    note: "managed-worktree.remove",
  },
  {
    method: "POST",
    path: "/experimental/managed-worktree/link",
    expect: true,
    note: "managed-worktree.link",
  },
  {
    method: "GET",
    path: "/experimental/managed-worktree/children",
    expect: true,
    note: "managed-worktree.children",
  },
  {
    method: "GET",
    path: "/experimental/managed-worktree/ancestors",
    expect: true,
    note: "managed-worktree.ancestors",
  },
  { method: "GET", path: "/experimental/managed-worktree", expect: true },
  // Wave 3b: app-scoped JSON mutations (POST /log, POST /skill, DELETE /skill/:name).
  { method: "POST", path: "/log", expect: true, note: "app.log" },
  {
    method: "POST",
    path: "/skill",
    expect: true,
    note: "app.skill.create (see httpapi/app.ts)",
  },
  {
    method: "DELETE",
    path: "/skill/test-skill",
    expect: true,
    note: "app.skill.delete (see httpapi/app.ts)",
  },
  // Wave 3a: /user/* lives in globalRoutes (instance-less branch).
  {
    method: "POST",
    path: "/user/register",
    expect: true,
    note: "UsersHttp global branch",
    scope: "global",
  },
  {
    method: "GET",
    path: "/user/status",
    expect: true,
    scope: "global",
  },
  {
    method: "PATCH",
    path: "/user/usr_1",
    expect: true,
    scope: "global",
  },
]

let failed = 0
for (const c of cases) {
  const fn = c.scope === "global" ? HttpApiBridge.supportsGlobal : HttpApiBridge.supports
  const got = fn(c.path, c.method)
  const ok = got === c.expect
  if (!ok) failed++
  const mark = ok ? "ok" : "FAIL"
  const suffix = c.note ? ` (${c.note})` : ""
  const scope = c.scope ? ` [${c.scope}]` : ""
  console.log(`${mark}${scope} ${c.method} ${c.path} => ${got}${suffix}`)
}

if (failed > 0) {
  console.error(`\n${failed} mismatch(es)`)
  process.exit(1)
}

console.log(`\n${cases.length} checks passed`)
