# Codemode — confined code execution over schema-described tools

Status: **implementato** (port da opencode v2, 2026-07-14; effect pin allineato a beta.83 lo
stesso giorno — vedi la sezione "Bump effect" in `specs/httpapi-codegen.md`)

## Cosa

Port di `@opencode-ai/codemode` (opencode branch `v2`, MIT) dentro `packages/nikcli/src/codemode`.
Un interprete puro (acorn AST + walker, nessun `eval`/`Function`/isolate) esegue programmi in un
DSL JavaScript-like. Il programma non ha ambient authority: niente `fetch`, `process`, filesystem,
timer o globals dell'host — ogni effetto passa esclusivamente dall'albero `tools.*` fornito
dall'host, con input/output validati (Effect Schema) o descritti (JSON Schema render-only).

Riferimento upstream: `packages/codemode` @ anomalyco/opencode v2 (~8.3k LOC src + test suite con
subset test262). Idea originale: Cloudflare "code mode"; qui senza sandbox/isolates.

## Perché in nikcli

1. **Sicurezza**: oggi `exec_code` esegue il codice del modello con `new Function` in un Bun
   `Worker` (`src/session/native-executor.ts:77`) — runtime JS reale, escape banale (import,
   fetch, process). L'interprete confinato elimina la classe di problema.
2. **Round-trip**: un programma orchestra N tool in una singola chiamata modello.
3. **Effect-native**: tool definiti con Effect Schema, esecuzione come `Effect` — allineato alla
   migrazione Effect di nikcli.

## Architettura del port

```
packages/nikcli/src/codemode/
  index.ts            # re-export pubblici (CodeMode, Tool, toolError, …)
  codemode.ts         # CodeMode.make / execute, Result, diagnostics, instructions()
  values.ts           # confini plain-data (JSON-like), copy/normalize
  tool.ts             # Tool.make (Effect Schema o JSON Schema render-only)
  tool-schema.ts      # rendering firme TS model-visible dagli schema
  tool-runtime.ts     # invocazione supervisionata dei tool dal programma
  tool-error.ts       # toolError(), errori tipizzati verso il programma
  interpreter/        # execute (transpile TS→JS via typescript.transpileModule, parse acorn),
                      # runtime, scope, methods, promises (eager+supervised), references, errors
  stdlib/             # subset allowlisted: Object/Array/String/Number/Math/JSON/Date/RegExp/
                      # Promise/URL/console/collections
```

Escluso dal port: `openapi/` (generazione tool da spec OpenAPI — non serve per l'integrazione
registry; eventuale fase successiva) e relative fixtures/test.

Test: `packages/nikcli/test/codemode/` — codemode, stdlib, promise(+test262), enumeration,
signature, parity, array/string test262.

Dipendenze nuove: `acorn` (parser). `typescript` e `effect` già presenti.

## Integrazione: tool `code_mode`

Nuovo `src/tool/code_mode.ts` + `code_mode.txt`, modellato su `exec_code`:

- Albero `tools.*` costruito dai tool del `ToolRegistry` (stessa `EXCLUDED` list di `exec_code`
  per evitare ricorsione/dipendenze UI), invocati via `executeAsync(args, ctx)` così permission
  (`ctx.ask`) e truncation restano quelli del tool loop.
- Firme model-visible: JSON Schema derivato dagli zod parameters dei tool (`z.toJSONSchema`),
  passato a `Tool.make` come schema render-only; la validazione vera resta nello zod del tool.
- Progress: `onToolCallStart/End` → `ctx.metadata({ toolCalls })` (pattern del tool dev-branch
  `code-mode.ts` di opencode).
- Cancellazione: `ctx.abort` interrompe l'esecuzione (race con l'Effect di execute).
- Gating: `Flag.NIKCLI_EXPERIMENTAL_CODE_MODE` — **default on**, opt-out con
  `NIKCLI_DISABLE_CODE_MODE` (stesso pattern di browser/computer tool). Registrato in `registry.ts`.
- `exec_code` è **deprecato**: rimosso dal registry di default (2026-07-14, richiesta esplicita),
  sorgente mantenuto con nota di deprecazione in `src/tool/exec_code.ts` fino alla rimozione.
  I rendering TUI/ACP/run mantengono il ramo `exec_code` per le sessioni storiche.
- Rendering: `code_mode` riusa il componente TUI `ExecCode` (session/index.tsx), kind ACP
  `execute` (acp/tool.ts) e la label "Exec" in `run.ts`, come exec_code.

## Rischi / note

- **Drift effect**: risolto — nikcli ora è su `effect@4.0.0-beta.83`, stessa versione upstream.
  Il sorgente di `src/codemode/` è pristino 1:1 tranne `tool-error.ts` (`Schema.Defect()` come
  funzione, non `Schema.Defect` costante — la shape è cambiata tra le beta, verificata al
  typecheck). Se il repo bumpa ulteriormente effect in futuro, ricontrollare quel simbolo.
- Il DSL è un subset JS documentato upstream in `interpreter-support.md`: syntax non supportata →
  diagnostic `UnsupportedSyntax`, niente classi/generatori/thenable assimilation.
- Promises eager e supervisionate: ciò che non è awaited al return viene interrotto; rejection
  non awaited → `warnings` sul Result.
- Licenza: upstream MIT; header di attribuzione nel modulo `index.ts`.

## Fasi

1. ✅ Spec (questo file)
2. ✅ Port sorgenti `src/codemode` + dep acorn (import normalizzati allo stile repo, senza `.js`)
3. ✅ Adattamento effect beta.65 — unico drift: `Schema.Defect()` → `Schema.Defect` (costante in
   beta.65); `bun run typecheck` pulito
4. ✅ Port test suite: 761 test / 0 fail (`test/codemode`, 12 file, incl. subset test262)
5. ✅ Tool `code_mode` default-on nel registry + `test/tool/code-mode.test.ts` (3 test di
   integrazione: registrazione, programma end-to-end glob→read via registry reale in
   `InstanceScope`, confinamento — `process.env` respinto con diagnostica)
6. ✅ Verifica: typecheck + `bun test test/codemode test/tool` → 800 pass / 0 fail

## Follow-up possibili

- Rimuovere del tutto `exec_code.ts` + `session/native-executor.ts` dopo un ciclo di release
  (oggi deprecati e non registrati).
- Esporre `CodeMode.instructions()` (catalogo firmato dei tool) nel system prompt invece della
  sola lista di nomi nella description del tool.
- Port del layer `openapi/` upstream per generare tool codemode da spec OpenAPI (connectors/MCP).
