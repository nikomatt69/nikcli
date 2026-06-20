# Execution strategy (deep)

How to proceed with **native LLM**, **error propagation**, and **opencode-parity** in
`packages/nikcli` — decision-grade detail, not a task list.

**Companion docs:** [ROADMAP.md](./ROADMAP.md) (schedule), [native-llm-opencode-parity-integration.md](./native-llm-opencode-parity-integration.md) (matrices).

---

## 0. Ground truth (reconcile plans with repo)

| Area               | Plan said                     | Repo today                                                                                                                                                             |
| ------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native P0          | Partial / broken `LLMRuntime` | **Done:** adapter, `llmStreamRequest`, `llm.ts` branch, tests green                                                                                                    |
| 03 throttling      | Not started                   | **Mostly done:** `util/signal.ts`, autocomplete 180ms debounce + `createLatestOnlyAsync`, `dialog-tag`, `test/tui/util/signal.test.ts` — **no config flag**, always on |
| F2 `features(cfg)` | Planned                       | **Not in code**                                                                                                                                                        |
| F1.2 retry parity  | Gap                           | **`provider-error` → `throw Error` → `UnknownError`**; `retryable` on event ignored                                                                                    |
| Native `abort`     | —                             | `StreamInput.abort` on AI SDK (`abortSignal`); **`streamRequest` path does not wire abort** into `LLMRequest` / iterator                                               |
| OAuth native       | P0 unsupported                | `status()` returns unsupported even when `fetch` exists                                                                                                                |

**Implication:** next work is **not** “implement 03 from zero” but **harden + gate + measure**, while **F1.2** is the real native risk reducer.

---

## 1. Mental model: three failure domains

```
Domain A — Pre-stream (LLM.stream setup)
  prepare / buildLLMRequest / status / open iterator
  → catch in llm.ts → fallback AI SDK (silent)
  → risk: double provider billing

Domain B — In-stream (processor for-await)
  provider-error, tool-error, throw from iterator
  → NO fallback; same catch as AI SDK
  → risk: wrong error class → no retry / wrong toast

Domain C — TUI local (parity)
  find.files, blobs, eviction, virtualization
  → must NOT become Domain B
  → risk: stale UI, not session.error
```

**Strategy rule:** optimize **Domain B** for native before expanding native eligibility (OAuth, more providers). Keep **Domain C** behind flags until soak.

---

## 2. Domain B — Native error parity (F1.2 design)

### 2.1 Current path (precise)

```
LLMEvent provider-error { message, retryable?, providerMetadata? }
  → mapLLMEvent: throw new Error(message)
  → processor catch
  → fromError: case Error → EventError.unknown(e.toString())
  → name: UnknownError, data.message = "Error: …"
  → retryable(): only if mapJsonRetryMessage(data.message) hits
```

AI SDK path for 429:

```
fullStream error event → throw APICallError (or similar)
  → fromError: APIError + statusCode + isRetryable + responseHeaders
  → retryable(): full behavior + delay(retry-after)
```

### 2.2 Target path (no processor edit)

**Preferred:** new helper `throwProviderFailure(event: ProviderErrorEvent): never` in
`llm-event-adapter.ts` (or `session/llm/native-errors.ts`):

1. If `ProviderError.parseStreamError(message)` → overflow:
   - `throw new MessageV2.ContextOverflowError({ … })` **only if** `fromError` already handles it.
   - **Today `fromError` does NOT list `ContextOverflowError`** — only `OutputLengthError`. Overflow in processor is driven mainly by **token usage on finish-step**, not stream fatal. For fatal overflow messages, **extend `fromError` with one `instanceof ContextOverflowError` case** mapping to existing Zod name `MessageContextOverflowError` (not a new name — class already exists). This is a **small, explicit** `message-v2.ts` change; processor unchanged.

2. Else if `event.retryable === true` or heuristics (message matches throttle / 429 / Overloaded):
   - `throw new APICallError({ message, isRetryable: true, statusCode: 429, url: … })` with fields the AI SDK constructor accepts (verify against `ai` package typings in-repo).
   - Lets `fromError` → `APIError` → `retryable()` unchanged.

3. Else:
   - `throw new APICallError({ message, isRetryable: false, statusCode: … })` if metadata exposes status; else plain `Error` (current).

**Tests (acceptance):**

| Case                                                      | Assert                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `provider-error` + `retryable: true` + "Overloaded"       | `fromError(throw…)` → `APIError`; `retryable()` defined                   |
| Recorded Bedrock throttle shape from `packages/llm` tests | Same                                                                      |
| Overflow regex message                                    | `MessageContextOverflowError` or compaction trigger path (document which) |
| Non-retryable 401                                         | No retry; auth-like message if possible                                   |

