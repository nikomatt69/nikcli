# nikcli Project Memory

## Overview

**nikcli** is an AI-powered development CLI tool (v0.0.6/0.0.7) — an autonomous coding agent with TUI, server mode, multi-agent system, 40+ tools, and 20+ AI provider support.

- **Repository**: https://github.com/nikomatt69/nikcli
- **Default branch**: `dev`
- **License**: MIT
- **Package manager**: Bun 1.3.12 (ESM throughout)

## Technology Stack

### Core

- **Bun** (v1.3.12) — runtime, package manager
- **TypeScript** 5.8/5.9 — primary language (also `tsgo` for typecheck)
- **Turborepo** 2.5.6 — monorepo orchestration
- **Zod** 4.1.8 — validation (with `.meta()` for OpenAPI refs)

### Frontend

- **SolidJS** 1.9.10 — TUI (OpenTUI), web app, enterprise, console
- **React** 18.3.1 — mobile (Expo), Astro pages, email templates
- **TailwindCSS** v4 (web/app) / v3 (mobile)
- **Kobalte** — SolidJS headless UI primitives
- **Vite** 7.1.4 — frontend build

### Backend / Server

- **Hono** 4.10.7 — HTTP framework (server, companion, cloud, functions, enterprise)
- **hono-openapi** 1.1.2 — OpenAPI 3.1.1 spec generation with Zod
- **WebSocket** (ws) — PTY, companion, remote
- **SSH** (ssh2 1.17.0) — remote access
- **mDNS** (bonjour-service) — server discovery

### AI / LLM

- **Vercel AI SDK** (`ai` 5.0.119) — core orchestration
- **17 bundled providers**: Anthropic, OpenAI, Google, Vertex, Bedrock, Azure, Groq, Cerebras, Cohere, DeepInfra, Mistral, Perplexity, Together, Vercel, xAI, OpenRouter, GitLab
- **Ollama** — auto-discovered locally, configurable base URL
- **MCP** (`@modelcontextprotocol/sdk` 1.25.2) — Model Context Protocol
- **ACP** (`@agentclientprotocol/sdk` 0.5.1) — Agent Client Protocol (IDE integration, e.g. Zed)
- **Chat adapters**: Discord, Slack, GitHub, Linear, Teams, Google Chat (with Redis/memory state)

### Database & Storage

- **Drizzle ORM** — console-core (55 migrations as of 2026-04-04)
- **PostgreSQL** (pg), **MySQL** (mysql2), **PlanetScale**
- **Cloudflare D1** — edge SQLite (cloud)
- **Stripe** 18.0.0 — payments

### Infrastructure

- **SST** 3.17.38 — infrastructure as code
- **Cloudflare Workers** — edge deployment
- **Tauri v2** — desktop app (Rust + WebView, 96.6 MB build output)
- **Expo** 52.0.46 / **React Native** 0.76.7 — mobile (iOS + Android)
- **Docker** — `Dockerfile` (mobile host) + `Dockerfile.serve` (SSH serve)
- **Nix** — reproducible builds (`flake.nix`)
- **GitHub Actions** — 23 workflows

## Monorepo Structure (21+ packages)

