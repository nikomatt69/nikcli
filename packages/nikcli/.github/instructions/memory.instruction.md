# Nikcli Project Memory

## Architecture Overview

### Monorepo Structure (`/Volumes/SSD/Projects/nikcli/`)

24 packages managed with Bun workspaces + Turbo:

| Package | Purpose | Key Tech |
|---------|---------|----------|
| **nikcli** | Main CLI with TUI (primary focus) | SolidJS, Bun, TypeScript |
| **mobile** | React Native mobile app | Expo, NativeWind, Tailwind |
| **desktop** | Cross-platform desktop app | Tauri (Rust), SolidJS, Vite |
| **web** | Web application | Astro, SolidJS, Tailwind |
| **sdk** | TypeScript API client | Auto-generated from OpenAPI |
| **plugin** | Plugin system | TypeScript |
| **remote** | Remote execution (ghostty terminal) | Vite, ghostty-web |
| **companion** | Companion services UI | Vite, SolidJS |
| **ui** | Shared UI component library | SolidJS, Tailwind CSS |
| **webrenderer** | WebView + native modules | Rust, WebGPU/3D |
| **app** | Core app pages/components | SolidJS |

### Core Structure

- **Session System** (`src/session/`) - Message storage, LLM processing, prompts, streaming
- **Tool System** (`src/tool/`) - 50+ tools: bash, edit, read, write, grep, task, skill, etc.
- **Mobile Development** (`src/mobile/`) - Expo, Simulator, React Native, Tophat integration
- **Provider System** (`src/provider/`) - AI provider integrations via AI SDK (15+ providers)
- **Server** (`src/server/`) - Hono-based HTTP routes, SSE events, WebSocket
- **MCP** (`src/mcp/`) - MCP protocol client with HTTP/SSE/stdio transports + OAuth
- **Plugins** (`src/plugin/`) - Hook-based plugin system with chat/tool/auth hooks
- **Storage** (`src/storage/`) - JSON file storage with git snapshots
- **Config** (`src/config/`) - 65KB Zod schema system

### Key Patterns

- Zod schemas for all validation
- `Tool.define()` for tool registration with lazy init
- `Session.loop()` for main chat loop
- Event bus (`Bus`) for state sync across instances
- Part-based message storage (incremental updates)
- Reader-writer locks for concurrent storage safety
- Permission rulesets: allow/deny/ask per tool + glob pattern
- `devalue` for portable deep equality (replaces `Bun.deepEquals`)

## MCP Protocol (`src/mcp/index.ts`)

### Transport Types

| Transport                       | Type   | Use Case                     |
| ------------------------------- | ------ | ---------------------------- |
| `StreamableHTTPClientTransport` | Remote | Primary HTTP with streaming  |
| `SSEClientTransport`            | Remote | Fallback for remote servers  |
| `StdioClientTransport`          | Local  | Local subprocess MCP servers |

### Auth Model

- OAuth 2.0 with dynamic client registration
- States: `needs_auth`, `needs_client_registration`, `connected`, `disabled`, `failed`
- Token storage: `Global.Path.data/mcp-auth.json` with 0o600 permissions
- Built-in callback handler on port 19876

## Plugin System (`src/plugin/`)

### Hook Types

| Hook                        | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `event`                     | Global event subscription                      |
| `config`                    | Config changes notification                    |
| `tool`                      | Register custom tools                          |
| `auth`                      | Custom auth providers                          |
| `chat.message`              | Modify incoming messages                       |
| `chat.params`               | Modify LLM params                              |
| `permission.ask`            | Handle permission requests                     |
| `tool.execute.before/after` | Pre/post tool hooks                            |
| `experimental.*`            | Transform messages, system prompts, compaction |

### Internal Plugins

- **CodexAuthPlugin** - OpenAI ChatGPT/Codex OAuth (PKCE)
- **CopilotAuthPlugin** - GitHub Copilot device flow
- **NotifyPlugin** - macOS/Slack/Discord notifications

### TUI Plugins (`src/cli/cmd/tui/plugin/`)

- Custom routes via `route.register()`
- Slash commands via `command.register()`
- UI extension slots (app, sidebar, home areas)

## Agent System (`src/agent/agent.ts`)

### Overview

Core configuration and registry for all AI agents. Three purposes:
1. **Agent Registry** — static registry of built-in agents with prompts, permissions, capabilities
2. **Configuration Layering** — merges built-in definitions with `nikcli.json`, `.nikcli/agent/*.md` files, and inline flags
3. **Agent Generation** — `Agent.generate()` creates new agent configs from natural language via LLM

### Agent Modes

- **`primary`** — main agents users interact with directly (ralph, build, plan, compaction, title, summary)
- **`subagent`** — only callable via `task` tool (researcher, delegator, ultrareview-reviewer)
- **`all`** — works in both roles (explore, fast-explore, planner, code-reviewer, debugger, test-runner, refactor, general)

### Built-in Agents (17 total)

| Agent | Mode | Hidden | Key Traits |
| ---- | ---- | ------ | ---------- |
| `ralph` | primary | no | Autonomous loop, allows `question` |
| `build` | primary | no | Feature creation, allows `plan_enter` |
| `plan` | primary | no | Planning, allows `plan_exit`, restricts `edit` to plan files |
| `general` | all | no | General-purpose parallel execution |
| `explore` | all | no | Fast explorer with bash/web tools |
| `fast-explore` | all | no | Read-only: tree/grep/read only |
| `planner` | all | no | Planning with web search |
| `researcher` | subagent | yes | Background evidence collection |
| `code-reviewer` | all | no | Quality/safety focused |
| `ultrareview-reviewer` | subagent | yes | Domain-specific parallel review (bugs/security/performance/patterns) |
| `debugger` | all | no | Failure/root cause analysis |
| `test-runner` | all | no | Test execution and analysis |
| `refactor` | all | no | Safe cleanup without behavior changes |
| `delegator` | subagent | yes | Synthesizes background subagent results |
| `compaction` | primary | yes | Session compaction (context summarization) |
| `title` | primary | yes | Generates conversation titles |
| `summary` | primary | yes | Summarizes conversations |

### Agent.Info Schema

```typescript
{
  name: string
  mode: "subagent" | "primary" | "all"
  description?: string
  native?: boolean           // true for built-in agents
  hidden?: boolean           // hide from autocomplete
  topP?: number
  temperature?: number
  color?: string             // UI color hex
  permission: PermissionNext.Ruleset  // {permission, pattern, action}[]
  model?: { modelID: string; providerID: string }
  advisor?: { model: {...}; maxUses?: number }
  variant?: string
  prompt?: string           // system prompt
  options?: Record<string, any>
  steps?: number            // max agentic iterations
}
```

### Key Functions

| Function | Signature | Description |
| ------- | --------- | ----------- |
| `Agent.get()` | `(agent: string) => Promise<Info \| undefined>` | Retrieve agent by name |
| `Agent.list()` | `() => Promise<Info[]>` | All non-disabled agents, sorted |
| `Agent.defaultAgent()` | `() => Promise<string>` | Default agent name |
| `Agent.generate()` | `(input) => Promise<{identifier, whenToUse, systemPrompt}>` | LLM-powered agent creation |
| `Agent.SUBAGENT_TOOLSETS` | `Record<string, string[]>` | Default tool allowlists per subagent type |

### Permission Defaults

Applied to all agents unless overridden:
```typescript
{
  "*": "allow",
  doom_loop: "ask",
  external_directory: { "*": "ask", [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
  question: "deny",
  plan_enter: "deny",
  plan_exit: "deny",
  read: { "*": "allow", "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" },
}
```

### Permission Layering

Precedence (lowest to highest):
1. `defaults` — base rules
2. Agent-specific overrides
3. `Config.get().permission`
4. Per-agent user config (`cfg.agent?.[name].permission`)

### Primary Agent Awareness Prompts

Two fragments injected into all primary agent prompts:
- **`PRIMARY_AGENT_DELEGATION_AWARENESS`** — how to use `task` (background), `delegation`, `delegator`
- **`PRIMARY_AGENT_RESEARCH_AWARENESS`** — when to launch background research via subagent_type "researcher"

### Agent Prompt Files (`src/agent/prompt/`)

| File | Purpose |
| ---- | ------- |
| `compaction.txt` | Compaction agent prompt |
| `explore.txt` | Explore agent prompt |
| `delegation.txt` | Primary agent delegation awareness |
| `delegator.txt` | Delegator coordination instructions |
| `summary.txt` | Summary agent prompt |
| `title.txt` | Title generation prompt |
| `ultrareview-reviewer.txt` | Ultrareview reviewer instructions |
| `../generate.txt` | Prompt for LLM agent generation |

### Files Imported BY `agent.ts`

