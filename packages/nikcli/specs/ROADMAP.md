# Roadmap — native LLM + TUI opencode-parity

Operational timeline for `packages/nikcli`. Detail lives in linked docs; this file is the **single schedule view**.

| Document                                                                                 | Role                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| [native-llm-opencode-parity-integration.md](./native-llm-opencode-parity-integration.md) | Error propagation matrices, phases, gates |
| [opencode-parity/README.md](./opencode-parity/README.md)                                 | TUI gap analysis, flags, spec index       |
| `.nikcli/plans/1781905749481-clever-nebula.md`                                           | Native `@nikcli-ai/llm` technical plan    |
| [integration-plan-verified.md](./integration-plan-verified.md)                           | Effect / v2 / OpenAPI (separate track)    |

---

## Tracks (run in parallel where noted)

```
Track A — Chat / native LLM (server)     Track B — Config foundation
  F0 → F1 → (F4 optional)                  F2 (schema flags only)

Track C — TUI opencode-parity (client)   Track D — Soak & default-on
  B1 → B2 → B3 → B4 (+ B5/B6/B7)           After internal dogfood per flag
```

**Invariant:** every behavior change ships **flag-off** until soak passes. (A 2026-07-08 flip-all attempt — misty-moon wave 4 — was rolled back on 2026-07-09: with `tui.*` flags on the TUI stopped rendering streamed assistant parts, and the Effect-OpenAPI SDK default dropped client namespaces. Exception kept: `NIKCLI_EXPERIMENTAL_HTTPAPI` stays default-on after the /config jsonSafe fix and Effect log redirect.)

---

## Now (current sprint) — reconciled 2026-07-30

| ID         | Work                                                            | Owner hint    | Gate   | Status                                                    |
| ---------- | --------------------------------------------------------------- | ------------- | ------ | --------------------------------------------------------- |
| **A-F0.1** | Smoke `experimental.nativeLlm` on/off (chat, tools)             | session       | Manual | 🟡 code path ready; dogfood on demand                     |
| **A-F0.2** | `cd packages/llm && bun test`                                   | llm           | Exit 0 | 🟡 run before release; package actively maintained        |
| **A-F0.3** | Update clever-nebula “stato implementazione” → P0 code complete | docs          | —      | ✅ 2026-07-30                                             |
| **A-F0.4** | Document known gap: native retry ≠ AI SDK until F1.2            | AGENTS / plan | —      | ✅ F1.2 landed 2026-07-08 (`providerErrorToAPICallError`) |

**Already shipped (P0 code):** `llm-event-adapter`, `native-runtime` (`llmStreamRequest` + `abortableIterable`), `llm.ts` branch + pre-stream fallback, `l.debug("llm.runtime", …)`, typecheck + session tests green.

**Already shipped (F1 partial):** F1.1 OAuth stays AI SDK (ADR); F1.2 retry parity; F1.5 `llm.runtime` tags; F1.6 `test/session/native-runtime.test.ts`.

**Already shipped (F2 + Track C partial):** `src/config/features.ts`; 01/02/03/06 integrated; 04 windowed render behind flag; 07 TUI v2 selective port (reconnect, row grouping, serve, SSE encode).

```bash
cd packages/nikcli && bun run typecheck
cd packages/nikcli && bun test test/session/llm-event-adapter.test.ts test/session/retry.test.ts test/session/processor-effect-service.test.ts test/session/native-runtime.test.ts
cd packages/nikcli && bun test test/tui/
cd packages/nikcli && bun test test/config/features.test.ts
```

---

## Track A — F1 native error parity

| ID         | Deliverable                                                        | Status                                                                                          |
| ---------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **A-F1.1** | OAuth `fetch` + `status()` ↔ full `mapToModelRef`                  | ✅ ADR: permanent AI SDK for OAuth until llm supports fetch (2026-07-08)                        |
| **A-F1.2** | `provider-error` → throw compatible with `fromError` / `retryable` | ✅ `providerErrorToAPICallError` + tests (2026-07-08)                                           |
| **A-F1.3** | Context overflow messages → compaction path (+ tests)              | ⬜ `fromError` still has no `ContextOverflowError` case; overflow mainly via finish-step tokens |
| **A-F1.5** | Debug tags: `llm.runtime`, `llm.fallback`                          | 🟡 `llm.runtime` landed; `llm.fallback` reason tag still thin                                   |
| **A-F1.6** | Tests for `native-runtime`; deprecate `native-request.ts`          | 🟡 tests landed; `native-request.ts` still present (builder, not dead)                          |

**Gate F1:** extended `retry.test` / adapter tests; `packages/llm` green; **no** `processor.ts` edit for native.

**Rollback:** `experimental.nativeLlm: false`.

**Remaining F1 focus:** A-F1.3 overflow → compaction; richer `llm.fallback` reason on pre-stream catch.

---

## Track B — F2 feature flags (no UX change)

