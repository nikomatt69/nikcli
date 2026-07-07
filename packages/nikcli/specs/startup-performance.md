# Startup performance: module-graph discipline

Audit + fixes from 2026-07-07. The TUI process was evaluating ~2600 modules at
boot (~3.5s warm in dev), most of it server-side code it never runs: every
bundled AI SDK package, drizzle + the database repos, and the full session
machinery. After the cuts below the TUI graph is ~1650 modules (~2.3s warm in
dev); the compiled binary skips the same evaluation work on demand.

## Rules

1. **Client processes (TUI) must not runtime-import server chains at module
   load.** `@/provider/provider`, `@/session`, `@/user/users`, `@/connectors`,
   `@/brain`, `@/analytics/analytics`, and anything drizzle-backed count as
   server chains. Use `import type` when only types are needed, a light shared
   module when a constant/helper is needed, or `await import(...)` inside the
   handler when the feature is actually used.
2. **Light shared primitives live in their own modules** so both sides import
   the same definition:
   - `src/provider/parse.ts` — `parseModel` (pure string parse)
   - `src/provider/fusion.ts` — `FUSION_*` constants + `fusionPreset`
   - `src/session/primitives.ts` — `SessionPrimitives` (session `ID` schema,
     `isDefaultTitle`/`createDefaultTitle`, `EventName` map that
     `session/index.ts` feeds into `BusEvent.define`, so TUI listeners cannot
     drift)
   - `src/permission/ruleset.ts` — `PermissionRuleset` (schemas + pure
     `evaluate`/`merge`/`disabled`; `PermissionNext` re-exports them)
   - `src/brain/constants.ts` — `BRAIN_SESSION_TITLE`
3. **Bundled provider SDKs load lazily.** `BUNDLED_PROVIDERS` in
   `provider/provider.ts` maps npm name → `() => Promise<factory>`; the ~20
   `@ai-sdk/*` packages (~1s eval) are imported only when a model from that
   provider is first instantiated, then cached in the existing per-instance
   sdk map. `nikcli serve` and `nikcli run` boot without evaluating any of
   them.
4. **`cli/error.ts` stays dependency-free.** It dispatches on `_tag` strings;
   it must not import the modules whose errors it formats (a dead
   `Provider`/`Agent`/`MCP`/`Config` import there pulled the whole server into
   every client via `exit.tsx`).

## How to re-audit

Import the TUI entry and inspect the loaded graph (dev mode):

```ts
await import(".../src/cli/cmd/tui/app")
const keys = Object.keys(require.cache)
// check keys for "@ai-sdk", "drizzle", "provider/provider", ...
```

To find who pulls a heavy module back in, build reverse edges over the loaded
repo files' runtime imports (`import ... from` without `type`) and BFS from the
heavy module to `app.tsx` — the session that produced this file used exactly
that script.

## Known remaining costs

- `@opentui/core` + tree-sitter WASM: ~120ms warm eval (the multi-second dev
  numbers are cold transpile, not eval).
- `routes/session/index.tsx` (3.6k lines) and `component/prompt/index.tsx` are
  genuinely needed at startup; splitting them is a refactor, not an import cut.
- Dialogs opened through handlers were made lazy where they pulled server
  chains (`dialog-skills`, `dialog-login`, `dialog-auth-manage`,
  `dialog-onboarding`, `dialog-analytics`). The rest are TUI-only and cheap.
