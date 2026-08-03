# Piano integrazione — verificato nel codice

Documento operativo per `packages/nikcli`. Non replica solo i flag `[ ]` / `[~]` del master plan: ogni fase indica **file toccati**, **criterio di done** verificabile con grep/test, e **dipendenze reali** osservate nel repo (2026-06-18).

Spec di riferimento: `ROADMAP.md`, `effect/http-api.md`, root `specs/08-unified-diff-hub.md`, `specs/09-cli-geolocalization-i18n.md`, e `specs/10-loops.md`.

---

## Principi

1. **Hono resta il server di produzione** finché `HttpApiBridge.implementedRoutes` non copre un path _e_ il SDK non è generato da Effect per quel path (`server/server.ts` L468, `httpapi/bridge.ts`).
2. **Session v2 HTTP** — Hono + HttpApi (`httpapi/session.ts` `v2Entries|v2State|v2Events`) e regex v2 in `bridge.ts`; `public.ts` deve registrare gli handler (duplicato di `SessionHandlersLive`).
3. **Quick win** indipendenti dal kill Hono: loop cancel desktop, Diff Hub fase 1, support attach, plugin keymap migration.
4. Dopo ogni fase Effect: aggiornare `effect/schema.md` e `ROADMAP.md` nello stesso commit.

---

## Fase 0 — Fix rapidi (1–2 settimane, parallelo)

| ID  | Deliverable                 | File / azione                                                                                                              | Done quando                                                       |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 0.1 | **Loop abort desktop**      | [x] `server/routes/loop.ts`: `POST /:id/abort`; SDK `loop.abort`; TUI `LoopApi.abort`                                      | [x] route + SDK; HttpApi `loop.abort` in F1.0                     |
| 0.2 | **Support file attach**     | `dialog-support.tsx` + `support-prompt-parts.ts`: paste path → file parts su `session.prompt`                              | [x] paste path; drag/@ full Prompt restano open                   |
| 0.3 | **Plugin interni → keymap** | `loops`, `mission`, `system/plugins`, `system/fusion`, `home/tips` → `api.keymap.registerLayer`; `keymap.ts` layer factory | [x] zero `api.command.register` in `feature-plugins/`             |
| 0.4 | **Bridge inventory doc**    | `specs/httpapi-bridge-inventory.md` + `script/httpapi-bridge-inventory.ts`                                                 | [x] v2/prompt/tui/loop/pty classificati; script `supports` matrix |

**Non dipende da:** E2, E5, SDK flip.

---

## Fase 1 — HttpApi: colmare i buchi del bridge (blocca tutto il resto server)

Ordine interno allineato a `effect/http-api.md` Phase 1–3.

| ID  | Deliverable                         | File                                                                                           | Done quando                                                                                       |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1.0 | **Loop HttpApi (F1 bridge)**        | [x] `httpapi/loop.ts`, `loop/generate.ts`, `public.ts` `LoopHandlersLive`, `bridge.ts` regex   | [x] `supports('/loop','GET')`, `supports('.../abort','POST')`; test `GET /loop`; inventory script |
| 1.1 | **Session v2 su HttpApi**           | [x] `httpapi/session.ts` + `bridge.ts` regex `GET .../v2/entries`, `state`, `events`           | [x] bridge test v2 + prompt paths                                                                 |
| 1.2 | **Bridge TuiHttpApi**               | [x] `TuiHttpApi` in `public.ts` + regex `/tui/*` in `bridge.ts`                                | [x] bridge test tui paths                                                                         |
| 1.3 | **Sync start** (dopo skeleton E2.1) | `httpapi` group sync; oggi blocked in spec per `Sync.Service`                                  | `POST /sync/start` bridged o documentato defer                                                    |
| 1.4 | **Prompt path default**             | [x] `httpapi/prompt.ts` + bridge `POST .../message`, `prompt_async`                            | [x] bridge test prompt 400/204                                                                    |
| 1.5 | **SSE `GET /event`**                | `httpapi/event.ts` — verificare se già in bridge (sì L33); parity comportamento vs Hono stream | test SSE byte-identical o accettato                                                               |
| 1.6 | **PTY WebSocket**                   | Piano esplicito `special` (Phase 7 http-api): raw Effect HTTP o keep Hono fino a design        | ADR in `effect/http-api.md`                                                                       |

