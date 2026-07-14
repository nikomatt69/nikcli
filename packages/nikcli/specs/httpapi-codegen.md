# httpapi-codegen — Effect-native + Promise SDK generation from HttpApi definitions

Status: **package ported and green; blocked on route-level parity for full nikcli coverage**
(2026-07-14, updated after bumping the repo's effect pin to 4.0.0-beta.83)

## Cosa

Port di `@opencode-ai/httpapi-codegen` (opencode branch `v2`, MIT) in `packages/httpapi-codegen`
(new workspace package, `@nikcli-ai/httpapi-codegen`). Genera due client TypeScript direttamente
da una definizione `HttpApi` di Effect — niente round-trip OpenAPI:

- **Effect client** (`emitEffect`/`emitEffectImported`/`emitEffectShape`): usa
  `HttpApiClient.ForApi<typeof Api>`, tipi derivati dagli schemi Effect.
- **Promise client** (`emitPromise`): wrapper fetch-based con tipi strutturali generati staticamente
  (nessuna dipendenza da Effect a runtime), per consumatori (mobile, desktop web) che non vogliono
  la dipendenza Effect.
- `write()` scrive su disco con un manifest `.httpapi-codegen.json` per pulizia incrementale
  (rimuove i file orfani tra una generazione e l'altra).

Riferimento upstream: così sono prodotti `packages/client` e `packages/sdk-next` di opencode v2
a partire da `packages/protocol/src/client.ts` (`ClientApi`, `groupNames`,
`effectOmitEndpoints`/`promiseOmitEndpoints`).

## Perché in nikcli

nikcli genera oggi l'SDK pubblico via Hono (`src/cli/cmd/generate.ts` + round-trip OpenAPI), non
dalla `PublicHttpApi` di Effect (`src/server/httpapi/public.ts`, 23 gruppi/78+ classi), perché la
spec Effect non aveva mai raggiunto parità con le route Hono reali (vedi memoria
`project_flipall_rollback`). Questo tool salta il round-trip OpenAPI e genera direttamente dalla
definizione `HttpApi` — se le route reali migrassero su Effect HttpApi, sbloccherebbe la
generazione SDK nativa.

## Stato del port

- Sorgente (`src/index.ts`, ~1540 righe) e test suite portati integralmente.
- Il repo era pinnato su `effect@4.0.0-beta.65`, 18 beta indietro rispetto a quella usata da
  opencode v2 (`4.0.0-beta.83`). Il primo port (stesso giorno) conteneva diverse patch strutturali
  per colmare il gap (tipi locali per `HttpApiSchema.Encoding`/`StreamSse`/`StreamUint8Array` non
  ancora esportati, `Schema.Defect` costante invece di funzione, marker di portabilità diverso,
  `yield*` esplicito su `Effect.fail`). **Il pin di effect è stato allineato a `4.0.0-beta.83`**
  (stessa versione di opencode v2) in tutto il monorepo (`packages/nikcli`, `packages/llm`,
  `packages/http-recorder`, `packages/httpapi-codegen`, + `@effect/platform-bun`/`platform-node`
  in tinta) — vedi sezione "Bump effect" sotto. Con beta.83 **il sorgente è pristino, 1:1 con
  l'upstream**: nessuna delle patch sopra è più necessaria.
- Unico adattamento sopravvissuto al bump, fuori da questo package: `src/codemode/tool-error.ts`
  (`Schema.Defect()` come funzione, non `Schema.Defect` costante — coerente con lo stesso fix qui).
- Branding: `@opencode-ai/httpapi-codegen` → `@nikcli-ai/httpapi-codegen`; `OpenCode` →
  `NikCli` come nome del namespace del client generato. Unica differenza permanente dall'upstream.
- Test: **78/78 pass** (73 + 5 test SSE, ripristinati col bump), `bun run typecheck` pulito.
- Script `script/generate-fixture.ts` per rigenerare gli snapshot di test da `test/fixture.ts`
  dopo modifiche all'emitter (mirror del pattern upstream `packages/client/script/build.ts`).

## Bump effect a 4.0.0-beta.83 (2026-07-14)

Il repo non usa il meccanismo "catalog" di bun per `effect` (a differenza di altre dipendenze) —
la versione è pinnata esplicitamente in ogni `package.json`. File aggiornati:
`packages/nikcli/package.json`, `packages/llm/package.json`, `packages/http-recorder/package.json`,
`packages/httpapi-codegen/package.json` (sia `effect` sia `@effect/platform-bun`/`platform-node`).

Verifica post-bump:
- `bun install` pulito (nessun conflitto di risoluzione).
- `bun run typecheck` pulito su tutti e 4 i package + su `packages/nikcli` per intero.
- `bun test test/codemode test/tool test/acp` in nikcli: **828/828 pass**, invariato.
- `bun test` in httpapi-codegen: **78/78 pass** (+5 rispetto a beta.65, i test SSE ripristinati).
- Nessuna patch beta.65-specifica è sopravvissuta tranne il fix `Schema.Defect()` in
  `src/codemode/tool-error.ts` (stesso simbolo, comportamento opposto tra le due versioni).

## Verifica contro la vera `PublicHttpApi` di nikcli (sotto beta.83)

Compilazione diretta (`compile(PublicHttpApi.Api)`) di tutti i 170 endpoint reali:

- **154/170 endpoint (91%) compilano puliti nel contratto.**
- 16 endpoint falliscono con `Input schema must be a struct` — payload deliberatamente
  non tipizzati (`Schema.Unknown` o `Schema.Record(Schema.String, Schema.Unknown)`), pattern
  intenzionale in nikcli per bridge/config a schema libero: `config.update`, `connectors.authSet`,
  `mission.upsert`/`update`, `loop.upsert`/`update`, `session.update`/`partUpdate`,
  `project.update`, `pty.update`, tutti i `tui.*` (`appendPrompt`, `executeCommand`, `showToast`,
  `publish`, `selectSession`, `controlResponse`). Non è un bug del generatore: è un vincolo di
  design (payload libero → nessun campo tipizzato da derivare per il client Promise).

Emissione sul sottoinsieme compilabile (154 endpoint) — **due emitter Effect, non uno**:

- `emitEffect` (ricostruisce ogni schema da zero, per un'API "generated") **fallisce** su
  `file.findFile`: il suo `query.limit` usa `Schema.NumberFromString` (una trasformazione), e la
  ricostruzione richiede che ogni schema coinvolto sia "portabile" — cioè riproducibile fuori dal
  modulo sorgente. Sotto beta.65 questo passava per via di una mia patch al marker di portabilità
  poi rimossa col bump: il comportamento pristino (corretto) lo boccia.
- `emitEffectImported` — **il vero emitter di produzione**, quello che opencode usa realmente per
  generare `packages/client` (`emitEffectImported(effectContract, { module: "...", api: "..." })`,
  vedi `packages/client/script/build.ts` upstream) — importa l'oggetto `HttpApi` autoritativo
  invece di ricostruirlo, quindi **non richiede portabilità** e genera pulito su **tutti e 154 gli
  endpoint**, `file.findFile` incluso. Il fallimento di `emitEffect` sopra è normale: quell'emitter
  serve solo a distribuire un client come pacchetto npm autonomo senza importare lo schema server.
- `emitPromise` è **molto più severo**: richiede errori con discriminatore letterale
  (`declaredErrorFields`) e success encoding Json/Uint8Array-only. Su nikcli fallisce già dal primo
  endpoint aggiuntivo escluso (`top-level.vcsApply`, poi a cascata su gran parte di `session.*` e
  `loop.*`) perché la tassonomia di errori reale di nikcli non è (ancora) modellata con
  discriminatori letterali ovunque. Il client Promise upstream funziona perché l'intera loro API è
  stata disegnata per quel constraint fin dall'inizio.
- Nota tecnica sul port: `omitEndpoints` filtra per **nome endpoint nudo**, non per
  `gruppo.nome` — su un'API con 78+ classi e nomi ripetuti fra gruppi (`update`, `get`, `create`
  ricorrono in decine di gruppi), questo causa esclusioni collaterali. Innocuo per l'API upstream
  (più piccola, nomi meno ripetuti); da qualificare per gruppo se si vuole un generate mirato su
  nikcli.

**Conclusione aggiornata**: usando l'emitter giusto (`emitEffectImported`, non `emitEffect`), il
client Effect-native si genera oggi, puro, su 154/170 endpoint (91%) — il blocco reale è solo il
client Promise (tassonomia errori) e i 16 endpoint a payload libero.

## Perché è "non un quick win" (confermato)

Il blocco non è nel generatore (che porta e funziona), ma nella **forma delle route reali**:
1. I payload a schema libero (`Schema.Unknown`/`Record`) sono design intenzionale su ~10% delle
   route — richiederebbero o schemi tipizzati (rompendo la flessibilità voluta) o un'estensione
   del generatore per emettere un campo payload opaco (`unknown`/`JsonValue`) invece di fallire.
2. Il client Promise richiede una convenzione di errore (discriminatore letterale ovunque) che le
   route nikcli non seguono sistematicamente — servirebbe un audit/rifattorizzazione della
   tassonomia errori attraverso 22 gruppi.
3. Nessuna delle due cose si fa "in un colpo" senza toccare le definizioni delle route reali —
   da qui l'aggancio alla migrazione Effect più ampia, non a questo pacchetto isolato.

## Follow-up possibili (medio termine, fuori scope oggi)

- Estendere `normalizeTransport`/`inputFields` per emettere un campo `payload: unknown` opaco
  quando lo schema non è uno struct, invece di lanciare — sbloccherebbe i 16 endpoint a schema
  libero senza toccarne la definizione.
  L'audit qui sopra fornisce la lista esatta di endpoint da coprire.
- Qualificare `omitEndpoints` per `gruppo.nome` per evitare le collisioni di nome nude su un'API
  di queste dimensioni.
- Solo dopo: uno script `script/generate-clients.ts` reale (mirror di
  `packages/client/script/build.ts` upstream) che scrive in `packages/sdk/js/src/v2` o analogo,
  sostituendo gradualmente il round-trip Hono→OpenAPI per i gruppi già compatibili.
