# TUI Package Extraction

| Field  | Value                                                            |
| ------ | ---------------------------------------------------------------- |
| Status | **In progress** — section 1, first slice landed 2026-08-14       |
| Scope  | `packages/nikcli/src/cli/cmd/tui` → `packages/tui`               |
| Buys   | A TUI that builds, tests, and starts without the backend graph   |

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

Measured 2026-08-14, after the first slice of section 1:

| Fact                            | Value                                                     |
| ------------------------------- | --------------------------------------------------------- |
| Files                           | 256 `.ts`/`.tsx`                                          |
| Lines                           | ~68,000                                                    |
| Largest subtrees                | `component/` 75, `feature-plugins/` 47, `routes/` 40, `util/` 33, `context/` 26 |
| Files already using the SDK     | 73                                                        |
| `@/` import statements          | **102** (was 240) — 12 of them in `thread.ts`/`worker.ts`, which are host files |
| Path alias                      | `@tui/*` → `./src/cli/cmd/tui/*` (already package-shaped)  |

The `@tui/*` alias is the good news: internal imports are already written as if the directory were a package root, so most files move without an edit.

### What Actually Blocks The Move

There are **109 `@/` import statements** left, and they are not evenly distributed. By weight:

| Import                                  | Count | Nature                              |
| --------------------------------------- | ----: | ----------------------------------- |
| `@/effect`                              | 11    | Runtime helpers, bound to `Instance`. |
| `@/config/*`                            | 11    | Config and TUI-config schema.        |
| `@/tool/*`                              | 10    | The viz decoder and the TTS voice catalogs. |
| `@/plugin/*`, `@/installation`, `@/cli/*` | 25  | Host concerns that should invert.     |
| `@/id/id`                               | 5     | Prefixed id generation.              |
| Backend-proper (`@/session/*`, `@/server/server`, `@/provider/*`, `@/project/*`, `@/account/schema`, `@/analytics/analytics`, `@/lsp/language`, `@/bus`, `@/brain`, `@/interaction`, `@/agent`) | 20 | **The real coupling.** |

`@/util/*`, `@/global` and `@/flag` are gone — that block was 97 imports and is now `@nikcli-ai/util`.

**The backend-proper group is 20 lines in 16 files, and only 4 files carry the hard ones:** `worker.ts` (`Server`, `Instance`, `InstanceBootstrap`, `GlobalBus`), `app.tsx` and `thread.ts` (`SessionPrimitives`, `parseModel`), `event.ts` (`BusEvent`). The rest is a constant table (`LANGUAGE_EXTENSIONS`, 4 sites), a preset table (`fusionPreset`), or a type. Everything above that group is infrastructure that was never packaged, which means the extraction is mostly a packaging problem, not a rewrite.

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

| Module                       | Move                                     | Why                                        |
| ---------------------------- | ---------------------------------------- | ------------------------------------------ |
| `util/keybind`, `util/rpc`   | → `@tui/util/*`                          | Zero consumers outside the TUI.            |
| `util/iife`                  | deleted → `@nikcli-ai/util/iife`         | Byte-identical duplicate of the packaged one. |
| `global`                     | → `@nikcli-ai/util/global`               | 81 call sites; brought `xdg-basedir` with it. |
| `flag/flag`                  | → `@nikcli-ai/util/flag`                 | 49 call sites, pure leaf.                  |
| `util/{locale,token,record,defer,format,redact,hash,teleport-archive,user-error}` | → `@nikcli-ai/util/*` | Shared leaves. |
| `util/{filesystem,process,effect-zod,log,flock}` | → `@nikcli-ai/util/*`  | Unblocked by the Effect dependency.        |
| `util/error`                 | → `@nikcli-ai/util/error-format`         | Renamed: the packaged `error.ts` is `NamedError`, a different concern. |

Two things are deliberately left where they are:

- **`id/id` (5).** `packages/util/src/identifier.ts` already exports a namespace called `Identifier`, and so does this one. They are two implementations of the same idea, not a collision of names — the nikcli one adds prefixes, zod and an Effect schema. Renaming the file would ship the duplicate rather than resolve it, so reconcile the two first.
- **`util/runtime` (1).** It imports `./lazy`, and `packages/util/src/lazy.ts` is a *different* module from `src/util/lazy.ts`. Moving the file would silently rebind it.

Note for anyone repeating this kind of sweep: `src/permission/ruleset.ts` is not valid text to `grep`, which skips it in `-l` mode without saying so. Every repo-wide import rewrite must be verified by `bun run typecheck`, never by a clean `grep` alone.

