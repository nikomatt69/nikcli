# opencode-parity specs

Optimizations imported from the upstream **opencode** spec set (`specs/01..05`, `06/07` i18n,
`perf-roadmap.md`, `project.md`) and re-scoped to **nikcli's own surface**: the
`packages/nikcli` package (terminal UI built on OpenTUI/Solid, the Hono HTTP server, and the
CLI). These are the gaps that opencode's specs target the shared web/desktop app
(`packages/app`, `packages/ui`) for, but that have **not** been applied to `packages/nikcli`.

**Roadmap (schedule):** [`../ROADMAP.md`](../ROADMAP.md)

**Master plan (error propagation + sequencing with native LLM):**
[`../native-llm-opencode-parity-integration.md`](../native-llm-opencode-parity-integration.md)

**Native chat route (`experimental.nativeLlm`):** separate track in
`.nikcli/plans/1781905749481-clever-nebula.md` — server `session/llm.ts`, not TUI. Parity specs
below do **not** change `MessageV2.fromError` / processor retry; they only affect TUI/SDK
chokepoints unless noted.

## Why these exist

nikcli is a superset of opencode and ships the same `packages/app` + `packages/ui`, where the
upstream specs already landed (i18n contexts in `packages/{app,ui}/src/i18n`, scroll-spy in
`packages/app/src/pages/session/scroll-spy.ts`, `packages/app/src/utils/persist.ts`, etc.).
nikcli's distinctive product — the terminal client and server in `packages/nikcli` — never
received the equivalent guardrails. Each spec below maps an upstream concern onto the concrete
nikcli file where the same class of problem exists today.

## Gap analysis (evidence)

| #     | opencode spec                | nikcli gap (verified)                                                                                                                                    | Evidence                                                                                                                                                                                                          |
| ----- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01    | `01-persist-payload-limits`  | Prompt history/stash persist base64 image `dataUrl`s into a plaintext JSONL file with no size caps                                                       | `src/cli/cmd/tui/component/prompt/history.tsx` writes `PromptInfo[]` (parts include `FilePart.url = data:…;base64,…`) to `prompt-history.jsonl` via `Bun.write`; `MAX_HISTORY_ENTRIES=50` bounds count, not bytes |
| 02    | `02-cache-eviction`          | TUI sync store keeps every visited session's messages/parts/diffs in memory; only `session.deleted` frees them — no LRU/TTL                              | `src/cli/cmd/tui/context/sync.tsx` stores `message`/`part`/`session_diff`/`todo` keyed by session; eviction only via `delete draft.message[id]` on delete                                                         |
| 03    | `03-request-throttling`      | `find.files` autocomplete fires one server call per keystroke, no debounce / abort / stale-result guard                                                  | `src/cli/cmd/tui/component/prompt/autocomplete.tsx:298` `createResource(() => filter(), …find.files)`; same uncoordinated call in `component/dialog-tag.tsx:18`                                                   |
| 04    | `04-scroll-spy-optimization` | Session view renders **all** messages with `<For each={messages()}>`, no windowing/virtualization                                                        | `src/cli/cmd/tui/routes/session/index.tsx:1330`                                                                                                                                                                   |
| 05    | `05-modularize-and-dedupe`   | Mega-components: `routes/session/index.tsx` 3534 LOC, `component/prompt/index.tsx` 2323, `component/dialog-opentui-viz.tsx` 2290, `app.tsx` 1409         | `wc -l` over `src/cli/cmd/tui`                                                                                                                                                                                    |
| 06/07 | `06/07-i18n-audit`           | `packages/nikcli` has **no** string-translation i18n; `src/util/locale.ts` is formatting-only (titlecase/number/duration). TUI copy is hardcoded English | `src/util/locale.ts`; no `useLanguage`/`t(` in `src/cli/cmd/tui`                                                                                                                                                  |

opencode's `project.md` (multi-project/worktree session API) is **already implemented** in
nikcli (`src/server/routes/project.ts`, `src/server/routes/workspace.ts`,
`src/workspace/*`, `sync.workspaceList`) and is therefore **not** included here.

## Error propagation (parity vs session chat)

| Layer                           | What fails                    | Reaches `Session.Event.Error`? | User-visible                                        |
| ------------------------------- | ----------------------------- | ------------------------------ | --------------------------------------------------- |
| **03** `find.files`             | Network, abort                | No (local autocomplete)        | Empty/stale list; classify `AbortError` as expected |
| **01** prompt history / blobs   | FS, quota                     | No                             | Fail-soft: entry without image, dev log             |
| **02** cache eviction           | Evicted session while viewing | No (re-sync from server)       | Brief stale UI until sync; **pin active session**   |
| **04** virtualization           | Render edge cases             | No                             | Scroll/layout; **flag fallback** = full `<For>`     |
| **06** i18n                     | —                             | No                             | Copy only                                           |
| **Chat** (`nativeLlm` / AI SDK) | Provider, stream              | **Yes** via processor          | Toast from `app.tsx` on `session.error`             |

Long native/AI sessions increase TUI traffic → **02** and **04** reduce memory/render cost; they
do **not** alter chat error classification. See integration plan §2–3 for native retry gaps
(`provider-error` → `UnknownError` until F1.2).