`../config/config`, `../provider/provider`, `../session/system`, `../project/instance`, `../tool/truncation`, `../auth`, `../provider/transform`, `@/permission/next`, `@/global`

### Files That Import FROM `agent.ts`

**Session core:** `session/llm.ts`, `session/processor.ts`, `session/summary.ts`, `session/compaction.ts`, `session/prompt.ts`
**Tools:** `tool/task.ts`, `tool/truncation.ts`, `tool/tool.ts`, `tool/registry.ts`
**CLI:** `cli/cmd/agent.ts`, `cli/cmd/debug/agent.ts`
**Server:** `server/routes/mobile.ts`, `server/routes/session.ts`, `server/server.ts`
**Other:** `acp/agent.ts`

## Tool System (`src/tool/`)

### Tool Framework (`tool.ts`)

- `Tool.Info` — interface with `id` and `init()` returning `Def`
- `Tool.Def` — contains `description`, Zod `parameters`, `execute()`
- `Tool.Context` — passed to every tool: `sessionID`, `messageID`, `agent`, `abort`, `ask()`, `metadata()`, `messages`

All tools wrap `execute()` with automatic Zod validation and output truncation handling.

### Tool Registry (`registry.ts`)

`ToolRegistry.tools(model, agent?)` filters tools before exposing to LLM:
- `codesearch`/`websearch`: only for nikcli provider or `Flag.NIKCLI_ENABLE_EXA`
- `apply_patch`: only for GPT models (non-oss, non-gpt-4); replaces `edit`/`write`
- `advisor`: only if `agent.advisor` is configured
- Loads custom tools from `{tool,tools}/*.{js,ts}` in configured directories
- Loads plugin tools

### Permission Flow

Every file-modifying tool calls `ctx.ask()` before execution:
- BashTool extracts directories/patterns via tree-sitter parsing
- EditTool requests edit permission per file
- Permission rules defined per agent in `src/agent/agent.ts`

### Core Tools

- **BashTool** - Command execution with tree-sitter parsing
- **EditTool** - 9 smart replacement strategies
- **ReadTool** - Streaming file reads with binary detection
- **WriteTool** - Atomic writes via temp file
- **GrepTool** - FFF file search backend with Bun.Glob fallback
- **TaskTool** - Subagent spawning (see below)

### TaskTool (`task.ts`, ~800 lines)

The main subagent orchestration tool. Creates child sessions, runs prompts, handles:
- **Foreground**: live progress tracking via event bus
- **Background**: worker session + delegator session with up to 3 follow-up synthesis rounds
- Research agents get special metadata extraction (question, confidence, source count)
- Validates subagent_type against caller's `task` permission rules

### SUBAGENT_TOOLSETS

Default tool allowlists for subagent types (from `agent.ts`):
```typescript
fast-explore: ["read", "grep", "glob", "list", "tree"]
planner: ["read", "grep", "glob", "list", "tree", "websearch", "codesearch", "webfetch"]
explore: ["read", "grep", "glob", "list", "bash", "webfetch", "websearch", "codesearch"]
researcher: [read/search/docs/memory/context tools + task + delegation + delegator]
code-reviewer: ["read", "grep", "glob", "list", "bash"]
debugger: ["read", "grep", "glob", "list", "bash", "edit"]
test-runner: ["read", "grep", "list", "bash", "edit", "write"]
refactor: ["read", "grep", "glob", "list", "bash", "edit", "write", "apply_patch"]
```

### Truncation System (`src/tool/truncation.ts`)

- MAX_LINES = 2000, MAX_BYTES = 50KB
- Output stored to `~/.nikcli/tool-output/{tool_id}` for 7 days

## Session Processing System (`src/session/`)

### Stream Processing (`processor.ts`)

Core loop consumes AI SDK `streamText()` `fullStream` async iterator. Handles 20 event types:

| Event Type | Handler | Description |
|------------|---------|-------------|
| `start` | 129-131 | Sets session "busy" |
| `reasoning-start/delta/end` | 133-173 | Creates/appends/flushes `ReasoningPart` |
| `tool-input-start/delta/end` | 176-200 | Creates pending `ToolPart` |
| `tool-call` | 202-230 | Starts execution, doom-loop detection |
| `tool-result` | 231-253 | Completes tool with output |
| `tool-error` | 255-280 | Error state, permission rejection check |
| `error` | 281-282 | Exception for retry handling |
| `start-step/finish-step` | 284-343 | Step tracking, usage/cost, compaction check |
| `text-start/delta/end` | 345-390 | Creates/appends/flushes `TextPart` |
| `finish` | 392-393 | Final event marker |

### Doom-Loop Detection (`processor.ts:22-58`)

- Ring buffer of last 3 tool calls `{tool, input}`
- When 3 identical consecutive calls detected → `PermissionNext.ask("doom_loop")`
- Returns permission prompt with `tool` + `input` metadata

### Retry Logic (`retry.ts` + `processor.ts:403-440`)

- Conditions: `APIError` with `isRetryable`, rate limits, server errors
- Exponential backoff: 2s initial × 2^attempt, max 30s
- Server `retry-after-ms` / `retry-after` headers respected
- Max 5 attempts; partial parts cleaned up on retry

### Compaction Triggering (`compaction.ts`)

- Overflow detected at `finish-step`: `tokens.total >= (inputLimit - reserved)`
- Reserved defaults: `min(20_000, maxOutput)` tokens
- Creates `"compaction"` agent message, runs summarization, injects "Continue" message

### Text-Delta Flow (arrival → persistence)

```
text-delta event
  → append to currentText.text (in-memory)
  → Bus.publish(PartUpdated) // UI gets it immediately
  → DeltaCoalescer.schedule(key, part, Storage.write)
      → 150ms debounce timer reset on each schedule()
      → Timer fires → Storage.write(key, content)
text-end
  → DeltaCoalescer.flushNow(key) // clears timer, immediate write
  → Session.updatePart(currentText) // publishes Bus event only (2026-05-04 fix)
```

### LLM Integration (`llm.ts`)

`LLM.stream()` wraps AI SDK `streamText()`:
- Builds system prompt from `SystemPrompt.header()` + agent prompt + provider prompt
- Resolves tools from `ToolRegistry.tools()` + MCP + connectors
- Returns `StreamTextResult` with `fullStream` async iterator

### Session Loop (`prompt.ts:284-766`)

`SessionPrompt.loop()`:
1. `createUserMessage()` saves user message to storage
2. `while (true)` main loop with `MessageV2.stream(sessionID)`
3. `SessionProcessor.create()` for each assistant turn
4. `resolveTools()` builds AI SDK tool set
5. `LLM.stream()` → `processor.process()` → result (`continue`/`stop`/`compact`)

### `lazyAsync` (`src/util/lazy.ts`)

Async-safe initialization for `state()` and similar singletons:
- Uses `Promise`-caching pattern (subsequent callers share init promise)
- Replaces original `lazy()` for async initializers to prevent race conditions
- Both `lazy()` (sync) and `lazyAsync()` exist; `lazyAsync` used for all async init

## Mobile Development System (`src/mobile/`)

### Core Modules

| Module              | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `expo.ts`           | Expo CLI: start, build, install, publish, credentials, profiles       |
| `simulator.ts`      | iOS Simulator (`xcrun simctl`) + Android Emulator (`adb`, `emulator`) |
| `react-native.ts`   | React Native CLI: run-ios, run-android, Metro bundler                 |
| `tophat.ts`         | Shopify Tophat: install apps on device/simulator/emulator             |
| `project-detect.ts` | Detect Expo, React Native, Flutter, native iOS/Android projects       |

### Mobile AI Tools (`src/tool/`)

| Tool                   | Description                              |
| ---------------------- | ---------------------------------------- |
| `expo_start`           | Start Expo dev server (Metro bundler)    |
| `expo_build`           | Run EAS builds (ios/android/all)         |
| `expo_install`         | Install Expo-compatible packages         |
| `expo_publish`         | Publish OTA updates                      |
| `simulator_list`       | List iOS simulators or Android emulators |
| `simulator_boot`       | Boot iOS simulator or Android emulator   |
| `simulator_shutdown`   | Shutdown device                          |
| `simulator_install`    | Install IPA/APK on device                |
| `simulator_screenshot` | Capture device screenshot                |
| `simulator_logs`       | Retrieve device logs                     |
| `simulator_wipe`       | Factory reset device                     |
| `rn_run`               | Run React Native app                     |

### CLI Commands (`src/cli/cmd/mobile-dev.ts`)

```
nikcli mobile dev
├── expo start [--platform ios|android|web] [--clear] [--port]
├── expo build --platform ios|android|all [--profile]
├── expo install <packages...>
├── expo publish [--message]
├── simulator list <ios|android>
├── simulator boot <device_id>
├── simulator shutdown <device_id>
├── simulator install <device_id> <target>
├── simulator screenshot <device_id> [--output]
├── simulator logs <device_id> [--filter] [--lines]
├── simulator wipe <device_id>
└── react-native run <ios|android> [--device] [--configuration]
```