**2. Close the tool-rendering seam.** Landed 2026-08-14 for the type surface: 44 `@/tool/*` imports → **10**.

The 34 type-only imports typed `input` and `metadata` in `tool-view.tsx` as `Tool.InferParameters<BashTool>`. They now come from `@tui/util/tool-shapes`, declared from what the renderers actually read — 26 distinct fields across 13 tools, every one optional. The view already cast a dozen sites to `any`, so the exact types were never the whole story; what they did buy was a hard dependency on the server's module graph for something the view sees only as wire data. A local `diagnosticMessage` replaced the sole use of `LSP.Diagnostic.message`, which also removed the `@/lsp` value import. A further 17 identical type imports in `routes/session/index.tsx` were dead — left behind when the renderers were split out — and were deleted outright.

Regression test: `test/tui/tool-seam.test.ts`.

The remaining 10 are value imports and need a decision, not a rewrite: `@/tool/opentui` (the viz decoder, 4) and `@/tool/speak/*` (TTS voice catalogs, 6) are TUI-facing code that sits under `src/tool/` because the tools that produce it are registered server-side. Splitting the codec and the catalogs out of the tool definitions is the move; where they land is the open question.

**3. Replace backend-proper imports with SDK calls.** In progress.

The inversion this section was written to perform **already exists**. `thread.ts` resolves the network options, spawns the worker, and calls `tui({ url, fetch, events, args, onExit, onRestart, checkUpgrade, upgradeNow, startServer, createMobileToken })` — the app entry receives its transport and its host operations as props and never reaches for the server itself. What remains is not a redesign but an ownership correction: `worker.ts` and `thread.ts` are host files living in the TUI directory (see the boundary above).

Landed 2026-08-14, all of them modules that only looked backend:

| Module                       | Move                                | Why                                       |
| ---------------------------- | ----------------------------------- | ----------------------------------------- |
| `lsp/language`               | → `@nikcli-ai/util/language`        | A pure extension→language map; 4 of its 5 consumers were TUI. |
| `provider/parse`             | → `@nikcli-ai/util/model`           | Four lines, no deps, two of three consumers were TUI. |
| `agent/prompt/support-docs`  | → `@tui/util/support-docs`          | Zero consumers outside the TUI.           |
| `cli/cmd/tui/util/prompt-blob` | → `@nikcli-ai/util/prompt-blob`   | Breaks a cycle — see below.               |

**The cycle.** `src/prompt/stash-store.ts` is a backend module (the mobile HTTP routes use it through `server/mobile/{helpers,memory}.ts`) that imported *runtime* code from the TUI: `capPromptEntryBytes` and `dehydratePromptEntry` from `@/cli/cmd/tui/util/prompt-blob`. The TUI in turn imports `PromptStashStore` from it. That is a genuine cycle, and it would have failed section 4 rather than merely looking untidy. `prompt-blob` was a pure leaf, so it moved to `packages/util` and the runtime half of the cycle is gone. Still open: `stash-store` imports `type PromptInfo` from a TUI component, and the TUI imports `PromptStashStore` back.

Still open beyond that: `@/effect` (11) is bound to `Instance` and belongs to the host inversion; `@/config/*` (11) needs the TUI to read config over the SDK; `@/plugin/*`, `@/installation`, `@/cli/*` (25) are host concerns that invert with `thread.ts`.

**4. Create the package and move the tree.** With sections 1–3 landed, this is a `git mv` plus a `package.json`, because `@tui/*` already resolves internally. Keep the alias pointing at the new location during the move, and leave `worker.ts` and `thread.ts` behind in `src/cli/cmd/tui/` (see the ownership boundary above).

**5. Delete the compatibility re-exports** introduced in sections 1–3.

**6. Add the second consumer.** Only after the package stands alone. Until then "extraction" is a claim, not a fact.

## Verification

- `packages/tui` typechecks with `packages/nikcli` excluded from its `tsconfig` references.
- No import in `packages/tui` matches `@/` or resolves into `packages/nikcli`.
- The TUI starts from the installer binary, not just from a dev checkout — the binary is where bundling assumptions break (see the Playwright `__dirname` precedent in the browser work).
- Startup time does not regress. The TUI startup graph was deliberately cut once already (server chains removed from the module graph, AI SDKs made lazy), so measure warm, best of three, before and after section 4 — a packaging change that re-imports a backend chain undoes that work invisibly.
