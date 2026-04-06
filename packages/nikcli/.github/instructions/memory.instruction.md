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
| Transport | Type | Use Case |
|-----------|------|----------|
| `StreamableHTTPClientTransport` | Remote | Primary HTTP with streaming |
| `SSEClientTransport` | Remote | Fallback for remote servers |
| `StdioClientTransport` | Local | Local subprocess MCP servers |

### Auth Model
- OAuth 2.0 with dynamic client registration
- States: `needs_auth`, `needs_client_registration`, `connected`, `disabled`, `failed`
- Token storage: `Global.Path.data/mcp-auth.json` with 0o600 permissions
- Built-in callback handler on port 19876

## Plugin System (`src/plugin/`)

### Hook Types
| Hook | Purpose |
|------|---------|
| `event` | Global event subscription |
| `config` | Config changes notification |
| `tool` | Register custom tools |
| `auth` | Custom auth providers |
| `chat.message` | Modify incoming messages |
| `chat.params` | Modify LLM params |
| `permission.ask` | Handle permission requests |
| `tool.execute.before/after` | Pre/post tool hooks |
| `experimental.*` | Transform messages, system prompts, compaction |

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
| Module | Purpose |
|--------|---------|
| `expo.ts` | Expo CLI: start, build, install, publish, credentials, profiles |
| `simulator.ts` | iOS Simulator (`xcrun simctl`) + Android Emulator (`adb`, `emulator`) |
| `react-native.ts` | React Native CLI: run-ios, run-android, Metro bundler |
| `tophat.ts` | Shopify Tophat: install apps on device/simulator/emulator |
| `project-detect.ts` | Detect Expo, React Native, Flutter, native iOS/Android projects |

### Mobile AI Tools (`src/tool/`)
| Tool | Description |
|------|-------------|
| `expo_start` | Start Expo dev server (Metro bundler) |
| `expo_build` | Run EAS builds (ios/android/all) |
| `expo_install` | Install Expo-compatible packages |
| `expo_publish` | Publish OTA updates |
| `simulator_list` | List iOS simulators or Android emulators |
| `simulator_boot` | Boot iOS simulator or Android emulator |
| `simulator_shutdown` | Shutdown device |
| `simulator_install` | Install IPA/APK on device |
| `simulator_screenshot` | Capture device screenshot |
| `simulator_logs` | Retrieve device logs |
| `simulator_wipe` | Factory reset device |
| `rn_run` | Run React Native app |

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
1. Error Handler → 2. User Auth (Bearer nku_) → 3. CORS → 4. Workspace Context → 5. Query Validation

## Storage System (`src/storage/`)

### Key Operations
- `Storage.read/write/list/remove`
- Git snapshots for file tracking
- File watchers for real-time sync

## Bug Fixes (2026-04-06)

### Code Review Session - 11 Bugs Confirmed & Fixed
All 11 bugs verified real by code-reviewer agent, fixes executed in single session.

| Priority | Bug | File | Fix Applied |
|----------|-----|------|-------------|
| P0 | #7 Missing `.toObject()` | `message-v2.ts:893` | Added `.toObject()` to default case |
| P0 | #1 Non-null assertion | `prompt.ts:1161,1222` | Changed `input.agent!` to `input.agent ?? "default"` |
| P0 | #2 findLast guard | `compaction.ts:103` | Added null check before `.info` access |
| P0 | #5 Race in sleep() | `retry.ts:10-24` | Added `settled` flag to prevent double resolution |
| P1 | #3 Unsafe JSON.parse | `message-v2.ts:716,742` | Wrapped in try-catch, cursor.decode returns undefined on error |
| P1 | #8 Unsafe import | `provider.ts:1267` | Added `createKey` validation before calling |
| P1 | #10 No timeout | `models.ts:186` | Added `AbortSignal.timeout(10000)` |
| P2 | #11 Session race | `prompt.ts:271-276` | Added session existence check before callbacks.push |
| P2 | #4 Bun.deepEquals | `processor.ts:154` | Replaced with `devalue` (portable, already in deps) |
| P2 | #9 Mutable mutation | `transform.ts:219,224` | Cloned messages before mergeDeep |
| P3 | #6 Redundant stringify | `processor.ts:343` | Removed JSON.stringify wrapper from `e.stack` |

### Bug Fixes Applied (2026-04-06 Build Session)
| Bug | File | Fix Applied |
|-----|------|-------------|
| ReadTool race | `prompt.ts:1214` | Converted `.then()` to sequential await |
| FileTime missing await | `prompt.ts:1256` | Added await to FileTime.read() |
| Session race | `session/index.ts:306` | Added await to share() + update() |
| Auth bypass | `permission.ts:11` | Added userAuthMiddleware() |
| Auth bypass | `dbedit.ts:10` | Added userAuthMiddleware() |
| Info leak | `server.ts:116` | Stack traces only in dev mode |
| Null deref | `compaction.ts:103` | Added null check for findLast() |
| Resource leak | `voice.ts` | Added cleanup for temp audio files |
| Process leak | `grep.ts` | Added abort controller kill |
| OOM risk | `read.ts` | Check only first 512 bytes for binary |

### Open Issues (2026-04-06)
| File | Line | Type | Issue |
|------|------|------|-------|
| `src/file/index.ts` | 306-307 | Security | Symlinks can escape project directory |
| `src/file/index.ts` | 366-367 | Security | Windows cross-drive bypass |
| `users.ts` | - | Export | `requireUser` not exported (blocked auth fixes) |
| `server.ts` | - | Type | `Instance.env` doesn't exist |

### Codebase Status (2026-04-06)
- Typecheck: ⚠️ Needs fixing (auth middleware blocked by missing export)
- Tests: ✅ 71 pass, 0 fail
- `@ts-ignore` count: Reduced from 11 to 10 (1 fixed)

## Opencode Comparison

### Nikcli has (from opencode)
- `project/state.ts` - Per-directory state with disposal (copied)
- `project/instance.ts` - Instance context (copied)

### Nikcli missing from opencode
- `abort.ts` - AbortController with timeout (LOW complexity to add)
- `glob.ts` - Glob scan/match utilities (LOW complexity)
- `effect-instance-state.ts` - Effect-based scoped cache (HIGH complexity)
- `process.ts` - Process utilities (has minimal version)
- `data-url.ts` - Data URL decoding
- `effect-http-client.ts` - Retry logic with Effect

## Blocking Issues

### Auth Middleware Fix Blocked
To complete auth bypass fixes for `permission.ts` and `dbedit.ts`:
1. Export `requireUser` from `src/server/routes/users.ts`
2. Update `permission.ts:11` to use `requireUser()` 
3. Update `dbedit.ts:10` to use `requireUser()`
4. Consider adding `Instance.env` check for dev mode stack traces in `server.ts:116`

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/session/processor.ts` | Main chat loop execution |
| `src/session/prompt.ts` | LLM prompt construction |
| `src/session/message-v2.ts` | Message/part CRUD operations |
| `src/tool/registry.ts` | Tool registration and execution |
| `src/config/config.ts` | Main configuration schema |
| `src/bus/index.ts` | Event bus for cross-instance sync |
| `src/server/server.ts` | HTTP server with 20+ route groups |
| `src/mobile/expo.ts` | Expo CLI wrapper |
| `src/mobile/simulator.ts` | iOS/Android device manager |
| `src/mobile/react-native.ts` | React Native CLI wrapper |