### Mobile Server Routes (`src/server/routes/mobile.ts`)

- `GET /mobile/doctor` - Environment health check
- `GET /mobile/expo/status` - Expo availability and version
- `GET /mobile/expo/projects` - Detect mobile projects
- `GET /mobile/simulator/list` - List simulators/emulators
- `POST /mobile/simulator/boot` - Boot device
- `POST /mobile/simulator/shutdown` - Shutdown device
- `GET /tophat/status` - Tophat providers and devices
- `GET /tophat/install-url` - Generate install URLs

## Server/TUI Integration (`src/server/`)

### Route Organization

```
/session/*        - Core session management
/tui/*            - TUI-specific endpoints
/global/*         - Global events/health
/project/*        - Project management
/mcp/*            - MCP routes
/auth/*           - Authentication
/permission/*     - Permission handling
```

### Communication Patterns

1. **Event Bus** - Server→TUI via Bus.publish()
2. **SSE** - `/event` endpoint for real-time updates
3. **Request/Response Queue** - External control via `/tui/control/*`
4. **SDK Client** - Auto-generated from OpenAPI spec in `packages/sdk/js/src/`

### SDK Client Pattern (`packages/sdk/js/src/client.ts`)

```typescript
export function createNikcliClient(config?: Config & { directory?: string }) {
  const client = createClient(config)  // Generated from OpenAPI spec
  return new NikcliClient({ client })
}

// Usage with directory header
const sdk = createNikcliClient({
  baseUrl: "http://nikcli.local",
  directory: "/path/to/project",
  fetch: customFetch,
})
```

### TUI Worker Communication (`src/cli/cmd/tui/worker.ts`)

```typescript
const fetchFn = (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  const auth = getAuthorizationHeader()  // Basic auth
  request.headers.set("Authorization", auth)
  return Server.App().fetch(request)
}

for await (const event of sdk.event.subscribe({}).stream) {
  Rpc.emit("event", { id, event })
}
```

### Middleware Stack

1. Error Handler → 2. User Auth (Bearer nku\_) → 3. CORS → 4. Workspace Context → 5. Query Validation

## Event Bus System (`src/bus/`)

### Bus Architecture

Two-layer event system:
- **`Bus`** (`bus/index.ts`): Per-instance, type-safe subscriptions via `Map<type, callback[]>` + wildcard `*` support. Local-only.
- **`GlobalBus`** (`bus/global.ts`): Node.js `EventEmitter` singleton. Cross-process forwarding.

### Key Operations

- `Bus.publish(def, props)` — fires local subscribers, then emits to `GlobalBus` for SSE/RPC propagation
- `Bus.subscribe(def, callback)` — returns unsubscribe function; stores in `subscriptions` Map
- `Bus.subscribeAll(callback)` — subscribes to all events (used by SSE endpoint at `server.ts:738`)
- `Bus.once(def, callback)` — single-fire subscription helper

### TUI Event Propagation

```
Server: Bus.publish(PartUpdated, {part, delta})
  → Local subscribers: ShareSync, TaskTool, ShareNext
  → GlobalBus.emit("event", {directory, payload})
    → SSE route (server/routes/global.ts:81) → TUI stream
    → Workspace SSE (workspace/workspace-server/routes.ts:30)
    → Mobile stream (server/routes/mobile.ts:2073)
    → Worker RPC (cli/cmd/tui/worker.ts:36-38) → Rpc.emit("global.event")
      → Thread.ts RPC client → SDK context → SolidJS emitter
        → TUI component subscriptions (app.tsx:1015-1109)
```

### Subscribers to `MessageV2.Event.PartUpdated`

| File | Purpose |
| ---- | ------- |
| `tool/task.ts:345` | Background delegation progress |
| `tool/task.ts:739` | Foreground task live summary |
| `share/share.ts:56` | Share service cache sync |
| `share/share-next.ts:87` | Share service cache sync (new) |

## Storage System (`src/storage/`)

### In-Memory Cache

- **Read-through cache** with 5s TTL (`DEFAULT_TTL_MS = 5000`)
- `Cache.get()` returns `undefined` if missing or expired (auto-deletes expired entries)
- `Cache.set()` with optional TTL; `Cache.invalidate(key)` / `Cache.invalidatePrefix(prefix)`
- `Storage.read()` populates cache on disk read; `Storage.write/update()` update cache

### Key Operations

- `Storage.read/write/list/remove` — JSON file storage with key→path mapping
- `Storage.update()` — read-modify-write with exclusive lock
- `Storage.NotFoundError` thrown for missing files (via `withErrorHandling`)
- Key format: `["collection", "id1", "id2"]` → `storage/collection/id1/id2.json`

### Locking Mechanism

Two lock types:
- **`Lock`** (`src/util/lock.ts`): In-memory reader-writer lock, single-process. Multiple concurrent readers, single writer, writers prioritized. Auto-cleanup when no active readers/writers.
- **`Flock`** (`src/util/flock.ts`): File-based distributed lock with lease. Used for cross-process coordination (snapshot, account refresh). Exponential backoff + heartbeat + breaker pattern.

### Storage Key Patterns (`<data>/storage/`)

| Key Pattern | File Path | Contains |
|-------------|-----------|----------|
| `["project", "<id>"]` | `storage/project/<id>.json` | Project metadata |
| `["session", "<projectID>", "<sessionID>"]` | `storage/session/<pid>/<sid>.json` | Session info |
| `["message", "<sessionID>", "<messageID>"]` | `storage/message/<sid>/<mid>.json` | Message info |
| `["part", "<messageID>", "<partID>"]` | `storage/part/<mid>/<pid>.json` | Message part |
| `["session_diff", "<sessionID>"]` | `storage/session_diff/<sid>.json` | Snapshot file diffs |
| `["session_share", "<sessionID>"]` | `storage/session_share/<sid>.json` | Share data |
| `["todo", "<sessionID>"]` | `storage/todo/<sid>.json` | Session TODO |

### Migrations

Two JSON file migrations tracked via `<data>/storage/migration` marker file:
- **Migration 0** (lines 64-159): Legacy project format → `session/{projectID}/` layout
- **Migration 1** (lines 160-180): Extracts `diffs` from session files → separate `session_diff/` files

Database migrations via Drizzle in `migration/` (timestamped subdirs).

### DeltaCoalescer (`src/session/delta-coalescer.ts`)

Reduces ~500 Storage writes per message to ~10-20 via debouncing:
- `schedule(key, content, callback)` — queues write with 150ms debounce timer
- `flushNow(key)` — forces immediate flush (clears timer, writes now)
- `flushAll()` — flushes all pending writes
- `clear()` — clears all timers and pending entries

**Flow for streaming text**: `text-delta` → `updatePartCoalesced()` → Bus.publish + coalescer.schedule → 150ms debounce → Storage.write
**Flow for terminal text**: `text-end` → `flushNow()` + `Session.updatePart()` (flushNow persists, updatePart publishes Bus event only)

### Database (`src/storage/db.ts`)

- SQLite with Drizzle ORM, Bun driver
- PRAGMAs: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `cache_size=-64000`, `foreign_keys=ON`

### Git snapshots and file watchers for real-time sync

## Bug Fixes (2026-04-06)

### Code Review Session - 11 Bugs Confirmed & Fixed

All 11 bugs verified real by code-reviewer agent, fixes executed in single session.

| Priority | Bug                      | File                    | Fix Applied                                                    |
| -------- | ------------------------ | ----------------------- | -------------------------------------------------------------- |
| P0       | #7 Missing `.toObject()` | `message-v2.ts:893`     | Added `.toObject()` to default case                            |
| P0       | #1 Non-null assertion    | `prompt.ts:1161,1222`   | Changed `input.agent!` to `input.agent ?? "default"`           |
| P0       | #2 findLast guard        | `compaction.ts:103`     | Added null check before `.info` access                         |
| P0       | #5 Race in sleep()       | `retry.ts:10-24`        | Added `settled` flag to prevent double resolution              |
| P1       | #3 Unsafe JSON.parse     | `message-v2.ts:716,742` | Wrapped in try-catch, cursor.decode returns undefined on error |
| P1       | #8 Unsafe import         | `provider.ts:1267`      | Added `createKey` validation before calling                    |
| P1       | #10 No timeout           | `models.ts:186`         | Added `AbortSignal.timeout(10000)`                             |
| P2       | #11 Session race         | `prompt.ts:271-276`     | Added session existence check before callbacks.push            |
| P2       | #4 Bun.deepEquals        | `processor.ts:154`      | Replaced with `devalue` (portable, already in deps)            |
| P2       | #9 Mutable mutation      | `transform.ts:219,224`  | Cloned messages before mergeDeep                               |
| P3       | #6 Redundant stringify   | `processor.ts:343`      | Removed JSON.stringify wrapper from `e.stack`                  |