| Package                     | Name                          | Description                                                                                          |
| --------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/nikcli`           | `nikcli`                      | **Core** — CLI, 14 agent types, 40+ tools, Hono server, OpenTUI TUI, session management              |
| `packages/app`              | `@nikcli-ai/app`              | Shared web UI (SolidJS)                                                                              |
| `packages/ui`               | `@nikcli-ai/ui`               | UI component library, icons, themes, i18n                                                            |
| `packages/util`             | `@nikcli-ai/util`             | Shared utilities (error, slug, retry — Zod-based)                                                    |
| `packages/sdk/js`           | `@nikcli-ai/sdk`              | JS SDK (client/server/crypto/cloud/v2 — auto-generated from OpenAPI)                                 |
| `packages/nikcli-plugins/`  | `nikcli-plugins`           | External TUI plugin package (music, greet, matrix, starwars, weather, win95, pomodoro, calcio, pills, crypto)                          |
| `packages/plugin`           | `@nikcli-ai/plugin`           | Plugin system core + 11 built-in plugins                                                             |
| `packages/desktop`          | `@nikcli-ai/desktop`          | Tauri v2 desktop app (16 languages: en, es, fr, de, ja, ko, zh, zht, ru, pl, ar, br, bs, da, no, sv) |
| `packages/mobile`           | `@nikcli-ai/mobile`           | Expo/React Native mobile (iOS + Android)                                                             |
| `packages/enterprise`       | `@nikcli-ai/enterprise`       | Enterprise web app (SolidStart + Nitro)                                                              |
| `packages/cloud`            | `@nikcli-ai/cloud`            | Cloudflare Workers backend (D1, Durable Objects, jose JWT)                                           |
| `packages/companion`        | `@nikcli-ai/companion`        | Companion server (Hono + WebSocket + Cloudflare Workers)                                             |
| `packages/remote`           | `@nikcli-ai/remote`           | Remote terminal via WebSocket + QR code + tunnels                                                    |
| `packages/slack`            | `@nikcli-ai/slack`            | Slack bot (@slack/bolt + Cloudflare Workers)                                                         |
| `packages/web`              | `@nikcli-ai/web`              | Marketing/docs site (Astro + React + Cloudflare)                                                     |
| `packages/webrenderer`      | `@opentui/webrenderer`        | Native Rust web renderer (wry/tao) for TUI bridge                                                    |
| `packages/function`         | `@nikcli-ai/function`         | Serverless function (Hono + Cloudflare Workers)                                                      |
| `packages/console/app`      | `@nikcli-ai/console-app`      | Console dashboard (SolidStart)                                                                       |
| `packages/console/core`     | `@nikcli-ai/console-core`     | Console backend (Drizzle ORM + Stripe, 55 migrations)                                                |
| `packages/console/function` | `@nikcli-ai/console-function` | Console serverless functions                                                                         |
| `packages/console/resource` | `@nikcli-ai/console-resource` | Console resource abstraction (Cloudflare/Node)                                                       |
| `packages/console/mail`     | `@nikcli-ai/console-mail`     | Email templates (jsx-email)                                                                          |
| `github/`                   | `github`                      | GitHub Action composite action                                                                       |

### Repository Root Structure

| Path                                                     | Purpose                                                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/`                                              | Main product code: CLI, SDK, apps, workers, shared libs, desktop, mobile, console sub-monorepo                                                                        |
| `infra/`                                                 | SST app definitions wiring deployed services to package entrypoints (`infra/app.ts`, `infra/console.ts`, `infra/enterprise.ts`)                                       |
| `script/`                                                | Root automation: build, publish, schema/OpenAPI generation, formatting, changelog/release, e2e seeding (`script/build.ts`, `script/generate.ts`, `script/publish.ts`) |
| `nix/`                                                   | Reproducible dev/build packaging anchored by `flake.nix`                                                                                                              |
| `.github/`                                               | CI/CD workflows: typecheck, test, deploy, publish, nix builds, release (`test.yml`, `deploy.yml`, `publish.yml`)                                                      |
| `.sst/`, `.turbo/`, `node_modules/`, `dist/`, `.output/` | Generated/local state — treat as environment/cache noise unless explicitly targeted                                                                                   |

### Build / Tooling Config Files

- `package.json:8` — Bun version pin enforced on push by `.husky/pre-push`
- `package.json:28` — shared dependency catalog (Bun catalog entries)
- `bunfig.toml:4` — root test guardrail (forbids `bun test` at repo root)
- `turbo.json:1` — task graph: `typecheck`, `build`, selected `test`; build depends on upstream package builds
- `sst.config.ts:4` — deployment control plane targeting Cloudflare
- `.husky/pre-push:1` — enforces Bun version match + runs `bun typecheck`

