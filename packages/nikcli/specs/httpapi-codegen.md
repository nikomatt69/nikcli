# httpapi-codegen — Effect-native + Promise SDK generation from HttpApi definitions

Status: **completo e integrato nella `PublicHttpApi` reale di nikcli**
(2026-07-14, Effect 4.0.0-beta.83)

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
- Test: **82/82 pass**, `bun run typecheck` pulito.
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
- `bun test` in httpapi-codegen: **82/82 pass**.
- Nessuna patch beta.65-specifica è sopravvissuta tranne il fix `Schema.Defect()` in
  `src/codemode/tool-error.ts` (stesso simbolo, comportamento opposto tra le due versioni).

## Integrazione nella vera `PublicHttpApi`

La generazione di produzione parte da `PublicHttpApi.Api` tramite
`packages/nikcli/script/generate-httpapi-clients.ts` e copre **22 gruppi / 170 endpoint HTTP**.
L'unica esclusione è `pty.connect`: è un upgrade WebSocket e non appartiene al trasporto HTTP dei
due client. L'API riflessa contiene quindi 171 endpoint totali.

Il generatore è stato esteso nei punti emersi dall'audit reale:

- payload non-struct (`Schema.Unknown` e `Schema.Record`) diventano un singolo input opaco
  `payload`, mantenendo intatto il body JSON invece di inventarne i campi;
- `omitEndpoints` usa sempre la chiave qualificata `gruppo.nome`, senza esclusioni collaterali;
- gli errori dichiarati senza discriminatore letterale vengono emessi come tipi strutturali; gli
  errori tagged/name-discriminated mantengono anche il type guard;
- le response `Text` (incluso `top-level.vcsDiffRaw`, `text/x-diff`) usano `Response.text()`;
- `relativeImportExtension: ".js"` produce import compatibili con TypeScript `NodeNext`.

Gli output sono separati in base alle dipendenze runtime:

- **Promise SDK pubblico**: `packages/sdk/js/src/httpapi/generated`, esportato come
  `@nikcli-ai/sdk/httpapi`; non dipende da Effect a runtime.
- **Effect client interno**: `packages/nikcli/src/server/httpapi/client/generated`, con shape API in
  `client/api`; importa `PublicApi` da `server/httpapi/public.ts`, quindi usa sempre lo schema
  autoritativo e supporta anche trasformazioni non portabili come `Schema.NumberFromString`.

Comandi:

```bash
cd packages/nikcli
bun run generate:httpapi-clients

cd ../sdk/js
bun run generate:httpapi
```

La scrittura dei tre output avviene in parallelo e ogni directory usa
`.httpapi-codegen.json` per eliminare esclusivamente i file generati diventati orfani.

## Verifica finale

- `bun run generate:httpapi-clients`: **22 gruppi / 170 endpoint generati**.
- `bun run typecheck` in `packages/httpapi-codegen`: pulito.
- `bun test` in `packages/httpapi-codegen`: **82/82 pass**.
- `bun run typecheck` in `packages/nikcli`: pulito, incluso il client Effect generato.
- `bun run typecheck` in `packages/sdk/js`: pulito in modalità NodeNext, incluso il client Promise.

`emitEffect` standalone resta intenzionalmente inadatto alla `PublicHttpApi` completa quando uno
schema non è ricostruibile fuori dal modulo sorgente. La produzione usa `emitEffectImported`, come
il client opencode v2 di riferimento, quindi questo non è un limite dell'integrazione.

## Parity del contratto con Hono (2026-07-14)

La generazione parte ora da `PublicApi` (contract = `PublicHttpApi.Api` servita + gruppi
contract-only senza handler: `sync` riallineato alle route Hono reali, `auth`,
`config-management`, `session-prompt`, `share`, `events`, `workspace-extra`, `users`,
`pty-connect`, `mobile` — 84 op). Ogni endpoint pinna l'operationId Hono via
`OpenApi.Identifier`; `generate.ts --httpapi` inietta i query param globali
`directory`/`workspace`. Misure:

- OpenAPI: Hono 280 op vs Effect 281 (extra: `DELETE /session/:id/message/:messageID`,
  endpoint reale del bridge), **0 op mancanti, 0 operationId divergenti**.
- SDK hey-api dalla spec Effect: **stesso albero di 78 classi/metodi** dell'SDK Hono.
- Typecheck repo con l'SDK da Effect: pulito ovunque tranne `@nikcli-ai/plugin`
  (importa i tipi nominati `Event`/`Message`/`UserMessage`/`Part`/`Todo`/`Model`/
  `SessionStatus`, oggi `Schema.Unknown` nel contract). Unico blocker rimasto per il
  flip del default — si chiude con lo schema split (MessageV2/Bus events in Effect Schema).

Estensione al generatore per questo lavoro: `compile(..., { clientPathsFromEndpointNames: true })`
— i client generati continuano a derivare i nomi dei metodi dai nomi endpoint Effect invece che
dagli `OpenApi.Identifier` (gli id Hono puntati, es. `provider.auth` + `provider.auth.remove`,
collidono come path client). Esclusioni client: `pty-connect.connect`, `mobile.ptyConnect`
(upgrade WebSocket) e `auth.set` (payload union: `HttpApiClient.ForApi` lo restringe al primo
membro — bug upstream da verificare a ogni bump di effect).

Client generati correnti: **30 gruppi / 278 endpoint** (Promise + Effect + shape).