### Bug Fixes Applied (2026-04-06 Build Session)

| Bug                    | File                   | Fix Applied                             |
| ---------------------- | ---------------------- | --------------------------------------- |
| ReadTool race          | `prompt.ts:1214`       | Converted `.then()` to sequential await |
| FileTime missing await | `prompt.ts:1256`       | Added await to FileTime.read()          |
| Session race           | `session/index.ts:306` | Added await to share() + update()       |
| Auth bypass            | `permission.ts:11`     | Added userAuthMiddleware()              |
| Auth bypass            | `dbedit.ts:10`         | Added userAuthMiddleware()              |
| Info leak              | `server.ts:116`        | Stack traces only in dev mode           |
| Null deref             | `compaction.ts:103`    | Added null check for findLast()         |
| Resource leak          | `voice.ts`             | Added cleanup for temp audio files      |
| Process leak           | `grep.ts`              | Added abort controller kill             |
| OOM risk               | `read.ts`              | Check only first 512 bytes for binary   |

### Phase 1 Patch Fixes (2026-04-09)

Changed files: `src/server/routes/tui.ts`, `src/session/prompt.ts`, `src/acp/agent.ts`

| Fix                      | File               | Description                                                                   |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------- |
| Route mapping            | `routes/tui.ts`    | `/open-themes` → `theme.switch`, `/open-sessions` → `session.list`            |
| data:text/plain decoding | `prompt.ts`        | `decodeDataUrlTextPayload()` helper handles base64/base64url/percent-encoded  |
| ACP mode validation      | `agent.ts:957-965` | `setSessionMode()` validates against visible non-subagent modes + session.cwd |

### Session Fixes (2026-05-04)

| Fix                          | File               | Description                                                                   |
| ---------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| Double-write on terminal     | `processor.ts:386-387` | Removed `Session.updatePart()` after `flushNow()` — `flushNow` already persists via coalescer |
| Timer nulling in clear()     | `delta-coalescer.ts:167` | Added `entry.timer = null` after `clearTimeout()` in `clear()` |
| Error safety for flushAll    | `processor.ts:475-481` | Wrapped `flushAll()` + `clear()` in try/finally |
| Race condition in lazy init  | `util/lazy.ts`     | Added `lazyAsync()` for async-safe singleton init (uses Promise-caching pattern) |

### Confirmed Issues (Updated 2026-05-04)

| #   | File                               | Issue                                                                   | Status          |
| --- | ---------------------------------- | ----------------------------------------------------------------------- | --------------- |
| 1   | `config/config.ts`                 | `Config.get()` side effects                                             | Pending         |
| 2   | `session/prompt.ts`                | Nondeterministic prompt ref ordering                                    | Pending         |
| 3   | `acp/agent.ts`                     | ACP live vs replay file-part mismatch                                   | Pending         |
| 4   | `acp/agent.ts`                     | ACP tool-result attachment omission                                     | Pending         |
| 5   | `provider/provider.ts`             | Late `enabled_providers` side effects                                   | Pending         |
| 6   | `packages/app/src/utils/prompt.ts` | App undo/fork drops non-inline file parts                               | Pending         |
| 7   | TUI                                | Explicit `--agent/--model` state issues                                 | Pending         |
| 8   | TUI                                | Stale model/variant sync                                                | Pending         |
| 9   | TUI                                | `read` tool image/PDF attachments not rendered                          | **Implemented** |
| 10  | `routes/tui.ts:266`                | `/execute-command` returns `200` for unknown commands (should be `400`) | Pending         |
| 11  | `cli/cmd/tui/context/local.tsx`   | `ultrareview-reviewer` in `PRIMARY_AGENT_NAMES` but mode=subagent/hidden | Intentional (TUI selector UI only) |
| 12  | `mobile/auth.ts:80-89`             | Timing attack in `MobileAuth.verify()` — uses `===` not constant-time   | **Fix needed**  |
| 13  | `server.ts:196-202`                | Token leaks in server logs via `c.req.path` (includes `?token=...`)    | **Fix needed**  |
| 14  | `session/processor.ts:159-173`    | Reasoning-end double-write (was same as text-end, removed updatePart)   | **Fixed**       |

## Mobile IDE Backend Issues

### Client/Backend Mismatch (CRITICAL)

Mobile client (`packages/mobile/lib/client.ts`) calls `/git/*` but backend defines endpoints under `/mobile/git/*`. Mobile also sends wrong body for stage (`{ paths }` not `{ files }`).

### Git Backend Bugs

- Porcelain parsing: `line.slice(3, 4)` for worktree status should be `line[1]`; `line.slice(4)` drops first char of path
- Diff only runs `git diff --no-color -U1000`; no `--staged` or untracked content
- Commit returns raw `git commit` output as `sha`; should use `git rev-parse HEAD`
- Discard uses `git checkout -- <files>` which doesn't remove untracked files

### WebSocket Auth (2026-04-30)

Fixed: `server.ts:161` now accepts token from query parameter for WS connections:
```typescript
const bearer = MobileAuth.bearer(c.req.raw) || c.req.query("token")
```

Security issues pending fix:
- Token leaks in `log.info` (path includes query string)
- Timing attack in `MobileAuth.verify()` using `===` instead of `crypto.timingSafeEqual()`

### GitHub OAuth Persistence

Token stored server-side in `${Global.Path.data}/connectors-auth.json`. If server restarts or XDG path changes, token disappears → repeated OAuth requests. Fix: make data directory durable, add `NIKCLI_DATA_DIR` env var.

## Plugin Package (`packages/plugin/`)

### Source Files (no tests)

- `src/index.ts` — Plugin system core (6 KB)
- `src/tool.ts` — Plugin tool definition (635 B)
- `src/shell.ts` — Plugin shell access (3 KB)
- `src/tui.ts` — Plugin TUI capabilities (10 KB)
- `src/index.d.ts` — Type declarations (6.1 KB)
- `src/example.ts` — Example plugin (390 B)
- `script/build-plugins.ts`, `script/publish-plugins.ts`, `script/publish.ts`

### Bundled Plugin Directories

- Directories exist: `agent-memory`, `background`, `background-agents`, `context-analysis`, `direnv`, `dynamic-context-pruning`, `envsitter-guard`, `handoff`, `safety-net`, `smart-title`
- **All plugin directories contain only `node_modules/` — no source code**
- Plugins install `@nikcli-ai/plugin` as a dependency (same as this package)
- Actual plugin implementations are external npm packages (e.g., `@nikcli-ai/plugin-agent-memory`)
- Health score: ~5/10 — plugin infrastructure is well-designed but ecosystem source is absent from repo

## TUI Architecture (`src/cli/cmd/tui/`)

### Framework

**SolidJS + OpenTUI** — `@opentui/solid` renders SolidJS JSX to terminal-native elements.

**Entry point**: `src/cli/cmd/tui/app.tsx` — `tui()` calls `render(() => <App />, { targetFps: 45, useMouse: true, useKittyKeyboard: {}, exitOnCtrlC: false })`

**OpenTUI primitives**: `<box>` (flexbox container), `<text>` (styled text), `<span>` (inline text), `<scrollbox>` (scrollable), `<textarea>` (input), `<spinner>`, `<flex>`

**SolidJS patterns**: `createSignal`, `createMemo`, `createEffect`, `createStore`/`setStore`, `For`/`Show`/`Switch`/`Match`, `onMount`/`onCleanup`, `untrack`, `batch`

### Route System

**File**: `context/route.tsx` — flat discriminated union stored in SolidJS store:

```typescript
export type Route =
  | { type: "home"; initialPrompt?: PromptInfo; workspaceID?: string }
  | { type: "session"; sessionID: string; initialPrompt?: PromptInfo; workspaceID?: string }
  | { type: "changes"; sessionID: string; workspaceID?: string }
  | { type: "tree"; sessionID?: string; workspaceID?: string }
  | { type: "git-graph"; sessionID?: string; workspaceID?: string }
  | { type: "github"; sessionID?: string; workspaceID?: string }
  | { type: "plugin"; id: string; data?: Record<string, unknown>; workspaceID?: string }
```

**Route switching**: `app.tsx` uses `<Switch>/<Match>` to render route components. Navigate via `route.navigate({ type: "..." })`.

**All routes** support `workspaceID?: string` for multi-workspace routing. Delete-safe navigation redirects to `home` on session deletion.

### Context/Provider Pattern

**Factory**: `createSimpleContext<T, Props>` in `context/helper.tsx` — wraps SolidJS `createContext` + provider/consumer with optional `ready` gating.

