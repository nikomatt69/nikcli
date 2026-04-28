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

### Confirmed Issues (2026-04-09, updated 2026-04-27)

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
| 11  | `cli/cmd/tui/context/local.tsx`    | `ultrareview-reviewer` in `PRIMARY_AGENT_NAMES` but mode=subagent/hidden | Intentional (TUI selector UI only) |

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

## TUI Route System (`src/cli/cmd/tui/routes/`)

### Core Route Types (`context/route.tsx`)

| Route            | File                    | Purpose                                |
| ---------------- | ----------------------- | -------------------------------------- |
| `home`           | `home/index.tsx`        | Main landing screen with logo + tips   |
| `session`        | `session/index.tsx`     | Main chat interface                    |
| `changes`        | `changes/index.tsx`     | Code review with inline comments       |
| `tree`           | `tree/index.tsx`        | Session hierarchy browser              |
| `git-graph`      | `git-graph/index.tsx`   | Git commit history browser (GHUI-style) |

All routes support `workspaceID?: string` for multi-workspace routing.

### Delete-Safe Navigation

`app.tsx` implements unified `onDelete` handling for ALL routes (session, changes, tree). When a session is deleted from any view, user is redirected to `home` route instead of leaving a dangling reference.

### Plugin Route API

`plugin/api.tsx` exports `changes.navigate(id?)`, `tree.navigate(id?)`, and `git-graph.navigate()` helpers. Also provides `changes.url(id?)`, `tree.url(id?)`, and `git-graph.url()` for URL construction. `git-graph` navigation preserves `workspaceID`.

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

| Component              | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `image-preview.tsx`    | ASCII art preview for image URLs (Jimp, 40×16 chars) |
| `logo.tsx`             | Static nikcli ASCII logo with shadow rendering       |
| `border.tsx`           | `SplitBorder` (left-side accent line) component      |
| `dialog-*`             | 20+ dialog components (settings, theme, model, etc.)  |
| `prompt/`              | Prompt bar with history, frecency, autocomplete      |

## Blocking Issues

### Auth Middleware Fix Blocked (Pre-2026-04-24)

Requires exporting `requireUser` from `src/server/routes/users.ts` to complete auth bypass fixes.

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

## Session Summary (2026-04-28)

### Completed Work

1. **GitHub patterns exploration** via explore subagent
   - Found existing GitHub REST wrapper (`src/connectors/api/github.ts`), credential resolution, mobile GitHub routes, session metadata
   - Recommended building TUI GitHub support around `Session.github`, `sync.data.session`/`session_diff`, `GithubApi`, and connector credentials

2. **Changes GitHub panel** (build agent)
   - Added `src/cli/cmd/tui/util/github.ts` with `gh` CLI wrapper (OAuth, PR metadata, checks, copy helpers)
   - Added `src/cli/cmd/tui/routes/changes/github-panel.tsx` as left sidebar
   - Updated changes route: `g` toggles Files/GitHub, `a` starts OAuth, `r` refresh, `o` open PR, `y` copy metadata
   - Updated header/footer with GitHub context and hints
   - `bun run typecheck` OK; tests pass

3. **Git graph route** (build agent, 5 code review rounds)
   - GHUI-style commit browser with PR details, checks, split view
   - PR detection: only `pull/<n>` refs or anchored `Merge pull request #n` pattern (not loose `#123`)
   - Robust spawn: `GH_PROMPT_DISABLED=1`, `GIT_TERMINAL_PROMPT=0`, timeout, non-zero exit handling
   - Stale data guard: directory/hash/PR matched before showing graph/details/GitHub
   - Keyboard: modifiers respected, dialog stack checked, leader key mode handled
   - Fixed-width cells with explicit `backgroundColor` to prevent row overlap on scroll
   - Scroll-to-selected via `listScroll.scrollTo()`
   - Theme consistency verified: all `theme.*` tokens, consistent component patterns

4. **Theme review** (code-reviewer subagent)
   - git-graph fully consistent with rest of TUI app across 10 categories (colors, typography, layout, keyboard hints, border, dialogs, empty states, responsive sizing)
