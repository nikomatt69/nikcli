# Route handler effectification

Practical reference for converting server route handlers in `packages/nikcli` to a single `AppRuntime.runPromise(Effect.gen(...))` body.

## Goal

Route handlers should wrap their entire body in a single `AppRuntime.runPromise(Effect.gen(...))` call, yielding services from context rather than calling facades one-by-one.

This eliminates multiple `runPromise` round-trips and lets handlers compose naturally.

```ts
// Before - one facade call per service
;async (c) => {
  await SessionRunState.assertNotBusy(id)
  await LegacySession.removeMessage({ sessionID: id, messageID })
  return c.json(true)
}

// After - one Effect.gen, yield services from context
;async (c) => {
  await AppRuntime.runPromise(
    Effect.gen(function* () {
      const state = yield* SessionRunState.Service
      const session = yield* Session.Service
      yield* state.assertNotBusy(id)
      yield* session.removeMessage({ sessionID: id, messageID })
    }),
  )
  return c.json(true)
}
```

## Rules

- Wrap the whole handler body in one `AppRuntime.runPromise(Effect.gen(...))` call when the handler is service-heavy.
- Yield services from context instead of calling async facades repeatedly.
- When independent service calls can run in parallel, use `Effect.all(..., { concurrency: "unbounded" })`.
- Prefer one composed Effect body over multiple separate `runPromise(...)` calls in the same handler.

## Current route files

Current branch audit, 2026-05-06:

- `src/server/routes/instance/*` does not exist on this branch.
- Current route files live under `src/server/routes/*.ts` plus top-level route handlers in `src/server/server.ts`.
- The old `server/routes/instance/*` checklist below is replaced by the current branch checklist. Do not mark a route file complete until the current file wraps service-heavy handlers in one composed Effect boundary and tests or typecheck cover that path.

Current branch checklist:

- [x] `server/routes/question.ts` — Hono handlers now enter `Question.Service` through one Effect boundary per handler; covered by `bun run typecheck` and `bun test test/question/effect-service.test.ts`.
- [ ] `server/routes/provider.ts` — ProviderAuth handlers now use `ProviderAuth.Service`, and credential removal now uses `Auth.Service`, through Effect boundaries; the route file is not complete yet because `GET /provider` and instance disposal still need service-boundary audit.
- [x] `server/routes/permission.ts` — Hono handlers now enter `PermissionNext.Service` through one Effect boundary per handler; covered by `bun run typecheck` and `bun test test/permission/effect-service.test.ts`.
- [ ] `server/routes/mcp.ts` — audit and convert service-heavy handlers to one Effect boundary
- [x] `server/routes/pty.ts` — HTTP handlers and websocket callbacks now enter `Pty.Service` through Effect boundaries; covered by `bun run typecheck` and `bun test test/pty/effect-service.test.ts`.
- [ ] `server/routes/session.ts` — session CRUD/message/share handlers now enter `Session.Service`, and status/todo/prompt/summary/revert/compaction handlers enter their Effect services; the route file remains open because it is still a Hono implementation and the broader HttpApi replacement is tracked in `http-api.md`.
- [ ] `server/routes/file.ts` — audit direct filesystem/search bridges and service boundaries
- [ ] `server/routes/experimental.ts` — `/tool/ids` and `/tool` now enter `ToolRegistry.Service`, and worktree create/remove/reset handlers now enter `Worktree.Service`, through Effect boundaries; the route file is not complete yet because other handlers still need direct `Instance.*` and service-boundary audit.
- [ ] `server/routes/global.ts` — still uses global lifecycle and streaming paths
- [ ] `server/server.ts` — command, skill, VCS, Format, and auth set/remove endpoints now enter Effect services through Effect boundaries; the file remains open because other top-level handlers still need direct `Instance.*` and service-boundary audit.
- [ ] `server/routes/mobile.ts` — mobile session create/detail/message/publish/cleanup/rename flows now enter `Session.Service`, plus command/status/worktree flows use Effect service boundaries; the route file remains open because it still has legacy boundary code such as `Instance.provide(...)`.

## Notes

- Route conversion is now less about facade removal and more about removing the remaining direct `Instance.*` reads, `Instance.provide(...)` boundaries, and small Promise-style bridges inside route files.
- `jsonRequest(...)` / `runRequest(...)` already provide a good intermediate shape for many handlers. The remaining cleanup is mostly consistency work in the heavier files.