**Provider nesting** (app.tsx, outer→inner):
```
ArgsProvider > ExitProvider > ServerProvider > KVProvider > ToastProvider >
RouteProvider > SDKProvider > ProjectProvider > SyncProvider > ThemeProvider >
LocalProvider > KeybindProvider > PromptStashProvider > DialogProvider >
CommandProvider > FrecencyProvider > PromptHistoryProvider > EditorContextProvider > PromptRefProvider
```

**Key contexts** (all in `context/`):
| Context | File | Purpose |
|---------|------|---------|
| `RouteProvider` | `route.tsx` | Navigation |
| `ThemeProvider` | `theme.tsx` | 50+ built-in themes from JSON |
| `LocalProvider` | `local.tsx` | Agent/model selection, MCP toggle |
| `SyncProvider` | `sync.tsx` | Server data sync (sessions, messages, config) |
| `KeybindProvider` | `keybind.tsx` | Keyboard shortcuts with leader-key |
| `KVProvider` | `kv.tsx` | Persistent key-value store (JSON on disk) |
| `SDKProvider` | `sdk.tsx` | API client connection |
| `DialogProvider` | `dialog.tsx` | Dialog stack management |

### Dialog System

**File**: `ui/dialog.tsx` — stack-based overlays, full-screen absolute-positioned boxes.

**API**:
```typescript
const dialog = useDialog()
dialog.replace(() => <MyComponent />)    // Replace/open dialog
dialog.clear()                           // Close all dialogs
dialog.setSize("medium" | "large" | "xlarge")  // max 60/88/116 chars
```

**Static patterns**: `DialogAlert.show()`, `DialogConfirm.show()` (returns `Promise<boolean>`), `DialogOnboarding.run(dialog)`, `DialogExportOptions.show()`

**Dialog components** (`component/dialog-*`): onboarding (4-step wizard), status, command palette, session list, model/agent/theme pickers, settings, provider, workspace list, confirm, alert, export.

### Styling System

**File**: `context/theme.tsx` — 50+ built-in themes (catppuccin, dracula, tokyonight, nord, etc.) from JSON in `context/theme/`. Custom themes from `themes/*.json` in config dir.

**Theme tokens**: `theme.primary`, `theme.textMuted`, `theme.borderSubtle`, `theme.backgroundPanel`, `theme.warning`, `theme.success`, `theme.error`, `theme.textDim` (note: `textDim` may not exist on all themes — use `textMuted` as fallback).

**Styling**: All colors via `theme.*` tokens (no hardcoded hex). Components use `<box>` with `flexGrow`, `flexShrink`, `flexDirection`, `gap`, `padding*`, `border`, `backgroundColor`.

### OpenTUI Primitive Components

| Primitive | Purpose | Key Props |
|-----------|---------|-----------|
| `<box>` | Flexbox container | `flexDirection`, `gap`, `flexGrow`, `flexShrink`, `padding*`, `backgroundColor`, `border`, `position` |
| `<text>` | Styled text | `fg`, `bg`, `attributes` (BOLD/ITALIC/etc), `wrapMode`, `selectable` |
| `<span>` | Inline text | Same as `<text>` |
| `<scrollbox>` | Scrollable container | `scrollTop`, handles j/k navigation |
| `<textarea>` | Input field | `value`, `onChange`, `onKeyDown`, keybindings |
| `<spinner>` | Loading animation | `frames`, `interval`, `color` |
| `<flex>` | Flex row helper | `gap`, `alignItems`, `justifyContent` |

### TUI State Management Patterns

**Pattern 1: `createSimpleContext` factory (context/helper.tsx)**
```typescript
export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore<Record<string, any>>()
    return {
      ready() { return ready() },
      get(key, defaultValue) { return store[key] ?? defaultValue },
      set(key, value) { 
        setStore(key, value)
        Bun.write(file, JSON.stringify(store, null, 2))
      },
      signal<T>(name, defaultValue) { /* reactive signal pair */ },
    }
  },
})
```

**Pattern 2: `createStore` for centralized state (sync.tsx)**
```typescript
const [store, setStore] = createStore<{
  status: "loading" | "partial" | "complete"
  provider: Provider[]
  config: Config
  session: Session[]
  message: Record<string, Message[]>
}>({ status: "loading", provider: [], ... })
```

**Pattern 3: `createSignal` for simple state**
```typescript
const [conceal, setConceal] = createSignal(true)
const [showThinking, setShowThinking] = kv.signal("thinking_visibility", true)
```

**Pattern 4: `createMemo` for derived state**
```typescript
const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
const showTips = createMemo(() => !kv.get("onboarding_complete", false))
```

### Onboarding Dialog (`component/dialog-onboarding.tsx`)

4-step wizard: **Welcome → Create account → Filesystem → Connect**

**Step 3 (Filesystem Footprint)**: Visual dashboard showing 4 sections with indented trees:
- **Application Data** (● sensitive): `storage/`, `auth.json`, `accounts.db`, `workspaces.db`, `plans/`, `snapshot/`, `worktree/`, `sync/`
- **Configuration**: `nikcli.json`, `tui.json`, `AGENTS.md`, `skills/`
- **Cache & Runtime State** (◦ ephemeral): `cache/`, `state/`
- **Project Directory**: `.nikcli/`, `commands/`, `agents/`, `plugins/`

Paths resolved dynamically from `Global.Path`, displayed with `~` for home. Legend: ● = sensitive (warning color), ◦ = ephemeral (muted).

### Plugin Route API

`plugin/api.tsx` exports `changes.navigate(id?)`, `tree.navigate(id?)`, `git-graph.navigate()` helpers + URL constructors. `git-graph` navigation preserves `workspaceID`.

## Filesystem Paths

### XDG Base Directories (created by `initialize()` in `src/global/index.ts`)

| Variable | Resolved Path | Purpose |
|----------|---------------|---------|
| `Global.Path.data` | `<XDG_DATA_HOME>/nikcli/` | Primary data storage |
| `Global.Path.cache` | `<XDG_CACHE_HOME>/nikcli/` | Versioned cache (cleared on version bump) |
| `Global.Path.config` | `<XDG_CONFIG_HOME>/nikcli/` | Global config files |
| `Global.Path.state` | `<XDG_STATE_HOME>/nikcli/` | Runtime state (locks, prefs, history) |
| `Global.Path.log` | `<XDG_DATA_HOME>/nikcli/log/` | Log files |
| `Global.Path.bin` | `<XDG_DATA_HOME>/nikcli/bin/` | Binary directory (curl install) |
| `Global.Path.home` | `os.homedir()` or `NIKCLI_TEST_HOME` | User home (read-only) |

### Config File Discovery (priority order, first existing wins)

**`nikcli.json`**: `<cwd>/nikcli.json` → `<cwd>/.nikcli/nikcli.json` → `<XDG_CONFIG_HOME>/nikcli/nikcli.json` → `<XDG_CONFIG_HOME>/nikcli/managed/nikcli.json` → `NIKCLI_CONFIG_DIR` → `~/.nikcli/nikcli.json` → `NIKCLI_CONFIG` env → `NIKCLI_CONFIG_CONTENT` env

**`tui.json`**: Same discovery as nikcli.json, plus `NIKCLI_TUI_CONFIG` env var. Supports `.json` and `.jsonc`. Auto-migrated from `nikcli.json` by `migrateTuiConfig()`.

### Data Files

| File | Path | Contains |
|------|------|----------|
| `auth.json` | `<data>/auth.json` | OAuth tokens, API keys (chmod 600) |
| `connectors-auth.json` | `<data>/connectors-auth.json` | Connector tokens (chmod 600) |
| `accounts.db` | `<data>/accounts.db` | SQLite: account + config tables |
| `workspaces.db` | `<data>/workspaces.db` | SQLite: workspace table |
| `mobile-github-imports.json` | `<data>/mobile-github-imports.json` | GitHub import records |
| `mobile-repos/<owner>/<repo>/` | `<data>/mobile-repos/` | Cloned mobile repos |
| `snapshot/<projectID>/` | `<data>/snapshot/` | Bare git repos for diff tracking |
| `worktree/<projectID>/` | `<data>/worktree/` | Git worktrees + `registry.json` |
| `tool-output/tool_*` | `<data>/tool-output/` | Truncated tool output (7-day cleanup) |
| `sync/<projectID>.events.json` | `<data>/sync/` | Event-sourced sync records |

### Storage Key Patterns (`<data>/storage/`)

