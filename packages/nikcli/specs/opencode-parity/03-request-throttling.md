## Request throttling

Debounce and cancel high-frequency `find.files` (and LSP refresh) calls from the TUI.

> Imported from opencode `specs/03-request-throttling.md`, re-scoped to nikcli's TUI
> (`packages/nikcli`). opencode wraps `sdk.client.find.files` in `packages/app`; nikcli's
> equivalent chokepoints are the prompt autocomplete and the tag dialog.

---

### Summary

File autocomplete in the prompt issues one `sdk.client.find.files` request per keystroke via a
Solid `createResource` keyed on the live filter string. Fast typing produces a burst of
overlapping requests whose responses can resolve out of order. We will add a small debounced +
latest-only request helper and route the file-search chokepoints through it, so only the latest
query's result is applied and empty queries never hit the server.

---

### Goals

- Collapse rapid file-search keystrokes into at most one request per debounce window.
- Guarantee stale responses never overwrite newer results (latest-only).
- Skip server calls for empty queries.
- Keep typing/selection responsive.

### Non-goals

- A global request queue for all SDK calls.
- Server-side changes or new endpoints.
- Persisting search results.

---

### Current state

- `src/cli/cmd/tui/component/prompt/autocomplete.tsx`
  - `const [files] = createResource(() => filter(), async (query) => { … await
sdk.client.find.files({ query: baseQuery }) … })` (≈ line 290–300).
  - No debounce, no `AbortController`, no monotonic request id. `createResource` re-fetches on
    every `filter()` change; ordering of applied results is not guaranteed under bursts.
- `src/cli/cmd/tui/component/dialog-tag.tsx:18` — a second, independent `find.files` call site
  with the same uncoordinated pattern.
- LSP refresh: triggered on file/session changes; no single debounced chokepoint.

### Evidence

- Grep for `find.files` in `src/cli/cmd/tui` returns exactly the two call sites above; neither
  references `debounce`/`AbortController`/request-id guarding.

---

### Proposed approach

#### 1) Debounced + latest-only helper

New `src/cli/cmd/tui/util/requests.ts`:

```ts
// drops stale results via a monotonic id; aborts the prior request when the SDK accepts a signal
function createLatestOnlyAsync<TArgs extends unknown[], R>(
  fn: (a: { input: TArgs; signal?: AbortSignal }) => Promise<R>,
) {
  /* id++ guard + AbortController */
}

function createDebouncedAsync<TArgs extends unknown[], R>(fn: (...a: TArgs) => Promise<R>, delayMs: number) {
  /* trailing-edge debounce returning a Promise of the latest call */
}
```

Compose them: `debounced(latestOnly(findFiles))`.

#### 2) Apply to prompt autocomplete

Replace the raw `createResource` fetcher with the composed helper:

- Debounce input by ~150–250 ms.
- Abort the previous `find.files` when a new query starts (pass `signal` if the SDK fetch client
  forwards it; otherwise rely on the id guard).
- Return `[]` synchronously for empty/whitespace `baseQuery` without a server round trip.
- Treat `AbortError` as expected (no error toast/log).

#### 3) Apply to the tag dialog

Route `dialog-tag.tsx` through the same helper instance (or a sibling) so its file search is
likewise debounced + latest-only.

#### 4) LSP refresh (follow-up)

Identify the LSP refresh trigger(s) and wrap them in `createDebouncedAsync` (≈250–500 ms) with
last-write-wins application of diagnostics, so rapid file switches don't flap the indicator.

---

### Phased implementation steps

1. Add `requests.ts` + a unit test proving stale results are dropped (latest-only).
2. Wire autocomplete through `debounced(latestOnly(findFiles))` behind flag
   `requests.debounceFileSearch` (default off); add dev counters: started / aborted / applied.
3. Add the empty-query short-circuit.
4. Route `dialog-tag.tsx` through the helper.
5. Wrap LSP refresh behind `requests.latestOnlyLspRefresh`.

---

### Backward compatibility

- No persisted data. UI state updates only when the latest request resolves — functionally
  equivalent for a settled query, strictly better under bursts.

---

### Risk + mitigations

- Over-aggressive debounce feels laggy → keep ≤250 ms for search; tune search vs LSP separately.
- Abort surfaces as log noise → classify `AbortError` as expected.
- SDK fetch client may not forward `AbortSignal` → id-based stale-drop still guarantees
  correctness without true cancellation.

---

### Validation plan

- Unit: `createLatestOnlyAsync` ignores a slow earlier call when a newer one resolves first;
  `bun test` exit code.
- Manual: type a long query fast; with dev counters, `started` ≫ `applied` and `applied`
  monotonically reflects the final query; confirm results match the final text and never flicker
  to a stale list.

---

### Rollout plan

- Helpers behind flags, default off.
- Enable file-search debounce first (highest impact, easiest to validate).
- Enable LSP latest-only next; add real cancellation if/when the SDK forwards signals.
- Flags are independent kill switches.

---

### Open questions

- Does the v2 SDK fetch client forward an `AbortSignal` to `find.files` today?
- Is there a single LSP-refresh chokepoint to wrap, or several call sites?
- Best debounce defaults for large repos / slower machines?