## Core Architecture

### CLI Entry Points (`src/index.ts`)

- yargs-based CLI with `parserConfiguration({ "populate--": true })`
- Global middleware: log init, env vars (`AGENT=1`, `NIKCLI=1`)
- `--print-logs` and `--log-level` (DEBUG/INFO/WARN/ERROR) global options
- Binary shim (`bin/nikcli`) locates platform package binary and forwards argv
- Default command is TUI (registered as `$0 [project]` in `src/cli/cmd/tui/thread.ts:52`) — invoking `nikcli` with no subcommand lands there
- Even local CLI execution goes through internal server API: `run` builds SDK client whose `fetch` points at `Server.App().fetch()` in `src/cli/cmd/run.ts:533`

### CLI Commands (32 commands)

`run`, `serve`, `workspace-serve`, `generate`, `auth`, `agent`, `models`, `mcp`, `github`, `pr`, `session`, `rag-model`, `image-model`, `speak-model`, `remote`, `connectors`, `chatbot`, `lovable`, `ads`, `companion`, `mobile`, `plugin`, `acp`, `web`, `export`, `import`, `debug`, `stats`, `upgrade`, `uninstall`
Plus TUI subcommands: `tui/attach`, `tui/thread`

**Adding a new command:**

1. Create `src/cli/cmd/<name>.ts` exporting a yargs `CommandModule`
2. Import it in `src/index.ts:3` and register via `.command(...)` in `src/index.ts:95`
3. For server/API-backed features: add route in `src/server/routes/` first, then call from CLI

### Runtime Model

- Most commands enter runtime via `bootstrap()` in `src/cli/bootstrap.ts:4` wrapping `Instance.provide(...)` from `src/project/instance.ts:54`
- `Instance` is the core runtime container; resolves project/worktree, memoizes state per directory, handles teardown
- Runtime init in `src/project/bootstrap.ts:18` wires: plugins, sharing, formatters, LSP, file watching, VCS, snapshots, truncation, todos, delegation
- **Architectural seam**: CLI commands stay thin; real behavior hangs off `Instance` + bootstrapped subsystems

### Agent System (`src/agent/agent.ts`)

Zod schema `Agent.Info` with fields: name, description, mode, native, hidden, topP, temperature, color, permission, model, variant, prompt, options, steps.

**14 built-in agents:**
| Agent | Mode | Description |
|-------|------|-------------|
| `ralph` | primary | Autonomous loop agent (iterates until complete, supports `steps` option) |
| `build` | primary | Main coding agent, allows plan_enter |
| `plan` | primary | Planning agent, denies edit except `.nikcli/plans/*.md` |
| `general` | all | General-purpose research + multi-step tasks |
| `explore` | all | Fast codebase exploration (read, grep, glob, bash, web) |
| `fast-explore` | all | Read-only quick inspection (read, grep, glob, list, tree) |
| `planner` | all | Multi-step implementation strategies |
| `code-reviewer` | all | Quality and safety review |
| `debugger` | all | Root cause analysis + minimal fixes |
| `test-runner` | all | Test execution + failure analysis |
| `refactor` | all | Safe refactoring without behavior changes |
| `compaction` | primary (hidden) | Session compaction |
| `title` | primary (hidden) | Title generation (temp: 0.5) |
| `summary` | primary (hidden) | Summary generation |

`SUBAGENT_TOOLSETS` defines restricted toolsets per subagent type.
Custom agents from `nikcli.json` config extend/override built-ins.

### Session System (`src/session/`)