| Key Pattern | Example | Contains |
|-------------|---------|----------|
| `["project", "<id>"]` | `storage/project/<id>.json` | Project metadata |
| `["session", "<projectID>", "<sessionID>"]` | `storage/session/<pid>/<sid>.json` | Session info |
| `["message", "<sessionID>", "<messageID>"]` | `storage/message/<sid>/<mid>.json` | Message info |
| `["part", "<messageID>", "<partID>"]` | `storage/part/<mid>/<pid>.json` | Message part |
| `["session_diff", "<sessionID>"]` | `storage/session_diff/<sid>.json` | Snapshot file diffs |
| `["session_share", "<sessionID>"]` | `storage/session_share/<sid>.json` | Share data |
| `["todo", "<sessionID>"]` | `storage/todo/<sid>.json` | Session TODO |
| `["permission", "<projectID>"]` | `storage/permission/<pid>.json` | Permission rules |

### Lock Files

| File | Path | Purpose |
|------|------|---------|
| `serve.lock` | `<state>/serve.lock` | Server PID lock |
| `session/<sessionID>.lock` | `<state>/session/<sid>.lock` | Session-level reader-writer lock |

## TUI Route System (`src/cli/cmd/tui/routes/`)

### Route Components

| Route | File | Purpose |
| ----- | ---- | ------- |
| `home` | `home/index.tsx` | Landing screen: logo, prompt, tips, version |
| `session` | `session/index.tsx` | Main chat with message scrollbox |
| `changes` | `changes/index.tsx` | Code review: diff view + inline comments + GitHub PR panel |
| `tree` | `tree/index.tsx` | Session hierarchy browser (vim-like: j/k/l/h/gg/G) |
| `git-graph` | `git-graph/index.tsx` | Git commit browser (GHUI-style, Ctrl-G) |
| `github` | `github/index.tsx` | GitHub panel |
| `plugin` | Dynamic | Plugin-rendered routes via `route.register()` |

Delete-safe navigation: `app.tsx` redirects to `home` on session deletion from any route.

### Credential Resolution

`src/connectors/credentials.ts` — resolves auth tokens in order:
1. Environment variable / CLI flag (`NIKCLI_GITHUB_TOKEN`)
2. Config token (`ConnectorGithub.token`)
3. Stored connector auth (`ConnectorAuth`)

### Connector Operations

`src/connectors/registry.ts` — defined operations:
`github_get_repo`, `github_get_file`, `github_create_issue`, `github_list_issues`, `github_search_code`, `github_list_repos`

## GitHub Integration (`src/connectors/`)

### Core Files

| File | Purpose |
| ---- | ------- |
| `api/github.ts` | `GithubApi` REST wrapper: token auth, repos, contents, issues, branches, PR lookup/create, file decoding |
| `credentials.ts` | Credential resolution order (env → config → stored auth) |
| `registry.ts:111` | Connector operation registry |
| `config/config.ts:543` | `ConnectorGithub` Zod schema: `{ type: "github", token?, oauthClientId?, clientId?, enabled? }` |

### Mobile GitHub Routes (`src/server/routes/mobile.ts`)

Comprehensive GitHub support via Hono + `describeRoute`:
- `GET /mobile/github/repos` — list repos, merge imported metadata
- `GET /mobile/github/repos/:owner/:repo/branches`
- `POST /mobile/github/oauth/device` + `/poll` — device auth flow
- `POST /mobile/github/auth` — store/remove tokens
- `POST /mobile/github/import` — import repos into managed host cache
- `POST /mobile/github/session` — create GitHub-backed sessions with isolated worktrees
- `POST /mobile/session/:sessionID/publish` — commit, push, create/reuse PR
- `POST /mobile/session/:sessionID/cleanup` — remove GitHub-backed worktrees

### Managed Git Repos (`src/mobile/github-repo.ts`)

`MobileGithubRepo.runGit()` — authenticated git via `http.extraHeader` (no `gh` CLI dependency for core operations). `gh` used only in release scripts.

### Session GitHub Metadata (`src/session/index.ts:40`)

`SessionGithub` schema: `owner`, `repo`, `fullName`, `baseBranch`, `headBranch`, `repositoryDirectory`, `cloneUrl`, `htmlUrl`, `private`, `worktree`, `pullRequest`, `lastCommitSha`, `publishedAt`, `publishError`.

### GitHub CLI / `gh`

- **No app-level TUI/server integration** — GitHub support uses direct REST + git, not `gh` CLI
- `gh` appears only in release scripts: `script/release-github.ts`, `script/publish-start.ts`, `script/publish-complete.ts`, `script/changelog.ts`
- `src/permission/arity.ts:79` includes `gh` command arity for permission parsing

### Tests

- `test/cli/github.test.ts` — `parseGitHubRemote`
- `test/cli/_network-precise.test.ts` — exhaustive remote parsing cases

## TUI GitHub Utilities (`src/cli/cmd/tui/util/`)

### Files

| File | Purpose |
| ---- | ------- |
| `github.ts` | `gh` CLI wrapper: check status, login OAuth, PR metadata, review status, copy helpers |

### `gh` Wrapper Functions

- `gh()` — spawn `gh` with `GH_PROMPT_DISABLED=1`, JSON parse with non-zero exit handling
- `ghStatus()` — `gh auth status` → logged-in username or null
- `ghLogin()` — `gh auth login --web` (opens browser OAuth)
- `ghPrStatus(number, owner, repo)` — fetch PR title, state, author, additions, deletions, files, checks, labels
- `ghPrChecks(number, owner, repo)` — `gh pr checks` with exit-8 (pending checks) handling
- `ghCopyPrInfo(pr)` — copy PR URL, number, title, state to clipboard

## Code Review Route (`routes/changes/`)

### Files

| File             | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `index.tsx`       | Main review page: sidebar file list + unified/split diff view |
| `file-list.tsx`   | Sidebar with directories, file navigator, +/- indicators    |
| `comment-box.tsx` | Inline comment UI with type badges (bug/style/question/suggestion), two-phase input (type select → text), keyboard: `c` opens, `1-4` selects type, `ctrl+enter` submits, `esc` cancels |
| `format-comments.ts` | Formats all comments per file for AI review feedback       |
| `footer.tsx`     | Keyboard hints bar                                          |
| `header.tsx`      | Title bar with mode toggle (unified/split), session info     |
| `github-panel.tsx` | GitHub PR sidebar (left panel, toggled via `g` key)         |

### GitHub Panel (Left Sidebar)

Integrated into `changes` route left sidebar, toggled via `g` key:
- Shows PR metadata (title, state, author, labels, checks, files changed, description)
- OAuth via `gh auth login --web` (key `a`) when not logged in
- `r` refreshes PR context; `o` opens PR in browser; `y` copies PR metadata
- Reuses `src/cli/cmd/tui/util/github.ts` for `gh` calls and `GithubApi` for PR details

### Comment System

- Comments stored per session in sync store, loaded/saved per file
- `CommentInput` two-phase: phase "type" for type selection, phase "text" for body
- KeyBindings on textarea: `{ name: "return", ctrl: true, action: "submit" }` for submit
- `submitting` signal controls textarea focus reactivity; reset after onSubmit completes
- `formatCommentsForAI()` outputs structured feedback with file path, line numbers, comment type, content

### Diff View

- Uses `@opentui/core` `DiffRenderable` for syntax-highlighted unified/split output
- `formatPatch()` / `structuredPatch()` from `diff` package for parsing
- Keyboard: `j/k` navigate, `w` toggle wrap, `tab` switch list/diff view

## Session Tree Route (`routes/tree/`)

### Files

| File                  | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `index.tsx`           | Main tree browser with header, column headers, scroll list, footer |
| `header.tsx`          | `SessionTreeHeader` (title + stats) + `SessionTreeColumnHeaders` (Session/Changes/Status/Updated/ID) |
| `footer.tsx`          | `SessionTreeFooter` with keyboard shortcuts + MCP/LSP status |
| `tree-rows.tsx`        | `TreeRow`, `flattenTreeRows()`, `treeLinePrefix()`, `listUserMessagePreviews()` |
| `session-activity-line.ts` | Activity display (file/additions/deletions counts)         |
| `session-status.ts`    | Status badge component                                       |

### Features

- Hierarchical tree with expand/collapse (`h/l` keys)
- Filter mode with `/` or `f` key to search by title/ID
- Expand all with `a` key
- MCP/LSP status indicators in footer
- `SessionTreeHeader`: background with `SplitBorder`, title "Session Tree", root/session counts, current selection indicator
- `SessionTreeColumnHeaders`: fixed column layout with aligned widths

## Git Graph Route (`routes/git-graph/`)

### Overview

GHUI-style git commit browser. Opens via command palette (`git graph` or `Ctrl-G`) or plugin API.

### Files

| File | Purpose |
| ---- | ------- |
| `index.tsx` | Main graph view: commit list, PR details panel, header, footer |

### Features

