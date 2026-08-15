# TUI Package Extraction

| Field  | Value                                                                   |
| ------ | ----------------------------------------------------------------------- |
| Status | **In progress** — sections 1–3 landed 2026-08-14; 240 `@/` imports → 46 |
| Scope  | `packages/nikcli/src/cli/cmd/tui` → `packages/tui`                      |
| Buys   | A TUI that builds, tests, and starts without the backend graph          |

## Goal

Move the terminal application from `packages/nikcli/src/cli/cmd/tui` into a self-contained workspace package while the CLI keeps using the same implementation.

```text
packages/tui
name: @nikcli-ai/tui
```

Target dependency graph:

```text
packages/nikcli ----\
                     > @nikcli-ai/tui -> @nikcli-ai/sdk
packages/desktop ---/
```

The TUI may depend directly on terminal and UI infrastructure — `@opentui/core`, `@opentui/solid`, `@opentui/keymap`, `solid-js`, Effect, `@nikcli-ai/tui-math`, `@nikcli-ai/tui-image` — and on generic presentation libraries. It must not depend on `packages/nikcli` internals.

The SDK is the TUI's backend boundary. Missing data or operations get added to the HttpApi and the generated client, not imported from a server module.

## Current State

Measured 2026-08-14, after sections 1–3:

| Fact                        | Value                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Files                       | 256 `.ts`/`.tsx`                                                                                                        |
| Lines                       | ~68,000                                                                                                                 |
| Largest subtrees            | `component/` 75, `feature-plugins/` 47, `routes/` 40, `util/` 33, `context/` 26                                         |
| Files already using the SDK | 73                                                                                                                      |
| `@/` import statements      | **46 static + 5 dynamic** (was 240 static) — 11 of the static ones are in `thread.ts`/`worker.ts`, which are host files |
| Path alias                  | `@tui/*` → `./src/cli/cmd/tui/*` (already package-shaped)                                                               |

The `@tui/*` alias is the good news: internal imports are already written as if the directory were a package root, so most files move without an edit.

### What Actually Blocks The Move

There are **46 static and 5 dynamic `@/` import statements** left. Excluding the eleven in the two host files, the TUI proper sits at 35 + 5 — and what remains is a different kind of problem from what was removed: not modules in the wrong folder, but the terminal calling backend services in-process.