- `Session.Info` Zod schema: id, slug, projectID, directory, parentID, workspaceID, share, github, title, version, time, permission, skills, revert
- **MessageV2**: `{ type: "text" | "reasoning" | "tool" | "file" | "step-start" | "step-finish" | "snapshot" | "patch" | "agent" | "retry" | "compaction" | "subtask" }`
- **SessionProcessor** (`processor.ts`): doom loop detection (threshold: 3), compaction check, permission deny handling, retry logic
- **LLM streaming** (`llm.ts`): full stream with reasoning-start/delta/end, text-delta, tool-call, tool-result, error, finish
- **ShareNext** (`share-next.ts`): syncs session data to enterprise endpoint (`s.nikcli.store`), with local fallback
- **SessionPrompt** (`prompt.ts`): system prompts per provider (anthropic, gemini, qwen, beast, copilot-gpt-5, etc.)
- **SessionCompaction** (`compaction.ts`): auto-compaction based on token usage
- **SessionSummary** (`summary.ts`): session summarization
- **Todo** (`todo.ts`): todo list management (used for plan tracking)
- Events: `session.created`, `session.updated`, `session.deleted`, `session.diff`, `session.error`

### Provider System (`src/provider/provider.ts`)

- `Provider.Info` and `Provider.Model` types
- 17+ providers with direct imports (not dynamic loading)
- Ollama auto-discovery: probes `http://127.0.0.1:11434/v1/models`, configurable `OLLAMA_BASE_URL` and `OLLAMA_API_KEY`
- `Provider.parseModel("providerID/modelID")` — parses model strings
- `Provider.sort(models)` — sorts by capability/recency
- Cost calculation with cache-aware pricing, over-200K multiplier support
- `ProviderTransform` for provider-specific options (e.g., OpenAI store/instructions)

**Model Listing / Refresh (`src/provider/models.ts`):**

- `nikcli models --refresh` calls `ModelsDev.refresh()` which fetches `${NIKCLI_MODELS_URL}/api.json` (default: `https://models.dev`) and writes to `Global.Path.cache/models.json`
- Cache can be disabled with `NIKCLI_DISABLE_MODELS_FETCH`; overridden via `NIKCLI_MODELS_URL` or `MODELS_DEV_API_JSON`
- `ModelsDev.get()` opportunistically refreshes in background, reads cache, falls back to embedded macro data
- Background refresh runs hourly via `setInterval(...).unref()`
- Local MiniMax patches injected via `ModelsDev.patch()` into `minimax`, `minimax-cn`, `minimax-coding-plan`, `minimax-cn-coding-plan`, `openrouter`
- Cursor injected via `cursorModelsDevProvider()` (not in models.dev catalog)
- Provider activation/filters apply: config gating (`disabled_providers`/`enabled_providers`), nikcli.json overrides, env vars, stored auth, plugin loaders, model-level blacklist/whitelist
- Final exclusions: `gpt-5-chat-latest`, `alpha` (unless `NIKCLI_ENABLE_EXPERIMENTAL_MODELS`), `deprecated`, disabled variants, empty providers

### Config System (`src/config/config.ts`)

Config layering (in precedence order):

1. Well-known remote config (`/.well-known/nikcli`)
2. Global config (`~/.nikcli/config`)
3. Custom env path/content
4. Project config (`nikcli.json`)
5. Scanned `.nikcli` dirs (upward scan)

User-defined extensions auto-loaded from `.nikcli` directories:

- Markdown commands from `{command,commands}/**/*.md`
- Markdown agents from `{agent,agents}/**/*.md`
- File-based plugins from `{plugin,plugins}/*.{ts,js}`
- Tool plugins from `{tool,tools}/*.{js,ts}`
- Config plugins may trigger automatic npm package installation

Runtime command catalog merges: built-ins, config commands, MCP prompts, connector prompts, skills.

### Extension Points for New Features

| Feature Type                            | Where to Add                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| CLI command (orchestration/UI)          | `src/cli/cmd/<name>.ts`, register in `src/index.ts`                                                         |
| Server/API capability (CLI + TUI + SDK) | Add route in `src/server/routes/`                                                                           |
| Model-executable tool during sessions   | Add in `src/tool/<name>.ts`, register in `src/tool/registry.ts`                                             |
| Connector-backed feature                | Extend `src/connectors/registry.ts` (surfaces in status/prompts/`use_connector` automatically)              |
| Plugin-based extensibility              | Use config/plugin discovery from `src/config/config.ts:355` and hook lifecycle in `src/plugin/index.ts:585` |
| AI/session command                      | Add to `src/command/index.ts:72` or support via markdown config                                             |