- **Commit list**: left panel with graph lines, hash, refs, author, date, CI/check status
- **PR details**: right panel (split view at ≥118 cols) with labels, checks, summary, files changed, tests, description
- **PR detection**: only from `pull/<n>` refs or anchored `Merge pull request #n` subject lines (not loose `#123` matching)
- **Checks**: uses `gh pr checks` output; handles non-zero exits (exit 8 = pending) without discarding JSON
- **Keyboard**:
  - `j/k` navigate rows
  - `g/G` go to first/last
  - `o` open in browser
  - `y` copy metadata/PR URL
  - `x` toggle split view
  - `r` reload
  - `f` filter/search
  - `esc` close / exit filter
- **Modifiers ignored**: all shortcuts respect `ctrl/meta/super` state, dialog stack, and leader key mode — no overlap with global shortcuts
- **Stale data guard**: graph/details/GitHub shown only if directory/hash/PR matches current resource request
- **Robust spawn**: `GH_PROMPT_DISABLED=1`, `GIT_TERMINAL_PROMPT=0`, timeout on all `git`/`gh` calls
- **Scroll**: selected row scrolled into view via `listScroll.scrollTo()`
- **Visual**: fixed-width cells with `overflow="hidden"` and `flexShrink={0}` prevent row overlap on scroll; explicit `backgroundColor` on all rows

### Theme Consistency

Fully consistent with other TUI routes:
- All colors via `theme.*` tokens (no hardcoded hex)
- Same `<box>`, `<text>`, `<scrollbox>`, `<flex>` component patterns
- `FooterHint`/`FooterSep` for keyboard hints matching other routes
- `borderColor={theme.borderSubtle}` for dividers
- Responsive column widths from `useTerminalDimensions()`

### Code Review (2026-04-28, 5 rounds)

| Round | Focus | Result |
| ----- | ----- | ------ |
| 1 | Initial implementation | 5 issues found (gh checks exit, stale resources, keyboard overlap, no scroll-into-view, misleading PR labels) |
| 2 | After fixes | 3 issues (dialog/leader conflicts, stale directory comparison, commit details by hash only) |
| 3 | After fixes | 1 issue (prNumber matches any `#123` in subject) |
| 4 | After fix (PR detection via refs/merge pattern only) | Clean |
| 5 | Visual overlap after scrolling | Clean (fixed-width cells + explicit backgroundColor) |

## Logo Component (`component/logo.tsx`)

Simple static ASCII logo (104 lines):
- Two-column ASCII art: `nikcli` split as "███╗" + "█████╗" and "╗██╗" + "██╔═══" etc.
- Shadow rendering via `▀` block characters with `_/^/~` markers
- Renders via OpenTUI `<text>` with `fg`, `bg`, `attributes`, `selectable={false}`
- `tint()` from theme for shadow color (25% intensity)
- No animation, no wave/burst effects (reverted after stability issues)

## TUI Component Library (`component/`)

| Component | Purpose |
| --------- | ------- |
| `image-preview.tsx` | ASCII art preview for image URLs (Jimp, 40×16 chars, `▀` block chars) |
| `logo.tsx` | Static nikcli ASCII logo with shadow rendering |
| `border.tsx` | `SplitBorder` (left-side accent line) component |
| `dialog-*` | 20+ dialog components: onboarding (4-step), status, command palette, session/model/agent/theme pickers, settings, provider, workspace, confirm, alert, export |
| `prompt/` | Prompt bar with history, frecency, autocomplete |
| `tips.tsx` | Home screen tips (from `ralph/feature-plugins/home`) |
| `spinner.tsx` | Loading spinner component |

### Dialog System Details

Dialogs are stack-based overlays rendered as full-screen absolute-positioned boxes with semi-transparent backdrop. Sizes: `medium` (60 chars), `large` (88 chars), `xlarge` (116 chars). Close on backdrop click or Esc/Ctrl+C. Components call `dialog.clear()` to dismiss.

## Mobile App (`packages/mobile/`)

### Stack

Expo 52, React Native 0.76, NativeWind, lucide-react-native, expo-router, react-native-webview, zustand, Expo SecureStore.

### Architecture

- **Root layout** (`app/_layout.tsx`): ServerProvider, auth guard, notifications/live activity reconciliation, Stack.
- **App shell** (`app/(app)/_layout.tsx`): custom Tabs with AppHeader + AppTabBar; hides chrome for nested routes (`segments.length > 2`).
- **Auth**: two credential concepts — server pairing token (`ServerConfig.token`) and user session token (`USER_TOKEN_KEY`).
- **Data**: direct screen-to-`MobileClient` calls; no query/cache layer; Zustand for UI prefs, SecureStore for config/token.

### Key Files

| File | Purpose |
| ---- | ------- |
| `app/(app)/_layout.tsx` | Tab shell with AppHeader/TabBar |
| `app/(app)/sessions/index.tsx` | Operations board / session list |
| `app/(app)/sessions/[sessionId].tsx` | Live session timeline: SSE stream, composer, permissions, Git publish |
| `app/(app)/repos/index.tsx` | Local/GitHub repo selection + import |
| `app/(app)/settings/index.tsx` | All-in-one settings hub (oversized; subroutes exist) |
| `app/(app)/routines/index.tsx` + `[routineId].tsx` | Routine list + create/edit detail |
| `app/(app)/terminal/index.tsx` | WebView-backed PTY terminal |
| `app/login.tsx` | Auth flow with remembered email |
| `lib/server-provider.tsx` | Global server config, bootstrap, user token state |
| `lib/client.ts` | Mobile API client (sessions, repos, settings, files, Git, routines, PTY) |
| `lib/store.ts` | Zustand UI preferences |
| `lib/storage.ts` | SecureStore persistence |
| `lib/theme.ts` | Design tokens: palette, glass, chat tokens |
| `components/layout/AppHeader.tsx` | Glass header with host/GitHub/workspace status |
| `components/layout/AppTabBar.tsx` | Custom glass bottom tab bar + status strip |
| `components/layout/DrawerMenu.tsx` | Animated right-side nav drawer |
| `components/ui/SurfaceCard.tsx` | Base card primitive |
| `components/ui/ActionButton.tsx` | Base button primitive |
| `components/ui/InfoChip.tsx` | Status chip with tone (default/info/warn/danger/success) |
| `components/ui/EmptyState.tsx` | Empty state placeholder |
| `components/ui/ErrorBanner.tsx` | Error banner |
| `components/session/SessionComposer.tsx` | Primary chat composer |
| `components/session/ComposerToolbar.tsx` | Composer toolbar |
| `components/session/ComposerToolDrawer.tsx` | Overlapping tool drawer (needs consolidation) |
| `components/MessageBubble.tsx` | Large message bubble (consider splitting) |
| `components/ToolCallView.tsx` | Tool call display |
| `components/PermissionCard.tsx` | Permission request UI |
| `components/Skeleton.tsx` | Loading skeleton |
| `components/git/GitReviewModal.tsx` | Git review modal |
| `components/git/GitCommitSheet.tsx` | Commit sheet |
| `components/git/GitFileTree.tsx` | Git file tree |
| `hooks/use-session-stream.ts` | SSE session event hook |

### Known Issues (2026-04-29)

- `_layout.tsx:31`: `settings` and `user` are registered tabs but filtered out of `AppTabBar`; navigating to them from header/drawer leaves no selected tab and `AppHeader` falls back to Sessions.
- `SessionComposer.tsx:653`: stop button's `onPress` only triggers haptics; `onStop` prop is accepted but never destructured/wired. Also: attachment/model/MCP props are accepted but only `onAttach` is destructured.
- `terminal/index.tsx:9,324`: imports `SafeAreaView` from React Native and adds top safe-area padding inside a screen that already has app chrome. Should use `View` and account only for bottom/keyboard safe area.
- `terminal/index.tsx:394`: uses `client!` for retained terminal tabs; host disconnect after tabs exist can crash. Needs null guard.
- `AppHeader.tsx:133`, `DrawerMenu.tsx:199`: icon-only `Pressable`s lack `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`.
- `ActionButton.tsx:86`: does not set default `accessibilityRole="button"` or `accessibilityState`; callers must override.
- `InfoChip.tsx:21`: `tone="warn"` maps to danger/red colors; dark mode theme keeps warn/success/danger near-monochrome. Semantic tokens needed before using chips for risk/permission states.

### UI Polish Plan (2026-04-29)

Full polish plan saved at `.nikcli/plans/1777478578333-curious-circuit.md`. Phases:

1. **Design tokens** — `lib/theme.ts`: add semantic tokens (successBg, warnBg, dangerBg, interactive, surfaceRaised); restore semantic color to dark mode; standardize radius values; align boxShadow usage.
2. **App shell** — Header: contextual title, responsive (< 390px), accessibility labels; TabBar: 44px min hit targets, clearer active state; DrawerMenu: cleaner sections.
3. **Screen patterns** — Reduce hero copy, consistent skeleton/empty/error states, `ScrollView contentInsetAdjustmentBehavior="automatic"`, bottom safe area above tab bar.
4. **Sessions/transcript** — Cleaner session list hierarchy, more breathing room in transcript, compact tool call states, better permission card risk display, cleaner composer.
5. **Settings** — Group into Account/AI Runtime/Integrations/Knowledge/Developer sections, shorter cards, progressive disclosure.
6. **Repos/Git/Routines** — Semantic diff colors (added/modified/deleted), cleaner routine cards + run history timeline.
7. **Terminal** — Remove RN `SafeAreaView`, better empty/offline/reconnect states.

