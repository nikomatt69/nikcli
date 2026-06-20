## TUI modularization & dedupe

Split the TUI mega-components and standardize session-scoped caches.

> Imported from opencode `specs/05-modularize-and-dedupe.md`, re-scoped to nikcli's TUI
> (`packages/nikcli`). opencode splits `packages/app/src/pages/{session,layout}.tsx` and
> `prompt-input.tsx`; nikcli's equivalents are the largest files under `src/cli/cmd/tui`.

---

### Summary

A handful of TUI files combine rendering, state, effects, persistence, and SDK wiring in one
unit, which makes the perf work in specs 01–04 risky to land. We will extract focused
modules (view / controller / services) from the worst offenders without changing user-facing
behavior, and introduce a shared session-scoped cache utility to replace ad-hoc per-session maps.

---

### Goals

- Reduce complexity in the biggest TUI files so eviction/throttling/virtualization land in
  isolated modules.
- Provide one `createScopedCache` utility for session-bound state (used by specs 02 and 04).
- No user-facing behavior change from the refactor itself.

### Non-goals

- Rewriting routing or the Solid reactivity model.
- One big-bang refactor — every extraction is its own reviewable change.

---

### Current state (file sizes, `wc -l` under `src/cli/cmd/tui`)

- `routes/session/index.tsx` — **3534** LOC (rendering for every message + part kind, scroll,
  navigation, revert UI, exports).
- `component/prompt/index.tsx` — **2323** LOC (composer, voice, paste/image, history nav,
  submit, footer/status, ads).
- `component/dialog-opentui-viz.tsx` — **2290** LOC.
- `component/dialog-analytics.tsx` — **1671**; `util/analytics-aggregator.ts` — **1499**.
- `app.tsx` — **1409**; `context/theme.tsx` — **1322**; `routes/github/index.tsx` — **1305**.

### Evidence

- File-size census above; `routes/session/index.tsx` and `component/prompt/index.tsx` are the two
  files that specs 01–04 must touch, so they are the priority for extraction.

---

### Proposed approach

#### 1) Shared scoped-cache utility

New `src/cli/cmd/tui/util/scoped-cache.ts`:

```ts
type ScopedOpts = { maxEntries?: number; ttlMs?: number }
function createScopedCache<T>(create: (sessionID: string) => T, opts?: ScopedOpts) {
  // get(id) (get-or-create), peek(id), delete(id), clear(), dispose hooks
}
```

This is the get-or-create/dispose layer over the eviction primitive from
`02-tui-cache-eviction.md` (`lru-cache.ts`), so both specs share one implementation.

#### 2) Extract `routes/session/index.tsx`

Split into a shallow folder, keeping the route export stable:

- `session/view.tsx` — layout shell + scrollbox wiring.
- `session/message-list.tsx` — the `<For each>` (consumes `message-window.ts` from spec 04).
- `session/parts/*.tsx` — per-part renderers (text, diff, tool, diagnostics, web-search) moved
  out of the 3.5k-line file one kind at a time.
- `session/revert.tsx` — revert/unrevert UI.

#### 3) Extract `component/prompt/index.tsx`

- `prompt/use-composer.ts` — draft/parts/submit state machine (consumes `history`, `stash`).
- `prompt/voice.ts` — the Swift/ffmpeg recorder + transcription helpers (already self-contained).
- `prompt/paste.ts` — paste/image handling (`pasteText`/`pasteImage`, consumes spec 01 blobs).
- `prompt/footer.tsx` — the status/agent/model/goal row (presentational).

#### 4) Adopt the shared cache

Replace ad-hoc per-session maps (e.g. `syncedSessions`, scattered `Map<sessionID, …>`) with
`createScopedCache` one call site at a time, behind flag `tui.scopedCacheShared`.

---

### Phased implementation steps

1. Add `scoped-cache.ts` (over `lru-cache.ts`) + unit tests; unused at first.
2. Extract `prompt/voice.ts` and `prompt/paste.ts` (lowest-risk, already cohesive).
3. Extract `session/parts/*` renderers one kind per PR (pure move, no logic change).
4. Extract `session/message-list.tsx` and integrate spec 04 windowing.
5. Adopt `createScopedCache` at remaining ad-hoc cache sites behind the flag.
6. Remove duplicated patterns after one release cycle of confidence.

---

### Backward compatibility

- Keep the route/component public exports stable so importers don't change.
- No persisted schema changes; if any internal cache key changes, keep a compat reader one cycle.

---

### Risk + mitigations

- Refactors silently change focus/keyboard/scroll behavior → extract without logic changes first;
  verify against the manual regression checklist below before any behavior tweak.
- Module-level state hidden in the big files → audit for top-level singletons before moving.
- Solid reactivity needs some code to stay synchronous → keep extracted controllers synchronous
  where they feed signals.

---

### Validation plan

- `bun run typecheck` exit 0 after each extraction (project uses `tsgo`).
- Targeted tests still green: `bun test` for prompt/session-related suites; capture exit code.
- Manual regression checklist per extraction: compose + attach image + submit + recall history;
  navigate between sessions (no cache bleed across IDs); voice record; scroll a long session;
  file autocomplete still works.
- Size check: `wc -l routes/session/index.tsx component/prompt/index.tsx` trends down (targets:
  `session/index.tsx` < ~1200 LOC for the route shell, `prompt/index.tsx` < ~1000 LOC).

---

### Rollout plan

- Introduce `createScopedCache` unused, adopt in one low-risk area.
- Extract submodules with no behavior change (mechanical PRs).
- Flip remaining scoped caches to the shared utility behind `tui.scopedCacheShared`.
- Remove old duplicated implementations after confidence.

---

### Open questions

- Which large files hold module-level singletons that need special handling on extraction?
- What are the agreed LOC targets per extracted module?
- Which extracted controllers must remain synchronous for Solid reactivity?
