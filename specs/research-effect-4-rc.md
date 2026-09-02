# Effect 4: the beta.83 pin against the release candidate

Status: **Landed with E6** (measured 2026-08-26; pin moved the same day).

Research notes behind roadmap items E6, E7, H9 and H10. Everything here is a measurement, not a
plan: the break surface was obtained by diffing the shipped `.d.ts` of `effect@4.0.0-beta.83`
against `effect@4.0.0-rc.112` and grepping the result against this repository. Counts exclude
`node_modules`.

---

## 1. Where the pin sits

Nine workspace packages pin `effect` (and, in `packages/nikcli`, `@effect/platform-bun`) at
`4.0.0-beta.83`: `http-recorder`, `httpapi-codegen`, `llm`, `nikcli`, `plugin`, `sdk-next`,
`simulation`, `tui`, `util`. `bun.lock` resolves a single copy.

Upstream has moved on and changed channel:

| Version          | Published  |
| ---------------- | ---------- |
| `4.0.0-beta.83`  | the pin    |
| `4.0.0-beta.107` | 2026-08-10 |
| `4.0.0-rc.108`   | 2026-08-12 |
| `4.0.0-rc.112`   | 2026-08-25 |

The beta line ended at `beta.107`; `rc.108` opened the release-candidate line on 2026-08-12. The
pin is 29 releases and one channel behind, which is the fact that dates every "prefer the Effect v4
API already in the tree" judgement made since.

The exposed surface: **448** `from "effect"` statements, plus **96** from `effect/unstable/*`
(49 `httpapi`, 39 `http`, 7 `encoding`, 1 `observability`) and **15** from `@effect/platform-bun`.
By package: `nikcli` 339 files, `llm` 62, `httpapi-codegen` 12, `util` 8, `http-recorder` 8,
`simulation` 6, then one each in `tui`, `sdk-next`, `plugin`.

## 2. The break surface, measured rather than feared

Two renames account for **all** of it outside `packages/httpapi-codegen`.

**Removed from `Schema`** between the pin and `rc.112`: `DateValid`, `ErrorClass`,
`LazyArbitrary`, `TaggedErrorClass`, `UnknownFromJsonString`, `asClass`, `isDateValid`, `redact`,
`toArbitraryLazy`. This repository uses exactly two of them:

| Symbol                    | Sites | Files | Replacement                     |
| ------------------------- | ----- | ----- | ------------------------------- |
| `Schema.TaggedErrorClass` | 109   | 52    | `Schema.TaggedError` (beta.104) |
| `Schema.ErrorClass`       | 1     | 1     | `Schema.Error` (beta.104)       |

The rename aligns the Schema error constructors with their `Data` counterparts; the JavaScript
`Error` instance schema became `Schema.ErrorInstance`. Distribution of the 53 files: `nikcli` 42,
`httpapi-codegen` 5, `util` 4, `llm` 1 — 45 under `src/`, 7 under `test/` or `script/`.

**Removed elsewhere, and unused here** (0 sites each): `SchemaUtils` as a top-level module,
`Effect.withConcurrency`, `Context.getReferenceUnsafe`, `Context.mutate` (now `Context.addUnsafe`).
`Layer`, `Cause`, `Stream`, `ScopedCache` and `ManagedRuntime` lost no export at all — which
matters, because R1 just built the instance runtime on the last two.

**`effect/unstable/httpapi` renamed its type-level helper family.** `HttpApiEndpoint.Any` and
`AnyWithProps` became `Top` and `Constraint`; `HttpApiGroup.Any` became `Top`; the whole
`Name` / `*WithName` family became `Identifier` / `*WithIdentifier`; `HttpApiBuilder.HandlersTypeId`
is gone and `HttpApiGroup.Service` is new. Only generic derivation code names those helpers, so the
repository touches **6 sites in 2 files**, both in `packages/httpapi-codegen`
(`src/index.ts:54,99,1267,1457` and `test/generate.test.ts:28,32`). The 33 files that merely _build_
groups and endpoints do not name them.

**`@effect/platform-bun` lost nothing.** Same 22 modules; `BunHttpServer`, `BunFileSystem` and
`BunPath` — the three this repository imports — have no removed export between the two versions.
`BunHttpServer.WebSocketOptions` is added.

## 3. The changes with no symbol diff, which are the ones to be careful about

A `.d.ts` diff cannot see these. Each is a real behaviour change on a path this repository has.

- **Schema issues stop formatting implicitly (beta.105).** Issues no longer format through
  `Issue#toString`, and a failure surfaces as a structured `SchemaIssue.Issue` rather than a wrapped
  `SchemaError`. `server/httpapi/bridge.ts:245` documents the exact rendering it is protecting —
  `Expected string, got null at ["workspaceID"]` — reached through `logFailures`
  (`Effect.tapCause` → `Effect.logError("encoded route failed", cause)`) because the bridge sets
  `disableLogger` and removes Effect's own logger. That comment exists because two encode failures
  once answered an
  empty 400 with nothing logged at all. This is the one place in the upgrade where a silent
  regression is plausible, and it already has a written invariant to test against.
- **`SchemaError` moved into `Schema` (beta.108).** No import of the standalone module exists here
  (0 hits), and `Schema.SchemaError` is newly exported, so this is a non-event — recorded so nobody
  re-derives it.