### Tool Registry (`src/tool/registry.ts`)

**44+ registered tools** (from `all()` function):
Invalid, Question (client-only), Bash, Read, Tree, Glob, Grep, Edit, Write, Task, Docs (add/search/load/unload/context/request/gap-report), SmartDocs, Context (collect/search/related/diagnostics), MemorySearch, Rag (index/search/status/reset), GenerateImage, WebFetch, Todo (write/read), WebSearch, CodeSearch, Skill, ApplyPatch, LSP (experimental), Batch (experimental), Plan (enter/exit, experimental), UseConnector, Speak

Plus dynamically loaded tools from `tool/*.{js,ts}` files and plugin tools.
Conditional: `codesearch`/`websearch` require nikcli provider or `NIKCLI_ENABLE_EXA`. `apply_patch` used for GPT models, `edit`/`write` for others.

### Permission System (`src/permission/next.ts`)

- `PermissionNext.Ruleset` = array of `{ permission, pattern, action }` where action is `"allow" | "deny" | "ask"`
- `PermissionNext.merge(...rulesets)` — deep merge with last-wins
- `PermissionNext.fromConfig(config)` — converts config objects to rulesets
- Default permissions: `*` allow, `doom_loop` ask, `external_directory` ask, `question` deny, `read *.env` ask

### Brain System (`src/brain/`) — **NEW**

Automatic memory consolidation system. Runs periodically (configurable via `experimental.brain` and `experimental.memory`):

- **Lock mechanism**: file-based lock with 1-hour duration, PID verification
- **Trigger conditions**: `minHours` (default 24) since last brain, `minSessions` (default 5) since last brain
- **Execution**: creates a restricted session (read, edit, glob, grep, list, tree only), reviews last 10 sessions (max 12K chars each), synthesizes memory into `.github/instructions/memory.instruction.md`
- **Config**: `experimental.brain` (bool), `experimental.memory` (bool), `experimental.brainMinHours`, `experimental.brainMinSessions`

### ACP System (`src/acp/`) — **NEW**

Agent Client Protocol implementation for IDE integration (e.g., Zed):

- `ACP.Agent` class implements `@agentclientprotocol/sdk` `Agent` interface
- Protocol v1, capabilities: loadSession, mcpCapabilities (http + sse), promptCapabilities (embeddedContext + image)
- Session management via `ACPSessionManager` (maps ACP sessions to nikcli sessions)
- Bidirectional event subscription: permission.asked → requestPermission, message.part.updated → sessionUpdate
- Tool call mapping: `toToolKind()` maps nikcli tools to ACP tool kinds (execute, fetch, edit, search, read, other)
- Command interception: `/compact` → summarize, other `/command` → session command
- `getNewContent()` uses `diff.applyPatch()` for ACP edit approvals
- Auth method: terminal-auth capability or `nikcli auth login`

### Scheduler System (`src/scheduler/`) — **NEW**

Generic interval-based task scheduler with `Instance.state` scoping:

- `Scheduler.register(task)` with `scope: "instance" | "global"` (default instance)
- Auto-cleanup on instance disposal
- `timer.unref()` to avoid keeping process alive

### Server (`src/server/server.ts`)

Hono-based HTTP server (762 lines), `Bun.serve()` with WebSocket support:

**Middleware chain:**

1. Error handler (NamedError → JSON, HTTPException → response, Unknown → 500)
2. Share redirects (`/s/:shareID` → `/share/:shareID`)
3. Auth: mobile bearer JWT → Tailscale identity headers → HTTP Basic
4. Request logging (except `/log`)
5. CORS (localhost, Tailscale `.ts.net`, `*.nikcli.store`, Tauri, Capacitor, Expo)
6. Instance/directory resolution from query params or `x-nikcli-*` headers
7. Workspace context + Instance bootstrap

