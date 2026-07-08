# Roadmap — native LLM + TUI opencode-parity

Operational timeline for `packages/nikcli`. Detail lives in linked docs; this file is the **single schedule view**.

| Document                                                                                 | Role                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| [native-llm-opencode-parity-integration.md](./native-llm-opencode-parity-integration.md) | Error propagation matrices, phases, gates |
| [opencode-parity/README.md](./opencode-parity/README.md)                                 | TUI gap analysis, flags, spec index       |
| `.nikcli/plans/1781905749481-clever-nebula.md`                                           | Native `@nikcli-ai/llm` technical plan    |
| [integration-master-plan.md](./integration-master-plan.md)                               | Effect / v2 / OpenAPI (separate track)    |

---

## Tracks (run in parallel where noted)

```
Track A — Chat / native LLM (server)     Track B — Config foundation
  F0 → F1 → (F4 optional)                  F2 (schema flags only)

Track C — TUI opencode-parity (client)   Track D — Soak & default-on
  B1 → B2 → B3 → B4 (+ B5/B6)              After internal dogfood per flag
```

**Invariant:** every behavior change ships **flag-off** until soak passes.

---

## Now (current sprint)

| ID         | Work                                                            | Owner hint    | Gate   | Status                                                    |
| ---------- | --------------------------------------------------------------- | ------------- | ------ | --------------------------------------------------------- |
| **A-F0.1** | Smoke `experimental.nativeLlm` on/off (chat, tools)             | session       | Manual | ⬜                                                        |
| **A-F0.2** | `cd packages/llm && bun test`                                   | llm           | Exit 0 | ⬜                                                        |
| **A-F0.3** | Update clever-nebula “stato implementazione” → P0 code complete | docs          | —      | ⬜                                                        |
| **A-F0.4** | Document known gap: native retry ≠ AI SDK until F1.2            | AGENTS / plan | —      | ✅ F1.2 landed 2026-07-08 (`providerErrorToAPICallError`) |

**Already shipped (P0 code):** `llm-event-adapter`, `native-runtime` (`llmStreamRequest`), `llm.ts` branch + pre-stream fallback, typecheck + session tests green.

**2026-07-08 (misty-moon wave 1):** F1.2 retry parity (`APICallError` from provider-error); native abort wrapper; `src/config/features.ts` + `messageVirtualization` flag; session list windowing behind flag; Effect OpenAPI opt-in (`generate --httpapi` / `NIKCLI_SDK_OPENAPI=httpapi`).

```bash
cd packages/nikcli && bun run typecheck
cd packages/nikcli && bun test test/session/llm-event-adapter.test.ts test/session/retry.test.ts test/session/processor-effect-service.test.ts
```

---

## Next (1–2 weeks)

### Track A — F1 native error parity

| ID         | Deliverable                                                        | Risk if skipped                                                          |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **A-F1.1** | OAuth `fetch` + `status()` ↔ full `mapToModelRef`                  | ✅ ADR: permanent AI SDK for OAuth until llm supports fetch (2026-07-08) |
| **A-F1.2** | `provider-error` → throw compatible with `fromError` / `retryable` | ✅ `providerErrorToAPICallError` + tests (2026-07-08)                    |
| **A-F1.3** | Context overflow messages → compaction path (+ tests)              | Wrong UX on long context                                                 |
| **A-F1.5** | Debug tags: `llm.runtime`, `llm.fallback`                          | Hard to debug double provider calls                                      |
| **A-F1.6** | Tests for `native-runtime`; deprecate `native-request.ts`          | ✅ abort + status tests in `test/session/native-runtime.test.ts`         |

**Gate F1:** extended `retry.test` / adapter tests; `packages/llm` green; **no** `processor.ts` edit for native.

**Rollback:** `experimental.nativeLlm: false`.

---

### Track B — F2 feature flags (no UX change)

| ID         | Deliverable                                                                             |
| ---------- | --------------------------------------------------------------------------------------- | ------------- |
| **B-F2.1** | Zod: `experimental.requests`, `.tui` (+ `messageVirtualization`); persist.\* still open | ✅ partial    |
| **B-F2.2** | `src/config/features.ts`                                                                | ✅ 2026-07-08 |
| **B-F2.3** | opencode-parity README ↔ config key table                                               | ✅ 2026-07-08 |

