# simulation — drive deterministico della TUI (headless, replay, screenshot)

Status: **implementato** (2026-07-14, effect 4.0.0-beta.83)

## Cosa

Port di `@opencode-ai/simulation` (opencode branch `v2`, MIT) in `packages/simulation`
(`@nikcli-ai/simulation`). Permette di pilotare la vera TUI nikcli da un processo esterno in modo
completamente deterministico e offline:

- **frontend** (`src/frontend/`): renderer OpenTUI headless (`createTestRenderer`), harness di
  azioni UI (type/press/enter/arrow/click/resize/matches/state), screenshot PNG dei frame
  (`@napi-rs/canvas`, font "Nikcli Simulation Mono"), server WebSocket JSON-RPC (`ui.*`).
- **backend** (`src/backend/`): mock OpenAI-compatible SSE (`/v1/chat/completions`) + server
  WebSocket JSON-RPC di controllo (`llm.*`, `network.log`), con exchange espliciti guidati dal
  driver (`SimulationLLMExchange`: push di chunk, finish, disconnect).
- **recording** (`src/recording.ts`): `Timeline` JSONL versionato (header/output/resize, ANSI in
  base64 con timestamp ms) per registrare/riprodurre sessioni terminale.
- **driver** (`src/driver.ts`): client WebSocket JSON-RPC con retry durante il boot della CLI —
  è quello che i test usano per collegarsi a `ui` e `backend`.
- **manifest** (`src/manifest.ts`): `DriveManifest.resolve()` legge `NIKCLI_DRIVE` (nome del
  manifest) + `NIKCLI_DRIVE_REGISTRY_DIR` e risolve gli endpoint `ui` (ws), `backend` (ws),
  `openai` (http) + viewport/recording. Default: `ws://127.0.0.1:40900|40950`,
  `http://127.0.0.1:40960`.
- **protocol** (`src/protocol/`): schema Effect dei messaggi JSON-RPC di entrambi i lati.

## Wiring in nikcli

Due punti, entrambi lazy-import (regola startup-graph: la simulation non entra nel module graph
di avvio normale):

1. **Frontend** — `src/cli/cmd/tui/app.tsx`: se `NIKCLI_DRIVE` è settato, il renderer viene
   creato da `Drive.create()` (headless se `NIKCLI_DRIVE_RENDERER=headless`) che avvia anche il
   server WS `ui` agli endpoint del manifest.
2. **Backend** — `src/cli/cmd/tui/thread.ts`: se `NIKCLI_DRIVE` è settato, prima dello spawn del
   worker parte `SimulationBackend.start()` (mock OpenAI + WS di controllo, nel processo TUI) e
   il worker viene spawnato con `createWorkerEnv(simulationWorkerEnv(backend.openai))`:
   `NIKCLI_CONFIG_CONTENT` inietta il provider `simulation` (`@ai-sdk/openai-compatible`,
   baseURL del mock, costo 0) e forza `model: "simulation/deterministic"`, più
   `NIKCLI_DISABLE_MODELS_FETCH=1` e `NIKCLI_DISABLE_AUTOUPDATE=1`. Lo stop del worker ferma
   anche il backend.

## Divergenza architetturale dall'upstream (intenzionale)

Upstream (opencode v2) il worker è tutto Effect: in `OPENCODE_SIMULATE` il server sostituisce il
layer `HttpClient.HttpClient` con una route-table in-memory (`simulationReplacements`) e
`startDriveServer()` parte dentro il processo server. In nikcli il worker parla con i provider
via AI SDK (fetch reale), quindi il mock è un **vero server HTTP** (`Bun.serve`) e il worker ci
arriva via override di config/env — stesso contratto driver, trasporto diverso. Il
`backend/network.ts` nikcli ha 3 modalità (`NIKCLI_SIMULATION_MODE`):

- `driver` (default): risposte non scriptate, ogni richiesta apre un exchange che il driver
  soddisfa via `llm.chunk`/`llm.finish`.
- `record`: proxy verso l'upstream reale, scrive cassette via `@nikcli-ai/http-recorder`
  (rifiuta di registrare secrets).
- `replay`: riproduzione deterministica delle cassette, 409 con diff su richiesta non
  corrispondente; route ignote → 404 (nessun accesso di rete silenzioso).

Altre differenze di branding: font PNG "Nikcli Simulation Mono", env `NIKCLI_*` al posto di
`OPENCODE_*`.

## Uso

```bash
# manifest e2e.json in $REGISTRY: { endpoints: { ui, backend, openai }, viewport }
NIKCLI_DRIVE=e2e NIKCLI_DRIVE_REGISTRY_DIR=$REGISTRY NIKCLI_DRIVE_RENDERER=headless \
  bun run --conditions=browser ./src/index.ts ~/project --model simulation/deterministic
```

Poi dal driver: `connect(ui)` / `connect(backend)` (`src/driver.ts`), `llm.attach`,
`ui.type`/`ui.enter`, attendi `llm.request`, `llm.chunk`+`llm.finish`, `ui.matches`,
`ui.screenshot` (PNG in `NIKCLI_DRIVE_MEDIA_DIR`).

## Test

`packages/simulation/test/`:

- `recording.test.ts` — timeline JSONL (header/output/resize) + registrazione output OpenTUI reale.
- `actions.test.ts`, `protocol.test.ts` — harness e schema protocollo (port upstream).
- `backend.test.ts` — `workerEnv` (config provider iniettata), SSE driver-mode end-to-end,
  record/replay con cassette (mismatch → 409, replay senza rete).
- `visual.test.ts` — golden PNG (`UPDATE_VISUALS=1` per rigenerarlo).
- `e2e.test.ts` — spawna la **vera TUI nikcli** headless in drive mode, scambio LLM
  deterministico completo, verifica screenshot PNG e network log.

## Il bug del runtime-plugin OpenTUI (root cause dell'e2e rotto)

`TuiPluginRuntime` (`cmd/tui/plugin/runtime.ts`) importa
`@opentui/solid/runtime-plugin-support`, che registra a runtime un Bun plugin
con un **onLoad async catch-all** su ogni file `.js/.ts` e riscrive gli import
specifier dell'intero grafo. Due conseguenze per la simulation:

1. Dopo l'installazione del plugin, un `require()` CJS di un modulo non ancora
   in cache fallisce con "require() async module is unsupported" e un import
   ESM di un pacchetto CJS (es. `@napi-rs/canvas`) restituisce un namespace
   vuoto. Era questo a uccidere `png.ts` dentro la TUI reale.
2. Pre-caricare l'intero frontend simulation *prima* del plugin non è una fix:
   crea un **secondo grafo modulo parallelo** (harness e app su istanze
   diverse) e la UI va in blank dopo il submit.

Fix (tre pezzi):

- `frontend/canvas.ts`: modulo **senza dipendenze** che risolve il binding
  `@napi-rs/canvas` via `createRequire` e lo cachea su
  `globalThis[Symbol.for("nikcli.simulation.canvas")]`; `png.ts` legge da lì.
- `cmd/tui/thread.ts` (drive mode): chiama `canvas.preload()` prima di
  importare `./app` — solo il binding, mai il grafo frontend.
- `cmd/tui/attach.ts`: import di `./app` reso lazy (prima era statico → il
  plugin si installava all'avvio della CLI, prima di qualunque handler, e
  nessun preload poteva precederlo). Coerente con le regole startup-graph.

## Verifica finale (2026-07-14, post-fix runtime-plugin)

- `bun run typecheck`: pulito su tutto il repo.
- `bun test` in `packages/simulation`: 10/10 pass (incluso e2e reale, ~19s).