**Route modules (18+):**
| Mount | Module | Key Operations |
|-------|--------|----------------|
| `/global` | GlobalRoutes | health, event (SSE), dispose |
| `/session` | SessionRoutes | CRUD, prompt, messages, fork, abort, share, revert, summarize, shell, command, init, todo, children, diff |
| `/project` | ProjectRoutes | list, current, update |
| `/pty` | PtyRoutes | CRUD + WebSocket connect |
| `/config` | ConfigRoutes | get, update, providers |
| `/experimental` | ExperimentalRoutes | tool/ids, tool/list, worktree CRUD, resource |
| `/permission` | PermissionRoutes | list, reply |
| `/dbedit` | DBEditRoutes | list, reply |
| `/question` | QuestionRoutes | list, reply, reject |
| `/provider` | ProviderRoutes | list, auth, oauth authorize/callback |
| `/mcp` | McpRoutes | status, add, connect, disconnect, auth |
| `/file` | FileRoutes | list, read, status, find text/files/symbols |
| `/tui` | TuiRoutes | append-prompt, open-help/sessions/themes/models, submit/clear, execute-command, toast, publish, control |
| `/companion` | CompanionRoutes | WebSocket chat |
| `/mobile` | MobileRoutes | mobile-specific |
| `/connectors` | ConnectorsRoutes | third-party integrations |
| `/chatbot` | ChatBotRoutes | chatbot |
| `/mcp` | McpRoutes | MCP server management |

**Inline routes:** `/instance/dispose`, `/path`, `/vcs`, `/command`, `/log`, `/agent`, `/skill`, `/lsp`, `/formatter`, `/auth/:providerID` (PUT/DELETE), `/event` (SSE with 30s heartbeat)
**Catch-all:** proxy to `app.nikcli.store` with CSP headers

**Workspace Server** (`workspace-server/routes.ts`): separate Hono route for `/event` SSE endpoint with 10s heartbeat.

**MDNS** (`src/server/mdns.ts`): optional mDNS publish/unpublish for server discovery.

### Workspace System (`src/workspace/`)

- `Workspace.Info` schema: id, branch, projectID, config
- Config types: `worktree` (local) or remote workspace
- **Sync loop**: SSE event stream from remote workspaces, mirrors events locally (session.status, permission.asked/replied)
- `startSyncing(project)` — starts sync for all non-worktree workspaces
- `session-proxy-middleware.ts` — transparently proxies session requests to remote workspace instances

### SDK (`packages/sdk/js`)

Auto-generated from `packages/sdk/openapi.json` via `@hey-api/openapi-ts`:

- `src/gen/` — v1 generated code
- `src/v2/gen/` — v2 generated code (current, `NikcliClient` class)
- Build: `packages/sdk/js/script/build.ts` runs `bun dev generate` then `@hey-api/openapi-ts`
- Exports: `.`, `./client`, `./server`, `./crypto` (ECDH+AES-GCM), `./cloud` (multi-device sync), `./v2`, `./v2/client`, `./v2/server`

### Plugin System (`src/plugin/`, `packages/plugin/`)

- Dynamic loading from `plugin/plugins/*.ts`, npm packages, or `tool/*.{js,ts}` directories
- `packages/plugin/src/`: `index.ts` (core), `shell.ts` (shell tools), `tool.ts` (tool definitions), `tui.ts` (TUI hooks)
- **11 built-in plugins**: agent-memory, background, background-agents, context-analysis, direnv, dynamic-context-pruning, envsitter-guard, handoff, safety-net, smart-title
- Copilot/Codex auth plugins support
- Notification dispatch: macOS, Slack, Discord

### TUI Plugin Package (`packages/nikcli-plugins/`) — **NEW**

External TUI plugin package using OpenTUI SolidJS components:

- **Import pattern**: `import { TuiPlugin, usePlugin, useSlot, useDialog } from "@nikcli-ai/plugin/tui"` + OpenTUI from `@opentui/solid`
- **Theme files**: JSON format with RGBA color values (e.g., `{ "current": { "primary": [255,149,0,1] } }`)
- **Key patterns**: KV store for persistence, `createSignal` for state, `createEffect` for side effects, `onMount`/`onCleanup` for lifecycle

**Known OpenTUI component constraints** (props that DO NOT exist at runtime):
- `<text>`: no `bold`, `fontSize`, `textWrap`, `textStyle`, `flex`, `borderDirection`, `borderTop`, `borderColor`, `onClick`, `fontFamily`, `fontStyle`
- `<box>`: no `borderTop`, `borderColor`, `overflow`, `paddingY`, `fg` (apply `fg` on child text elements instead)
- `attributes` prop expects number (bitmask), not string array — remove or use `@ts-ignore`
- No `flexGrow` prop
- `<input>` requires `type` property
- Dialog uses `content`/`footer` slots, not `title`/`body`
- `useKeyboard` events use `code` property, not `key`
- `useTerminalDimensions` for responsive layouts

**Plugins created** (2026-04-25): music (Spotify OAuth), greet (KV storage + ASCII gallery), matrix (rain animation), starwars (ASCII art), weather (wttr.in), win95, pomodoro, calcio, pills, crypto

### Connectors (`src/connectors/`)

- **5 API implementations**: Figma, GitHub, Lovable, Slack (each in `api/*.ts`)
- Auth, cache, credentials, registry modules
- Status schema (discriminated union): connected, disabled, failed, needs_auth
- Tool creation via `createTools()`, health checks, prompts
- Connector tools exposed via `use-connector` tool in registry

### Other Notable Modules

- `src/mcp/` — MCP client with OAuth, auth flows, well-known discovery
- `src/rag/` — chunking (`chunk.ts`), embedding (`embed.ts`), vector storage (`storage.ts`), search
- `src/skill/` — loads `SKILL.md` from `.nikcli/skill/`, `.claude/skills/`, `.agents/skills/`
- `src/bus/` — pub/sub event bus (`bus-event.ts`, `global.ts`) with typed events
- `src/mobile/` — bearer token auth (`MobileAuth`), GitHub repo management
- `src/storage/` — file-based JSON with read/write locks, migrations
- `src/file/` — fff integration, `.gitignore` support, file watcher, time utilities
- `src/snapshot/` — git snapshot management for reverts
- `src/share/` — session sharing to enterprise endpoint
- `src/shell/` — shell execution management
- `src/pty/` — pseudo-terminal support (bun-pty)
- `src/lsp/` — Language Server Protocol integration
- `src/format/` — code formatting
- `src/command/` — custom command system with templates
- `src/installation/` — version management, install detection
- `src/flag/` — environment flag parsing
- `src/id/` — identifier generation (ascending/descending ULID-based)
- `src/global/` — global paths (home, state, config)
- `src/project/` — instance management, bootstrap, VCS (git), state
- `src/util/` — 27 utility modules (archive, color, context, defer, error, eventloop, filesystem, flock, fn, format, hash, iife, keybind, lazy, locale, lock, log, network, process, queue, record, rpc, scrap, signal, timeout, token, wildcard)
- `src/chatbot/` — chatbot handlers
- `src/docs/` — documentation context/library management
- `src/worktree/` — git worktree management
- `src/bun/` — Bun process utilities and tool registry
- `src/ide/` — IDE integration
- `src/opentui/` — OpenTUI TUI integration (render.ts, context.ts, app.ts, dialog.ts, toast.ts)

### Mobile Package (`packages/mobile`)

