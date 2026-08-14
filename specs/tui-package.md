# TUI Package Extraction

| Field  | Value                                                          |
| ------ | -------------------------------------------------------------- |
| Status | **Proposed and unimplemented**                                 |
| Scope  | `packages/nikcli/src/cli/cmd/tui` → `packages/tui`             |
| Buys   | A TUI that builds, tests, and starts without the backend graph |

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

Measured 2026-08-14:

| Fact                                       | Value                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| Files                                      | 254 `.ts`/`.tsx`                                                                |
| Lines                                      | ~68,700                                                                         |
| Largest subtrees                           | `component/` 75, `feature-plugins/` 47, `routes/` 40, `util/` 31, `context/` 28 |
| Files already using the SDK                | 43                                                                              |
| Distinct backend modules imported via `@/` | 86 (69 of them outside `@/util/*`)                                              |
| Path alias                                 | `@tui/*` → `./src/cli/cmd/tui/*` (already package-shaped)                       |

A "module" here is a whole import specifier (`@/session/message-v2`, not `@/session`), counted distinct over the tree:

```sh
grep -rho 'from "@/[^"]*"' src/cli/cmd/tui | sort -u | wc -l
```

The `@tui/*` alias is the good news: internal imports are already written as if the directory were a package root, so most files move without an edit.

### What Actually Blocks The Move

There are **241 `@/` import statements** across 86 distinct backend modules, and they are not evenly distributed. By weight:

| Import                                                                                                                                                                                                                                             | Count | Nature                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | --------------------------------------------------- |
| `@/util/*` (locale, keybind, log, filesystem, error, token, record, process, iife)                                                                                                                                                                 |    76 | **Generic.** Belongs in a shared package.           |
| `@/tool/*`                                                                                                                                                                                                                                         |    44 | Tool prompt text and metadata shapes for rendering. |
| `@/global`, `@/flag/flag`, `@/id/id`                                                                                                                                                                                                               |    27 | Paths, env flags, id generation.                    |
| `@/config/*`                                                                                                                                                                                                                                       |    11 | Config and TUI-config schema.                       |
| `@/effect`                                                                                                                                                                                                                                         |    11 | Runtime helpers.                                    |
| `@/plugin/*`, `@/installation`, `@/cli/*`                                                                                                                                                                                                          |    25 | Host concerns that should invert.                   |
| Backend-proper (`@/session/*`, `@/server/server`, `@/provider/*`, `@/project/*`, `@/account/schema`, `@/analytics/analytics`, `@/lsp/language`, `@/snapshot`, `@/user/*`, `@/mobile/*`, `@/loop/*`, `@/image/*`, `@/prompt/*`, `@/bus`, `@/skill`) |   ~47 | **The real coupling.**                              |

Only that last group is genuinely backend, and within it just ~18 imports touch server-side execution (`@/server/server`, `@/project/bootstrap`, `@/project/instance`, `@/session/primitives`, `@/provider/{parse,fusion}`, `@/plugin/{shared,meta,install}`, `@/analytics/analytics`, `@/account/schema`, `@/lsp/language`). Everything above it is infrastructure that was never packaged, which means the extraction is mostly a packaging problem, not a rewrite.

## Migration Rules

- Keep one canonical implementation of every TUI feature. Do not copy the tree and synchronize two of them.
- Land each section below independently and commit at its boundary. Every intermediate commit must build and typecheck (`bun run typecheck`).
- Use temporary compatibility re-exports only where they materially reduce conflict risk, and mark them for removal in a named later section.
- Do not preserve a private import by aliasing `packages/tui` back into `packages/nikcli`.
- Keep tool rendering tolerant of unknown tools and wire-format drift. Local checks over `unknown` metadata are fine; importing a backend tool implementation for type safety is not.
- Keep CLI argument parsing, server startup, worker management, auth, and config discovery **outside** `@nikcli-ai/tui`.

## Ownership Boundary

### `@nikcli-ai/tui` owns

- The OpenTUI renderer lifecycle and worker entry (`worker.ts`, `app.tsx`, `thread.ts`)
- Solid application composition, routes, dialogs, components, contexts
- Themes, keymaps, i18n, and UI primitives
- Feature plugins (`feature-plugins/`, 47 files) and the TUI plugin host
- Rendering of tool calls, diffs, markdown, and math

### `packages/nikcli` keeps

- The `tui` command, server bootstrap, and instance binding
- Everything under `src/session`, `src/server`, `src/provider`, `src/tool`
- Config discovery and the auth flows the TUI triggers over HTTP

## Sections

Each section is independently landable and independently revertible.

**1. Extract shared infrastructure.** Move `@/util/*`, `@/flag`, `@/id`, and `@/global` path resolution into a package both sides depend on (`packages/util` already exists — extend it rather than creating another). This removes 103 of the 241 imports — 43% — without touching a single component.

**2. Close the tool-rendering seam.** The ~44 `@/tool/*` imports are mostly prompt text and metadata shapes. Replace them with types carried by the SDK plus local `unknown`-tolerant checks. This is the section most likely to surface real behavior questions; do it before the move, not during.

**3. Replace backend-proper imports with SDK calls.** The ~18 genuine ones. Each either already has an HttpApi endpoint or needs one added — `@/server/server` and `@/project/bootstrap` in particular exist because the TUI can start its own in-process server, and that path must be inverted so the host starts the server and hands the TUI a base URL.

**4. Create the package and move the tree.** With sections 1–3 landed, this is a `git mv` plus a `package.json`, because `@tui/*` already resolves internally. Keep the alias pointing at the new location during the move.

**5. Delete the compatibility re-exports** introduced in sections 1–3.

**6. Add the second consumer.** Only after the package stands alone. Until then "extraction" is a claim, not a fact.

## Verification

- `packages/tui` typechecks with `packages/nikcli` excluded from its `tsconfig` references.
- No import in `packages/tui` matches `@/` or resolves into `packages/nikcli`.
- The TUI starts from the installer binary, not just from a dev checkout — the binary is where bundling assumptions break (see the Playwright `__dirname` precedent in the browser work).
- Startup time does not regress. The TUI startup graph was deliberately cut once already (server chains removed from the module graph, AI SDKs made lazy), so measure warm, best of three, before and after section 4 — a packaging change that re-imports a backend chain undoes that work invisibly.