Update `llm-event-adapter.test.ts`: replace bare `toThrow("rate limited")` with **integration-style** `fromError` + `retryable` expectations.

### 2.3 What not to do in F1.2

- Import OpenCode `provider-error.ts` wholesale.
- Add new public error `name` strings beyond existing `MessageContextOverflowError` wire shape.
- Map `Cause` / `LLMError` Effect tags into session.
- Fallback to AI SDK **after** first `text-delta` (forbidden).

---

## 3. Domain A — Eligibility, OAuth, abort (F1.1 + F1.5)

### 3.1 `status()` sophistication

Today: API key check + OAuth hard-block.

**Target:**

- `modelRef` resolved ⇒ route exists in `@nikcli-ai/llm` (optional: `prepareRequest` dry-run in debug only, not hot path).
- OAuth openai: wire `provider.options.fetch` into `LLMRequest` HTTP layer (how `buildLLMRequest` sets `HttpOptions` — may need `fetch` injection on executor; read `packages/llm` route client).
- Document **matrix** in clever-nebula: provider × auth × native.

### 3.2 Abort gap (high severity, often missed)

AI SDK: `abortSignal: input.abort`.

Native: `streamRequest(llmRequest)` — verify whether request supports abort signal on HTTP; if yes, thread `input.abort` from `streamNative` into `HttpOptions` or runtime API.

**Until fixed:** user abort mid-native-stream may leave hanging fetch; processor may still throw `AbortError` on next `throwIfAborted` but wire can continue.

**Task:** spike 2h in `packages/llm` schema + executor; then nikcli `buildLLMRequest` / wrapper async generator that calls `reader.cancel()` on abort.

### 3.3 Observability (F1.5)

Structured debug (no user-facing change):

```ts
l.debug("llm.path", {
  runtime: "native" | "ai-sdk",
  fallback?: "pre_stream" | "unsupported",
  reason?: string,
  providerID,
  route?: modelRef.route,
})
```

Optional counter env `NIKCLI_DEBUG_LLM_PATH=1` for QA double-call detection.

---

## 4. Domain C — Parity (revised sequence)

### 4.1 Spec 03 — finish, don’t rewrite

**Already shipped behavior** (always on). Remaining spec gaps:

| Item                                 | Action                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Flag `requests.debounceFileSearch`   | **Retrofit:** when flag off, bypass debounce/latest-only (restore raw `createResource` behavior) OR document “03 shipped default-on” and close spec with amendment |
| Empty `baseQuery` short-circuit      | Verify in autocomplete resource; add if missing                                                                                                                    |
| Dev counters started/aborted/applied | `NIKCLI_DEBUG_REQUESTS=1` only                                                                                                                                     |
| LSP debounce                         | Separate small PR; grep refresh chokepoints                                                                                                                        |
| `dialog-tag` debounce                | Add `createDebouncedSignal` on filter (latest-only only today)                                                                                                     |

**Recommendation:** treat 03 as **“harden + flag for rollback”** in one PR, not greenfield.

### 4.2 Spec 01 — prompt history

Highest **data integrity** risk. Sequence inside PR:

1. `prompt-blob.ts` + unit tests (no behavior change).
2. Flag `persist.promptPayloadLimits`: measure+log only.
3. Flag `persist.promptImageBlobs`: write path.
4. Migrate-on-read + stash parity.
5. GC flag last.

Never block submit on blob failure (fail-soft).

### 4.3 Spec 02 before 04

Eviction can drop messages for **inactive** sessions while user hops; **pin** `route.data.sessionID` and children (background jobs). Without pin, 02 causes Domain C “false errors” (empty thread until resync).

### 4.4 Spec 04

Only after 02 or with flag fallback to full `<For>`. Large native sessions increase part churn → virtualization ROI goes up.

---

## 5. Configuration architecture (F2)

Single module `src/config/features.ts`:

```ts
export function features(cfg: Config.Info) {
  return {
    nativeLlm: cfg.experimental?.nativeLlm === true,
    debounceFileSearch: cfg.experimental?.requests?.debounceFileSearch !== false, // if 03 stays default-on
    // …
  } as const
}
```

**Policy decision required:**

- **Option A:** 03 default-on in code; flag **disables** (rollback).
- **Option B:** 03 off until flag enables (spec literal).

Given code already default-on, **Option A** is honest; update spec 03 rollout section accordingly.

---

## 6. Verification pyramid