- Expo Router with routes: `index.tsx`, `connect.tsx`, `(app)/`, `+not-found.tsx`
- Components: chat/, layout/, session/, settings/, ui/, BottomSheet, ConnectionStatus, DiffViewer, GlassView, GlobalErrorBoundary, MessageBubble, NetworkBanner, PermissionCard, RepoCard, SessionListItem, Skeleton, ToolCallView
- Hooks: `use-session-stream.ts`
- Lib: chat-types, client, cn, haptics, notifications, offline, server-provider, storage, store, theme, types
- TailwindCSS v3 with NativeWind
- iOS + Android native builds

### Desktop Package (`packages/desktop`)

- Tauri v2 with Rust sidecar (`src-tauri/src/`): main, lib, cli, server, markdown, window_customizer, windows, constants, job_object
- 16 language translations in `src/i18n/`
- Auto-updater support
- Deep-link, dialog, notification, shell, store, updater Tauri plugins

## Build Commands

- `bun dev` — run nikcli in dev mode (`bun run --cwd packages/nikcli --conditions=browser src/index.ts`)
- `bun run typecheck` — `bun turbo typecheck`
- `bun run build` per package — e.g., `bun run script/build.ts` for nikcli core
- `./packages/sdk/js/script/build.ts` — regenerate JavaScript SDK from OpenAPI (always run after editing server endpoints in `src/server/server.ts`)
- `bun test` — per-package tests (root explicitly exits with error; use `bun turbo test` or package-level)
- Turborepo tasks: `typecheck`, `build`, `test`
- `tsgo --noEmit` — typecheck for nikcli core (fast TS compiler)
- Husky pre-push hook configured
- CI deploy: `bun sst deploy --stage=<branch>` on `dev` and `production`
- CI tests: `bun turbo typecheck`, `bun turbo test`, plus Playwright/e2e app flow
- Release/publish workflow: builds CLI artifacts first, then Tauri desktop artifacts, then completes release
- Cross-platform CLI binary build matrix: `script/build.ts:22` (packages/nikcli)

## Build Agent Risks / Patterns

- **Root tests are blocked**: `bunfig.toml:4` redirects root test to fake path; use package-level tests or `bun turbo test`
- **Bun version pin enforced on push**: mismatched local Bun will fail pre-push/typecheck
- **SDK is generated from CLI server/OpenAPI flow**: server endpoint edits in `src/server/server.ts` require SDK regeneration via `script/generate.ts:5` (runs `bun dev generate`, writes `openapi.json`, regenerates SDK)
- **Infra split across multiple deploy surfaces**: SST/Cloudflare, direct Wrangler packages, Tauri desktop, Expo mobile, Nix packaging — edits can have cross-target consequences
- **Nested manifests below declared workspace globs** (e.g., `packages/remote/web-client/package.json`) are internal/build-only, not first-class workspaces
- **Config loading is side-effectful**: reading config can trigger npm package installation logic; `src/config/config.ts:203`
- **Provider state is `Instance.state(...)` cached**: long-lived processes keep older resolved provider sets until instance disposal/recreation
- **`models --refresh` only refreshes models.dev cache**: provider-specific catalogs like Ollama or GitHub Copilot come from their own runtime fetch paths

## Workspace Catalog (shared dependency versions)

Key catalog-pinned deps: `ai: 5.0.119`, `hono: 4.10.7`, `zod: 4.1.8`, `solid-js: 1.9.10`, `vite: 7.1.4`, `tailwindcss: 4.1.11`, `typescript: 5.8.2`, `shiki: 3.20.0`, `marked: 17.0.1`, `remeda: 2.26.0`, `diff: 8.0.2`

## Spec Files (`specs/`)

- `01-persist-payload-limits.md` — payload limit optimization
- `02-cache-eviction.md` — cache eviction strategy
- `03-request-throttling.md` — request throttling
- `04-scroll-spy-optimization.md` — scroll spy optimization
- `05-modularize-and-dedupe.md` — modularization + dedup
- `06-app-i18n-audit.md` — app i18n audit
- `07-ui-i18n-audit.md` — UI i18n audit
- `perf-roadmap.md` — performance roadmap
- `project.md` — project/session API design spec