| ID         | Deliverable                                                                             | Status        |
| ---------- | --------------------------------------------------------------------------------------- | ------------- |
| **B-F2.1** | Zod: `experimental.requests`, `.tui` (+ `messageVirtualization`); persist.\* still open | ✅ partial    |
| **B-F2.2** | `src/config/features.ts`                                                                | ✅ 2026-07-08 |
| **B-F2.3** | opencode-parity README ↔ config key table                                               | ✅ 2026-07-08 |

**Live flags** (`features(cfg)` → `src/config/features.ts`):

| Key                                          | Default | Notes                                    |
| -------------------------------------------- | ------- | ---------------------------------------- |
| `experimental.nativeLlm`                     | off     | native `@nikcli-ai/llm` stream path      |
| `experimental.tui.cacheEviction`             | off     | session LRU in `context/sync.tsx`        |
| `experimental.tui.messageVirtualization`     | off     | windowed message list                    |
| `experimental.tui.explorationGrouping`       | off     | collapse consecutive read-only tool runs |
| `experimental.requests.latestOnlyLspRefresh` | off     | latest-only LSP refresh                  |
| `experimental.events.schemaEncoding`         | off     | `BusEvent.encode` on SSE                 |

File-search debounce (spec 03) is **always on** (no enable flag).

---

## Track C — TUI parity

One spec per PR historically; several have landed. Order was fixed by risk/impact ([README](./opencode-parity/README.md)).

| Milestone | Spec                                                                       | Flag(s)                                             | Status (2026-07-30)                                    |
| --------- | -------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| **C-B1**  | [03 request-throttling](./opencode-parity/03-request-throttling.md)        | debounce always-on; `requests.latestOnlyLspRefresh` | ✅ integrated                                          |
| **C-B2**  | [01 prompt-history](./opencode-parity/01-prompt-history-payload-limits.md) | blob path always-on (no separate `persist.*` flags) | ✅ integrated                                          |
| **C-B3**  | [02 cache eviction](./opencode-parity/02-tui-cache-eviction.md)            | `tui.cacheEviction`                                 | ✅ integrated, default off                             |
| **C-B4**  | [04 virtualization](./opencode-parity/04-message-list-virtualization.md)   | `tui.messageVirtualization`                         | ✅ windowed render behind flag; soak still default-off |
| **C-B5**  | [06 i18n](./opencode-parity/06-tui-i18n.md)                                | structural                                          | ✅ scaffold + first surfaces (`en`/`zh`)               |
| **C-B6**  | [05 modularize](./opencode-parity/05-tui-modularization.md)                | shared primitives extracted; mega-components remain | 🟡 ongoing                                             |
| **C-B7**  | [07 TUI v2 selective port](./opencode-parity/07-tui-v2-selective-port.md)  | `tui.explorationGrouping`, `events.schemaEncoding`  | ✅ landed (v1.201.0)                                   |

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
| **—**    | Native abort into `@nikcli-ai/llm` HTTP layer           | Today: `abortableIterable` wrapper only  |

---

## Timeline (historical + current)

```
Week 0     A-F0 closure                          ✅ code
Week 1–2   A-F1 + B-F2 (parallel)                ✅ mostly (F1.3 open)
Week 2–5   C-B1…B4 + C-B5                        ✅
Ongoing    C-B6 modularize, D-* soak flips
2026-07    C-B7 TUI v2 selective port            ✅ v1.201.0
2026-07-30 Provider options typing               ✅ packages/llm
```

Adjust for team size; **do not** merge A-F1.3 and large TUI refactors in one PR.

---

## Decision log

| #   | Question                                                 | Resolution                                                                                  |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Rebuild `APICallError` from `provider-error` + metadata? | **Yes** — landed as `providerErrorToAPICallError`                                           |
| 2   | Fallback AI SDK after partial native stream?             | **No** (keep current pre-stream-only fallback)                                              |
| 3   | Parity flags under `experimental` only?                  | **Yes**                                                                                     |
| 4   | OAuth on native path?                                    | **No** until `@nikcli-ai/llm` supports custom `fetch`; AI SDK permanent for oauth auth type |
| 5   | Spec 03 debounce flag?                                   | **Always on** in code; only `latestOnlyLspRefresh` is gated                                 |

---

## Status legend

| Symbol | Meaning               |
| ------ | --------------------- |
| ⬜     | Not started           |
| 🟡     | In progress / partial |
| ✅     | Done / gate passed    |
| ⏸      | Blocked on decision   |

_Update this file when milestones complete (status column + “Already shipped” section)._

---

## Quick links — spec files

- [01 prompt-history](./opencode-parity/01-prompt-history-payload-limits.md)
- [02 cache eviction](./opencode-parity/02-tui-cache-eviction.md)
- [03 request-throttling](./opencode-parity/03-request-throttling.md)
- [04 message virtualization](./opencode-parity/04-message-list-virtualization.md)
- [05 modularization](./opencode-parity/05-tui-modularization.md)
- [06 TUI i18n](./opencode-parity/06-tui-i18n.md)
- [07 TUI v2 selective port](./opencode-parity/07-tui-v2-selective-port.md)