```
L0  bun run typecheck (every commit)
L1  Session contract (every touch session/*)
      bun test test/session/llm-event-adapter.test.ts
           test/session/retry.test.ts
           test/session/processor-effect-service.test.ts
L2  LLM wire (every touch packages/llm or adapter mapping)
      cd packages/llm && bun test
L3  TUI util (touch cli/cmd/tui/util|component/prompt)
      bun test test/tui/util/signal.test.ts
L4  Manual matrix (release candidate)
      see §7
```

**Do not** run only L0 before merging F1.2.

---

## 7. Manual matrix (release candidate)

| #   | Config                       | Action                     | Pass                                     |
| --- | ---------------------------- | -------------------------- | ---------------------------------------- |
| M1  | native off                   | Chat + tool                | Same as baseline                         |
| M2  | native on, openai key        | Chat + tool                | Parts stream; debug `llm.runtime=native` |
| M3  | native on, unsupported oauth | Chat                       | AI SDK; no error toast                   |
| M4  | native on                    | Simulate 429 (if possible) | Retry UI vs M1                           |
| M5  | —                            | Fast-type `@file`          | No stale list flicker (03)               |
| M6  | native on                    | Abort mid-stream           | Stops; no hung turn (after abort fix)    |

---

## 8. PR slicing (sophisticated concurrency)

```
PR-1  F1.2 adapter + fromError ContextOverflow + tests     (blocks native soak)
PR-2  F1.1 OAuth fetch + status matrix doc                 (parallel after PR-1 review)
PR-3  Abort on native stream                               (parallel, touches llm pkg)
PR-4  F2 features.ts + zod only                           (parallel)
PR-5  03 flag retrofit + dialog-tag debounce + counters    (parallel)
PR-6  01 blob phase 1–2                                    (after PR-4)
```

**Merge order:** PR-1 → PR-3 → PR-2 → enable wider native in docs; parity PR-4/5/6 independent.

Max **~400 LOC** per PR except 04 virtualization.

---

## 9. Risk register (living)

| ID  | Risk                                        | Likelihood      | Impact          | Mitigation                                                                           |
| --- | ------------------------------------------- | --------------- | --------------- | ------------------------------------------------------------------------------------ |
| R1  | Double provider call on pre-stream fallback | Med             | Cost            | F1.5 metrics; narrow catch                                                           |
| R2  | No retry native throttle                    | High until F1.2 | UX              | PR-1                                                                                 |
| R3  | Abort not wired native                      | Med             | UX/hang         | PR-3                                                                                 |
| R4  | Message transform drift AI vs native        | Med             | 400/wrong tools | Compare `prepareRequest` body vs AI SDK in debug; long-term ProviderTransform parity |
| R5  | 02 evicts active session                    | Low if pinned   | Confusion       | Pin + test                                                                           |
| R6  | 04 breaks opentui streaming parts           | Med             | UX              | Flag fallback                                                                        |

---

## 10. How I would run the next two weeks

**Week 1 — Correctness before coverage**

| Day   | Focus                                                          |
| ----- | -------------------------------------------------------------- |
| D1    | F0 closure: `packages/llm` test + M1–M3 + clever-nebula status |
| D2–D3 | PR-1 F1.2 full test pyramid L1–L2                              |
| D4    | PR-3 abort spike → implement or ticket with severity           |
| D5    | PR-2 OAuth if spike green; else document blockers              |

**Week 2 — Platform + parity debt**

| Day    | Focus                                                |
| ------ | ---------------------------------------------------- |
| D6     | PR-4 F2 schema                                       |
| D7     | PR-5 03 flag + spec amendment                        |
| D8–D10 | PR-6 01 phase 1–2 OR start 02 LRU helper behind flag |

**Staffing:** one owner on **Track A (PR-1/2/3)**; another on **F2 + 03/01** — avoids context switch on `message-v2` vs TUI.

---

## 11. Explicit non-goals (quarter)

- Processor consumes raw `LLMEvent` (F4).
- Default-on `nativeLlm` for all users.
- Merging Effect/v2 master plan into this track ([integration-master-plan.md](./integration-master-plan.md) stays separate).
- Perfect byte parity AI SDK middleware vs native messages (track as R4; fix incrementally).

---

## 12. First commit I would make Monday

**PR-1 skeleton:**

1. `native-errors.ts` — `providerErrorToThrown(event)` with APICallError + overflow.
2. `llm-event-adapter.ts` — delegate `provider-error` case.
3. `message-v2.ts` — `instanceof ContextOverflowError` in `fromError` (wire name already exists).
4. Tests: adapter + `retry.test` + one table-driven case from Bedrock recorded event JSON.

No config, no TUI, no processor.

That is the highest-leverage, best-prepared next step given the actual tree.
