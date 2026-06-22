# Piano integrazione: propagazione errori + native LLM + opencode-parity

Analisi **propagazione errori / side-effect**, poi **fasi realistiche**, gate e rollback.
Riferimenti: `.nikcli/plans/1781905749481-clever-nebula.md`, `specs/opencode-parity/README.md`.
(Distinto da `specs/integration-master-plan.md` — Effect/v2/OpenAPI.)

---

## 1. Architettura percorsi

```
                    ┌─────────────────────────────────────────┐
                    │  TUI (parity 01–06)                      │
                    │  SDK HTTP/WS, sync, prompt history       │
                    └──────────────────┬──────────────────────┘
                                       │ session.error, parts, status
                                       ▼
┌──────────────┐    LLM.stream()     ┌──────────────────────────────┐
│ experimental │ ──────────────────► │ SessionProcessor.process      │
│ .nativeLlm   │                     │  for await (fullStream)       │
└──────────────┘                     │  catch → fromError → retry    │
                                     └──────────────┬───────────────┘
              ┌──────────────────────┴──────────────────────────────┐
              │ AI SDK (default)     │ Native (flag on)              │
              │ streamText, error    │ streamRequest → adapter       │
              │ event → throw        │ provider-error → throw Error  │
              └─────────────────────────────────────────────────────┘
```

Il processor **non** distingue i runtime; vede solo `fullStream` e eccezioni.

---

## 2. Matrice propagazione — chat / session (native LLM)

### 2.1 Ingresso `LLM.stream` (`llm.ts`)

| Origine                                                 | Processor vede errore?     | Fallback AI SDK?  |
| ------------------------------------------------------- | -------------------------- | ----------------- |
| `nativeLlm` off                                         | —                          | N/A (solo AI SDK) |
| `status() === unsupported`                              | No                         | Sì (debug)        |
| `streamNative` unsupported                              | No                         | Sì                |
| Eccezione **sync** in `try { streamNative }` (L499–502) | No                         | **Sì** (warn)     |
| `provider-error` in stream                              | Sì (`throw`)               | No                |
| Fail iterator / Effect                                  | Sì                         | No                |
| `abort` in loop                                         | Sì (`MessageAbortedError`) | No                |

**Doppia chiamata provider:** possibile solo se native fallisce **prima** che il processor consumi eventi (prepare/sync), poi AI SDK riparte — degradazione P0 accettabile; **metricare** in P1.

**Corretto oggi:** nessun fallback AI SDK dopo partial stream native.

### 2.2 Processor (`processor.ts`)

| Evento         | Effetto                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `case "error"` | `throw value.error`                                                                                    |
| `tool-error`   | Part tool; permission/question → `blocked`                                                             |
| `default`      | `log.info("unhandled")` — eventi adapter non mappati finiscono qui se mai emessi come tipo sconosciuto |
| catch L623+    | `fromError` → retry o `Session.Event.Error`                                                            |

Tool: **solo processor** esegue tool (P0 `streamRequest`, no `ToolRuntime`).

### 2.3 `MessageV2.fromError`

| Input                              | Output `name`                             | Native          |
| ---------------------------------- | ----------------------------------------- | --------------- |
| `AbortError`                       | `MessageAbortedError`                     | ok              |
| `APICallError`                     | `APIError` (status, retry, headers, body) | **path AI SDK** |
| `LoadAPIKeyError`                  | `ProviderAuthError`                       | ok              |
| `ECONNRESET`                       | `APIError` retryable                      | ok              |
| `Error` da `provider-error`        | **`UnknownError`** (`e.toString()`)       | **gap**         |
| `ProviderError.HeaderTimeoutError` | `UnknownError`                            | **gap**         |
| altro                              | `UnknownError`                            |                 |

### 2.4 `SessionRetry.retryable`

- **`APIError`:** retry 429/5xx, `retry-after`, JSON in message — **completo**.
- **`UnknownError`:** retry solo se `data.message` parsabile da `mapJsonRetryMessage`.
- **`provider-error` con `retryable: true`** (es. Bedrock throttle): adapter fa `throw new Error(message)` → **flag `retryable` perso** → spesso **nessun retry** vs AI SDK.

**P1.2 (leva alta):** tradurre `provider-error` in throw che `fromError` classifica come `APIError` / `APICallError` **senza** nuovi `name` e **senza** edit processor (se possibile).

### 2.5 Compaction

- `finish-step` + usage → `isOverflow` → `needsCompaction`: **ok** se adapter mappa usage.
- Overflow solo come messaggio in `provider-error` → `UnknownError` → **compaction/retry non allineati** a `ProviderError.parseAPICallError` usato altrove.

### 2.6 TUI