**Criterio fase 1 chiusa:** tutti i JSON route usati da TUI/SDK v2 hanno entry in `implementedRoutes` _oppure_ ADR “resta Hono” con test fallback.

---

## Fase 2 — SDK flip + Hono deletion incrementale (E4 + E5)

| ID  | Deliverable              | File                                                                                             | Done quando                                        |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 2.1 | **OpenAPI PR5 sweep**    | Per-group error schemas in `httpapi/*`                                                           | checklist deletion http-api.md item 1–4 per gruppo |
| 2.2 | **SDK diff zero**        | `packages/sdk/js/script/build.ts` `NIKCLI_SDK_OPENAPI=httpapi`; `public.ts` normalizzazioni      | `bun run` build SDK; diff review vs Hono           |
| 2.3 | **Default backend**      | `Flag.NIKCLI_EXPERIMENTAL_HTTPAPI` invertito o `server/backend.ts` fork-at-startup (spec target) | nuove installazioni senza flag                     |
| 2.4 | **Delete Hono gruppo 1** | Es. `routes/config.ts` dopo parity                                                               | nessun `describeRoute` per path eliminato; SDK ok  |
| 2.5 | **Ripeti 2.4**           | session (ultimo), loop, file, mcp, …                                                             | `server/server.ts` non importa gruppo rimosso      |

**Non iniziare 2.3** finché 1.1–1.4 non passano test bridge per i path che il TUI usa ogni giorno.

---

## Fase 3 — Session v2 write path (E7, prodotto)

| ID  | Deliverable                            | File                                                             | Done quando                                               |
| --- | -------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| 3.1 | **Engine swap**                        | `session/prompt.ts`, `session/runner.ts`, `session/processor.ts` | nuovi messaggi passano da stepper v2 senza solo projector |
| 3.2 | **Option 2 mutators**                  | `specs/v2/message-shape.md` hooks                                | test `v2-conversion`, `v2-projector` estesi               |
| 3.3 | **SSE `session.v2.updated`** già wired | verificare parity con write path                                 | TUI live update su write nativo                           |

**Dipende da:** storage SQL (done), non da kill Hono completo (read già Hono).

---

## Fase 4 — Effect platform services (E1 + E2 + E6 + E8)

| ID  | Deliverable                | File                                                                    | Done quando                                                                         |
| --- | -------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 4.1 | **Session domain schemas** | `effect/schema.md` inventory → migrate batch                            | meno `.zod` duplicati su boundary migrati                                           |
| 4.2 | **Sync.Service Effect**    | nuovo servizio in `src/sync/`; migrate una callsite da `namespace Sync` | `grep Sync.Service` > 0; test                                                       |
| 4.3 | **Workspace.Service**      | `workspace/` Effect layer                                               | idem                                                                                |
| 4.4 | **Boot ScopedCache**       | `effect/instance-state.ts` + bootstrap                                  | item E2 Phase G acceptance in schema.md                                             |
| 4.5 | **Shrink Instance**        | `project/instance.ts`, `effect/with-instance.ts`                        | `Instance.provide` solo in bridge legacy; resto `withInstanceAsync` / InstanceState |
| 4.6 | **Flag sweep**             | `flag.ts` reads → RuntimeFlags                                          | `grep 'Flag\\.' src/` trend a zero                                                  |

**Ordine:** 4.2–4.3 sbloccano 1.3 sync; 4.5–4.6 dopo E5 riduce churn (master plan sequencing).

---

## Fase 5 — Diff Hub (spec 08, UX)

