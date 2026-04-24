# Nikcli Project Memory

## Architecture Overview

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

## Tool System (`src/tool/`)

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
- **GrepTool** - ripgrep subprocess
- **TaskTool** - Subagent spawning

### Truncation System (`src/tool/truncation.ts`)

- MAX_LINES = 2000, MAX_BYTES = 50KB
- Output stored to `~/.nikcli/tool-output/{tool_id}` for 7 days

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

### Middleware Stack

1. Error Handler → 2. User Auth (Bearer nku\_) → 3. CORS → 4. Workspace Context → 5. Query Validation

## Storage System (`src/storage/`)

### Key Operations

- `Storage.read/write/list/remove`
- Git snapshots for file tracking
- File watchers for real-time sync

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

### DB/User Bugs (2026-04-09 - Unfixed)

| Bug                       | File              | Impact                                                                                                                      | Fix                                                          |
| ------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Message pagination        | `db/users.ts:335` | Long threads return oldest 100 instead of newest 100; coupled with `markMessagesRead()` silently marks unseen messages read | Fetch newest window via `DESC LIMIT ?` subquery, re-sort ASC |
| Contact removal asymmetry | `db/users.ts:291` | `removeContact()` only deletes one direction; `addContact()` creates both                                                   | Delete both directions or document as one-sided              |

### Confirmed Issues (2026-04-09, updated 2026-04-24)

| #   | File                               | Issue                                                                   | Status         |
| --- | ---------------------------------- | ----------------------------------------------------------------------- | -------------- |
| 1   | `config/config.ts`                 | `Config.get()` side effects                                             | Pending        |
| 2   | `session/prompt.ts`                | Nondeterministic prompt ref ordering                                    | Pending        |
| 3   | `acp/agent.ts`                     | ACP live vs replay file-part mismatch                                   | Pending        |
| 4   | `acp/agent.ts`                     | ACP tool-result attachment omission                                     | Pending        |
| 5   | `provider/provider.ts`             | Late `enabled_providers` side effects                                   | Pending        |
| 6   | `packages/app/src/utils/prompt.ts` | App undo/fork drops non-inline file parts                               | Pending        |
| 7   | TUI                                | Explicit `--agent/--model` state issues                                 | Pending        |
| 8   | TUI                                | Stale model/variant sync                                               | Pending        |
| 9   | TUI                                | `read` tool image/PDF attachments not rendered                          | **Implemented** |
| 10  | `routes/tui.ts:266`                | `/execute-command` returns `200` for unknown commands (should be `400`) | Pending        |

### Code Reviewer Remaining Concerns

- `decodeDataUrlTextPayload()` needs base64 padding normalization for unpadded inputs
- ACP replay (`agent.ts:742`) lacks generic data URL parsing for non-base64 text resources
- ACP mode validation should use same session cwd filtering as `loadSessionMode()`
- Image preview (`image-preview.tsx`): avoid `text-` prefix in element IDs, use `flexShrink={0}` wrappers, ignore reasoning parts for URL extraction
- TUI markdown rendering is fully owned by OpenTUI; no local link-render hook available

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

## Codebase Status (2026-04-24)

- Typecheck: Likely passing
- Tests: 71 pass, 0 fail (2026-04-06 baseline)
- `@ts-ignore` count: 10 remaining
- New: `src/cli/cmd/tui/component/image-preview.tsx` added (TUI image URL previews)

## Blocking Issues

### Auth Middleware Fix Blocked (Pre-2026-04-24)

Requires exporting `requireUser` from `src/server/routes/users.ts` to complete auth bypass fixes.

## TUI Message Rendering (`src/cli/cmd/tui/routes/session/index.tsx`)

### Message Components

| Component        | Line   | Content                                  |
| ---------------- | ------ | ---------------------------------------- |
| `Session`        | ~1188  | Main scrollbox with sticky-bottom scroll |
| `UserMessage`    | ~1367  | Renders user text + file attachments     |
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

## Test Coverage (2026-04-24 Assessment)

### Coverage by Area

| Area             | Source Files | Test Coverage  | Notes                                           |
| ---------------- | ------------ | -------------- | ----------------------------------------------- |
| sandbox/         | 2            | ~80% ✅        | 11 `it()` cases, good assertions                |
| delegation/      | 1            | ~80% ✅        | 7 `it()` cases, integration pattern             |
| background/      | 1            | ~70% ✅        | Covered via delegation tests                    |
| session/         | 21           | ~15%           | Session-lifecycle tests only                     |
| workspace/       | 11           | ~15%           | Config + routes tests                            |
| id/              | 1            | ~15%           | Benchmark tests only                             |
| provider/        | 31           | ~2%            | 1 tiny copilot smoke test                       |
| **tool/**        | **57**       | **~3%** ❌      | Zero standalone tool tests                       |
| **server/**      | **44**       | **~2%** ❌      | Zero route handler tests                        |
| **cli/**         | **84**       | **0%** ❌       | Zero CLI command tests                          |
| util/            | 31           | ~2%            | Regex/JSON via benchmarks                       |
| plugin/          | 9            | 0%             | No plugin tests                                 |
| connector/       | 10           | 0%             | No connector tests                              |
| mcp/             | 4            | 0%             | No MCP tests                                    |
| permission/      | 5            | 0%             | No permission tests                             |
| **TOTAL**        | **371**      | **~5%**        | 16 test files, ~110 `it()` cases, ~214 asserts |

### Top 5 Untested Areas

1. **Tools** (57 files, 0 tests) — BashTool, EditTool, ReadTool, GrepTool, TaskTool need unit tests
2. **Server Routes** (44 files, 0 tests) — All HTTP endpoint handlers need integration tests
3. **CLI Commands** (84 files, 0 tests) — Session, serve, remote, mcp, plugin commands need tests
4. **Providers** (31 files, 1 test) — Provider selection, fallback, retry logic untested
5. **Session Pipeline** (21 files, 1 test) — Message parsing, compaction, streaming need tests

### Project Health Score: ~4/10

- Tests: 71 pass, 0 fail (2026-04-06 baseline)
- `@ts-ignore` count: 10 remaining
- Build/CI: `.github/workflows/` present, lint+typecheck in pipeline
- Critical gaps: zero tool tests, zero server tests, zero CLI tests

## Key Files Reference

| File                              | Purpose                           |
| --------------------------------- | --------------------------------- |
| `src/session/processor.ts`        | Main chat loop execution          |
| `src/session/prompt.ts`           | LLM prompt construction           |
| `src/session/message-v2.ts`       | Message/part CRUD operations      |
| `src/tool/registry.ts`            | Tool registration and execution   |
| `src/config/config.ts`            | Main configuration schema         |
| `src/bus/index.ts`                | Event bus for cross-instance sync |
| `src/server/server.ts`            | HTTP server with 20+ route groups |
| `src/mobile/expo.ts`              | Expo CLI wrapper                  |
| `src/mobile/simulator.ts`         | iOS/Android device manager        |
| `src/mobile/react-native.ts`      | React Native CLI wrapper          |
| `src/cli/cmd/tui/routes/session/` | TUI message rendering pipeline    |