| Concern                                                                      | Count | What it needs                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@/effect` (+ `@/effect/runtime`)                                            |    11 | The vehicle, not the target: it goes when the calls below do.                                                                                                                 |
| `@/plugin/*` (herdr, island, shared, meta, install)                          |     8 | Plugin install and the two bridges are host operations; invert them the way `upgradeNow` already is.                                                                          |
| `@/config/*`                                                                 |     3 | `plugin/runtime.ts` still calls `TuiConfig.{sources,reload,get,waitForDependencies}` for plugin install and hot reload — host operations, not config reads.                   |
| `@/user/users`, `@/account`, `@/auth`                                        |     7 | The login dialogs call `UserDB` directly. `/user/*` exists but as raw handlers outside the OpenAPI surface, so it is not in the generated client — reach it with `sdk.fetch`. |
| `@/image/photon`                                                             |     4 | **Deliberately left** — see below.                                                                                                                                            |
| `@/tool/speak/openrouter`                                                    |     2 | Needs an audio-models endpoint.                                                                                                                                               |
| `await import("@/…")` — `@/chatbot` (3), `@/brain/scheduler`, `@/user/users` |     5 | Whole subsystems, lazily loaded.                                                                                                                                              |

**Count `await import("@/…")` too.** A static grep for `from "@/"` misses five more: `@/chatbot` (3), `@/brain/scheduler` (1), `@/user/users` (1). Lazy-loading a subsystem keeps it out of the startup graph, which is why they were written that way — but it does not decouple anything, and it hides the dependency from exactly the measurement this document runs on.

**`@/image/photon` stays where it is on purpose.** It primes `globalThis.__NIKCLI_PHOTON_WASM_PATH` before the decoder's first `import()`, and its own comment records the failure mode when that resolution is wrong: _"a compiled binary loses the WASM decoder entirely."_ Moving a bundler-sensitive asset path for four imports, when no test exercises image decoding from the installer binary, trades a verified state for an unverifiable one.

### The first service over the wire: `GET /tui/config`

Landed 2026-08-14, as the worked example of the pattern the rest of the list follows. Three things it taught, none of which were visible from the source:

**The renderer's config read cannot go over the wire.** `tui()` reads the config to build `rendererConfig`, so it happens _before the renderer exists_ — and at that instant no transport does either. The HTTP server has not been asked to listen, and the worker has not installed its RPC `onmessage`. Over HTTP the call fails with `ClientError: Transport`; over worker RPC it is worse, because `Rpc.call` posts a message and waits on a promise with no timeout, so the first frame never arrives. That one read stays local, deliberately, with a comment saying why. Everything after the first frame uses `sdk.client.tui.config()`.

**The response encoder validates, and `undefined` is not JSON.** Merging the config search path leaves explicitly-`undefined` keys behind. Encoding one fails with `SchemaError: Expected JSON value, got undefined`, which surfaces as **400 with an empty body** — from the terminal, indistinguishable from an empty config, and nothing is logged unless you run the server with `--print-logs`. The handler round-trips through JSON, the way `loop.ts` already does. Regression test: `test/server/httpapi-tui-config.test.ts`, verified to fail when the round-trip is removed.

**`zod-effect` could not describe the document.** `fromZod` threw `unsupported zod node "tuple"` on `PluginSpec` — a plugin entry is either a bare specifier or a `[specifier, options]` pair — so the route could not be declared at all until the walker learned tuples. That gap was reachable from `nikcli.json` too, not just here.

### Services that already had endpoints

Two more moved the same day, and neither needed a new route — only a call site.

**Connectors.** `feature-plugins/connectors` ran `Connectors.status()`, `ConnectorAuth.remove()` and the three `invalidate*` calls in-process, lazily importing `@/connectors` because it drags the `ai` package chain. `GET /connectors/`, `DELETE /connectors/:name/auth` and `POST /connectors/invalidate` already covered all of it, including the "invalidate everything" case (the handler branches on whether `name` is present). Four imports gone, the lazy-import concern with them, and `Connectors.Status` came from the contract as `ConnectorStatus`.

**Mobile pairing** — and a contract drift worth generalising. The dialog polls `MobileAuth.list()` to see whether a phone has connected, which it decides from `lastUsedAt`. `sdk.client.mobile.auth.token.list()` returned a type without that field: the Effect schema in `httpapi/mobile.ts` was **hand-copied** from the zod `MobileAuth.PublicToken` and had fallen behind it. Deriving it with `fromZod` — the same treatment `config.ts` documents — restored `lastUsedAt` and removes the whole class of drift. Any hand-written Effect struct sitting next to a zod source is a candidate for the same fix.

**Brain.** The session footer recomputed the brain's state from three in-process reads — `getBrainConfig()`, `readLastBrainAt()`, `getSessionsCountSince()` — on a 60-second timer, and `GET /brain` already returns exactly that triple plus `shouldTrigger` and the model. The settings dialog wanted the same config, and `/brain/trigger` covered the plugin's "Run Brain" command. Four dynamic imports gone; only `initBrainScheduler()` stays, because starting a scheduler is a host operation, not a read.

Verifying these means curling the routes against a real server; `bun run src/index.ts serve --port …` is enough and much faster than building a binary. Watch for stray writes while you do it: creating a mobile token during a probe writes to the user's real token store, so revoke it afterwards.

### `/profile`, and where a preview belongs

The profile dialog ran five `Profile.Service` operations in-process. They are now `GET`/`PATCH`/`DELETE /profile` plus `GET`/`DELETE /profile/habits`, with two details worth keeping:

**An absent profile has to encode as `null`.** `profile.get()` returns `undefined` when the user has not set one up, and the encoder rejects that — the same "Expected JSON value, got undefined" trap as `/tui/config`, hit from a different direction. The handler maps it, and the test asserts the `null`.

**The prompt preview moved to the server, not to a shared module.** The dialog showed what agents receive by calling `Profile.render(info)` and `renderHabits()` locally. Extracting those looked right until the render turned out to read fifteen fields through a helper — a second renderer to keep in step with the first, for a preview whose whole point is fidelity. `GET /profile/preview` returns the rendered lines and the habits path from the code that actually builds the block. Regression test: `test/server/httpapi-profile.test.ts`.

Loop validation went the other way for the same reason: `isValidModel`, `validateStage` and `validateDefinition` produce the messages a user sees _while typing_, so a round trip is the wrong shape. They are `@nikcli-ai/util/loop-validation`, typed structurally, with `loop/schema.ts` re-exporting them. When copying a block like that, extract it from the file rather than retyping it — `formatDuration` has a two-branch shape that is easy to "remember" wrong, and every interval message depends on it.

### Three more that were never backend

`cli/error` (176 lines) already imported nothing but `@nikcli-ai/util/*` — pure error presentation, now `@nikcli-ai/util/cli-error`. The mobile pairing dialog wanted three helpers (`buildMobilePairingDeepLink`, `getLocalIPs`, `isLoopbackHostname`) and imported the whole `mobile` **command** to get them, dragging `Server` and `MobileAuth` in to build a URL; they are now `@nikcli-ai/util/mobile-pairing`.

The four `TuiEvent` definitions split the same way: names and payloads are `@nikcli-ai/util/tui-event-schema`, and `src/bus/tui-event.ts` is now just the `BusEvent.schema` wrapping. One definition, two projections — the terminal takes the names to subscribe and the zod form to parse a toast, and neither can drift from what the server publishes.

**A bug found by moving one of them.** `app.tsx` reported a failed self-update with `error instanceof Installation.UpgradeFailedError ? error.stderr : …`. That check could never be true: the upgrade runs in the worker, and `Rpc.deserializeError` rebuilds a plain `Error` from `{name, message, stack}` — the class does not cross a worker boundary, and `stderr` was not even serialized. Since `UpgradeFailedError.message` is empty by design, every failed update showed the generic "Update failed" with no reason. Worse, a source-reading test _required_ the broken form. `serializeError` now carries the error's own fields and the handler matches on `name`; `test/tui/rpc-error.test.ts` covers the round-trip, and the old test asserts the `instanceof` form is **absent**.

`cli/remote` — 1889 lines across seven files, with **zero** `@/` imports — moved to `@nikcli-ai/util/remote-tunnel`. Two traps there. A grep for `cli/remote` said the TUI dialog was the only consumer; `src/cli/cmd/remote.ts` and `src/cli/ui.ts` reach it as `../remote` and `./remote`, so the relative forms have to be part of the search or the conclusion inverts. And `packages/util`'s exports map is `"./*": "./src/*.ts"`, which resolves a _file_: a directory needs its own entry, hence the explicit `"./remote-tunnel"`. It is named for the tunnel rather than "remote" because `@nikcli-ai/remote` is a different package it depends on.

### Inverting the server start

`worker.ts` is the one that decides the transport, and section 3 must preserve what it does rather than replace it with a URL. In a normal run the TUI has **no listening HTTP server**: `thread.ts` sets `url = "http://nikcli.local"` — a synthetic hostname — and hands the SDK `createWorkerFetch(client)`, which marshals requests over worker RPC straight into `Server.fetch`. A host that "hands the TUI a base URL" without also handing it that transport produces a TUI where every request fails DNS silently: no error, no router log line, and nothing that fails at build time. This is not hypothetical — it is what disabled the analytics panel's history for weeks (see `test/tui/analytics-transport.test.ts`).

## Migration Rules

- Keep one canonical implementation of every TUI feature. Do not copy the tree and synchronize two of them.
- Land each section below independently and commit at its boundary. Every intermediate commit must build and typecheck (`bun run typecheck`).
- Use temporary compatibility re-exports only where they materially reduce conflict risk, and mark them for removal in a named later section.
- Do not preserve a private import by aliasing `packages/tui` back into `packages/nikcli`.
- Keep tool rendering tolerant of unknown tools and wire-format drift. Local checks over `unknown` metadata are fine; importing a backend tool implementation for type safety is not.
- Keep CLI argument parsing, server startup, worker management, auth, and config discovery **outside** `@nikcli-ai/tui`.

## Ownership Boundary

### `@nikcli-ai/tui` owns

- The OpenTUI renderer lifecycle and app entry (`app.tsx`)
- Solid application composition, routes, dialogs, components, contexts
- Themes, keymaps, i18n, and UI primitives
- Feature plugins (`feature-plugins/`, 47 files) and the TUI plugin host
- Rendering of tool calls, diffs, markdown, and math

### `packages/nikcli` keeps

- The `tui` command, server bootstrap, and instance binding — **including `thread.ts` and `worker.ts`**, which contain no UI. `worker.ts` is the backend half of the worker (it owns `Server`, `Instance`, `InstanceBootstrap`, `GlobalBus`, upgrades and event streams); `thread.ts` is the yargs `$0` command that spawns it and then calls `tui()`. Together they carry 12 of the TUI tree's remaining `@/` imports, and they are most of the reason the tree still looks coupled.

  **They keep their current path and filenames** (`src/cli/cmd/tui/{worker,thread}.ts`). That path is load-bearing: `script/build.ts`, `packages/nikcli/script/{build,cross-build-windows}.ts` and the `NIKCLI_WORKER_PATH` define all name `./src/cli/cmd/tui/worker.ts` literally, and the compiled binary emits the worker chunk at the matching bunfs path. Section 4 therefore **excludes these two files from the tree move** rather than relocating them beforehand — the exclusion is the cheap operation, the rename is not. Relocating them was tried on 2026-08-14 and reverted; it works (build and binary verified) but buys nothing that the exclusion does not.

- Everything under `src/session`, `src/server`, `src/provider`, `src/tool`
- Config discovery and the auth flows the TUI triggers over HTTP

## Sections

Each section is independently landable and independently revertible.

**1. Extract shared infrastructure.** Move `@/util/*`, `@/flag`, `@/id`, and `@/global` path resolution into a package both sides depend on (`packages/util` already exists — extend it rather than creating another).

Before moving anything, check who the consumers actually are. A module the TUI alone uses does not belong in a shared package; it belongs in the TUI, where relocating it costs nothing and needs no dependency decision.

Landed 2026-08-14. `packages/util` now depends on `effect` and `xdg-basedir`, which was the decision blocking most of this.

| Module                                                                            | Move                             | Why                                                                    |
| --------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `util/keybind`, `util/rpc`                                                        | → `@tui/util/*`                  | Zero consumers outside the TUI.                                        |
| `util/iife`                                                                       | deleted → `@nikcli-ai/util/iife` | Byte-identical duplicate of the packaged one.                          |
| `global`                                                                          | → `@nikcli-ai/util/global`       | 81 call sites; brought `xdg-basedir` with it.                          |
| `flag/flag`                                                                       | → `@nikcli-ai/util/flag`         | 49 call sites, pure leaf.                                              |
| `util/{locale,token,record,defer,format,redact,hash,teleport-archive,user-error}` | → `@nikcli-ai/util/*`            | Shared leaves.                                                         |
| `util/{filesystem,process,effect-zod,log,flock}`                                  | → `@nikcli-ai/util/*`            | Unblocked by the Effect dependency.                                    |
| `util/error`                                                                      | → `@nikcli-ai/util/error-format` | Renamed: the packaged `error.ts` is `NamedError`, a different concern. |

Two things are deliberately left where they are:

- **`id/id` (5).** `packages/util/src/identifier.ts` already exports a namespace called `Identifier`, and so does this one. They are two implementations of the same idea, not a collision of names — the nikcli one adds prefixes, zod and an Effect schema. Renaming the file would ship the duplicate rather than resolve it, so reconcile the two first.
- **`util/runtime` (1).** It imports `./lazy`, and `packages/util/src/lazy.ts` is a _different_ module from `src/util/lazy.ts`. Moving the file would silently rebind it.

Note for anyone repeating this kind of sweep: `src/permission/ruleset.ts` is not valid text to `grep`, which skips it in `-l` mode without saying so. Every repo-wide import rewrite must be verified by `bun run typecheck`, never by a clean `grep` alone.

**2. Close the tool-rendering seam.** Landed 2026-08-14 for the type surface: 44 `@/tool/*` imports → **10**.

The 34 type-only imports typed `input` and `metadata` in `tool-view.tsx` as `Tool.InferParameters<BashTool>`. They now come from `@tui/util/tool-shapes`, declared from what the renderers actually read — 26 distinct fields across 13 tools, every one optional. The view already cast a dozen sites to `any`, so the exact types were never the whole story; what they did buy was a hard dependency on the server's module graph for something the view sees only as wire data. A local `diagnosticMessage` replaced the sole use of `LSP.Diagnostic.message`, which also removed the `@/lsp` value import. A further 17 identical type imports in `routes/session/index.tsx` were dead — left behind when the renderers were split out — and were deleted outright.

Regression test: `test/tui/tool-seam.test.ts`.

The remaining 10 are value imports and need a decision, not a rewrite: `@/tool/opentui` (the viz decoder, 4) and `@/tool/speak/*` (TTS voice catalogs, 6) are TUI-facing code that sits under `src/tool/` because the tools that produce it are registered server-side. Splitting the codec and the catalogs out of the tool definitions is the move; where they land is the open question.

**3. Replace backend-proper imports with SDK calls.** In progress.

The inversion this section was written to perform **already exists**. `thread.ts` resolves the network options, spawns the worker, and calls `tui({ url, fetch, events, args, onExit, onRestart, checkUpgrade, upgradeNow, startServer, createMobileToken })` — the app entry receives its transport and its host operations as props and never reaches for the server itself. What remains is not a redesign but an ownership correction: `worker.ts` and `thread.ts` are host files living in the TUI directory (see the boundary above).

Landed 2026-08-14, all of them modules that only looked backend:

| Module                                        | Move                                   | Why                                                                                                           |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `lsp/language`                                | → `@nikcli-ai/util/language`           | A pure extension→language map; 4 of its 5 consumers were TUI.                                                 |
| `provider/parse`                              | → `@nikcli-ai/util/model`              | Four lines, no deps, two of three consumers were TUI.                                                         |
| `agent/prompt/support-docs`                   | → `@tui/util/support-docs`             | Zero consumers outside the TUI.                                                                               |
| `cli/cmd/tui/util/prompt-blob`                | → `@nikcli-ai/util/prompt-blob`        | Breaks a cycle — see below.                                                                                   |
| loop shapes                                   | → `@nikcli-ai/sdk/httpapi`             | `LoopDefinition`, `LoopRun`, `LoopTemplate` and `LoopPullRequestRef` are all in the generated contract.       |
| `Snapshot.FileDiff`, `MobileAuth.PublicToken` | → `@nikcli-ai/sdk/httpapi`             | Same: `FileDiff` and `MobileAuthTokenPublic` were already there.                                              |
| analytics merge helpers                       | → `@tui/util/analytics-merge`          | 184 lines of `Math.max` over wire shapes, `await import()`-ed from the panel; no server caller.               |
| `session/primitives`                          | → `@nikcli-ai/util/session-primitives` | Its own comment says it exists for the TUI; 31 pure lines.                                                    |
| `config/features`                             | → `@nikcli-ai/util/features`           | A predicate over `experimental`; every field is read with `=== true`, so naming `Config.Info` bought nothing. |
| `Installation.VERSION`                        | → `@nikcli-ai/util/version`            | Seven files pulled the whole upgrade subsystem to print a string in a footer. `Installation` re-exports it.   |
| viz catalog + codec                           | → `@nikcli-ai/util/viz` (+ `viz.txt`)  | The contract between the `opentui` tool and the terminal; the tool module went from 804 lines to 24.          |
| `tool/speak/{provider,elevenlabs}`            | → `@nikcli-ai/util/tts/*`              | Registry and voice catalog. `openrouter` stays: `getAudioModels` reads auth through `@/effect`.               |
| `interaction/spec`                            | → `@tui/util/interaction-spec`         | 274 lines whose only consumer was the TUI.                                                                    |
| `provider/fusion`, `brain/constants`          | → `@nikcli-ai/util/*`                  | Constant tables.                                                                                              |

A third pattern showed up late and is worth naming, because it applies to almost everything still on the list: **when the TUI reaches into a backend namespace for one small pure thing, extract that thing rather than the namespace.** `Skill.commandName` is a slug plus a six-character hash — reaching for it pulled in the skill loader and with it `@/session`, `@/bus` and the Effect runtime. `Config.pluginSpecifier`/`pluginOptions` are three-line accessors over a `string | [string, options]` tuple. Both now live in `@nikcli-ai/util` and the original namespaces re-export them, so no caller changed.

The other two patterns:

- **A shape the server declares and the wire carries belongs to the contract.** Before writing a local type or moving a module, check `packages/sdk/js/src/httpapi/generated/types.ts` — the loop and analytics shapes were already there under contract names (`AnalyticsGlobal`, `AnalyticsDaily`, `AnalyticsSession`). Substituting them typechecks, which is also the proof that the two definitions agree.
- **A helper only the TUI calls is TUI code, wherever it currently sits.** `keybind`, `rpc`, `support-docs` and the analytics merge functions all lived in the backend tree with zero backend callers.

### The cycles — closed 2026-08-14

`packages/nikcli` importing `packages/tui` is the allowed direction. `packages/tui` importing back is not, and five backend modules did exactly that. Each would have failed section 4 outright rather than merely looking untidy, and none was visible in the `@/` import count, which only looks one way.

| Backend module                                                 | Imported from the TUI                             | Fix                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt/stash-store`                                           | `util/prompt-blob` (runtime), `PromptInfo` (type) | Store moved to `@nikcli-ai/util/prompt-stash`; `parts` is `unknown[]` there — persistence never inspects a part — and the composer narrows on read. |
| `bus/all-events`, `server/httpapi/tui`, `mcp`, `session/toast` | `cli/cmd/tui/event`                               | `TuiEvent` is a bus contract, not UI. Moved to `src/bus/tui-event.ts`.                                                                              |
| `cli/cmd/upgrade`                                              | `cli/cmd/tui/win32`                               | Terminal/FFI handling with one `bun:ffi` import. Moved to `@nikcli-ai/util/win32`.                                                                  |
| `session/toast.tsx`                                            | `cli/cmd/tui/component/border`                    | **Deleted.** An orphaned 107-line copy of `cli/cmd/tui/ui/toast.tsx` with no importer at all.                                                       |

What is left pointing into the TUI is `cli-main.ts` registering `AttachCommand` and `TuiThreadCommand` — the host wiring up its own commands, which is the direction the target graph wants.

Still open beyond that: `@/effect` (11) is bound to `Instance` and goes with the service calls; `@/config/*` (8) needs `TuiConfig.get()` and the plugin-spec helpers to arrive over the SDK; `@/plugin/*` (8) are host operations that invert the way `upgradeNow` already does.

**4. Create the package and move the tree.** With sections 1–3 landed, this is a `git mv` plus a `package.json`, because `@tui/*` already resolves internally. Keep the alias pointing at the new location during the move, and leave `worker.ts` and `thread.ts` behind in `src/cli/cmd/tui/` (see the ownership boundary above).

**5. Delete the compatibility re-exports** introduced in sections 1–3.

**6. Add the second consumer.** Only after the package stands alone. Until then "extraction" is a claim, not a fact.

## Verification

- `packages/tui` typechecks with `packages/nikcli` excluded from its `tsconfig` references.
- No import in `packages/tui` matches `@/` or resolves into `packages/nikcli`.
- The TUI starts from the installer binary, not just from a dev checkout — the binary is where bundling assumptions break (see the Playwright `__dirname` precedent in the browser work).
- Startup time does not regress. The TUI startup graph was deliberately cut once already (server chains removed from the module graph, AI SDKs made lazy), so measure warm, best of three, before and after section 4 — a packaging change that re-imports a backend chain undoes that work invisibly.