Can start **in parallel** with A-F1.

---

## Then — TUI parity (Track C)

One spec per PR; order fixed by risk/impact ([README](./opencode-parity/README.md)).

| Milestone | Spec                                                                       | Flag(s)                                                        | Est.    | Depends                 |
| --------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- | ------- | ----------------------- |
| **C-B1**  | [03 request-throttling](./opencode-parity/03-request-throttling.md)        | `requests.debounceFileSearch`, `requests.latestOnlyLspRefresh` | 3–5 d   | F2 nice-to-have         |
| **C-B2**  | [01 prompt-history](./opencode-parity/01-prompt-history-payload-limits.md) | `persist.*`                                                    | 5–8 d   | —                       |
| **C-B3**  | [02 cache eviction](./opencode-parity/02-tui-cache-eviction.md)            | `tui.cacheEviction`                                            | 5–8 d   | Pin active session      |
| **C-B4**  | [04 virtualization](./opencode-parity/04-message-list-virtualization.md)   | per spec 04                                                    | 1–2 wk  | B3 helps large sessions |
| **C-B5**  | [06 i18n](./opencode-parity/06-tui-i18n.md)                                | structural                                                     | ongoing | Parallel to B3–B4       |
| **C-B6**  | [05 modularize](./opencode-parity/05-tui-modularization.md)                | `tui.scopedCacheShared`                                        | ongoing | Feeds B3                |

**Per-PR gate:**

```bash
cd packages/nikcli && bun run typecheck
cd packages/nikcli && bun test test/session/llm-event-adapter.test.ts test/session/retry.test.ts test/session/processor-effect-service.test.ts  # if config/session touched
cd packages/nikcli && bun test <new-spec-tests>
```

**Error rule:** parity failures must **not** surface as `Session.Event.Error` (except normal chat). See integration plan §3.

---

## Later (post-soak)

| ID       | Work                                                    | When                                     |
| -------- | ------------------------------------------------------- | ---------------------------------------- |
| **A-F4** | Processor consumes `LLMEvent` directly                  | After F1 stable in production            |
| **A-F4** | clever-nebula P3: cache-policy, protocol cherry-pick    | After F1 + llm recorded tests            |
| **D-\*** | Default-on per flag (one at a time)                     | After metrics + 1 release cycle fallback |
| **—**    | `generateObject` / structured output behind `nativeLlm` | If product needs it                      |

---

## Timeline (indicative)

```
Week 0     [NOW]  A-F0 closure
Week 1–2          A-F1 + B-F2 (parallel)
Week 2–3          C-B1 (03 throttling)
Week 3–5          C-B2, C-B3
Week 5–8          C-B4 + C-B5 parallel, C-B6 incremental
Ongoing           Soak → flip flags → F4 optional
```

Adjust for team size; **do not** merge A-F1 and C-B4 in one PR.

---

## Decision log (resolve before A-F1.2)

| #   | Question                                                 | Recommendation                                                                           |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Rebuild `APICallError` from `provider-error` + metadata? | Yes for retry parity; minimal fields: message, status if known, `isRetryable` from event |
| 2   | Fallback AI SDK after partial native stream?             | **No** (keep current)                                                                    |
| 3   | Parity flags under `experimental` only?                  | **Yes** for one config surface                                                           |

---

## Status legend

| Symbol | Meaning             |
| ------ | ------------------- |
| ⬜     | Not started         |
| 🟡     | In progress         |
| ✅     | Done / gate passed  |
| ⏸      | Blocked on decision |

_Update this file when milestones complete (status column + “Already shipped” section)._

---

## Quick links — spec files

- [01 prompt-history](./opencode-parity/01-prompt-history-payload-limits.md)
- [02 cache eviction](./opencode-parity/02-tui-cache-eviction.md)
- [03 request-throttling](./opencode-parity/03-request-throttling.md)
- [04 message virtualization](./opencode-parity/04-message-list-virtualization.md)
- [05 modularization](./opencode-parity/05-tui-modularization.md)
- [06 TUI i18n](./opencode-parity/06-tui-i18n.md)