## TUI Message Rendering (`src/cli/cmd/tui/routes/session/index.tsx`)

### Message Components

| Component          | Line  | Content                                  |
| ------------------ | ----- | ---------------------------------------- |
| `Session`          | ~1188 | Main scrollbox with sticky-bottom scroll |
| `UserMessage`      | ~1367 | Renders user text + file attachments     |
| `AssistantMessage` | ~1463 | Renders assistant parts + metadata       |

### User Message Rendering

- Text extracted from non-synthetic text parts (line ~1376)
- User text rendered as plain `<text>` (line ~1411)
- File attachments including image MIME badges (line ~1412)
- Safe insertion point: below text block, before timestamp/queued metadata

### Assistant Message Rendering

- Parts dynamically mapped (line ~1510) via `PartMap` (line ~1575)
- Text renders through `TextPart` (line ~1614)
- Markdown rendered by OpenTUI `<code filetype="markdown">` (line ~1620) — **not custom JSX**
- Metadata/status renders after all parts (line ~1539)
- Safe insertion point: after `<For each={props.parts}>`, before error/status metadata

### Markdown/URL Rendering

- OpenTUI owns markdown link rendering; no local hook available
- Link styling: `string.special.link` in theme (line ~1099)
- URL styling: `string.special.url` (line ~1137)
- `Link` component in `src/cli/cmd/tui/ui/link.tsx:20` — used in dialogs, not markdown output
- Avoid IDs starting with `text-`; `InlineTool` uses that prefix for spacing heuristics (line ~1800)

### OpenTUI FrameBuffer APIs

- `FrameBufferRenderable extends Renderable` — requires `width`, `height`; optional `respectAlpha`
- `frameBuffer.setCell(x, y, char, fg, bg)` — core API for colored terminal-cell rendering
- `frameBuffer.drawSuperSampleBuffer()` — for RGBA pixel buffers with native supersampling
- `RGBA.fromInts(r, g, b, a)` / `RGBA.fromHex()` — color construction
- `extend({ tagName: RenderableClass })` — registers custom JSX renderables in Solid
- Property setters should call `redraw()` + `requestRender()` for reactive updates
- Repo example: `packages/webrenderer/src/webview-renderable.ts` (extends `FrameBufferRenderable`)

### Image URL Previews (Implemented 2026-04-24)

- Component: `src/cli/cmd/tui/component/image-preview.tsx`
- Uses Jimp for image decoding (PNG, JPEG, GIF, WebP, BMP, TIFF)
- Renders ASCII art with `▀` block characters (2 pixels per cell) for pixel doubling
- Max preview: 40 columns × 16 rows; images capped at 10 MB
- Remote images fetched via `fetch()` with 10s timeout; local via `Bun.file()`
- URL extraction via `extractImageUrls(text: string)` helper
- Cached per URL to avoid re-fetch on re-renders
- Place in bordered box; render inside `UserMessage` or `AssistantMessage` at safe insertion points above

## Test Coverage (2026-04-28 Assessment)

### Coverage by Area

| Area        | Source Files | Test Coverage | Notes                                          |
| ----------- | ------------ | ------------- | ---------------------------------------------- |
| sandbox/    | 2            | ~80% ✅       | 11 `it()` cases, good assertions               |
| delegation/ | 1            | ~80% ✅       | 7 `it()` cases, integration pattern            |
| background/ | 1            | ~70% ✅       | Covered via delegation tests                   |
| session/    | 21           | ~15%          | Session-lifecycle tests only                   |
| workspace/  | 11           | ~15%          | Config + routes tests                          |
| id/         | 1            | ~15%          | Benchmark tests only                           |
| provider/   | 31           | ~2%           | 1 tiny copilot smoke test                      |
| **tool/**   | **52**       | **~3%** ❌    | Zero standalone tool tests                     |
| **server/** | **44**       | **~2%** ❌    | Zero route handler tests                       |
| **cli/**    | **84**       | **0%** ❌     | Zero CLI command tests                         |
| util/       | 31           | ~2%           | Regex/JSON via benchmarks                      |
| plugin/     | 9            | 0%            | No plugin tests                                |
| connector/  | 10           | 0%            | No connector tests                             |
| mcp/        | 4            | 0%            | No MCP tests                                   |
| permission/ | 5            | 0%            | No permission tests                            |
| **TOTAL**   | **371**      | **~5%**       | 16 test files, ~110 `it()` cases, ~214 asserts |

### Top 5 Untested Areas

1. **Tools** (52 files, 0 tests) — BashTool, EditTool, ReadTool, GrepTool, TaskTool need unit tests
2. **Server Routes** (44 files, 0 tests) — All HTTP endpoint handlers need integration tests
3. **CLI Commands** (84 files, 0 tests) — Session, serve, remote, mcp, plugin commands need tests
4. **Providers** (31 files, 1 test) — Provider selection, fallback, retry logic untested
5. **Session Pipeline** (21 files, 1 test) — Message parsing, compaction, streaming need tests

### Project Health Score: ~4/10

- Tests: 109 pass, 0 fail (2026-04-27)
- `@ts-ignore` count: 10 remaining
- Build/CI: `.github/workflows/` present, lint+typecheck in pipeline
- Critical gaps: zero tool tests, zero server tests, zero CLI tests

## Session Summary (2026-05-03)

### Completed Work

1. **Workspace exploration** — Comprehensive analysis of nikcli monorepo via background agents:
   - **Monorepo structure**: 24 packages including nikcli, mobile, desktop, web, sdk, plugin, remote, companion, ui, webrenderer, app
   - **Server & API patterns**: Hono framework, REST + SSE + WebSocket, Zod validation, OpenAPI auto-generated SDK
   - **Tool system deep-dive**: `Tool.define()` factory, Zod parameter schemas, auto-truncation wrapper, registry with model-specific filtering
   - **TUI component patterns**: OpenTUI primitives (`<box>`, `<text>`, `<scrollbox>`), `createSimpleContext` provider factory, theme tokens, SolidJS state management
   - **Core architecture**: Yargs CLI, Instance DI pattern, project bootstrap, command-based modular structure

### Key Findings

**SDK Client Pattern** (`packages/sdk/js/src/client.ts`):
- Auto-generated from OpenAPI spec
- `createNikcliClient(config)` returns `NikcliClient` with typed API methods
- Supports `directory` header for workspace-aware requests

**Server Communication** (`src/cli/cmd/tui/worker.ts`):
- Internal fetch via RPC with `getAuthorizationHeader()` for Basic auth
- Event subscription via `sdk.event.subscribe({}).stream` (async iterable)
- Routes: `/session/*`, `/tui/*`, `/global/*`, `/project/*`, `/mcp/*`, `/auth/*`, `/permission/*`

**Tool Metadata Pattern**:
- Tools return `{ title, metadata, output, attachments? }`
- `metadata()` callback auto-injects `truncated: false` via wrapper
- `ctx.ask()` for permission requests before file operations
- Output truncation: MAX_LINES=2000, MAX_BYTES=50KB, 7-day file retention

**TUI State Management**:
- `createSimpleContext` factory pattern for context providers
- `createStore` for complex centralized state (sync.tsx)
- `createSignal` for simple reactive state
- `createMemo` for derived computed state

## Session Summary (2026-04-29 to 2026-05-02)

### Completed Work

1. **Changes GitHub panel** — Added `gh` CLI wrapper (`util/github.ts`), GitHub PR sidebar in changes route (`g` toggle), OAuth/login/refresh/copy keybinds
2. **Git graph route** — GHUI-style commit browser, 5 code review rounds, PR detection via refs/merge pattern only, robust spawn, stale data guards, theme consistency
3. **Mobile UI polish** — 7-phase plan: theme tokens, app shell, screen patterns, session/transcript, settings, repos/git/routines, terminal. `bun run typecheck` passes
4. **Mobile IDE backend audit** — Found client/backend mismatch (`/git/*` vs `/mobile/git/*`), git backend bugs, GitHub OAuth persistence issue
5. **PTY/WebSocket terminal fixes** — Timeout 10s→30s, auto-retry 3x, error overlay with retry, WS auth via query param token
6. **Onboarding dialog update** (2026-05-02) — Step 3 changed from "Configuration & docs" to "Filesystem Footprint" visual dashboard showing 4 sections (Application Data, Configuration, Cache & State, Project Directory) with color-coded sensitivity legend