## Feature flags (spec names → planned config)

Flags ship **off** first. Planned home: `config.experimental` (or `features(cfg)` helper — Fase 2
in integration plan). Wire names when implementing each spec.

| Spec | Flag(s) in spec docs                                                              | Purpose                            |
| ---- | --------------------------------------------------------------------------------- | ---------------------------------- |
| 03   | `requests.debounceFileSearch`, `requests.latestOnlyLspRefresh`                    | Debounce file search + LSP refresh |
| 01   | `persist.promptPayloadLimits`, `persist.promptImageBlobs`, `persist.promptBlobGc` | JSONL byte caps, blob refs, GC     |
| 02   | `tui.cacheEviction`                                                               | LRU/TTL on sync maps               |
| 04   | (see `04-message-list-virtualization.md`)                                         | Windowed message list + fallback   |
| 05   | `tui.scopedCacheShared`                                                           | Shared cache primitive             |
| 06   | (structural; no runtime gate required for phase 1)                                | i18n catalog                       |

Independent kill switches: disabling one flag must not require disabling others.

## Sequenced roadmap

Guardrails first, optimize at chokepoints, ship behind flags (mirrors upstream
`perf-roadmap.md`). **Aligned with** [`native-llm-opencode-parity-integration.md`](../native-llm-opencode-parity-integration.md) **Fase 3 (B1→B6)**:

1. **03 request-throttling** — highest impact, lowest risk, easy to observe (file search).
2. **01 prompt-history payload limits** — stop persisting base64 blobs; bound the JSONL file.
3. **02 TUI cache eviction** — bound memory for long "session hopping" runs.
4. **04 message-list virtualization** — keep large sessions scrollable.
5. **06 TUI i18n** — structural; enables localization but no behavior change.
6. **05 modularization** — ongoing, one extraction per PR; makes the above safer.

**Parallel track (not in this folder):** native LLM P0 closure + F1 error/retry parity —
clever-nebula plan; run session tests on every `session/llm` change.

Each spec defines its own feature flag, validation plan, and rollback. Every behavior change
ships flag-off first.

## Verification (every parity PR)

```bash
cd packages/nikcli && bun run typecheck
# If the PR touches session/server paths or shared config:
cd packages/nikcli && bun test test/session/llm-event-adapter.test.ts test/session/retry.test.ts test/session/processor-effect-service.test.ts
# Spec-specific unit tests (add per spec, e.g. requests.test.ts for 03)
cd packages/nikcli && bun test <spec-test-path>
```

Manual checks are listed in each spec file (burst typing for 03, `wc -c` on history for 01, etc.).

## Integration status (2026-06-20)

| Spec | Status | Landed in code | Tests |
| ---- | ------ | -------------- | ----- |
| 03 request-throttling | **integrated** | `util/signal.ts` `createLatestOnlyAsync` (+ existing `createDebouncedSignal`); wired into `prompt/autocomplete.tsx` (debounced source + abort), `component/dialog-tag.tsx`, and `context/sync.tsx` LSP refresh (`refreshLspLatest`) | `test/tui/util/signal.test.ts` |
| 01 prompt-history payload limits | **integrated** | `util/prompt-blob.ts` (blob store + `dehydrate/hydratePromptEntry` + TTL `gc`); wired into `prompt/history.tsx` (write strips base64→blobID, load hydrates, startup GC over history+stash refs) | `test/tui/util/prompt-blob.test.ts` |
| 02 cache eviction | **integrated** | `util/lru-cache.ts`; wired into `context/sync.tsx` (`reapSessions` on `session.sync`, pins active/parent/streaming/bg, frees `message`/`part`/`diff`/`todo`) | `test/tui/util/lru-cache.test.ts` |
| 06 TUI i18n | **integrated (scaffold + first surface)** | `context/language.tsx`, `i18n/en.ts`+`i18n/zh.ts`, `LanguageProvider` in `app.tsx`, prompt placeholders migrated to `t()` | `test/tui/i18n-parity.test.ts` |
| 04 message virtualization | **module landed** | `routes/session/message-window.ts` (pure `visibleRange`/`spacerHeights`). Render flip in `routes/session/index.tsx` is the soak-gated follow-up (needs live-terminal verification) | `test/tui/util/message-window.test.ts` |
| 05 modularization | **partial** | shared primitives extracted (`signal`, `lru-cache`, `prompt-blob`, `message-window`). Mega-component splits remain as mechanical per-PR follow-ups | — |

All landed code: `bun run typecheck` → 0 errors; `bun test test/tui/` → 195 pass / 0 fail.

## Spec files

- [`01-prompt-history-payload-limits.md`](./01-prompt-history-payload-limits.md)
- [`02-tui-cache-eviction.md`](./02-tui-cache-eviction.md)
- [`03-request-throttling.md`](./03-request-throttling.md)
- [`04-message-list-virtualization.md`](./04-message-list-virtualization.md)
- [`05-tui-modularization.md`](./05-tui-modularization.md)
- [`06-tui-i18n.md`](./06-tui-i18n.md)