- **`ConfigProvider.load` and the `make` lookup return `Node | undefined` (beta.103).** Only custom
  providers are affected. Usage here is `ConfigProvider.fromEnv` / `ConfigProvider.layer` in four
  `packages/llm` tests and `fromDotEnvContents` in one script; `ConfigProvider.fromEnvRecord` is the
  new constructor for the explicit-record case those tests hand-roll.
- **`Clock.Clock` requires `monotonicTimeNanos` / `monotonicTimeNanosUnsafe` (beta.103).** No custom
  `Clock` implementation exists here.
- **`Match.value` matcher type arguments changed (rc.111).** No `Match` usage here.
- **`Pool.State`, `Pool.PoolItem` and `Scope.State.Open` are new public shapes (rc.112).** No usage
  of either here; the `Pool` grep hits are this repository's own `OpenAIWebSocketPool`.
- **`Schedule.andThen` → `concat`, `Command.withHidden` → `unlisted`, `File.seek` returns `Size`.**
  0 sites each.

## 4. What the upgrade brings that this repository has an existing use for

Listed with the leftover each one addresses. None of these is admitted work on its own; H9 and H10
are the two that got roadmap entries, and both are gated.

- **`HttpApiSchema.WithHeaders` / `withHeaders` / `encodeToWithHeaders` (beta.104)**, with
  `OpenApi.OpenAPISpecHeader`. Typed response headers reach handlers, generated clients (including
  `HttpApiTest`), streaming responses and OpenAPI. Today every response header in the encoded
  surface is set outside the contract on a raw `Response` — 11 sites across `account.ts`,
  `auth.ts` (`www-authenticate`), `chatbot.ts`, `contract-extra.ts` (`location`), `event.ts`
  (`EventFeed.HEADERS`), `prompt.ts`, `sync.ts` (`retry-after`) and `users.ts` — so the generated
  SDK cannot see any of them. This is also the mechanism the release-trust brief needs for a
  revision-bearing health identity: `global.ts` currently answers `GET /global/health` with a body
  of `{ healthy, version }` and no revision header.
- **`Schema.TaggedUnion.matchOrElse` (rc.112)** — partial case matching with a typed fallback. The
  reason `SessionV2EntryList`, `SessionV2State` and `SessionV2EventList` are open in the SDK is that
  a closed union would freeze the contract to a variant set that grows without a bump. H10
  (2026-08-30) re-checked that against `matchOrElse` and kept the non-goal: the matcher is
  consume-time, and a half-open catch-all accepts malformed known members.
- **`SchemaBinary` and schema-aware RPC `codecFor` (rc.112).** Relevant in principle to sync frames
  and the browser-control daemon socket, whose payloads are validated loosely on purpose. No
  evidence of a problem either causes today. Not proposed.
- **`Effect.withExecutionPlan` lifecycle events via `onEvent` (beta.104).** 0 uses of
  `ExecutionPlan` here; the provider fallback ladder is hand-rolled. Worth a look only if the
  trusted-automation discovery finds a gap it fits. Not proposed.
- **HTTP response compression (beta.104).** No compression anywhere in `server/*.ts` today. There is
  no measurement saying payload size costs anything, and this repository has twice closed a
  performance item by measuring instead of building (P2.2, P3). Do not schedule it without a number.
- **`Schema.Graph`, `Schema.JsonObject`, `Pool.use`, faster synchronous decode/encode (rc.110–112),
  lightweight INI/YAML/TOML parsers and a vendored multipart parser (beta.104).** Recorded for
  completeness.

## 5. Two side effects of the upgrade worth naming

**The dependency tail shrinks.** `effect@4.0.0-beta.83` declares ten runtime dependencies —
`@standard-schema/spec`, `fast-check`, `find-my-way-ts`, `ini`, `kubernetes-types`, `msgpackr`,
`multipasta`, `toml`, `uuid`, `yaml`. `effect@4.0.0-rc.112` declares two: `msgpackr` and
`fast-check`. The parsers were vendored (`effect/unstable/encoding`,
`effect/unstable/http/MultipartParser`). Eight transitive packages leave the tree.

**The reference the working rules point at arrives in the package.** `beta.83` ships `dist`, `src`,
`README.md` and nothing else. `rc.112` also ships `AGENTS.md` (17 KB, byte-identical to the
`CLAUDE.md` beside it) and `ai-docs/` — 24 markdown sections and 50 compiled TypeScript examples,
covering `Effect.gen` / `Effect.fn` style, `Context.Service`, error handling, `Scope`, streams,
observability, testing, HttpApi servers and `HttpClient`.

That matters because the working rule used to name a local clone of effect-smol that existed only
on the author's machine (`/Volumes/SSD/Projects/nikcli/…`, recorded in
`.nikcli/plans/1780432203144-hidden-orchid.md:306` and `1780518271642-sunny-mountain.md:407` as a
clone made "per the `effect` skill"). **No such directory exists in this repository.** Anyone else
reading the old rule had nothing to check against, and `oxlint.slop.config.ts` still ignores the
`.opencode` tree. E7 replaces the dangling clone with the docs the package now ships.

## 6. Why the upgrade is the first item and not the fifth

Not urgency — order. Every other Effect-facing item in section 4 names an API that does not exist
at `beta.83`, so none of them can be started, prototyped or measured while the pin stands. The
upgrade is also the cheapest it will ever be: the break surface is two mechanical renames plus six
type-level sites in one package, and it grows with every release the pin skips. Waiting for `4.0.0`
final does not reduce the work — the renames already happened at `beta.104`, inside the window
already skipped.