- `Session.Event.Error` → toast `data.message`; skip `MessageAbortedError` (`app.tsx` L1258+).
- Stessi shape → **nessun cambio TUI** richiesto per P0 native.

### 2.7 `prepareRequest` (native off)

- Fail → `warn` non-fatal; **nessun** errore utente.

---

## 3. Matrice propagazione — opencode-parity (TUI)

| Spec              | Errori tipici | Rischio vs chat              |
| ----------------- | ------------- | ---------------------------- |
| 03 throttling     | `AbortError`  | Isolato; swallow             |
| 01 prompt history | FS blob       | Fail-soft; no session error  |
| 02 cache eviction | Stale UI      | Re-sync; pin sessione attiva |
| 04 virtualization | Render        | Flag fallback                |
| 06 i18n           | —             | Nessuno                      |
| 05 split file     | Refactor      | PR piccole                   |

Sessioni lunghe (native + tool) **aumentano carico TUI** → 02/04 aiutano; **non** cambiano `fromError`.

---

## 4. Invarianti integrazione

1. P0–P1: **no** refactor processor per native.
2. **No** nuovi `MessageV2` error `name` in P0.
3. **No** port OpenCode `provider-error.ts` in session (fase 1).
4. In-stream fatal: `provider-error` → `throw Error` (≈ AI SDK `error`).
5. Flag off = baseline.
6. Un solo tool loop.

---

## 5. Piano per fasi

### Fase 0 — P0 native chiusura (~1–2 gg)

| Task                                 | Errori                |
| ------------------------------------ | --------------------- |
| Smoke flag on/off                    | No toast su fallback  |
| `packages/llm` test                  | `provider-error` wire |
| Aggiornare plan clever-nebula        | Stato P0 done         |
| Doc: retry native ≠ AI SDK fino P1.2 | Aspettative           |

**Gate:** typecheck + session tests citati; chat + tool manuale.

**Già fatto:** adapter, native-runtime `llmStreamRequest`, branch `llm.ts`, fallback pre-stream.

---

### Fase 1 — Parità errori native (~1 settimana)

| ID  | Task                                                                  |
| --- | --------------------------------------------------------------------- |
| 1.1 | OAuth + `status` ↔ `mapToModelRef`                                    |
| 1.2 | Adapter `provider-error` → errore compatibile `fromError`/`retryable` |
| 1.3 | Overflow message → path compaction (test obbligatori)                 |
| 1.4 | Opz. `HeaderTimeoutError` in `fromError`                              |
| 1.5 | Log/metriche `llm.fallback`, `llm.runtime`                            |
| 1.6 | Test `native-runtime`; deprecare `native-request.ts`                  |

**Gate:** test adapter + estensione `retry.test`; `packages/llm` verde.

---

### Fase 2 — Schema flag parity (~2–3 gg, parallelo)

- Zod: `experimental.requests`, `.tui`, `.persist` (default off).
- `config/features.ts`.
- Aggiornare `opencode-parity/README.md` con chiavi config.
- **Nessun** wiring behavior.

---

### Fase 3 — Parity B1→B6 (settimane, 1 spec/PR)

1. **03** throttling
2. **01** prompt history
3. **02** cache eviction
4. **04** virtualization
5. **06** i18n (parallelo)
6. **05** modularize (continuo)

Ogni PR: gate F0 session tests + test spec; default flag **off**.

---

### Fase 4 — Opzionale (post-soak)

- Processor su `LLMEvent` diretto.
- P3 clever-nebula (cache-policy, protocol cherry-pick).

---

## 6. Rollback

| Problema          | Azione                             |
| ----------------- | ---------------------------------- |
| Stream/tool/retry | `experimental.nativeLlm: false`    |
| Retry native      | F1.2 o disabilita native           |
| TUI               | Kill switch flag spec              |
| Doppio billing    | F1.5; evitare fallback post-stream |

---

## 7. Verifica release

```bash
cd packages/nikcli && bun run typecheck
cd packages/nikcli && bun test test/session/llm-event-adapter.test.ts test/session/retry.test.ts test/session/processor-effect-service.test.ts
cd packages/llm && bun test   # se llm/adapter
```

Manuale: native off/on; unsupported provider; (post-B1) autocomplete burst.

---

## 8. Decisioni aperte

1. Ricostruire `APICallError` da `provider-error` + `providerMetadata`?
2. Vietare fallback post-partial-stream (raccomandato: sì).
3. Namespace config parity: tutto sotto `experimental`?

---

## 9. Priorità immediate

1. **F0** — llm test + doc gap retry.
2. **F1.2** — propagazione errori senza processor.
3. **F2** — flags schema.
4. **B1 (03)** — parity isolata.

**Realismo:** oggi native è **funzionale** ma **retry/overflow** possono divergere da AI SDK fino a F1; parity TUI è **ortogonale** e va per flag indipendenti.