| ID  | Deliverable             | File                                                                                   | Done quando               |
| --- | ----------------------- | -------------------------------------------------------------------------------------- | ------------------------- |
| 5.1 | **Skeleton `/diff`**    | partire da `src/cli/cmd/tui/routes/changes/index.tsx` e `specs/08-unified-diff-hub.md` | navigazione da session    |
| 5.2 | **Source working-tree** | `vcs.diffRaw` / API esistente + TUI                                                    | source `git` in hub       |
| 5.3 | **Commit + PR sources** | `git/show`, PR diff endpoint se mancanti desktop                                       | Enter da git-graph/github |
| 5.4 | **Shared primitives**   | estrarre tree/patch da `changes/`                                                      | LOC shared, KV `diff.*`   |

**Indipendente da** kill Hono; dipende da sync session diff già in TUI.

---

## Fase 6 — Locale / i18n (spec 09)

| ID  | Deliverable                 | File                                                                    | Done quando                           |
| --- | --------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| 6.1 | **Geo.Service**             | seguire `specs/09-cli-geolocalization-i18n.md`                          | test offline fallback                 |
| 6.2 | **dialog-locale + /locale** | TUI command keymap                                                      | picker region/language                |
| 6.3 | **i18n catalog**            | estendere `src/locale/` seguendo `specs/09-cli-geolocalization-i18n.md` | parity test come app                  |
| 6.4 | **Intl migration**          | ~8 file TUI elencati in spec 09                                         | no hardcoded `en-US` nei path migrati |

**P1 già fatto:** `config.locale`, `locale/resolve.ts`, `cmd/locale.ts`.

---

## Fase 7 — Loops Phase 3 (spec 10)

| ID  | Deliverable                  | File                                            | Done quando                |
| --- | ---------------------------- | ----------------------------------------------- | -------------------------- |
| 7.1 | **0.1 loop cancel**          | (Fase 0)                                        | —                          |
| 7.2 | **Trigger `event`**          | `loop/schema.ts`, `engine.ts`, bus subscription | schema discriminated union |
| 7.3 | **Guardrails approval/cost** | loop definition + engine checks                 | spec 10 Phase 3            |
| 7.4 | **Promote goal → loop**      | TUI + command                                   | UX Cherny loop             |

---

## Fase 8 — v2 launch blockers (E7 tail)

| ID  | Deliverable                       | Dipendenze                     |
| --- | --------------------------------- | ------------------------------ |
| 8.1 | Server plugin API v2              | root `specs/v2/todo.md`        |
| 8.2 | Config rework + hot-reload events | event bus                      |
| 8.3 | Embedded `v2/api.ts`              | **dopo** E5/E6 (master plan)   |
| 8.4 | Plugin CLI uninstall/list         | `plugin/install.ts` simmetrico |

---

## Fase 9 — E9 `packages/server` extract

Ultima: `specs/effect/server-package.md`. Solo quando `server/server.ts` non è più Hono monolith.

---

## Roadmap visiva (dipendenze)

```text
Fase 0 (parallel) ─────────────────────────────────────────►
Fase 1 HttpApi gaps ──► Fase 2 SDK flip + kill Hono ──► Fase 9
         │                        │
         └──► Fase 4.2 Sync (per 1.3)     └──► Fase 4.5–4.6 ALS/Flag
Fase 3 v2 write (parallel dopo 3.1 indipendente da Hono)
Fase 5 Diff Hub (parallel)
Fase 6 Locale (parallel)
Fase 7 Loops (0.1 poi resto)
Fase 8 embed API (after Hono)
```

---

## Cosa NON è gap nikcli `src/`

- **Bedrock `providerOptions`:** wired in `packages/llm` (audit explore).
- **Generative TUI agent path:** done (`tool/opentui.ts`).
- **Storage SQL:** done.
- **Notifications:** `tui.sound` opt-out — trattare master `[~]` come done nel prossimo audit commit.

---

## Prossima azione consigliata

1. Aprire PR **0.1** (loop cancel) — ~1 giorno.
2. In parallelo PR **1.1** (session v2 bridge) — sblocca parità per client che useranno HttpApi.
3. Aggiornare questo file quando un ID passa a done con commit hash.
