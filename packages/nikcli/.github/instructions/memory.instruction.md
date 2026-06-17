# Nikcli Project Memory

## Architecture Overview

### Monorepo Structure (`/Volumes/SSD/Projects/nikcli/`)

24 packages managed with Bun workspaces + Turbo (35+ total including inference, console, cloud, enterprise, etc.):

| Package                 | Purpose                             | Key Tech                            |
| ----------------------- | ----------------------------------- | ----------------------------------- |
| **nikcli**              | Main CLI with TUI (primary focus)   | SolidJS, Bun, TypeScript            |
| **mobile**              | React Native mobile app             | Expo, NativeWind, Tailwind          |
| **desktop**             | Cross-platform desktop app          | Tauri (Rust), SolidJS, Vite         |
| **web**                 | Web application                     | Astro, SolidJS, Tailwind            |
| **sdk**                 | TypeScript API client               | Auto-generated from OpenAPI         |
| **plugin**              | Plugin system                       | TypeScript                          |
| **remote**              | Remote execution (ghostty terminal) | Vite, ghostty-web                   |
| **companion**           | Companion services UI               | Vite, SolidJS                       |
| **ui**                  | Shared UI component library         | SolidJS, Tailwind CSS               |
| **webrenderer**         | WebView + native modules            | Rust, WebGPU/3D                     |
| **app**                 | Core app pages/components           | SolidJS                             |
| **inference**           | Multi-provider inference routing    | Bun, Drizzle/SQLite, Hono           |
| **inference-dashboard** | Inference service dashboard         | Astro + SolidJS, Cloudflare Workers |
| **console**             | Console application                 | SolidJS                             |
| **cloud**               | Cloud infrastructure                | Various                             |
| **function**            | Function service                    | Various                             |
| **enterprise**          | Enterprise features                 | Various                             |

### Core Structure

- **Session System** (`src/session/`) - Message storage, LLM processing, prompts, streaming
- **Tool System** (`src/tool/`) - 50+ tools: bash, edit, read, write, grep, task, skill, etc.
- **Background/Delegation** (`src/delegation/`, `src/background/`) - Background job management, durable run store
- **Monitor** (`src/monitor/`) - Long-running process management
- **Command System** (`src/command/`) - Slash commands, built-ins, MCP/connector prompts
- **Mobile Development** (`src/mobile/`) - Expo, Simulator, React Native, Tophat integration
- **Provider System** (`src/provider/`) - AI provider integrations via AI SDK (15+ providers)
- **Server** (`src/server/`) - Hono-based HTTP routes, SSE events, WebSocket
- **MCP** (`src/mcp/`) - MCP protocol client with HTTP/SSE/stdio transports + OAuth
- **Plugins** (`src/plugin/`) - Hook-based plugin system with chat/tool/auth hooks
- **Storage** (`src/storage/`) - JSON file storage with git snapshots
- **Config** (`src/config/`) - 65KB Zod schema system

### CLI Entry Points

| File                   | Purpose                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `bin/nikcli`           | Node launcher shim: resolves platform-specific native binary or `NIKCLI_BIN_PATH`, forwards argv                  |
| `src/index.ts`         | Yargs router: initializes globals/logging, sets `AGENT=1`/`NIKCLI=1`, registers all commands, calls `cli.parse()` |
| `src/cli/bootstrap.ts` | Wraps command work in `Instance.provide()` + disposes project instance after                                      |

### CLI Commands (`src/cli/cmd/`)

| Command             | File            | Purpose                                                                                                                        |
| ------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `nikcli run`        | `run.ts`        | Non-interactive: message/files/model/agent/session options, subscribes to events, prints text/tool events until `session.idle` |
| `nikcli serve`      | `serve.ts`      | Headless HTTP server with network/auth options + local workspace sync                                                          |
| `nikcli attach`     | `attach.ts`     | Open TUI against already-running server (`--dir`, `--session`)                                                                 |
| `nikcli mobile dev` | `mobile-dev.ts` | Expo, simulator, React Native commands                                                                                         |
| `nikcli tui thread` | `tui/thread.ts` | Default TUI: resolves cwd, starts worker, RPC fetch + event streaming, renders TUI                                             |
| `nikcli goal`       | `goal.ts`       | Goal management (create, list, update, archive, clear)                                                                         |
| TUI plugin          | `tui/plugin/`   | Routes, slash commands, UI slots (app/sidebar/home areas)                                                                      |

### Key Patterns

- Zod schemas for all validation
- `Tool.define()` for tool registration with lazy init
- `fn()` wrapper for validated async functions with `.parse()` and `.force()` methods
- `lazyAsync()` for async-safe singleton initialization (Promise-caching pattern)
- Session.loop() for main chat loop
- Event bus (`Bus`) for state sync across instances
- Part-based message storage (incremental updates)
- Reader-writer locks for concurrent storage safety
- Permission rulesets: allow/deny/ask per tool + glob pattern
- `devalue` for portable deep equality (replaces `Bun.deepEquals`)
- **Durable delegation**: `BackgroundRun` records persisted at `background_run` + markdown artifacts at `delegations/<parentSessionID>/<id>.md`
- **Delta coalescer**: reduces ~500 Storage writes per message to ~10-20 via 150ms debouncing
- **Job projection**: worker/delegator/followup records grouped by `jobID` → status `running`/`synthesizing`/terminal
- **Supervisor synthesis**: hidden `delegator` agent waits for worker completion, then synthesizes results (up to 3 follow-up rounds)

## Testing Patterns (`test/`, `bun test`)

### Framework & Setup

- **Test runner**: Bun's built-in test (`bun:test`)
- **Imports**: `describe`, `expect`, `it`, `beforeAll`, `beforeEach`, `afterAll`, `afterEach` from `bun:test`
- **Config**: `bunfig.toml` with `preload="./test/preload.ts"`, 10s timeout, coverage enabled

### Test Organization

| Aspect              | Details                                                              |
| ------------------- | -------------------------------------------------------------------- |
| **Location**        | `packages/nikcli/test/` directory                                    |
| **File Naming**     | `.test.ts` suffix for all test files                                 |
| **Subdirectories**  | Mirrors `src/` structure (session/, tool/, provider/, server/, etc.) |
| **Benchmark Files** | `.benchmark.test.ts` suffix                                          |
| **Helpers**         | `test/helpers/` for shared utilities                                 |
| **Benchmark Data**  | `test/benchmarks/runs/` for recorded benchmarks                      |

### Common Test Patterns

**1. Effect-based tests with temp directories:**

```typescript
import fs from "fs/promises"
import os from "os"
const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-test-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
```

**2. Project instance tests:**

```typescript
async function withProject<T>(fn: () => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(...)
  return Instance.provide({ directory: projectDir, fn })
}
```

**3. Running effects with layers:**

```typescript
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
await runService(
  Effect.gen(function* () {
    const service = yield* Service.Service
    return yield* service.someOperation()
  }),
)
```

**4. HTTP API tests:**

```typescript
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"
async function request(pathname: string, directory: string, params = {}) {
  const url = new URL(pathname, "http://nikcli.local")
  return Server.App().fetch(new Request(url))
}
```

**5. Benchmark tests:**

```typescript
import { recordBenchmark, flushBenchmarkRun } from "../benchmarks/runner"
recordBenchmark({ suite: "module", module: "feature", scenario: "operation", iterations: 1000, value: ms, unit: "ms" })
afterAll(() => flushBenchmarkRun())
```

### Running Tests

```bash
bun test                      # Run all tests
bun test test/tool/tool.test.ts  # Run single file
bun test --match "pattern"   # Run matching pattern
bun run test:unit            # Non-benchmark tests only
bun run test:bench           # Benchmark tests only
NIKCLI_BENCHMARK_SAVE=1 NIKCLI_BENCHMARK_COMPARE=1 bun test  # Benchmark comparison
```

### Test Environment Variables

```bash
NIKCLI_TEST_HOME=...           # Test home directory
NIKCLI_DISABLE_PROJECT_CONFIG=1 # Disable project config loading
NIKCLI_EXPERIMENTAL_HTTPAPI=1   # Enable HTTP API
NIKCLI_DISABLE_MODELS_FETCH=1  # Disable model fetching
XDG_DATA_HOME=...              # Data directory
XDG_CACHE_HOME=...             # Cache directory
```

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

### Built-in Agents (18 total)

| Agent                  | Mode     | Hidden | Key Traits                                                                              |
| ---------------------- | -------- | ------ | --------------------------------------------------------------------------------------- |
| `ralph`                | primary  | no     | Autonomous loop, allows `question`                                                      |
| `build`                | primary  | no     | Feature creation, allows `plan_enter`                                                   |
| `plan`                 | primary  | no     | Planning, allows `plan_exit`, restricts `edit` to plan files                            |
| `general`              | all      | no     | General-purpose parallel execution                                                      |
| `explore`              | all      | no     | Fast explorer with bash/web tools                                                       |
| `fast-explore`         | all      | no     | Read-only: tree/grep/read only                                                          |
| `planner`              | all      | no     | Planning with web search                                                                |
| `researcher`           | subagent | yes    | Background evidence collection                                                          |
| `code-reviewer`        | all      | no     | Quality/safety focused                                                                  |
| `ultrareview-reviewer` | subagent | yes    | Domain-specific parallel review (bugs/security/performance/patterns)                    |
| `debugger`             | all      | no     | Failure/root cause analysis                                                             |
| `test-runner`          | all      | no     | Test execution and analysis                                                             |
| `refactor`             | all      | no     | Safe cleanup without behavior changes                                                   |
| `delegator`            | subagent | yes    | Synthesizes background subagent results                                                 |
| `compaction`           | primary  | yes    | Session compaction (context summarization)                                              |
| `title`                | primary  | yes    | Generates conversation titles                                                           |
| `summary`              | primary  | yes    | Summarizes conversations                                                                |
| `support`              | subagent | yes    | In-app help chat — read-only, webfetch+websearch, `/support` command (added 2026-06-10) |

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

| Function                  | Signature                                                   | Description                               |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| `Agent.get()`             | `(agent: string) => Promise<Info \| undefined>`             | Retrieve agent by name                    |
| `Agent.list()`            | `() => Promise<Info[]>`                                     | All non-disabled agents, sorted           |
| `Agent.defaultAgent()`    | `() => Promise<string>`                                     | Default agent name                        |
| `Agent.generate()`        | `(input) => Promise<{identifier, whenToUse, systemPrompt}>` | LLM-powered agent creation                |
| `Agent.SUBAGENT_TOOLSETS` | `Record<string, string[]>`                                  | Default tool allowlists per subagent type |

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

| File                       | Purpose                             |
| -------------------------- | ----------------------------------- |
| `compaction.txt`           | Compaction agent prompt             |
| `explore.txt`              | Explore agent prompt                |
| `delegation.txt`           | Primary agent delegation awareness  |
| `delegator.txt`            | Delegator coordination instructions |
| `summary.txt`              | Summary agent prompt                |
| `title.txt`                | Title generation prompt             |
| `ultrareview-reviewer.txt` | Ultrareview reviewer instructions   |
| `../generate.txt`          | Prompt for LLM agent generation     |

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

Core interfaces:

```typescript
// Tool.Info — the entry point returned by Tool.define()
interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  init: (ctx?: InitContext) => Promise<Def<Parameters, M>>
}

// Tool.Def — the initialized tool definition
interface Def<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  description: string
  parameters: Parameters
  execute(args: z.infer<Parameters>, ctx: Context): Effect.Effect<Result<M>, Error>
  executeAsync(args: z.infer<Parameters>, ctx: Context): Promise<Result<M>>
  formatValidationError?(error: z.ZodError): string
}

// Tool.Context — passed to every tool execution
interface Context<M extends Metadata = Metadata> {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  callID?: string
  extra?: Record<string, unknown>
  messages?: MessageV2.WithParts[]
  metadata(input: { title?: string; metadata?: M }): void
  ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
}

// Tool.Result — return type for all tools
interface Result<M extends Metadata = Metadata> {
  title: string
  metadata: M
  output: string
  attachments?: MessageV2.FilePart[]
}
```

### Tool Registry (`registry.ts`)

`ToolRegistry.Service` with Effect-based interface:

```typescript
interface Interface {
  register: (tool: Tool.Info) => Effect.Effect<void, unknown>
  ids: () => Effect.Effect<string[], unknown>
  tools: (
    model: { providerID: string; modelID: string },
    agent?: Agent.Info,
    options?: { slim?: boolean },
  ) => Effect.Effect<Resolved[], unknown>
}
```

Tool discovery from multiple sources:

1. **Built-in tools** (hardcoded in `all()`): ~25 tools including Bash, Edit, Read, Write, Grep, Task, etc.
2. **Custom tools** from `{tool,tools}/*.{js,ts}` in config directories
3. **Plugin tools** via `plugin.tool` hook

Slim mode (`SLIM_TOOLS = new Set(["bash","read","glob","grep","tree","edit","write","task","search_tools"])`).

### Tool Execution Flow

```
Tool.define(id, init)
  → init() returns Def or Effect<Def>
  → Tool.normalize() wraps execute in Effect context
  → executeAsync() wraps with Zod validation + truncation
  → result returned as { title, metadata, output, attachments? }
```

### Effect Schema → Zod Conversion (`src/util/effect-zod.ts`)

| Effect Schema            | Zod Equivalent      |
| ------------------------ | ------------------- |
| `Schema.Struct({ ... })` | `z.object({ ... })` |
| `Schema.Array(...)`      | `z.array(...)`      |
| `Schema.Union(...)`      | `z.union([...])`    |
| `Schema.Literal(...)`    | `z.literal(...)`    |
| `Schema.Record(K, V)`    | `z.record(K, V)`    |
| `Schema.optional(...)`   | `.optional()`       |

### Built-in Tools Inventory (25+)

**File Operations**: `read`, `write`, `edit`, `glob`, `grep`, `ls`, `tree`
**Execution**: `bash`, `task`, `delegation`, `delegator`, `batch`, `exec_code`, `monitor`
**Context/Intelligence**: `memory_search`, `context_collect`, `context_related`, `context_diagnostics`, `codesearch`, `websearch`, `webfetch`, `search_tools`
**External**: `generate_image`, `speak`, `mcp-exa`, `repo_clone`, `repo_overview`

### Batch Tool + Plan Mode (`src/tool/batch.ts`)

The batch tool executes multiple tool calls in a single turn. When running with `plan` agent, it enforces read-only restrictions:

**Restricted tools in plan mode**: `edit`, `write`, `apply_patch`, unsafe `bash`
**Safe bash commands in plan mode**: `ls`, `cat`, `git status`, `git diff`, `git log`, `grep`, `head`, `tail`, `find`, `wc`, `file`

Key functions:

```typescript
function isPlanModeAgent(agent?: string): boolean {
  return agent === "plan"
}

function isSafeBashCommand(command: string): boolean {
  // Allowed: ls, cat, git status, grep, find, etc.
}
```

Error messages guide users toward allowed alternatives or suggest switching to `build` agent.

### Permission Flow

- Every file-modifying tool calls `ctx.ask()` before execution
- BashTool extracts directories/patterns via tree-sitter parsing
- EditTool requests edit permission per file
- Permission rules defined per agent in `src/agent/agent.ts`

### Tool Part States

Part `state.status` values: `"pending"` → `"running"` → `"completed"` | `"error"`
**NOT**: `"success"`, `"complete"`, `"failed"` (these don't exist in the schema)

### Tool Creation Pattern

```typescript
import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { Tool } from "./tool"
import DESCRIPTION from "./my-tool.txt"

const Parameters = Schema.Struct({
  input: Schema.String.annotations({ description: "..." }),
  optional: Schema.optional(Schema.String).annotations({ ... })
})

export const MyTool = Tool.define("my-tool", {
  description: DESCRIPTION,
  parameters: zod(Parameters),
  async execute(params, ctx) {
    if (!params.input) throw new Error("input is required")
    await ctx.ask({ permission: "my_tool", patterns: ["*"], always: ["*"], metadata: { input: params.input } })
    const result = await doSomething(params.input)
    return { title: "Tool Title", metadata: { count: result.length }, output: result.join("\n") }
  }
})
```

**Naming conventions:**

- Files: kebab-case (e.g., `memory-search.ts`, `web-fetch.ts`)
- Tool IDs: kebab-case (e.g., `"bash"`, `"memory_search"`)
- Exports: PascalCase (e.g., `BashTool`, `MemorySearchTool`)
- Metadata types: PascalCase with `Metadata` suffix (e.g., `TaskMetadata`)

### Tool Result Patterns

```typescript
// Success
return { title: "Success", metadata: { count: 5, truncated: false }, output: "Result text" }

// With file attachments
return {
  title,
  metadata: {},
  output: "File read",
  attachments: [{ id, sessionID, messageID, type: "file", mime, url: "data:..." }],
}

// Error
return { title: "Error", metadata: {}, output: `Failed: ${error.message}` }
```

## Question Module (`src/question/index.ts`)

### Architecture

Enables agents to ask users questions and receive answers interactively. Built on Effect dependency injection with scoped service layer.

### Data Structures

```typescript
Question.Info: { question, header (max 30 chars), options: Option[], multiple?, custom? }
Question.Request: { id, sessionID, questions: Info[], tool?: { messageID, callID } }
Question.Answer: string[] (array of selected labels)
Question.Reply: { answers: Answer[] } (one array per question)
```

### Flow

```
Agent calls Question.Service.ask()
  → Generates unique question ID (ascending "question")
  → Stores pending { info, resolve, reject }
  → Bus.publish(Event.Asked)
    → TUI SyncContext stores pending question
    → Workspace remembers for restore
    → Plugins receive notification
TUI shows question with options
User submits via POST /question/:id/reply
  → Question.Service.reply() resolves Effect
  → Bus.publish(Event.Replied)
Agent resumes with formatted answers
```

### Events

| Event               | Properties                          | Purpose                             |
| ------------------- | ----------------------------------- | ----------------------------------- |
| `question.asked`    | Request                             | Published when agent asks questions |
| `question.replied`  | `{ sessionID, requestID, answers }` | Published when user answers         |
| `question.rejected` | `{ sessionID, requestID }`          | Published when user dismisses       |

### Error Handling

- `Question.RejectedError` thrown when user dismisses → agent handles gracefully
- Unknown requestIDs logged but don't throw
- Timeout: `Effect.timeout(duration)` via `Question.Context`

## Background Delegation System (`src/delegation/`, `src/background/`)

### Architecture

```
Parent Session
  ├── Worker Session (role: worker)  ── runs subagent, streams PartUpdated → Delegation.updateProgress()
  └── Delegator Session (role: delegator) ── synthesizes results, optionally spawns follow-up rounds (up to 3)
      → wakeParentSession() — injects completion message via SessionPrompt.prompt()
```

**Wake on completion (2026-05-08)**: When the delegator finishes synthesizing (success or error), `wakeParentSession()` reads the last ~80 lines of the worker session log and injects a completion message into the parent session via `SessionPrompt.prompt()`. This triggers the LLM loop so the agent is automatically notified — no polling needed.

### Durable Run Store (`src/background/run.ts`)

Sources: `task`, `model-subtask`, `advisor`, `research`, `ultrareview`, `delegator`, `delegator-followup`, `other`
Roles: `worker`, `delegator`, `followup`, `advisor`, `other`
Stores records under `background_run`, writes markdown artifacts under `delegations/<parentSessionID>/<id>.md`.
Research-specific metadata: question, confidence, source count, follow-up rounds.

**List caching (2026-05-08)**: `listAll()` has a 2-second TTL cache with a pending-promise reference so concurrent callers share a single in-flight load. Uses `Promise.all()` for parallel JSON reads (vs sequential `for` loop before). Cache invalidated after every mutation (create, finalize, update).

### Delegation Manager (`src/delegation/manager.ts`)

Runtime + durable manager. Creates `BackgroundRun` records, keeps active maps, session→delegation indexes, timers, heartbeats, forced finalization. Job projection groups worker/follow-up/delegator records by `jobID` → status `running`/`synthesizing`/terminal.
Access scoped to parent session, worker session, or delegator session.

### Tool-Facing Tools

| Tool         | File                 | Purpose                                                                                                                                                                                                                             |
| ------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delegation` | `tool/delegation.ts` | `list`/`count`/`read`/`cancel` background jobs, scoped to current session; `read`/`cancel` require `task` permission for target agent                                                                                               |
| `delegator`  | `tool/delegator.ts`  | Lightweight monitor: `status`/`progress`/`summarize`; reads projected job state; formats research-specific summaries with confidence/source metadata; `status` action includes Worker/Delegator session IDs for subagent navigation |
| `advisor`    | `tool/advisor.ts`    | Available only when `agent.advisor` is configured; dispatches background `generateText()` with no tools, creates `advisor` source delegation, returns `delegation_id` immediately; separate from delegator supervisor loop          |

**Wake behavior**: Background tasks auto-inject a completion message into the parent session on finish. The agent does not need to poll — it will be woken automatically. `delegator` is for checking progress _before_ the wake arrives.

### Monitor Tool (`tool/monitor.ts`)

Reuses bash authorization, then starts a background monitored process through `Monitor.start()`. Returns monitor id, session id, log path, status, wake flag, recent output metadata. TUI listens for `monitor.output`, `monitor.updated`, `monitor.completed` via Bus, displays live output, shows completion toasts. Session abort cancels monitors via `/session/:sessionID/abort`.

## Model Subtask Flow (`src/session/message-v2.ts`, `prompt.ts`)

`SubtaskPart` schema: prompt, description, agent, model, command, background. Loop detects queued `subtask` parts → constructs synthetic assistant `task` tool call. Internal subtask execution sets `extra.bypassAgentCheck = true`. Background subtasks set `backgroundSource = "model-subtask"`. Slash/command execution turns subagent commands into `SubtaskPart` when target agent is `mode: "subagent"` or command forces `subtask`.

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

### ID Patterns (`src/id/id.ts`)

- **Session IDs**: `Identifier.descending("session")` → `ses_0a1b2c3d4e5f...` (high bits flipped for newest-first ordering)
- **Message/Part IDs**: `Identifier.ascending("message")` → `msg_1a2b3c4d5e6f...` (normal for chronological ordering)
- Prefix structure: `ses`, `msg`, `prt`, `usr`, `tool`, `wrk`, `evt`, `syn`, `per`
- Monotonically increasing within same millisecond; random base62 suffix for uniqueness

### Stream Processing (`processor.ts`)

Core loop consumes AI SDK `streamText()` `fullStream` async iterator. Handles 20 event types:

| Event Type                   | Handler | Description                                 |
| ---------------------------- | ------- | ------------------------------------------- |
| `start`                      | 129-131 | Sets session "busy"                         |
| `reasoning-start/delta/end`  | 133-173 | Creates/appends/flushes `ReasoningPart`     |
| `tool-input-start/delta/end` | 176-200 | Creates pending `ToolPart`                  |
| `tool-call`                  | 202-230 | Starts execution, doom-loop detection       |
| `tool-result`                | 231-253 | Completes tool with output                  |
| `tool-error`                 | 255-280 | Error state, permission rejection check     |
| `error`                      | 281-282 | Exception for retry handling                |
| `start-step/finish-step`     | 284-343 | Step tracking, usage/cost, compaction check |
| `text-start/delta/end`       | 345-390 | Creates/appends/flushes `TextPart`          |
| `finish`                     | 392-393 | Final event marker                          |

### Doom-Loop Detection (`processor.ts:22-58`)

- Ring buffer of last 3 tool calls `{tool, input}`
- When 3 identical consecutive calls detected → `PermissionNext.ask("doom_loop")`
- Returns permission prompt with `tool` + `input` metadata

### Retry Logic (`retry.ts` + `processor.ts:403-440`)

- Conditions: `APIError` with `isRetryable`, rate limits, server errors
- Exponential backoff: 2s initial × 2^attempt, max 30s
- Server `retry-after-ms` / `retry-after` headers respected
- Max 5 attempts; partial parts cleaned up on retry

### Abort Signal Propagation

Single `AbortController` per session prompt, propagated across layers:

```
prompt.ts (loop) → processor.ts (LLM.stream) → llm.ts (LLM.stream) →
  @nikcli-ai/llm/core.ts (LLMCore.stream) → AI SDK streamText(abortSignal)
```

Each tool receives `abort: options.abortSignal!` via `prompt.ts:1120`. Subprocess abort via `kill()` in `shell()` (`prompt.ts:2133-2138`). Deferred cleanup via `using`/`defer()` pattern.

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

### Race Condition Handling (`prompt.ts`)

- `PromptState` type tracks per-session `AbortController` + callbacks
- `start(sessionID)` creates controller; `cancel(sessionID)` aborts + rejects
- Concurrent prompts to same session: second waits via callbacks queue (`prompt.ts:271-276`)
- Loop checks for new user messages via `lastUser.id < lastAssistant.id` on fresh fetches

### `lazyAsync` (`src/util/lazy.ts`)

Async-safe initialization for `state()` and similar singletons:

- Uses `Promise`-caching pattern (subsequent callers share init promise)
- Replaces original `lazy()` for async initializers to prevent race conditions
- Both `lazy()` (sync) and `lazyAsync()` exist; `lazyAsync` used for all async init

## LLM Provider System (`src/provider/provider.ts`)

### Three Resolution Pathways

**1. AI SDK Language Model** (`getLanguage`, lines 1567-1595):

- Cache lookup → `getSDK()` → custom loader (`modelLoaders[providerID]`) or generic `sdk.languageModel()`
- Custom loaders: OpenAI (`sdk.languageModel(model.api.id)`), Azure, GitHub Copilot, Amazon Bedrock, Google Vertex

**2. @nikcli-ai/llm Route-Based Streaming** (`getModelRef`, lines 1731-1736):

- `mapToModelRef()` maps `model.api.npm` → route + provider factory
- Routes registered in `packages/llm/src/providers/index.ts`: Anthropic, AmazonBedrock, Azure, Cloudflare, GitHubCopilot, Google, OpenAI, OpenAICompatible, OpenRouter, XAI

**3. Provider State Construction** (`buildState`, lines 891-1194):

1. Load models.dev database
2. Ollama auto-detection (probes `http://127.0.0.1:11434/v1/models`)
3. Config provider merge (user's `nikcli.json` overrides)
4. Environment variable detection
5. Auth key loading from storage
6. Plugin auth loaders (Codex, Copilot, Cursor, Cloudflare)
7. Custom loaders: Anthropic beta headers, Bedrock credential chain, Google Vertex project/location, SAP AI Core, etc.
8. Plugin model hooks
9. Filter by enabled/disabled/blacklist/whitelist

### SDK Caching (`getSDK`, lines 1295-1434)

- Key: hash of npm package + options
- Wrapped fetch: strips OpenAI `itemId` metadata, injects `cache_control: { type: "ephemeral" }` on last tool definition for Anthropic-compatible providers
- Bundled providers (Anthropic, OpenAI, Google) imported directly; others use dynamic `import()`

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

## Server Architecture (`src/server/`)

### Transport Layer

Built on Bun's HTTP server + **Hono** framework. Three transports:

- **HTTP/HTTPS** (REST) — default port 4096, configurable
- **WebSocket** — PTY sessions (`/pty/:ptyID/connect`), workspace remote proxying (`/__workspace_ws`)
- **Server-Sent Events (SSE)** — `/event` and `/global/event` for real-time streaming
- **mDNS** — optional discovery via `bonjour-service`, publishes `nikcli-{port}.local`

### Middleware Stack (ordered)

1. Error handler → 2. Share redirect → 3. Share endpoints → 4. **User auth** (Bearer `nku_`) → 5. **Server auth** (mobile bearer / Tailscale / Basic auth) → 6. Request logging → 7. CORS → 8. `/global` routes → 9. **Instance/Workspace context** (resolves directory from `x-nikcli-directory` header or `?directory=` query, handles HTTP/WebSocket proxy) → 10. OpenAPI doc → 11. Query validation → 12. **HttpApiBridge** (experimental Effect-based HTTP API) → 13. All route groups → 14. Catch-all proxy to `app.nikcli.store`

### Route Groups (19 total)

Defined via Hono `describeRoute` + `hono-openapi` with Zod validation:

| Group         | Path            | Key Operations                                                          |
| ------------- | --------------- | ----------------------------------------------------------------------- |
| session       | `/session/*`    | CRUD, fork, abort, share, diff, summarize, message/prompt, revert, undo |
| file-explorer | `/fs/*`         | file read/write/delete, directory listing, workspace glob               |
| mcp           | `/mcp/*`        | MCP server CRUD, tools, resources, prompts                              |
| providers     | `/provider/*`   | provider config, auth, model list                                       |
| config        | `/config/*`     | get/set config, workspace config                                        |
| connector     | `/connector/*`  | connector auth, operations, health                                      |
| question      | `/question/*`   | ask, reply, reject                                                      |
| permission    | `/permission/*` | respond, allow, deny rules                                              |
| pty           | `/pty/*`        | PTY connect/disconnect/exec                                             |
| project       | `/project/*`    | project CRUD, workspace discovery                                       |
| workspace     | `/workspace/*`  | workspace CRUD, sync, events                                            |
| global        | `/global/*`     | health, events, dispose                                                 |
| tui           | `/tui/*`        | control, input, routes, themes, onboarding                              |
| analytics     | `/analytics/*`  | global/daily/session stats                                              |
| mobile        | `/mobile/*`     | doctor, expo, simulator, tophat, git, github, oauth                     |
| user          | `/user/*`       | register, login, logout, token refresh                                  |
| chatbot       | `/chatbot/*`    | MCP-compatible chat completions                                         |
| companion     | `/companion/*`  | companion service endpoints                                             |
| static        | `/s/`           | shareable link redirects                                                |

### Experimental HttpApiBridge (`server/httpapi-bridge.ts`)

New Effect-based HTTP API layered on top of Hono. Activated via `NIKCLI_EXPERIMENTAL_HTTPAPI=1`. Routes requests through `Effect`-based services with typed request/response schemas. Two-layer system: Hono routes handle HTTP transport, HttpApiBridge handles business logic via Effect.

### Server Startup (`Server.listen()`, server.ts:904)

1. Configure CORS whitelist from options + env
2. `Bun.serve({ hostname, port, fetch: App().fetch, websocket })`
3. If port 0, try 4096 first then fall back to OS-assigned port
4. Optionally publish mDNS service
5. If local install, start syncing all project workspaces
6. Return wrapped `.stop()` that unpublishes mDNS

## App Initialization & Lifecycle (`src/index.ts`, `src/global/index.ts`)

### Startup Sequence

1. **Process handlers**: `unhandledRejection`/`uncaughtException` → `Log.Default.error()`
2. **Global init** (`Global.initialize()`): Creates XDG dirs (data/cache/config/state/log/bin/repos), clears cache on version bump (`CACHE_VERSION = "14"`)
3. **Log init** (`Log.init()`): DEBUG for local dev, INFO otherwise; file-based logs in `<data>/log/`, cleans when >5 files
4. **Yargs middleware**: calls `initialize()` + `Log.init()`, sets `AGENT=1`/`NIKCLI=1`
5. **Command dispatch**: registers all subcommands, calls `cli.parse()`
6. **Top-level error handling**: catches `NamedError`, `Error`, `ResolveMessage` → `FormatError()` → user-friendly message → `process.exit(1)`

### Instance Bootstrap (`src/cli/bootstrap.ts`)

```
bootstrap(directory, callback) → Instance.provide({ directory, init: InstanceBootstrap, fn: callback })
```

Wraps operations in `Instance` context (Effect DI), resolves project, sets up worktree/sandbox, calls `Instance.dispose()` after execution.

### Effect Service Layer

Nikcli uses `@effect/schema` + `@effect/platform` for dependency injection:

- `Context.Tag<T>()` creates service tags; `Layer` composes implementations
- `runPromiseWithLayer()` executes Effect workflows with a given layer
- All storage/config/provider operations return `Effect<A, E>` values
- `withCurrentInstance()` provides instance context within Effect fibers

### Config as Service (`src/config/config.ts:1569`)

Massive Zod schema `Config.Info` (1847 lines). Precedence (lowest→highest): remote → global user → `NIKCLI_CONFIG` env → project `nikcli.json` → `NIKCLI_CONFIG_CONTENT` env → config directories (`agent/`, `command/`, `plugin/`). Supports JSONC, variable substitution (`{env:VAR}`, `{file:path}`), `$schema` auto-injection. Uses `mergeDeep` from `remeda` for array concatenation on `plugin`/`instructions` fields.

## Logging Infrastructure (`src/util/log.ts`)

- `Log.create({ service: "name" })` for namespaced loggers
- `Log.Default` for top-level error handling
- Levels: `debug()`, `info()`, `warn()`, `error()`
- Timing: `logger.time("operation")` — auto-logs duration on scope exit
- Extra data: `log.info("message", { count: 42 })`
- File-based logging: `<data>/log/` with timestamped `.log` files
- Init via `Log.init()` in startup sequence

## Event Bus System (`src/bus/`)

### Bus Architecture

Two-layer event system:

- **`Bus`** (`bus/index.ts`): Per-instance, type-safe subscriptions via `Map<type, callback[]>` + wildcard `*` support. Local-only.
- **`GlobalBus`** (`bus/global.ts`): Node.js `EventEmitter` singleton. Cross-process forwarding.

### Event Definition (`BusEvent.define`)

```typescript
// In bus-event.ts
export namespace BusEvent {
  const registry = new Map<string, Definition>()
  export function define<Type extends string, Properties extends ZodType>(type: Type, properties: Properties) {
    const result = { type, properties }
    registry.set(type, result)
    return result
  }
  // payloads() generates a discriminated union schema from all registered events
}
```

Every event is defined with a Zod schema for type-safe payloads. `payloads()` creates a union from all registered definitions for validation.

### Key Operations

- `Bus.publish(def, props)` — fires local subscribers (exact match + `*` wildcard), then emits to `GlobalBus` for SSE/RPC propagation. Waits for all handlers.
- `Bus.subscribe(def, callback)` — returns unsubscribe function; stored in `subscriptions` Map per instance.
- `Bus.subscribeAll(callback)` — subscribes to all events (used by SSE endpoint).
- `Bus.once(def, callback)` — single-fire subscription helper.
- `Bus.publish()` is Effect-based (`Effect.gen`), callable via `Bus.Service` from Effect context.

### Services That Subscribe

- **ShareNext** (`share/share-next.ts`): Subscribes to `Session.Event.Updated`, `MessageV2.Event.Updated`, `MessageV2.Event.PartUpdated`, `Session.Event.Diff`. Syncs data locally (`local_share/`) or remotely (`/api/share/{id}/sync`) with 1-second debounce.
- **PermissionNext** (`permission/next.ts`): Publishes `permission.asked`/`permission.replied` events.
- **TUI SyncContext**: Stores pending questions from `question.asked` events.

### Effect Layer Integration

`Bus.Service` uses `Context.Tag` for DI, `InstanceState.make` for per-instance subscription storage, and `Layer.scoped` for lifecycle. Subscribers stored in `InstanceState<{ subscriptions: Map<string, Subscription[]> }>`.

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

| File                     | Purpose                        |
| ------------------------ | ------------------------------ |
| `tool/task.ts:345`       | Background delegation progress |
| `tool/task.ts:739`       | Foreground task live summary   |
| `share/share.ts:56`      | Share service cache sync       |
| `share/share-next.ts:87` | Share service cache sync (new) |

## Storage System (`src/storage/`)

### In-Memory Cache

- **Read-through cache** with 5s TTL (`DEFAULT_TTL_MS = 5000`)
- `Cache.get()` returns `undefined` if missing or expired (auto-deletes expired entries)
- `Cache.set()` with optional TTL; `Cache.invalidate(key)` / `Cache.invalidatePrefix(prefix)`
- `Storage.read()` populates cache on disk read; `Storage.write/update()` update cache
- **Write-through**: all write/update operations call `Cache.set()` after completing the file write

### Key Operations

- `Storage.read/write/list/remove` — JSON file storage with key→path mapping
- `Storage.update()` — read-modify-write with exclusive lock
- `Storage.NotFoundError` thrown for missing files (via `withErrorHandling`)
- Key format: `["collection", "id1", "id2"]` → `storage/collection/id1/id2.json`

**Why `structuredClone` over `JSON.parse(JSON.stringify())`?** `Storage.update()` uses `structuredClone` for the draft copy:

- Handles circular references (JSON throws)
- Preserves BigInt, Date objects, Typed arrays (JSON corrupts/strips)
- Prevents accidental cache corruption from shared references in mutating `fn(content)`

### Locking Mechanism

Two lock types:

- **`Lock`** (`src/util/lock.ts`): In-memory reader-writer lock, single-process. Multiple concurrent readers, single writer, writers prioritized. Auto-cleanup when no active readers/writers.
- **`Flock`** (`src/util/flock.ts`): File-based distributed lock with lease. Used for cross-process coordination (snapshot, account refresh). Exponential backoff + heartbeat + breaker pattern.

### Storage Key Patterns (`<data>/storage/`)

| Key Pattern                                 | File Path                          | Contains            |
| ------------------------------------------- | ---------------------------------- | ------------------- |
| `["project", "<id>"]`                       | `storage/project/<id>.json`        | Project metadata    |
| `["session", "<projectID>", "<sessionID>"]` | `storage/session/<pid>/<sid>.json` | Session info        |
| `["message", "<sessionID>", "<messageID>"]` | `storage/message/<sid>/<mid>.json` | Message info        |
| `["part", "<messageID>", "<partID>"]`       | `storage/part/<mid>/<pid>.json`    | Message part        |
| `["session_diff", "<sessionID>"]`           | `storage/session_diff/<sid>.json`  | Snapshot file diffs |
| `["session_share", "<sessionID>"]`          | `storage/session_share/<sid>.json` | Share data          |
| `["todo", "<sessionID>"]`                   | `storage/todo/<sid>.json`          | Session TODO        |

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

| Fix                         | File                     | Description                                                                                   |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| Double-write on terminal    | `processor.ts:386-387`   | Removed `Session.updatePart()` after `flushNow()` — `flushNow` already persists via coalescer |
| Timer nulling in clear()    | `delta-coalescer.ts:167` | Added `entry.timer = null` after `clearTimeout()` in `clear()`                                |
| Error safety for flushAll   | `processor.ts:475-481`   | Wrapped `flushAll()` + `clear()` in try/finally                                               |
| Race condition in lazy init | `util/lazy.ts`           | Added `lazyAsync()` for async-safe singleton init (uses Promise-caching pattern)              |

### Confirmed Issues (Updated 2026-05-11)

| #   | File                               | Issue                                                                                                                                                                                                             | Status                             |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | `config/config.ts`                 | `Config.get()` side effects                                                                                                                                                                                       | Pending                            |
| 2   | `session/prompt.ts`                | Nondeterministic prompt ref ordering                                                                                                                                                                              | Pending                            |
| 3   | `acp/agent.ts`                     | ACP live vs replay file-part mismatch                                                                                                                                                                             | Pending                            |
| 4   | `acp/agent.ts`                     | ACP tool-result attachment omission                                                                                                                                                                               | Pending                            |
| 5   | `provider/provider.ts`             | Late `enabled_providers` side effects                                                                                                                                                                             | Pending                            |
| 6   | `packages/app/src/utils/prompt.ts` | App undo/fork drops non-inline file parts                                                                                                                                                                         | Pending                            |
| 7   | TUI                                | Explicit `--agent/--model` state issues                                                                                                                                                                           | Pending                            |
| 8   | TUI                                | Stale model/variant sync                                                                                                                                                                                          | Pending                            |
| 9   | `routes/tui.ts:266`                | `/execute-command` returns `200` for unknown commands (should be `400`)                                                                                                                                           | Pending                            |
| 10  | `cli/cmd/tui/context/local.tsx`    | `ultrareview-reviewer` in `PRIMARY_AGENT_NAMES` but mode=subagent/hidden                                                                                                                                          | Intentional (TUI selector UI only) |
| 11  | `mobile/auth.ts:80-89`             | Timing attack in `MobileAuth.verify()` — uses `===` not constant-time                                                                                                                                             | **Fix needed**                     |
| 12  | `server.ts:196-202`                | Token leaks in server logs via `c.req.path` (includes `?token=...`)                                                                                                                                               | **Fix needed**                     |
| 13  | Multiple sessions (2026-05-17)     | Confirmed via multi-agent analysis: server auth token leaks, storage structuredClone usage, Effect→Zod conversion, dual API layer (Hono + Effect HttpApiBridge), SDK generation workflow — all confirmed accurate | Known/Working                      |

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

**Entry point**: `src/cli/cmd/tui/thread.ts` — creates worker, server, RPC client, then calls `tui()` in `app.tsx`.

**Renderer pattern (aligned with OpenCode, 2026-05-19)**:

```typescript
import { createCliRenderer } from "@opentui/core"
const renderer = await createCliRenderer(rendererConfig({ targetFps: 45 }))
render(() => <App renderer={renderer} />, { renderer })
// Use renderer.getPalette() + waitForThemeMode(1000) for theme detection
// DO NOT use manual process.stdin.setRawMode() for color probing — breaks the TUI
```

**Raw-mode safety**: Color probes in `util/terminal.ts` save `isRaw` state and restore after; `app.tsx` probes run with raw mode preserved. OpenTUI owns raw mode — manual toggle during render causes double-ESC/exit crashes.

**Exit path** (`context/exit.tsx`): promise-idempotent, calls `renderer.destroy()`, `worker.shutdown()`, `process.exit(1)` on error. Win32 guards (`win32InstallCtrlCGuard`, `win32DisableProcessedInput`) protect Ctrl+C and raw mode on Windows.

**Thread shutdown** (`thread.ts`): `stop()` is idempotent with timeout on `client.call("shutdown")`, removes process listeners, calls `worker.terminate()`, uses `setTimeout(...).unref()` for fire-and-forget cleanup.

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

| Context           | File          | Purpose                                       |
| ----------------- | ------------- | --------------------------------------------- |
| `RouteProvider`   | `route.tsx`   | Navigation                                    |
| `ThemeProvider`   | `theme.tsx`   | 50+ built-in themes from JSON                 |
| `LocalProvider`   | `local.tsx`   | Agent/model selection, MCP toggle             |
| `SyncProvider`    | `sync.tsx`    | Server data sync (sessions, messages, config) |
| `KeybindProvider` | `keybind.tsx` | Keyboard shortcuts with leader-key            |
| `KVProvider`      | `kv.tsx`      | Persistent key-value store (JSON on disk)     |
| `SDKProvider`     | `sdk.tsx`     | API client connection                         |
| `DialogProvider`  | `dialog.tsx`  | Dialog stack management                       |

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

| Primitive     | Purpose              | Key Props                                                                                             |
| ------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `<box>`       | Flexbox container    | `flexDirection`, `gap`, `flexGrow`, `flexShrink`, `padding*`, `backgroundColor`, `border`, `position` |
| `<text>`      | Styled text          | `fg`, `bg`, `attributes` (BOLD/ITALIC/etc), `wrapMode`, `selectable`                                  |
| `<span>`      | Inline text          | Same as `<text>`                                                                                      |
| `<scrollbox>` | Scrollable container | `scrollTop`, handles j/k navigation                                                                   |
| `<textarea>`  | Input field          | `value`, `onChange`, `onKeyDown`, keybindings                                                         |
| `<spinner>`   | Loading animation    | `frames`, `interval`, `color`                                                                         |
| `<flex>`      | Flex row helper      | `gap`, `alignItems`, `justifyContent`                                                                 |

### Generative TUI (json-render for OpenTUI)

A faithful port of [json-render](https://json-render.dev/docs)'s three layers onto
OpenTUI — the model emits a visualization spec and the TUI assembles itself as it
streams. Full design in `specs/generative-tui.md`.

| json-render                                                                                        | nikcli                                                                                                                                                    | Where                                              |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Catalog** (`defineCatalog` → `prompt`/`validate`/`zodSchema`/`jsonSchema`/`componentNames`)      | `VizCatalog` (+ `VIZ_COMPONENT_TYPES`, `VizSpecZod`, `decodeVizComponent`, `normalizeVizComponents`)                                                      | `src/tool/opentui.ts`                              |
| **Registry / Renderer** (`defineRegistry`, `createRenderer`, `<Renderer spec registry loading />`) | `VizRegistry`, `defaultVizRegistry`, `createVizRenderer`, `<Renderer>`, `ComponentRenderer` (registry lookup via context + per-component `ErrorBoundary`) | `src/cli/cmd/tui/component/dialog-opentui-viz.tsx` |
| **SpecStream compiler** (`push`/`getResult`/`getPatches`/`reset`)                                  | `createSpecStreamCompiler` (adds `pushObject`/`finalize`/`snapshot`; emits RFC-6902-flavored `VizPatch[]`)                                                | `src/cli/cmd/tui/util/spec-stream.ts`              |

- **20 catalog components** (text, markdown, code, diff, alert, table, key_value,
  tree, stat, stat_grid, bar_chart, line_chart, histogram, heatmap, gauge,
  progress_bars, timeline, status_grid, section, grid).
- **Two drive paths**: (1) the agent's `opentui` tool — `session/processor.ts`
  accumulates streaming tool-input JSON onto `part.state.raw` (gated to `opentui`,
  no disk write, throttled ~24 chars), rendered live by `OpenTUIViz` in
  `routes/session/index.tsx`; (2) standalone `streamGenerativeTui` +
  `<LiveViz />` (`util/generate-viz.ts`).
- **Crash-safety**: `ComponentRenderer` wraps each render in an `ErrorBoundary`
  so a half-streamed component degrades to a `⚠ <type> unavailable` placeholder,
  never crashing the TUI.

### TUI State Management Patterns

**Pattern 1: `createSimpleContext` factory (context/helper.tsx)**

```typescript
export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore<Record<string, any>>()
    return {
      ready() {
        return ready()
      },
      get(key, defaultValue) {
        return store[key] ?? defaultValue
      },
      set(key, value) {
        setStore(key, value)
        Bun.write(file, JSON.stringify(store, null, 2))
      },
      signal<T>(name, defaultValue) {
        /* reactive signal pair */
      },
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

| Variable             | Resolved Path                        | Purpose                                   |
| -------------------- | ------------------------------------ | ----------------------------------------- |
| `Global.Path.data`   | `<XDG_DATA_HOME>/nikcli/`            | Primary data storage                      |
| `Global.Path.cache`  | `<XDG_CACHE_HOME>/nikcli/`           | Versioned cache (cleared on version bump) |
| `Global.Path.config` | `<XDG_CONFIG_HOME>/nikcli/`          | Global config files                       |
| `Global.Path.state`  | `<XDG_STATE_HOME>/nikcli/`           | Runtime state (locks, prefs, history)     |
| `Global.Path.log`    | `<XDG_DATA_HOME>/nikcli/log/`        | Log files                                 |
| `Global.Path.bin`    | `<XDG_DATA_HOME>/nikcli/bin/`        | Binary directory (curl install)           |
| `Global.Path.home`   | `os.homedir()` or `NIKCLI_TEST_HOME` | User home (read-only)                     |

### Config File Discovery (priority order, first existing wins)

**`nikcli.json`**: `<cwd>/nikcli.json` → `<cwd>/.nikcli/nikcli.json` → `<XDG_CONFIG_HOME>/nikcli/nikcli.json` → `<XDG_CONFIG_HOME>/nikcli/managed/nikcli.json` → `NIKCLI_CONFIG_DIR` → `~/.nikcli/nikcli.json` → `NIKCLI_CONFIG` env → `NIKCLI_CONFIG_CONTENT` env

**`tui.json`**: Same discovery as nikcli.json, plus `NIKCLI_TUI_CONFIG` env var. Supports `.json` and `.jsonc`. Auto-migrated from `nikcli.json` by `migrateTuiConfig()`.

### Data Files

| File                           | Path                                | Contains                              |
| ------------------------------ | ----------------------------------- | ------------------------------------- |
| `auth.json`                    | `<data>/auth.json`                  | OAuth tokens, API keys (chmod 600)    |
| `connectors-auth.json`         | `<data>/connectors-auth.json`       | Connector tokens (chmod 600)          |
| `accounts.db`                  | `<data>/accounts.db`                | SQLite: account + config tables       |
| `workspaces.db`                | `<data>/workspaces.db`              | SQLite: workspace table               |
| `mobile-github-imports.json`   | `<data>/mobile-github-imports.json` | GitHub import records                 |
| `mobile-repos/<owner>/<repo>/` | `<data>/mobile-repos/`              | Cloned mobile repos                   |
| `snapshot/<projectID>/`        | `<data>/snapshot/`                  | Bare git repos for diff tracking      |
| `worktree/<projectID>/`        | `<data>/worktree/`                  | Git worktrees + `registry.json`       |
| `tool-output/tool_*`           | `<data>/tool-output/`               | Truncated tool output (7-day cleanup) |
| `sync/<projectID>.events.json` | `<data>/sync/`                      | Event-sourced sync records            |

### Storage Key Patterns (`<data>/storage/`)

| Key Pattern                                 | Example                            | Contains            |
| ------------------------------------------- | ---------------------------------- | ------------------- |
| `["project", "<id>"]`                       | `storage/project/<id>.json`        | Project metadata    |
| `["session", "<projectID>", "<sessionID>"]` | `storage/session/<pid>/<sid>.json` | Session info        |
| `["message", "<sessionID>", "<messageID>"]` | `storage/message/<sid>/<mid>.json` | Message info        |
| `["part", "<messageID>", "<partID>"]`       | `storage/part/<mid>/<pid>.json`    | Message part        |
| `["session_diff", "<sessionID>"]`           | `storage/session_diff/<sid>.json`  | Snapshot file diffs |
| `["session_share", "<sessionID>"]`          | `storage/session_share/<sid>.json` | Share data          |
| `["todo", "<sessionID>"]`                   | `storage/todo/<sid>.json`          | Session TODO        |
| `["permission", "<projectID>"]`             | `storage/permission/<pid>.json`    | Permission rules    |

### Lock Files

| File                       | Path                         | Purpose                          |
| -------------------------- | ---------------------------- | -------------------------------- |
| `serve.lock`               | `<state>/serve.lock`         | Server PID lock                  |
| `session/<sessionID>.lock` | `<state>/session/<sid>.lock` | Session-level reader-writer lock |

## TUI Route System (`src/cli/cmd/tui/routes/`)

### Route Components

| Route       | File                  | Purpose                                                    |
| ----------- | --------------------- | ---------------------------------------------------------- |
| `home`      | `home/index.tsx`      | Landing screen: logo, prompt, tips, version                |
| `session`   | `session/index.tsx`   | Main chat with message scrollbox                           |
| `changes`   | `changes/index.tsx`   | Code review: diff view + inline comments + GitHub PR panel |
| `tree`      | `tree/index.tsx`      | Session hierarchy browser (vim-like: j/k/l/h/gg/G)         |
| `git-graph` | `git-graph/index.tsx` | Git commit browser (GHUI-style, Ctrl-G)                    |
| `github`    | `github/index.tsx`    | GitHub panel                                               |
| `plugin`    | Dynamic               | Plugin-rendered routes via `route.register()`              |

Delete-safe navigation: `app.tsx` redirects to `home` on session deletion from any route.

### Credential Resolution

`src/connectors/credentials.ts` — resolves auth tokens in order:

1. Environment variable / CLI flag (`NIKCLI_GITHUB_TOKEN`)
2. Config token (`ConnectorGithub.token`)
3. Stored connector auth (`ConnectorAuth`)

### Connector Operations

`src/connectors/registry.ts` — defined operations:
`github_get_repo`, `github_get_file`, `github_create_issue`, `github_list_issues`, `github_search_code`, `github_list_repos`

## TUI Analytics System (2026-05-11)

### Analytics Architecture

**Goal**: Persistent historical analytics + enterprise-quality braille-based visualizations.

**Hybrid storage**: Pre-aggregated daily snapshots merged with live sync data when dialog opens.

**Key files**:

- `src/analytics/analytics.ts` — Server-side recording service (Zod schemas, event hooks on message/session/part updates)
- `src/server/routes/analytics.ts` — API endpoints: `GET /analytics/global`, `GET /analytics/daily`, `GET /analytics/sessions`
- `src/cli/cmd/tui/context/analytics.tsx` — TUI context for fetching historical data via `fetch()`
- `src/cli/cmd/tui/component/chart-braille-line.tsx` — High-resolution braille chart components
- `src/cli/cmd/tui/util/analytics-aggregator.ts` — Adds `mergeWithHistorical()` for snapshot merging

**Storage keys**:

- `["analytics", "daily", "YYYY-MM-DD"]` — Daily snapshots (tokens, cost, sessions, tools, models, providers, background runs, efficiency)
- `["analytics", "global"]` — Cumulative user stats (totalSessions, totalTokens, totalCost, firstActivity, daysTracked)
- `["analytics", "session", sessionID]` — Per-session analytics snapshots

**Recording hooks** (in `src/session/index.ts:createNextImpl/updateMessageImpl/updatePartImpl/removeImpl`):

- `Analytics.recordMessageCompleted()` on message completion
- `Analytics.recordToolUsed()` on tool result
- `Analytics.recordSessionCreated()` / `Analytics.recordSessionDeleted()`

### Chart Components (`chart-braille-line.tsx`)

High-resolution terminal charting using Unicode braille characters (U+2800–U+28FF) for 8× sub-pixel rendering:

| Component           | Purpose                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `BrailleLineChart`  | Multi-series line chart with legend, axis labels, per-row color dominance |
| `BrailleAreaChart`  | Filled area chart (single series) with top-border line                    |
| `BrailleSparkline`  | Compact 2-row inline chart                                                |
| `StackedBarChartV2` | Stacked bar with proportional widths                                      |
| `HBarPrecision`     | Horizontal bar with 8-level Unicode precision (▏▎▍▌▋▊▉█)                  |
| `KPICard`           | KPI display with box-drawing border                                       |
| `ModelCard`         | Model stats card with token bar charts                                    |

**Braille encoding** (2×4 dot matrix per character):

- Bit layout: `[[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]`
- Pattern: OR dots into `Uint8Array` per cell, then map to `String.fromCharCode(0x2800 + byte)`

**Color scheme** (theme-coherent, distinct, no pink):

```typescript
export function getChartColors(theme: Theme) {
  return [
    theme.primary, // cyan/blue — input tokens
    theme.error, // red — output tokens
    theme.success, // green — cache/savings
    theme.accent, // accent — reasoning
    theme.secondary, // secondary series
    theme.info, // additional series
  ]
}

export function colorToString(color: RGBA): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0")
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
}
```

### Analytics Dialog (`dialog-analytics.tsx`)

6 tabs with braille charts: **Overview** (KPI cards + token/cost trends), **Tokens** (input/output/reasoning breakdown), **Models** (per-model stats), **Tools** (usage + success rates), **Projects** (project activity), **Sessions** (session history with background run status).

Retrieves historical data via `fetch(sdk.url + '/analytics/global')` etc., merges with live sync data.

### Theme System (`context/theme.tsx`)

80+ built-in themes (dracula, catppuccin, tokyonight, nord, gruvbox, etc.).
Theme colors are `RGBA` objects from `@opentui/core`.
Key tokens: `primary`, `secondary`, `accent`, `error`, `warning`, `success`, `info`, `text`, `textMuted`, `background`, `backgroundPanel`, `border`, `borderSubtle`.
Use `getChartColors(theme)` from `chart-braille-line.tsx` for chart-specific color palettes.

## GitHub Integration (`src/connectors/`)

### Core Files

| File                   | Purpose                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `api/github.ts`        | `GithubApi` REST wrapper: token auth, repos, contents, issues, branches, PR lookup/create, file decoding |
| `credentials.ts`       | Credential resolution order (env → config → stored auth)                                                 |
| `registry.ts:111`      | Connector operation registry                                                                             |
| `config/config.ts:543` | `ConnectorGithub` Zod schema: `{ type: "github", token?, oauthClientId?, clientId?, enabled? }`          |

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

| File        | Purpose                                                                               |
| ----------- | ------------------------------------------------------------------------------------- |
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

| File                 | Purpose                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`          | Main review page: sidebar file list + unified/split diff view                                                                                                                          |
| `file-list.tsx`      | Sidebar with directories, file navigator, +/- indicators                                                                                                                               |
| `comment-box.tsx`    | Inline comment UI with type badges (bug/style/question/suggestion), two-phase input (type select → text), keyboard: `c` opens, `1-4` selects type, `ctrl+enter` submits, `esc` cancels |
| `format-comments.ts` | Formats all comments per file for AI review feedback                                                                                                                                   |
| `footer.tsx`         | Keyboard hints bar                                                                                                                                                                     |
| `header.tsx`         | Title bar with mode toggle (unified/split), session info                                                                                                                               |
| `github-panel.tsx`   | GitHub PR sidebar (left panel, toggled via `g` key)                                                                                                                                    |

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

| File                       | Purpose                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `index.tsx`                | Main tree browser with header, column headers, scroll list, footer                                   |
| `header.tsx`               | `SessionTreeHeader` (title + stats) + `SessionTreeColumnHeaders` (Session/Changes/Status/Updated/ID) |
| `footer.tsx`               | `SessionTreeFooter` with keyboard shortcuts + MCP/LSP status                                         |
| `tree-rows.tsx`            | `TreeRow`, `flattenTreeRows()`, `treeLinePrefix()`, `listUserMessagePreviews()`                      |
| `session-activity-line.ts` | Activity display (file/additions/deletions counts)                                                   |
| `session-status.ts`        | Status badge component                                                                               |

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

| File        | Purpose                                                        |
| ----------- | -------------------------------------------------------------- |
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

| Round | Focus                                                | Result                                                                                                        |
| ----- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1     | Initial implementation                               | 5 issues found (gh checks exit, stale resources, keyboard overlap, no scroll-into-view, misleading PR labels) |
| 2     | After fixes                                          | 3 issues (dialog/leader conflicts, stale directory comparison, commit details by hash only)                   |
| 3     | After fixes                                          | 1 issue (prNumber matches any `#123` in subject)                                                              |
| 4     | After fix (PR detection via refs/merge pattern only) | Clean                                                                                                         |
| 5     | Visual overlap after scrolling                       | Clean (fixed-width cells + explicit backgroundColor)                                                          |

## Logo Component (`component/logo.tsx`)

Simple static ASCII logo (104 lines):

- Two-column ASCII art: `nikcli` split as "███╗" + "█████╗" and "╗██╗" + "██╔═══" etc.
- Shadow rendering via `▀` block characters with `_/^/~` markers
- Renders via OpenTUI `<text>` with `fg`, `bg`, `attributes`, `selectable={false}`
- `tint()` from theme for shadow color (25% intensity)
- No animation, no wave/burst effects (reverted after stability issues)

## TUI Component Library (`component/`)

| Component           | Purpose                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image-preview.tsx` | ASCII art preview for image URLs (Jimp, 40×16 chars, `▀` block chars)                                                                                         |
| `logo.tsx`          | Static nikcli ASCII logo with shadow rendering                                                                                                                |
| `border.tsx`        | `SplitBorder` (left-side accent line) component                                                                                                               |
| `dialog-*`          | 20+ dialog components: onboarding (4-step), status, command palette, session/model/agent/theme pickers, settings, provider, workspace, confirm, alert, export |
| `prompt/`           | Prompt bar with history, frecency, autocomplete                                                                                                               |
| `tips.tsx`          | Home screen tips (from `ralph/feature-plugins/home`)                                                                                                          |
| `spinner.tsx`       | Loading spinner component                                                                                                                                     |

### Dialog System Details

Dialogs are stack-based overlays rendered as full-screen absolute-positioned boxes with semi-transparent backdrop. Sizes: `medium` (60 chars), `large` (88 chars), `xlarge` (116 chars). Close on backdrop click or Esc/Ctrl+C. Components call `dialog.clear()` to dismiss.

**Dialog centering pattern**: Large dialogs (xlarge) must call `dialog.setSize("xlarge")` in `onMount` to appear centered rather than offset:

```typescript
const dialog = useDialog()
onMount(() => {
  dialog.setSize("xlarge")
})
```

**Analytics dialog** (`dialog-analytics.tsx`): 6-tab dashboard (overview, tokens, projects, runs, tools, sessions) with aggregated stats, multi-line charts, sparklines, and stacked bar charts.

## Mobile App (`packages/mobile/`)

### Stack

Expo 52, React Native 0.76, NativeWind, lucide-react-native, expo-router, react-native-webview, zustand, Expo SecureStore, expo-image.

### Architecture

- **Root layout** (`app/_layout.tsx`): ServerProvider, auth guard, notifications/live activity reconciliation, Stack.
- **App shell** (`app/(app)/_layout.tsx`): custom Tabs with AppHeader + AppTabBar; hides chrome for nested routes (`segments.length > 2`).
- **Auth**: two credential concepts — server pairing token (`ServerConfig.token`) and user session token (`USER_TOKEN_KEY`).
- **Data**: direct screen-to-`MobileClient` calls; no query/cache layer; Zustand for UI prefs, SecureStore for config/token.

### Key Files

| File                                               | Purpose                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `app/(app)/_layout.tsx`                            | Tab shell with AppHeader/TabBar                                          |
| `app/(app)/sessions/index.tsx`                     | Operations board / session list                                          |
| `app/(app)/sessions/[sessionId].tsx`               | Live session timeline: SSE stream, composer, permissions, Git publish    |
| `app/(app)/repos/index.tsx`                        | Local/GitHub repo selection + import                                     |
| `app/(app)/settings/index.tsx`                     | All-in-one settings hub (oversized; subroutes exist)                     |
| `app/(app)/routines/index.tsx` + `[routineId].tsx` | Routine list + create/edit detail                                        |
| `app/(app)/terminal/index.tsx`                     | WebView-backed PTY terminal                                              |
| `app/login.tsx`                                    | Auth flow with remembered email                                          |
| `lib/server-provider.tsx`                          | Global server config, bootstrap, user token state                        |
| `lib/client.ts`                                    | Mobile API client (sessions, repos, settings, files, Git, routines, PTY) |
| `lib/store.ts`                                     | Zustand UI preferences                                                   |
| `lib/storage.ts`                                   | SecureStore persistence                                                  |
| `lib/theme.ts`                                     | Design tokens: palette, glass, chat tokens                               |
| `components/layout/AppHeader.tsx`                  | Glass header with host/GitHub/workspace status                           |
| `components/layout/AppTabBar.tsx`                  | Custom glass bottom tab bar + status strip                               |
| `components/layout/DrawerMenu.tsx`                 | Animated right-side nav drawer                                           |
| `components/ui/SurfaceCard.tsx`                    | Base card primitive                                                      |
| `components/ui/ActionButton.tsx`                   | Base button primitive                                                    |
| `components/ui/InfoChip.tsx`                       | Status chip with tone (default/info/warn/danger/success)                 |
| `components/ui/EmptyState.tsx`                     | Empty state placeholder                                                  |
| `components/ui/ErrorBanner.tsx`                    | Error banner                                                             |
| `components/session/SessionComposer.tsx`           | Primary chat composer                                                    |
| `components/session/ComposerToolbar.tsx`           | Composer toolbar                                                         |
| `components/session/ComposerToolDrawer.tsx`        | Overlapping tool drawer (needs consolidation)                            |
| `components/MessageBubble.tsx`                     | Large message bubble (consider splitting)                                |
| `components/ToolCallView.tsx`                      | Tool call display                                                        |
| `components/PermissionCard.tsx`                    | Permission request UI                                                    |
| `components/Skeleton.tsx`                          | Loading skeleton                                                         |
| `components/git/GitReviewModal.tsx`                | Git review modal                                                         |
| `components/git/GitCommitSheet.tsx`                | Commit sheet                                                             |
| `components/git/GitFileTree.tsx`                   | Git file tree                                                            |
| `hooks/use-session-stream.ts`                      | SSE session event hook                                                   |

### Known Issues (2026-05-15)

- `ChatBubble.tsx` uses `import { Image } from "expo-image"` — dependency was missing from `package.json` (fixed 2026-05-15: added `"expo-image": "~1.14.0"`). Note: `bun install` may timeout in Docker; run manually.
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

### NamedError (`@nikcli-ai/util/error`)

External package at `packages/util/src/error.ts`. Base class:

```typescript
export class NamedError extends Error {
  constructor(
    public override message: string,
    public name: string,  // stable error identifier
    public override cause?: unknown
  )
}
```

`Storage.NotFoundError` extends `NamedError` with name `"STORAGE_NOT_FOUND"`. Thrown by `withErrorHandling` on ENOENT. Other errors propagate as-is.

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

### LLM Provider Resolution (3 pathways)

1. **AI SDK LanguageModel** (`getLanguage`) — custom model loaders per provider (OpenAI, Azure, Copilot, Bedrock, Vertex)
2. **@nikcli-ai/llm Route-Based** (`getModelRef`) — maps `model.api.npm` → route + provider factory
3. **Provider State Construction** (`buildState`) — merges models.dev DB + config + env + auth + plugin loaders

## Deep Analysis Sessions (2026-05-14)

### Session & Agent System (`src/session/`, `src/agent/`)

**Session creation flow** (`Session.Service.createNextImpl`):

- Inherits skills from parent session if not specified
- ID format: `Identifier.descending("session")` for newest-first ordering
- Title: "New session - YYYY-MM-DD..." (or parent title for forked sessions)
- Publishes `BusEvent.Session.Created` after storage write
- Analytics recording on session creation

**Message processing loop** (`SessionPrompt.loop()`):

1. Load messages stream, filter compacted sessions
2. Check session end (finish type + role)
3. Handle special tasks (SubtaskPart, CompactionPart)
4. Create processor → process messages → result (continue/stop/compact)

**Plan mode behavior** (`src/tool/batch.ts`):

- `plan` agent restricts file modification: `edit`, `write`, `apply_patch` blocked
- `bash` restricted to read-only commands: `ls`, `cat`, `git status/diff/log`, `grep`, `find`, `wc`
- Error messages guide toward allowed alternatives or suggest `build` agent switch

**Message serialization** (`MessageV2.withParts`):

- Part-based storage with incremental updates
- Delta coalescer reduces ~500 writes/message to ~10-20 via 150ms debouncing
- Text delta flow: in-memory append → Bus.publish → scheduled Storage.write → text-end flushes immediately

### LLM Provider System (`src/provider/`)

**Provider support** (25+ providers):

- Bundled: OpenAI, Anthropic, Google
- Custom loaders: Azure, GitHub Copilot, Amazon Bedrock, Google Vertex, GitLab
- OpenRouter (150+ models), Ollama (auto-detect at localhost:11434)
- SAP AI Core, Cloudflare AI Gateway, Mistral, Groq, DeepInfra, Cerebras, Cohere, Perplexity

**Model schema** (`Provider.Model`):

- `cost`: input/output per-million pricing + cache read/write
- `limit.context`: max context tokens
- `capabilities`: temperature, reasoning, toolcall, attachments, input/output types

**SDK caching** (`getSDK`):

- Key: xxHash32(npm + options)
- Bundled providers imported directly; others use dynamic `import()` via BunProc.install
- Custom fetch wraps: timeout via AbortSignal, strips OpenAI itemId metadata, injects cache_control for Anthropic

### Server Routes (19 route groups)

**Key routes by priority**:

- `/session/*` — CRUD, fork, abort, share, diff, summarize
- `/provider/*` — config, auth, model list
- `/mobile/*` — doctor, expo, simulator, git, github, oauth
- `/workspace/*` — CRUD, sync, events
- `/tui/*` — control, input, routes, themes, onboarding
- `/mcp/*` — MCP server CRUD, tools, resources, prompts

**Middleware stack** (ordered):

1. Error handler → 2. Share redirect → 3. Share endpoints → 4. User auth → 5. Server auth → 6. Request logging → 7. CORS → 8. `/global` routes → 9. Workspace context → 10. OpenAPI → 11. Query validation → 12. HttpApiBridge (experimental) → 13. Route groups → 14. Catch-all proxy

### Utilities (`src/util/`)

| Utility       | File              | Purpose                                                                          |
| ------------- | ----------------- | -------------------------------------------------------------------------------- |
| `Filesystem`  | `filesystem.ts`   | isContained, readJson, writeJson, findUp, globUp                                 |
| `Archive`     | `archive.ts`      | extractZip (cross-platform unzip/PowerShell)                                     |
| `WindowsPath` | `windows-path.ts` | Git Bash/Cygwin/WSL path conversion                                              |
| `Log`         | `log.ts`          | Structured logging with file output, timing, tagging                             |
| `Format`      | `format.ts`       | formatDuration (human-readable durations)                                        |
| `Color`       | `color.ts`        | hexToRgb, hexToAnsiBold                                                          |
| `Locale`      | `locale.ts`       | titlecase, time, datetime, number, duration, truncate, truncateMiddle, pluralize |
| `Lock`        | `lock.ts`         | In-memory reader-writer lock                                                     |
| `Flock`       | `flock.ts`        | File-based distributed lock with lease                                           |

### Remote Execution System (`src/cli/remote/`, `packages/remote/`, `packages/companion/`)

**Architecture**:

```
RemoteServer (packages/remote/)
├── HTTPS Server (createServer) — /health, /api/session, /ghostty-*.wasm
├── WebSocket Server — /ws/cli/, /ws/browser/
└── STDOUT Proxy — process.stdout/stdin forwarding

CLI Layer (packages/nikcli/)
├── RemoteService singleton
├── SessionManager — start/stop/broadcast/notifications
├── TunnelManager — localtunnel, cloudflared, ngrok, remotafh
└── SubagentRemoteHooks — onStart/onProgress/onComplete → broadcast
```

**WebSocket protocol** (auth required):

1. Client connects → `auth:required` → client sends `{type: "auth", token}`
2. Auth success → bidirectional: terminal:input/resize ↔ terminal:output
3. Heartbeat: ping/pong every 5s, timeout 60s
4. Max 5 concurrent connections per server

**Companion package** (`packages/companion/`):

- `ws-bridge.ts` — WebSocket bridge between local server and companion app
- `cli-launcher.ts` — Launches companion app via URL scheme
- Session state management with durable persistence

## Server Build Infrastructure (`Dockerfile.serve`)

### Build Process (2026-05-15)

Multi-stage Docker build using `oven/bun:1.3.14-debian` base:

1. **Base**: `apt-get install` (bash, git, libgcc-s1, libstdc++, openssh-server, curl, ca-certificates, patchelf) + Homebrew clone
2. **Build stage**: `bun install` → copies all source packages → `bun run script/build.ts --single --skip-install`
3. **Package resolution stage**: `bun install --os="*" --cpu="*"` for platform-specific `@opentui/solid` + `@effect/platform` deps
4. **Runtime stage**: copies nikcli binary from build stage, installs platform-specific glibc via `patchelf`, sets up SSH, creates `/data` dirs

### Bundled Packages (25 plugins + core packages)

Core packages in build: `@nikcli-ai/app`, `@nikcli-ai/cloud`, `@nikcli-ai/companion-ui`, `@nikcli-ai/console-app`, `@nikcli-ai/console-core`, `@nikcli-ai/console-function`, `@nikcli-ai/console-mail`, `@nikcli-ai/console-resource`, `@nikcli-ai/desktop`, `@nikcli-ai/enterprise`, `@nikcli-ai/function`, `@nikcli-ai/mobile`, `@nikcli-ai/remote-client`, `@nikcli-ai/ui`, `@nikcli-ai/web`, `@opentui/webrenderer`, and all plugin packages (`agent-memory`, `background`, `background-agents`, `context-analysis`, `direnv`, `dynamic-context-pruning`, `envsitter-guard`, `handoff`, `safety-net`, `smart-title`).

### Package Resolution Strategy

`bun install --os="*" --cpu="*"` (2026-05-15) is the standard pattern for resolving platform-specific native dependencies (e.g., `@opentui/solid`, `@effect/platform-bun`) inside Docker builds without needing a separate `postinstall` step.

### Integration Master Plan (`specs/integration-master-plan.md`)

Central tracking document for v2 migration. Key epochs:

- **E7**: v2 Features — batch tool + plan mode (E7-E)
- **E9**: APIError migration (retry.ts → api-error.ts)
- **E10**: Config migration (to Effect-based services)

Current state: Multiple v1→v2 migrations in progress. Batch tool + plan mode integration complete. APIError migration pending in test files.

## Brain Pass (2026-05-20)

### Inference Package (`packages/inference/`)

Multi-provider inference routing engine with caching, health monitoring, and middleware pipeline.

**Structure:**

```
packages/inference/
├── src/
│   ├── cache/          # Hash, store, request coalescing
│   ├── config/         # Environment config + routing table
│   ├── health/         # Circuit breaker pattern
│   ├── middleware/     # Validation, logging, rate limiting
│   ├── providers/      # Multi-provider routing engine
│   │   ├── base.ts           # Base provider for local vLLM
│   │   ├── cached.ts         # Caching provider wrapper
│   │   ├── index.ts          # Provider exports
│   │   ├── local.ts          # Local vLLM provider
│   │   ├── openai-compat.ts  # Fireworks, OpenRouter, Groq, etc.
│   │   ├── registry.ts       # Provider registry/directory
│   │   └── router.ts        # Intelligent routing engine
│   ├── types/          # Zod schemas + types
│   ├── server.ts       # Main HTTP server (Hono)
│   ├── index.ts        # Package exports
│   └── main.ts         # Entry point
├── deploy/             # Docker, cloudflared, deployment scripts
└── test/               # Circuit, router, cached, registry tests
```

**Key patterns:**

- Singleton initialization for DB and runtime
- Onion/layered middleware architecture
- Circuit breaker with half-open state for health checks
- Two-tier cache: in-process LRU + D1 SQLite
- Request coalescing to deduplicate concurrent identical requests
- Margin model for router cost/latency optimization

### Adding a New Inference Provider (2026-05-20)

**3 files to modify — no code changes needed, registration is automatic:**

**1. `packages/inference/src/providers/openai-compat.ts`** — Add `ProviderDefinition` entry:

```typescript
export const PROVIDER_DEFS = {
  // ... existing ...
  newprovider: {
    name: "newprovider",
    baseUrl: "https://api.newprovider.ai/v1",
    envKey: "NEWPROVIDER_API_KEY", // process.env key for API key
    // Optional: add custom headers
    headers: {
      "HTTP-Referer": process.env.NEWPROVIDER_REFERRER ?? "https://nikcli.store",
    },
  },
} as const satisfies Record<string, ProviderDefinition>
```

**2. `packages/inference/src/config/env.ts`** — Add optional API key env var to `envSchema`:

```typescript
NEWPROVIDER_API_KEY: z.string().optional(),
NEWPROVIDER_REFERRER: z.string().optional(),
```

**3. `packages/inference/src/config/routing.ts`** — Add routes mapping canonical model IDs to the new provider:

```typescript
export const ROUTES: Partial<Record<ModelId, ProviderRoute[]>> = {
  "model-canonical-id": [
    { provider: "newprovider", upstreamModel: "upstream/model-id", input: 0.5, output: 1.0 },
    { provider: "openrouter", upstreamModel: "vendor/model-id", input: 0.7, output: 1.5 },
  ],
}
```

**Key points:**

- Provider auto-enabled when `envKey` is present in `process.env` at boot
- `ProviderName` type auto-derived from `PROVIDER_DEFS` keys
- Pricing in routing.ts per (model, provider); mark speculative routes `estimated: true`
- `OpenAICompatProvider` class handles all OpenAI-compatible endpoints via `/chat/completions`
- Supports reasoning effort, tool calls, custom stop sequences, response format via options

### Inference Dashboard (`packages/inference-dashboard/`)

Astro + SolidJS dashboard for the inference service, deployed on Cloudflare Workers.

**Tech stack:** Astro (SSR), SolidJS, Tailwind, Drizzle/SQLite (D1), Cloudflare Workers

**Design system:** Aligned with `packages/web` — uses `terminal-*` prefixed Tailwind classes (`terminal-bg`, `terminal-accent`, `terminal-muted`, `terminal-border`, etc.), same CSS variables, fonts (Syne, JetBrains Mono, Space Grotesk), animations, and component patterns.

**4 canonical design files (must stay identical to web package):**

- `src/styles/global.css` — CSS variables, animations, scrollbar styles
- `src/styles/docs.css` — Prose styles for documentation pages
- `tailwind.config.mjs` — Terminal color classes, fonts, plugins
- `astro.config.mjs` — Cloudflare adapter, SolidJS integration

**Astro Cloudflare Pages binding access (2026-05-20):**

- D1 and other bindings are in `ctx.locals.runtime.env.DB` (NOT `ctx.locals.DB`)
- Pre-rendered pages: `ctx.locals.runtime.env` is `process.env`
- API routes MUST have `export const prerender = false`

**wrangler deploy vs pages deploy (2026-05-20):**

- `wrangler pages deploy` does NOT properly bind D1/Secrets to API routes — bindings need manual Cloudflare Dashboard setup
- `wrangler deploy` (Workers mode) correctly binds D1 via `wrangler.toml`
- To use Workers mode: add `main = "_worker.js"` to wrangler.toml, create `.assetsignore` with `_worker.js`

**API endpoints:**

- `POST /api/auth/sign-up` — Creates account + API key
- `POST /api/auth/sign-in` — Authenticates user
- `POST /api/auth/sign-out` — Invalidates session
- `GET /api/usage` — Returns usage data
- `POST /api/usage/ingest` — Ingests usage events
- `GET /api/validate` — Validates API key
- `GET /api/keys` — Lists API keys
- `POST /api/keys` — Creates new API key
- `DELETE /api/keys/:id` — Revokes API key
- `PATCH /api/account` — Updates account
- `DELETE /api/account` — Deletes account

**wrangler.toml bindings required:**

```toml
[[d1_databases]]
binding = "DB"
database_name = "nikcli-inference"
database_id = "<uuid>"

[vars]
INFERENCE_API_BASE = "https://inference.nikcli.store"
SITE_URL = "https://nikcli.store"

[secrets]
GATEWAY_SHARED_SECRET = "..."
SESSION_SECRET = "..."
```

### GitHub Actions CI Fix (2026-05-20)

**File:** `packages/nikcli/script/publish-registries.ts`

**Problem:** GitHub Actions runner has no Git user identity configured, causing `git commit` to fail:

```
fatal: empty ident name (for <runner@...>) not allowed
```

**Fix:** Added `git config` commands before git commit in homebrew-tap clone:

```typescript
await $`cd ./dist/homebrew-tap && git config user.email "github-actions[bot]@users.noreply.github.com"`
await $`cd ./dist/homebrew-tap && git config user.name "github-actions[bot]"`
```

### TUI Exit Logo (TODO - 2026-05-20)

User requested nikcli to display ASCII logo on terminal kill (like OpenCode does). Not yet implemented.

## Brain Pass (2026-05-19)

### TUI Shutdown & OpenCode Alignment

**Bug fixed (2026-05-19)**: Raw-mode color probe in `app.tsx` and `util/terminal.ts` was forcing `process.stdin.setRawMode(false)` while OpenTUI was using raw mode, breaking the TUI on double-ESC or exit. Fix: save `isRaw` before probe and restore after, wrap cleanup in try/finally.

**OpenCode comparison findings** (`anomalyco/opencode`):

| Aspect                | OpenCode                                                               | Nikcli (before)                       | Nikcli (after)                                                           |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| Color probe           | `createCliRenderer()` → `getPalette()` + `waitForThemeMode()`          | Manual `setRawMode` OSC queries       | Aligned: uses `createCliRenderer`, `getPalette`, `waitForThemeMode`      |
| Windows raw mode      | `win32.ts`: disable `ENABLE_PROCESSED_INPUT`, poll, flush buffer       | None                                  | Added `win32InstallCtrlCGuard()` in thread.ts                            |
| Thread shutdown       | `stop()` with `client.call("shutdown")` timeout → `worker.terminate()` | Simple shutdown                       | Aligned: timeout on shutdown, `worker.terminate()`, `setTimeout.unref()` |
| Worker idempotency    | Simple dispose                                                         | `shuttingDown` promise cached forever | Fixed: `shutdown()` now idempotent, resets `server`                      |
| Event stream cleanup  | No local stream map                                                    | Event streams not removed on failure  | Fixed: abort + remove on stream error                                    |
| Exit path             | Promise-idempotent, no error catch                                     | Error handling present                | Aligned: idempotent, error → exit(1)                                     |
| RPC error propagation | Only posts `rpc.result`; errors leave pending promise                  | `rpc.error` posted, error serialized  | Nikcli stronger here — errors reject pending promises                    |
| Keymap layer          | `@opentui/keymap` with pending-sequence cleanup                        | Command/keybind provider              | Gap: nikcli lacks equivalent keymap pending-sequence cleanup             |
| Teardown order        | Keymap → plugins → audio → renderer.destroy()                          | Plugins + onCleanup                   | Aligned: full teardown sequence in exit.tsx                              |

**Key files changed (2026-05-19)**:

- `src/cli/cmd/tui/app.tsx` — `createCliRenderer` + `getPalette`/`waitForThemeMode`, raw-mode protection
- `src/cli/cmd/tui/thread.ts` — `stop()` idempotent with timeout + `worker.terminate()`, Win32 guards, process listener removal
- `src/cli/cmd/tui/util/terminal.ts` — Raw-mode save/restore with anti double-resolve guard
- `src/cli/cmd/tui/worker.ts` — Shutdown idempotency, event stream cleanup, `server` reset
- `src/util/rpc.ts` — RPC errors propagate as rejection (already superior to OpenCode)
- `src/cli/cmd/tui/context/exit.tsx` — Idempotent exit with error → exit(1)

**Remaining gaps vs OpenCode**:

1. Thread does not call `worker.terminate()` after `shutdown()` — added, but verify runtime behavior
2. No `@opentui/keymap` integration for ESC pending-sequence cleanup
3. No `waitForThemeMode` polling fallback in app.tsx for terminals that don't reply OSC 10/11

### Other Sessions (2026-05-19)

- **Goal command** (`src/cli/cmd/goal.ts`) — New native CLI command for goal management. Added to CLI commands table.
- **Skills search** — Tested `find-skills` skill with mobile development search. Found `vercel-react-native-skills` (121K installs) and `sleek-design-mobile-apps` (143.5K installs) from skills.sh leaderboard.

## Brain Pass (2026-05-23)

### Workspace Health Check (2026-05-23)

Ran deep workspace exploration via 3 parallel background explore agents covering: project structure, code patterns, and current state.

**Findings:**

- **Typecheck**: Passes clean — zero errors
- **TODO/FIXME**: ~11 comments found (none critical, mostly informational)
- **Git status**: Workspace is clean — no uncommitted changes
- **Placeholders**: Some `console.log` statements in production paths (need cleanup), no obvious `TODO` stubs

**Parallel exploration pattern** — Effective for comprehensive checks:

1. Launch 3+ explore agents with `background: true`
2. Monitor via `delegation` tool
3. Aggregate results when all complete

### Abort/Cancellation Path (discovered during debugging session)

Traced session abort flow end-to-end:

```
Server abort endpoint (server/routes/session.ts:630)
  → cancelOwnedBySessionID(sessionID) [session/index.ts:943]
    → cancelJob(record.id) [delegation/manager.ts:711]
      → cancel(sessionID, id) [delegation/manager.ts:650-675]
        → cancelAll(sessionID) [monitor/manager.ts:634]
          → Shell.killTree(pid) [monitor/manager.ts:550-600]
        → Finalization: Delegation.finalize(id, "cancelled")
```

**Worker cleanup** (`thread.ts`):

- `client.call("shutdown")` with timeout → `worker.terminate()` → `setTimeout(...).unref()` for fire-and-forget
- `worker.ts` shutdown is idempotent (resets `server` reference) with event stream cleanup (abort + remove on error)

**Error handling in Effect layer**:

- HTTP API abort handlers use `.pipe(Effect.orDie)` which throws on failure
- `Effect.tryPromise` catchers can trigger nested cancellations (cancel2 path)
- Worker thread catches unhandled rejections via `worker.on('error')` → logs but doesn't prevent default print

### Session Prompt Loop Helpers (`prompt.ts`)

Key run helpers defined in prompt.ts (before the main loop function):

- `runSummary(sessionID, ...)` — session summarization
- `runTitle(message, ...)` — title generation
- `runCompaction(sessionID, ...)` — context compaction

These are used for special-purpose message generation (summaries, titles, compaction) outside the main LLM streaming loop.

### TUI Cleanup Sequence

The full TUI teardown sequence (aligned with OpenCode):

1. `renderer.destroy()` — OpenTUI renderer destruction
2. `worker.shutdown()` / `worker.terminate()` — worker cleanup + event stream cleanup
3. `process.exit(1)` — final process exit on error

`exit.tsx` is promise-idempotent; `thread.ts` `stop()` is idempotent with timeout. Cleanup wrapped in try/finally. Bun worker unhandled rejections logged to red stderr unless caught by `worker.on('error')`.

### Storage `structuredClone` Behavior

`Storage.update()` uses `structuredClone` (not `JSON.parse(JSON.stringify())`) for draft copies:

- Handles circular references (JSON throws)
- Preserves BigInt, Date, Typed arrays (JSON corrupts/strips)
- Prevents cache corruption from shared references in mutating `fn(content)`

## Brain Pass (2026-06-07)

### Parallel Investigation Matrix

Today ran 4 parallel `@explore` agents (via `task(background: true)`) for a comprehensive read-only code audit. All four hit the 10-minute timeout but supervisors confirmed full delivery of comprehensive reports:

| Agent                        | Topic                                                   | Key contribution                                          |
| ---------------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| `rising-aquamarine-pinniped` | Core architecture (boot, CLI, server, Instance, Effect) | Full file:line references for boot, upgrade, CLI dispatch |
| `conscious-magenta-cow`      | Tool registry + Agents + Permissions + Plugins          | Default tool allowlists per agent (table)                 |
| `adjacent-chocolate-salmon`  | Session v1/v2 + LLM streaming + Stepper                 | **First detailed v1/v2 split**                            |
| `short-amaranth-swallow`     | TUI + Storage + Provider + Bus + MCP + Brain + DB       | Provider.parseModel, DB tables, Brain module              |

**Pattern**: 10-min agent timeout is common for deep audits. Trust the supervisor's `Action: finalize` synthesis note (returned via the wake summary) — work was delivered; only the `delegation(action="read")` artifact is unavailable. Cross-check with own direct reads when possible.

### Session v1 vs v2 Split (CRITICAL — was undocumented)

Two parallel session systems coexist, share on-disk storage, but expose different shapes:

| Aspect         | v1 (`MessageV2` / `Session`) — production path                                      | v2 (`SessionV2` / `SessionEntry`) — newer model                                                   |
| -------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Top-level type | `Session.Info` (Zod)                                                                | `Session.Info` (re-uses v1 record) + `SessionEntry.Entry[]`                                       |
| Message shape  | `MessageV2.User` / `MessageV2.Assistant`                                            | `SessionEntry.User` / `Synthetic` / `Assistant`                                                   |
| Part shape     | `MessageV2.Part` discriminated union                                                | Aligned with AI SDK UIMessage parts                                                               |
| State          | Effect `Service` + `Session.defaultLayer` (singleton per project)                   | `Map<sessionID, Stepper.MemoryState>` in `src/session/v2/index.ts:56` (in-memory) + Immer reducer |
| Persistence    | Storage namespace `["session", projectID, id]`, `["message", ...]`, `["part", ...]` | Reuses v1 storage; v2 entries derived via `toEntries()` on read                                   |

- `src/session/v2/index.ts:85` — `SessionV2.create` delegates to v1 `Session.Service.createNext` for persistence, then initialises a v2 `MemoryState`.
- `src/session/v2/index.ts:182` — `toEntries()` walks v1 `MessageV2.WithParts[]` and converts to v2 entries (read-side shim).
- The **processor / LLM / tool loop all run on the v1 representation**. v2 is a parallel event-log / reducer (`Stepper.reduce` in `src/session/v2/stepper.ts:106`) that has not yet replaced v1 in the main code path.
- Legacy v1 namespace `Message` lives in `src/session/message.ts` (not imported by `index.ts:17` — uses `MessageV2` from `./message-v2`). Remains for backward compat.

### TUI: thread.ts vs app.tsx vs worker.ts

Three distinct files often confused in the TUI subsystem:

| File                                    | Role                                                | Key responsibilities                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/cmd/tui/thread.ts` (297 lines) | CLI command file (registered as `TuiThreadCommand`) | Spawns Bun Worker pointing to `worker.ts`; sets up RPC client; decides between **direct-RPC mode** (no HTTP) and **HTTP server mode** (when `--port`/`--hostname`/`--mdns` given); parses args (project, model, continue, session, prompt, agent); dynamically imports `./app`; handles `SIGUSR2` for hot-reload |
| `src/cli/cmd/tui/app.tsx` (1300+ lines) | SolidJS + OpenTUI renderer entry                    | Exports `tui(input)` async function; creates CLI renderer via `createCliRenderer` (FPS=45, mouse+kitty); mounts deep provider tree (ArgsProvider > ExitProvider > ... > PromptRefProvider); reads route from `useRoute()` and renders via `<Switch>/<Match>`                                                     |
| `src/cli/cmd/tui/worker.ts`             | Bun Worker hosting the server (RPC + optional HTTP) | Subscribes to `GlobalBus` events; exposes RPC surface (`fetch`, `server`, `checkUpgrade`, `upgradeNow`, `reload`, `subscribe`, `unsubscribe`, `shutdown`); initializes `Log` with `worker` metadata                                                                                                              |

### TUI: Three Connection Modes

| Mode                     | When                                    | Mechanism                                                                                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Direct RPC (no HTTP)** | Default (no `--port`/`--hostname`)      | `url = "http://nikcli.local"`; `customFetch = createWorkerFetch(client)` translates every HTTP call into `Rpc.client.call("fetch", ...)`; `events = createEventSource(client)` fakes `EventSource` with `subscribe()` returning id; events routed through `Rpc.emit("event", {id, event})` |
| **HTTP server mode**     | `--port`, `--hostname`, or `--mdns` set | `client.call("server", networkOpts)` returns real URL; SDK does regular HTTP + SSE; TUI still has `startServer` fallback for "Open WebUI" command                                                                                                                                          |
| **Attach mode**          | `nikcli attach <url>`                   | Calls `tui({url, args, directory})` with no worker at all; user runs `nikcli serve` separately                                                                                                                                                                                             |

### TUI: Provider Nesting (app.tsx, outer→inner)

```
<ErrorBoundary>
  <ArgsProvider>           ← CLI args (--model, --prompt, --session, --agent)
    <ExitProvider>         ← exit / restart hooks
      <ServerProvider>     ← server URL/start fallback
        <KVProvider>       ← TUI key-value state
          <ToastProvider>
            <RouteProvider>    ← current page
              <SDKProvider>    ← wraps @nikcli-ai/sdk/v2 + event stream
                <ProjectProvider>
                  <SyncProvider>      ← server data store
                    <AnalyticsProvider>
                      <ThemeProvider>  ← theme + dark/light
                        <LocalProvider>   ← model/agent selection
                          <KeybindProvider>
                            <PromptStashProvider>
                              <EditorContextProvider>
                                <DialogProvider>
                                  <CommandProvider>
                                    ...
                                    <App />
```

### Provider System: parseModel() Semantics

`Provider.parseModel(input: string)` splits a `provider/model` reference at the **first** `/` into `{providerID, modelID}`. E.g. `"anthropic/claude-3-5-sonnet"` → `{providerID: "anthropic", modelID: "claude-3-5-sonnet"}`.

**Bundled providers (17 total in nikcli package)** — imported in `src/provider/provider.ts:26-46`:

- `createAmazonBedrock`, `createAnthropic`, `createAzure`, `createGoogle`, `createGoogleVertex`, `createVertexAnthropic`
- `createOpenAI`, `createOpenAICompatible`, `createOpenRouter`, `createXAI`
- `createMistral`, `createGroq`, `createDeepInfra`, `createCerebras`, `createCohere`, `createGateway`, `createTogetherAI`, `createPerplexity`, `createVercel`, `createGitLab`
- Internal GitHub Copilot at `src/provider/sdk/copilot/`
- Also imports factory objects from `@nikcli-ai/llm/providers` (`:51-61`)

**`Provider.Service` Effect API** (`:1021-1043`): `list`, `getProvider`, `getModel`, `getLanguage`, `getImageModel`, `getModelRef`, `getSmallModel`, `defaultModel`, `closest`, `refresh`.

### Storage Backend (updated 2026-06-10)

Hybrid: **filesystem JSON + central SQLite (Drizzle ORM, Bun driver)** — migration to single `nikcli.db` in progress.

- `Storage` namespace (`src/storage/storage.ts:62-86`) — JSON file ops with `["collection", "id", ...]` key format
- `Database` namespace (`src/database/database.ts`) — Effect service for single unified SQLite; `defaultLayer` and `layerFromPath(filename)` for testing
- `src/database/schema.ts` — re-exports all tables from per-module `.sql.ts` files
- `DatabaseMigration` namespace (`src/database/migration.ts`) — applies migrations in transactions, tracks in `migration(id, time_completed)` table
- **Old** `src/storage/db.ts` and `src/storage/db.bun.ts` — being removed (no imports after migration)
- **DB tables** (from `src/database/schema.ts`): `users`, `user_sessions`, `chat_contacts`, `chat_messages`, `account`, `config`, `mobile_tokens`, `workspace`
- PRAGMAs: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `cache_size=-64000`, `foreign_keys=ON`, `wal_checkpoint(PASSIVE)`
- `BUNDLED_PROVIDERS` map in `src/provider/provider.ts:385`

### Config Loading Precedence (lowest → highest)

1. Well-known (compile-time) defaults
2. Global user (`<XDG_CONFIG_HOME>/nikcli/nikcli.json`)
3. `NIKCLI_CONFIG` env (file path) / `NIKCLI_CONFIG_CONTENT` env (inline JSON)
4. Project walk-up: `<cwd>/nikcli.json` → `<cwd>/.nikcli/nikcli.json` → ... → `NIKCLI_CONFIG_DIR`
5. Config directory fragments: `agent/`, `command/`, `plugin/`
6. CLI flags

Supports **JSONC** (JSON with comments) and **variable substitution** (`{env:VAR}`, `{file:path}`). Uses `mergeDeep` from `remeda` for array concatenation on `plugin`/`instructions` fields.

### MCP Integration (per-instance)

`MCP.Service` lives in `src/mcp/index.ts`, instantiated per project instance. Three transports:

- `StreamableHTTPClientTransport` (remote, primary)
- `SSEClientTransport` (remote, fallback)
- `StdioClientTransport` (local subprocess)

OAuth 2.0 with dynamic client registration. States: `needs_auth`, `needs_client_registration`, `connected`, `disabled`, `failed`. Token storage at `Global.Path.data/mcp-auth.json` (0o600). Built-in callback handler on **port 19876**.

### Event Bus Architecture

```
Local instance publishes (Bus.publish)
  ├─→ Local subscribers (exact + * wildcard)
  └─→ GlobalBus.emit("event", {directory, payload})
        ├─→ SSE route (server/routes/global.ts:81)
        ├─→ Workspace SSE (workspace/workspace-server/routes.ts:30)
        ├─→ Mobile stream (server/routes/mobile.ts:2073)
        └─→ Worker RPC (cli/cmd/tui/worker.ts:36-38) → Rpc.emit("global.event")
              └─→ TUI SDK context → SolidJS emitter → component subscriptions
```

`Bus.Service` uses `Context.Tag` for DI, `InstanceState.make` for per-instance subscription storage, `Layer.scoped` for lifecycle. Subscribers stored in `InstanceState<{ subscriptions: Map<string, Subscription[]> }>`.

### Brain Module (THIS module — meta)

`src/brain/` runs an **hourly memory consolidation session** that writes to `.github/instructions/memory.instruction.md` (this file). The Brain component is essentially the persistence layer for institutional memory across agent sessions — when invoked, it:

1. Reads the current memory file
2. Gathers recent signal from session transcripts
3. Consolidates by merging new findings, converting relative dates to absolute, deleting contradicted facts
4. Prunes for conciseness

This is the agent that produced every "Brain Pass (...)" section in this file.

### opentui Tool — Current Open Work (2026-06-07)

User reported the `opentui` tool fails too often. Investigation traced the full schema-to-JSON pipeline:

**Phase 1 — Schema construction**:

1. Effect Schema `Parameters` in `opentui.ts:422-434` (title, subtitle, components: Array of union of 20 types)
2. `zod(Parameters)` (`opentui.ts:438`) — walker in `effect-zod.ts:489` produces `z.ZodType`. The `Schema.Union(...)` becomes `z.union([...])` **flat** (effect-zod.ts:372) — weak point
3. `z.toJSONSchema(item.parameters)` (`session/tools.ts:147`) — Zod v4 converts to JSON Schema 7. Flat `z.union` becomes `{ "anyOf": [ {…table}, {…stat}, … 20 schemi … ] }` **without discriminator**
4. `ProviderTransform.schema(model, ...)` (`provider/transform.ts:1312`) — sanitizes JSON Schema for provider quirks
5. `tool({inputSchema: jsonSchema(schema)})` (`session/tools.ts:149-152`) — AI SDK packages schema + description

**Phase 2 — Model generation**: Provider does constrained-decoding but **no discriminator** on a 20-branch anyOf means the model must guess which form to fill.

**Phase 3 — Validation**: AI SDK parses, validates against inputSchema; then `executeAsync(args)` calls `execute` which re-validates via `authored.parameters.parse(args)` (`tool.ts:120`) — if fails, generic message `tool.ts:125-128`.

**Root cause**: flat `z.union` at step 2 → flat anyOf at step 3 → model can't constrain choice AND Zod aggregates 20 errors at validation.

**Fix path (planned)**:

- **A**: Convert to `z.discriminatedUnion("type", [...])` — produces `oneOf+discriminator` JSON Schema; Zod returns single issue on error (not 20-branch invalid_union). Zod 4.1.8 supports this.
- **B**: Improve `formatValidationError` to surface actionable messages (existing pattern in `batch.ts`, `skill.ts`).
- **C**: User requested move from "display read-only dashboard" to "**vere e proppie interfacce**" (proper interactive interfaces — AI-generated mini-app TUIs). This is a design workstream: needs foundation in existing interactivity (prompt/ask mechanism, TUI primitives, dialog system).

**Render-side facts**:

- Renderer: `src/cli/cmd/tui/component/dialog-opentui-viz.tsx` (1856 lines)
- Dispatch: from `session/index.tsx:2427`
- `Schema.check` cross-field refinements get dropped by `effect-zod` walker (fallback in `effect-zod.ts:421-433`); must be applied in `execute` not schema.

### Vercel AI SDK Integration

- `streamText` (re-exported via `LLMCore.stream` at `src/session/llm.ts:435-500`) is the primary streaming call
- `wrapLanguageModel` (`:481`) — applies middleware: `ProviderTransform.messageMiddleware` + `extractReasoningMiddleware({tagName: "think"})`
- `tool()`, `jsonSchema()` (`:411-415`)
- `convertToModelMessages` / `modelMessageSchema` (`:6-17`)
- LiteLLM hack: when provider is LiteLLM proxy with tool history but no active tools, inject `_noop` tool to pass proxy's tool-history validation
- Codex sessions: pack everything into the first user message `{role:"user", content:system}` (OpenAI codex endpoint ignores system role); pass `SystemPrompt.instructions()` as `options.instructions` instead

### Effect Tool-State Machine (processor.ts)

| Phase | Stream event       | ToolPart state                     | Action                                                             |
| ----- | ------------------ | ---------------------------------- | ------------------------------------------------------------------ |
| 0     | —                  | n/a                                | Tool registry built from `Agent.tools` × `Agent.permission` filter |
| 1     | `tool-input-start` | `pending` (input:{}, raw:"")       | Part persisted; `toolcalls[value.id] = part`                       |
| 2     | `tool-input-delta` | `pending`                          | Streamed JSON, not persisted yet                                   |
| 3     | `tool-call`        | `running` (input set, time.start)  | `detectDoomLoop()` (DOOM_LOOP_THRESHOLD=3)                         |
| 4     | `tool-result`      | `completed` (output set, time.end) | Persistence                                                        |
| 5     | `tool-error`       | `error` (error set)                | If `PermissionRejectedError`/`QuestionRejectedError` → `blocked`   |

### Agent Default Tool Allowlists (from agent.ts)

| Agent           | Default tool allowlist                                                | Mode     |
| --------------- | --------------------------------------------------------------------- | -------- |
| `plan`          | `plan` only                                                           | primary  |
| `planner`       | `read, grep, glob, list, tree, websearch, codesearch, webfetch`       | subagent |
| `scout`         | planner + `repo_clone`, `repo_overview`                               | subagent |
| `explore`       | `read, grep, glob, list, bash, webfetch, websearch, codesearch`       | all      |
| `fast-explore`  | `read, grep, glob, list, tree` (no bash, no web)                      | all      |
| `researcher`    | read/search/docs/memory/context tools + task + delegation + delegator | subagent |
| `code-reviewer` | `read, grep, glob, list, bash`                                        | all      |
| `debugger`      | read/grep/glob/list/bash + edit                                       | all      |
| `test-runner`   | read/grep/list/bash + edit + write                                    | all      |
| `refactor`      | read/grep/glob/list/bash + edit + write + apply_patch                 | all      |
| `delegator`     | (synthesizes background results)                                      | subagent |

## Brain Pass (2026-06-08)

### Loops Feature Plugin — Headless Scheduling Integration (in progress 2026-06-08)

**Location**: `packages/nikcli/src/cli/cmd/tui/feature-plugins/loops/`

**Files**:

- `index.tsx` — sidebar widget + manager entry; subscribes to bus events on init
- `store.ts` — KV-backed storage for `LoopDefinition`, history, stats
- `runner.ts` — Scheduler + Goal wiring; runs loops on a tick
- `dialogs.tsx` — wizard (multi-step create) + manager (list/edit/delete) dialogs

**Integration pattern (decided 2026-06-08)**:

- Core engine (server-side scheduler) uses **Effect** via `Effect.gen` + `runPromiseWithLayer` helpers (`runSession`, `runSessionPrompt`) — pattern matches `mobile/routine.ts`
- TUI plugin side uses **Promise-based SDK** via `api.client.loop.*` — this is the documented plugin pattern (see `feature-plugins/loops` neighbors, `system/plugins.tsx`, `context/sync.tsx`)
- User feedback ("non dovrebbe usare effect?") confirmed: server uses Effect, plugins use Promise SDK calls

**SDK call conventions (2026-06-08)**:

- SDK is generated with `paramsStructure: "flat"` → calls are flat, NOT nested
- ✅ `client.loop.get({ id })` — correct
- ❌ `client.loop.get({ params: { id } })` — wrong (this was an early mistake in the loops plugin)
- Server's `PUT /` upsert route calls `generateID()` for new definitions — **ignores client-provided IDs**. So the pattern is: create with `Store.createDefinition()` locally, then call `Runner.persist(api, def)` which handles upsert + sync in one step

**Bus event types (typed, in SDK `Event` union)**:

- `loop.upserted` — definition created or updated
- `loop.removed` — definition deleted
- `loop.run.started` / `loop.run.completed` / `loop.run.failed` — execution lifecycle
- `loop.runtime.changed` — runtime config updates

**TuiEventBus.on signature**:

```typescript
on: <Type extends Event["type"]>(type: Type, handler: (event: Extract<Event, { type: Type }>) => void) => () => void
```

`Type` is constrained to `Event["type"]` (the union of all event type strings from the generated SDK). `as never` cast is NOT needed when subscribing to typed events — that was a wrong workaround in the first iteration of the loops plugin. The correct pattern is to use the typed string directly: `bus.on("loop.upserted", (e) => …)`.

**Loops feature plugin status (2026-06-08)**:

- Headless scheduling integration actively being built (session ID `ses_156b89753ffeQRoJvkgpRJY0T9`)
- Wizard, store, and runner are wired through SDK with flat params
- Bus subscription in `index.tsx` initial sync from server
- `Runner.persist(api, def)` consolidates `Store.upsert` + `Runner.syncAll` into one call

### Effect / Instance Runtime Foundation (`src/effect/`)

Cross-cutting foundation used by every "Service" in the codebase:

| File                | Purpose                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `instance-ref.ts`   | `InstanceRef` and `WorkspaceRef` Effect service tags. `locallyInstance(ctx, effect)` and `locallyWorkspace(ctx, effect)` wrap `provideService`. `currentInstance` / `instance` Effects yield or fail with "No active nikcli instance in Effect context"      |
| `instance-state.ts` | `make<S>(init)` returns a per-directory scoped cache. Cache key is `ctx.directory`; values scoped to calling `Scope`. Used by `permission/next.ts`, `question/index.ts`, `agent/agent.ts`, `skill/skill.ts`, `tool/registry.ts`                              |
| `instance-scope.ts` | `InstanceScope.with({ directory, workspaceID? }, effect)` — `Effect.tryPromise` wrapping `Instance.provide({ directory, fn })`                                                                                                                               |
| `runtime.ts`        | `sharedMemoMap = Layer.makeMemoMap()`, `AppRuntime = makeRuntime(Layer.empty)`, `runtimeFor(layer)` (WeakMap cache of ManagedRuntimes per Layer identity), `runPromiseWithLayer(layer, effect)`, `withCurrentInstance(effect)`                               |
| `with-instance.ts`  | Two entry points: `withInstance(input, effect)` (Effect path) and `withInstanceAsync(input, fn)` (async path; falls back to legacy `Instance.provide({ init, fn })` when `input.init` is set for one-time per-directory bootstraps like `InstanceBootstrap`) |

**Semantics of every `withInstanceAsync({ directory }, …)` call site**: "resolve the project at `directory`, set up the `Instance` singleton, build an `InstanceContext` from it, and run my effect/fn with `InstanceRef` and `WorkspaceRef` provided in the Effect context."

### Agent System Service Layer (2026-06-08 deep-dive)

**File**: `src/agent/agent.ts` (919 lines, June 2026)

- `InfoSchema` — `name, description?, mode, native?, hidden?, topP?, temperature?, color?, permission: PermissionNext.RuleSchema[], model?, advisor?, variant?, prompt?, options, steps?` — annotated with `identifier: "Agent"`
- `Info` exported as `zodObject(InfoSchema)`; `type Info = DeepMutable<…>` strips Effect's `Readonly` so consumers can mutate fields when composing
- `NotFoundError` — `Schema.TaggedErrorClass` with tag `"AgentNotFound"`, name field → catchable via `Effect.catchTag("AgentNotFound", …)` AND `instanceof`
- `Interface`: `get(agent)`, `list()`, `defaultAgent()`, `generate({ description, model? })`
- `Service` extends `Context.Service<Service, Interface>()("Agent.Service")`; `defaultLayer` is the effect implementation
- `SUBAGENT_TOOLSETS` (lines 98–139) is informational; actual gating happens through each agent's `permission` array

**Agent selection precedence**: default = `build`; overrideable by `--agent` flag, subagent invocation (`task` tool), or config. Agent prompts can include `PRIMARY_AGENT_DELEGATION_AWARENESS` (how to use `task`/`delegation`/`delegator`) and `PRIMARY_AGENT_RESEARCH_AWARENESS` (when to launch background `researcher`) fragments.

### Tool System — Authoring Surface (2026-06-08 deep-dive)

**File**: `src/tool/tool.ts` (~180 lines)

- `Tool.Metadata = Record<string, unknown>` (loose); `Tool.StrictMetadata extends z.ZodType<Record<string, unknown>>` (future: Zod-validated metadata)
- `Tool.InitContext = { agent?: Agent.Info }` — passed to `init(ctx)` for per-agent specialization (e.g. `skill` and `task` filter visible items by the caller's permission ruleset)
- `Tool.Context` — see existing table; built **per call** by `context(args, options)` factory in `session/tools.ts:106`
- `Tool.AuthoredDef.execute(args, ctx): Promise<Result> | Effect<Result, Error>` — author can return either; `Tool.define` normalizes via `asEffect`
- `Tool.Def.execute(args, ctx): Effect<Result, Error>` is the normalized form; `executeAsync` is a `Effect.runPromise` shim for legacy/ai-sdk callers

**Full 5-phase execution flow** (confirmed 2026-06-08):

```
model output
  → ai-sdk tool dispatcher (session/tools.ts)
  → ToolRegistry.ids() → registry.tools() → Tool.init(ctx)
  → build AITool, attach execute() that constructs a Tool.Context
  → AI provider returns tool-call → onCall(toolId, args, {abortSignal, toolCallId})
  → context(args, options) builds per-call Tool.Context
  → plugin.trigger("tool.execute.before")
  → item.executeAsync(args, ctx)            ← Effect.runPromise(execute(args, ctx))
  → parameters.parse(args)                  ← Zod / Effect Schema
  → wrappedCtx.metadata(...)                ← in-place override for "truncated" default
  → authoredExecute(args, wrappedCtx) → asEffect(Promise|Effect)
  → Truncate.output(result.output, {}, agent)  ← unless metadata.truncated already set
  → plugin.trigger("tool.execute.after")
  → return to model as toModelOutput
```

**Truncation policy**: `MAX_LINES = 2000`, `MAX_BYTES = 50KB`, output stored to `~/.nikcli/tool-output/{tool_id}` for 7 days. The wrapper in `Tool.define` injects `metadata.truncated: false` by default; the tool body can call `ctx.metadata({ truncated: true })` to override.

**`ctx.ask({ permission, patterns, always, metadata })`** — escalates to `PermissionNext.ask`. Resolves when user replies or an in-memory "approved" ruleset already permits the pattern. Throws `PermissionNext.RejectedError` / `CorrectedError` / `DeniedError` on rejection. Works in subagent context — propagates to the parent TUI via the bus, not blocked at the subagent boundary.

## Brain Pass (2026-06-08 review + 2026-06-09 integration)

### Loops Plugin Review (2026-06-08) — 3 deep-dive audits

Three parallel `@explore` agents reviewed the loops feature end-to-end. Key findings consolidated:

**TUI plugin issues** (`packages/nikcli/src/cli/cmd/tui/feature-plugins/loops/`):

| Issue                                                | Location                     | Severity | Status                                         |
| ---------------------------------------------------- | ---------------------------- | -------- | ---------------------------------------------- |
| N+1 list call on every bus event                     | `runner.ts:159-163, 168-172` | Medium   | Pending                                        |
| `onRemoved` doesn't update local KV (stale data)     | `runner.ts:164-167`          | High     | Pending                                        |
| Optimistic `patch` redundant with bus event          | `runner.ts:74-87, 107-113`   | Low      | Pending                                        |
| Dead export `parseGeneratedDraft`                    | `store.ts`                   | Low      | Pending                                        |
| Dead export `Runs` (SDK class via `runs2` getter)    | `sdk.ts`                     | Low      | **Fixed 2026-06-09** (renamed to `recentRuns`) |
| `isValidModel` unused                                | `dialogs.tsx`                | Low      | Pending                                        |
| `getById` unused                                     | `store.ts`                   | Low      | Pending                                        |
| Wizard data-loss: cancel during generate loses draft | `dialogs.tsx`                | Medium   | Pending                                        |
| No `as never` casts needed for typed bus events      | `index.tsx`                  | Low      | **Fixed 2026-06-09** (no cast needed)          |
| `onUpserted`/`onRuntimeChanged` refetch full list    | `runner.ts:159-172`          | Medium   | Pending (could use `LoopApi.get(loopID)`)      |

**Core engine issues** (`packages/nikcli/src/loop/`):

| Issue                                                                                                | Location                                                                 | Severity | Status                                                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------ |
| `runSession`/`runSessionPrompt` duplicated                                                           | `engine.ts:126-132`, `routes/loop.ts:37-43`                              | Low      | Pending (extract to `loop/util.ts`)                          |
| `runStorage` redefined 3×                                                                            | `manager.ts:18-20`, `background/run.ts:16-18`, `mobile/routine.ts:39-82` | Low      | Pending (extract to `storage.ts` adapter)                    |
| `engine.ts` mixes 5 concerns (persistence, bus, runtime, single-flight, scheduler)                   | `engine.ts`                                                              | Medium   | Pending (split into `loop/runtime.ts`, `loop/scheduler.ts`)  |
| `syncAll` has no-op loop with comment-only branch                                                    | `engine.ts:349-358`                                                      | Low      | Pending (remove or implement)                                |
| `dispose` doesn't unregister from bus or drop inFlight                                               | `engine.ts:371-376`                                                      | Medium   | Pending                                                      |
| `restore()` doesn't reconcile stale "running" LoopRuns                                               | `engine.ts:361-368`                                                      | High     | Pending (no `BackgroundRun.reconcileInterrupted` equivalent) |
| `restore()` blindly re-arms everything                                                               | `engine.ts:361-368`                                                      | Low      | Pending (arm is idempotent, fine in practice)                |
| `source: "loop"` added to `BackgroundRun.SourceSchema` but engine never calls `BackgroundRun.create` | `background/run.ts:74` vs `engine.ts:193-254`                            | Medium   | Pending (loop runs indistinguishable from manual sessions)   |
| No in-flight run cancellation (pause ≠ abort)                                                        | `routes/loop.ts:386-394` + `runner.ts:268-273`                           | Medium   | Pending (next interval just starts new session)              |

**SDK alignment issues** (server `loop` source):

| Issue                                                   | Location                                | Status                                              |
| ------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| `Loop.runs2` getter from collision with mobile route    | `packages/sdk/js/src/v2/gen/sdk.gen.ts` | **Fixed 2026-06-09** (renamed to `Loop.recentRuns`) |
| `loop.runs.recent` exists on server but not used by TUI | `routes/loop.ts` + `tui/loops/sdk.ts`   | Pending                                             |

### Spec gaps (from `specs/10-loops.md`)

Implementation has moved past the v1 spec but several Phase 3 items remain:

| Spec item                                       | Status                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| Single `objective: string` per loop             | **Not implemented** (uses `stages: LoopStage[]` pipeline) |
| Top-level `agent: string`                       | **Not implemented** (per-stage)                           |
| `stop: { maxIterations, tokenBudget, maxRuns }` | **Partial** (only `maxRuns` at top)                       |
| `guardrails: { requireApproval, maxCostUSD }`   | **Not implemented** (Phase 3)                             |
| `trigger: { kind: "event"; on: Event["type"] }` | **Not implemented** (Phase 3)                             |
| `BackgroundRun.create` per loop iteration       | **Not implemented** (engine uses own `Manager.startRun`)  |
| `client.session.abort` for clean stop           | **Not implemented** (pause ≠ abort)                       |
| "Promote current goal to loop" action           | **Not implemented**                                       |
| `src/loop/definition.ts` file                   | **Renamed to `schema.ts`**                                |

**Items implemented in advance of spec**: `POST /loop/generate`, `loop.generate` SDK method, sidebar live panel via `api.slots.register('sidebar_content')`.

### CI Failure Monitor Workflow (2026-06-08)

New GitHub Action `ci-check.yml` runs every 5 hours (cron: `0,5,10,15,20 * * *`) to detect CI failures and create tracking issues.

**Files created/modified**:

- `.github/workflows/ci-check.yml` — workflow with `github-actions[bot]` git identity
- `script/ci-check.ts` — checks last 6h of workflow runs, identifies failures by `conclusion != "success"` excluding skipped, creates/updates tracking issue

**Pattern (matches `script/ci-report-failure.ts`)**:

```typescript
// Dynamic import with fetch-based fallback (Octokit may not resolve from root)
try {
  const { Octokit } = await import("@octokit/rest")
  // ... use Octokit
} catch {
  // Fallback: use fetch() directly to GitHub REST API
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=100`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
  })
  // ... parse manually
}
```

**Known issue (preexisting)**: `@octokit/rest` LSP error in root `script/` files — not resolvable by tsgo (root tsconfig doesn't pick up workspace catalog version 22.0.0). `bun run` works fine; only the IDE/LSP shows the error. The dynamic-import-with-fallback pattern makes the script robust regardless.

### Loop Engine Spec-Alignment Decisions (2026-06-09)

**Source literal** (`src/background/run.ts:74`): `"loop"` was added to `SourceSchema` but the engine does NOT call `BackgroundRun.create` — it uses its own `Manager.startRun`/`finishRun` flow. The `backgroundRunID` field on `LoopRun` is a foreign-key reference but currently unused. Either: (a) engine should create a BackgroundRun per loop-run, or (b) remove the literal.

**SDK regen post-merge** (2026-06-09): After operationId rename to avoid `runs2` collision:

- `client.loop.runs()` → still exists (returns list of runs for a loop)
- `client.loop.recentRuns()` → new (returns recent runs across loops)
- Mobile route has its own `client.loop.runs` class → no collision after rename
- Typecheck passes; all 99 loop tests pass

### Loop Engine Test Coverage (2026-06-09)

| Test file                            | Tests                            | Coverage                                                 |
| ------------------------------------ | -------------------------------- | -------------------------------------------------------- |
| `test/loop/*.test.ts` (multiple)     | ~60+                             | Schema, manager, engine basics                           |
| `test/tui/loops-store.test.ts`       | ~30                              | Solid store CRUD, history, KV persistence                |
| `test/tui/loops-store-extra.test.ts` | ~10                              | Edge cases                                               |
| **Total**                            | **99 pass, 0 fail, 206 expects** | Run: `bun test test/loop/ test/tui/loops-store*.test.ts` |

**Test gaps** (per @explore review):

- `runner.ts` — no tests
- `sdk.ts` (TUI loops) — no tests
- `dialogs.tsx` (1015 lines) — no component tests
- `engine.ts` crash recovery (`restore()`) — not covered
- `Manager.startRun`/`finishRun` concurrency — not covered

### Loops Integration Status (2026-06-09 end)

- Session ID `ses_156b89753ffeQRoJvkgpRJY0T9` (active through the day)
- TUI plugin wizard, store, runner, dialogs all wired through SDK with flat params
- Bus subscription in `index.tsx` working with typed events (no `as never` needed)
- `Runner.persist(api, def)` is the canonical entry point for create+update
- **Remaining**: 3.6 (server namespaces for Engine concerns), 3.8 (SDK types alignment with TUI shapes), 3.9 (string constants/i18n) — deferred
- **Pending from review**: tests for runner/sdk/dialogs, dispose unregister, restore reconciliation, removed event handling

### Parallel Investigation Pattern — Confirmed 2026-06-08

For comprehensive read-only audits, launch 3+ explore agents in parallel:

1. **Split by concern**: e.g. (TUI plugin, core engine, SDK alignment)
2. **Use `task(background: true)` with `subagent_type: "explore"`**
3. **10-minute timeout is common** for deep audits; trust supervisor's `Action: finalize` synthesis
4. **All three reviews completed** despite the timeout — read state in `delegation(action="read")` if needed, or accept the supervisor summary

### Brain Pass — Recursive Pattern Note (2026-06-09, 2026-06-10)

Multiple nested Brain Pass sessions were initiated (sessions `ses_15145fe50…`, `ses_151458d5a…`, `ses_1510f0fe9…`). The Brain agent itself sometimes appears in its own inputs as the "current" tool — be aware of the recursive structure when reading older Brain Pass sections in this file.

## Brain Pass (2026-06-10)

### TUI Architecture Deep-Dive (session `ses_14e4f2c7effe2VQc5rwm0w1DD5`)

Italian-language comprehensive analysis of TUI subsystem. Key findings consolidated with existing entries:

**Three TUI files, distinct roles** (confirmed with file:line ranges):

| File        | Role                                                        | Key lines                                                                                                    |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `app.tsx`   | Entry `tui()`: creates `CliRenderer`, mounts provider stack | `app.tsx:108-202` (entry), `app.tsx:237-1376` (root App component, `<Switch>/<Match>` router at `1338-1372`) |
| `worker.ts` | Bun worker process, isolated                                | RPC surface + `Server.App().fetch` + SSE + install/upgrade                                                   |
| `thread.ts` | Thread CLI command, spawns worker                           | `thread.ts:104-296` (registers as `TuiThreadCommand`)                                                        |

**Why a separate worker process?** (`thread.ts:153-189`):

1. `reload` via `SIGUSR2` → `Instance.disposeAll` without killing TUI
2. `shutdown` with 5s timeout
3. `server` start/stop of `Bun.Server`
4. `checkUpgrade` / `upgradeNow` for auto-updates

Vantaggio (advantage): hot-restart of server isolation without terminating the TUI renderer.

**IPC worker↔main**: `Rpc` utility + `Rpc.client<typeof rpc>`. Methods: `fetch`, `server`, `checkUpgrade`, `upgradeNow`, `reload`, `subscribe`/`unsubscribe` (SSE), `shutdown`. `createWorkerFetch` (`thread.ts:37-53`) intercepts HTTP, `createEventSource` (`thread.ts:55-68`) bridges SSE. When `--port`/`--hostname` NOT passed: `url="http://nikcli.local"` with direct RPC (no HTTP server at all).

**OpenTUI rendering**:

- `targetFps: 45`, `gatherStats: false`, `useKittyKeyboard: {}`, `useMouse` (`app.tsx:90-103`)
- Resize via `box.on("resize")` (e.g. `bg-pulse.tsx:54`)
- MouseUp globally on root (`app.tsx:1324-1336`) + text-selection capture
- Dialog overlay with mouse absorption (`dialog.tsx:60-90`)
- Layout via `flexDirection`, `flexGrow`, `flexShrink`, `alignItems`, `justifyContent`, `position="absolute"`, `paddingLeft/Right/Top/Bottom`, `gap`
- `useTerminalDimensions()` reactive (e.g. `dialog.tsx:38`)
- ANSI/Unicode: 256 colors + 24-bit RGB; box-drawing custom chars (`border.tsx:1-67` — `GlassBorder ╭╮╰╯│─┬┴├┤┼`, `SplitBorder ┃`); braille U+2800-U+28FF (chart-braille-line.tsx:66-72); 8-level block chars `▏▎▍▌▋▊▉█` (chart-braille-line.tsx:629)
- `ghostty-web` integration: **no direct reference found**; renderer is OpenTUI based on Kitty keyboard protocol + SGR mouse + palette detection via `renderer.getPalette({size:16})` (`theme.tsx:492-516`)

### TUI Dialog System — Complete Catalogue (component/dialog-\*.tsx)

**All dialogs in `src/cli/cmd/tui/component/` are stack-based modal overlays** (managed by `DialogContext` in `ui/dialog.tsx:93-224`: `replace`, `clear`, `setSize("medium"|"large"|"xlarge")`, `stack`, `onClose` callbacks; Esc closes top at `dialog.tsx:122-127`; Ctrl+C closes stack if top non-interactive at `dialog.tsx:132-153`).

| Dialog file                                              | Purpose                                                                                                                          | Size hint                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `dialog-onboarding.tsx`                                  | 5-step wizard: account, FS, provider, test                                                                                       | Large (was 4-step)                      |
| `dialog-login.tsx`                                       | Returning user login                                                                                                             | Medium                                  |
| `dialog-advisor-model.tsx`                               | Advisor agent model selection                                                                                                    | Medium                                  |
| `dialog-agent.tsx`                                       | Switch agent (build/plan/general)                                                                                                | Medium                                  |
| `dialog-model.tsx`                                       | Favorites/recent model picker + fuzzy search                                                                                     | Large                                   |
| `dialog-image-model.tsx`                                 | Image generation model picker                                                                                                    | Medium                                  |
| `dialog-speak-model.tsx`                                 | TTS model picker                                                                                                                 | Medium                                  |
| `dialog-variant.tsx`                                     | Model variant selector                                                                                                           | Medium                                  |
| `dialog-provider.tsx`                                    | Connect/disconnect provider (API key)                                                                                            | Large                                   |
| `dialog-mcp.tsx`                                         | Installed MCPs + catalog                                                                                                         | Large                                   |
| `dialog-skills.tsx`                                      | Browse loaded skills                                                                                                             | Large                                   |
| `dialog-routine.tsx`                                     | Scheduled routine creation wizard                                                                                                | Large                                   |
| `dialog-theme-list.tsx`                                  | Switch theme with live preview                                                                                                   | Large                                   |
| `dialog-theme-create.tsx`                                | Custom theme creation                                                                                                            | Large                                   |
| `dialog-workspace-list.tsx`                              | Workspace management                                                                                                             | Large                                   |
| `dialog-workspace-create.tsx`                            | New workspace                                                                                                                    | Medium                                  |
| `dialog-workspace-unavailable.tsx`                       | Workspace unavailable error                                                                                                      | Medium                                  |
| `dialog-workspace-file-changes.tsx`                      | Workspace file change review                                                                                                     | Large                                   |
| `dialog-session-list.tsx`                                | Session list + filter                                                                                                            | Large                                   |
| `dialog-session-rename.tsx`                              | Rename session                                                                                                                   | Medium                                  |
| `dialog-session-warp.tsx`                                | (Experimental) warp session                                                                                                      | Large                                   |
| `dialog-session-delete-failed.tsx`                       | Delete failure error                                                                                                             | Medium                                  |
| `dialog-stash.tsx`                                       | Prompt stash                                                                                                                     | Medium                                  |
| `dialog-tag.tsx`                                         | Session tag                                                                                                                      | Medium                                  |
| `dialog-status.tsx`                                      | Provider/MCP/LSP status                                                                                                          | Large                                   |
| `dialog-usage.tsx`                                       | Context token usage                                                                                                              | Large                                   |
| `dialog-analytics.tsx`                                   | Session analytics                                                                                                                | XLarge                                  |
| `dialog-tour.tsx`                                        | 6-step tour                                                                                                                      | Large                                   |
| `dialog-support.tsx`                                     | Quickstart/Doctor info                                                                                                           | Large                                   |
| `dialog-web-preview.tsx`                                 | Web preview browser                                                                                                              | Large                                   |
| `dialog-opentui-viz.tsx`                                 | OpenTUI visualization (1856 lines)                                                                                               | XLarge                                  |
| `dialog-config.tsx`                                      | Config file editor                                                                                                               | Large                                   |
| `dialog-remote.tsx`                                      | Remote server connection                                                                                                         | Large                                   |
| `dialog-chat.tsx`                                        | DM contacts chat                                                                                                                 | XLarge                                  |
| `dialog-auth-manage.tsx`                                 | Auth account management                                                                                                          | Large                                   |
| `dialog-command.tsx`                                     | Command palette (slash + keybind)                                                                                                | Large                                   |
| `dialog-settings/index.tsx`                              | Settings hub (5 categories)                                                                                                      | Large                                   |
| `dialog-settings/{prompt,sidebar,spinner,ui,brain}.tsx`  | Sub-dialogs of settings                                                                                                          | Large                                   |
| `error-component.tsx`                                    | ErrorBoundary fallback (`app.tsx:138`)                                                                                           | Medium                                  |
| `plugin-route-missing.tsx`                               | Plugin route fallback (`app.tsx:1368`)                                                                                           | Medium                                  |
| `startup-loading.tsx`                                    | Splash before pluginReady (`app.tsx:1373`)                                                                                       | **Persistent overlay** (only non-modal) |
| `image-preview.tsx`                                      | Image attachment preview (Jimp, 40×16)                                                                                           | Inline persistent                       |
| `logo.tsx`                                               | ASCII logo (104 lines, static, shadow via `▀`)                                                                                   | Persistent (Home)                       |
| `tips.tsx`                                               | Home screen tips                                                                                                                 | Persistent                              |
| `todo-item.tsx`                                          | Single todo item                                                                                                                 | Inline                                  |
| `spinner.tsx`                                            | Loading spinner                                                                                                                  | Inline                                  |
| `border.tsx`                                             | Box-drawing defs (no render)                                                                                                     | —                                       |
| `bg-pulse.tsx`                                           | Animated Home background                                                                                                         | Persistent (Home)                       |
| `chart-braille-line.tsx`                                 | Charts: `BrailleLineChart`, `BrailleAreaChart`, `BrailleSparkline`, `StackedBarChartV2`, `HBarPrecision`, `KPICard`, `ModelCard` | Inline                                  |
| `prompt-frames.tsx`                                      | Prompt frame decorations                                                                                                         | Inline                                  |
| `prompt-jobs-inline.tsx`                                 | Background jobs inline status                                                                                                    | Inline                                  |
| `prompt/{index,history,stash,frecency,autocomplete}.tsx` | Prompt system                                                                                                                    | Persistent                              |
| `mcp-catalog.ts`                                         | Known MCP catalog (data, no render)                                                                                              | —                                       |
| `textarea-keybindings.ts`                                | Textarea keybind config                                                                                                          | —                                       |

**Only `startup-loading.tsx` is non-modal** (persistent overlay). All others are stack-based modals.

### TUI Routes — File Inventory

`routes/` files are **top-level navigable pages** (NOT HTTP routes) — Switch/Match dispatch in `app.tsx:1338-1372`. Legacy `changes/tree/git-graph/github` redirect to `workspace` (app.tsx:1339-1356). See "TUI Route System" section above for `home|session|plugin|changes|tree|git-graph|github|workspace` types.

### TUI Feature Plugins System

`feature-plugins/` directory contains side-panel widgets and dialogs that integrate via SDK (Promise-based, NOT Effect — see Loops section above). Hot reload via `SIGUSR2` (thread.ts:176) → `Instance.disposeAll` (worker.ts:165-167). Plugins register: `api.slots.register('sidebar_content')`, `api.routes.register()`, `api.commands.register()`. See `system/plugins.tsx` and `context/sync.tsx` for patterns.

### TUI Server Communication

- **SDK import path**: `@nikcli-ai/sdk/v2` (regenerated from OpenAPI spec)
- **Polling vs push**: All real-time via SSE (`/event` and `/global/event`); no polling
- **Optimistic updates**: Used in loops plugin (`runner.ts:74-87`) and feature plugins
- **Error display**: `ToastProvider` (app.tsx stack) for transient errors; dialog for critical
- **Toast file**: `src/session/toast.tsx` (per `app.tsx:140-194` provider chain, NOT the 2026-04 entry)

### TUI Attach Mode

`src/cli/cmd/tui/attach.ts` opens a TUI against a remote `nikcli serve` instance. **No worker process spawned** — `tui({url, args, directory})` called directly. User runs `nikcli serve` separately on the target host. SSH tunneling typically used for remote access; no built-in SSH client in the TUI itself.

### High-Level Architecture (session `ses_14e6c42b0ffeR3amriRp3YsHUc`)

nikcli is an AI-powered development tool with two faces: headless CLI + interactive TUI (default entrypoint). Conceptually a **"coding agent runtime"**: orchestrator running AI agents (LLM) with a tool set, session persistence, permission system, multi-mode deployment (local/server/remote-attach/mobile-companion).

**Five "pillars" of the core** (from `src/`):

1. **Agent** — agent profiles (build, plan, ralph + subagents like explore/code-reviewer/debugger). Effect-based schema, tool permissions, modular system prompt.
2. **Session** — conversation lifecycle, streaming, history, compaction, runner (state machine single-flight via Effect).
3. **Provider** — 20+ LLM provider abstraction via Vercel AI SDK.
4. **Tool** — "muscles": bash, edit, glob, grep, webfetch, LSP, MCP, monitor, apply_patch, generate_image, etc.
5. **Server** — Hono (HTTP + SSE + WebSocket) with auto-generated OpenAPI (`hono-openapi`).

**Three usage modes, same backend**:

- **CLI one-shot**: `nikcli run "..."` → launches server, executes, exits
- **TUI**: `nikcli` (default) → worker process SolidJS connects to local server via SDK
- **Server**: `nikcli serve` → Hono bound, SSE for event stream
- **Remote attach**: `nikcli attach <url>` → remote TUI
- **Mobile**: companion package

**Full `src/` directory map (63 entries)**:

- **Core runtime**: `agent/`, `session/` (processor, runner, llm, message-v2, compaction, revert, retry, mode, goal, todo, stats, summary), `session/llm/` (ai-sdk, native-request, native-runtime), `session/v2/`, `provider/` (registry, llm-client, transform, models), `tool/` (~40+ tools with .txt system prompts), `bus/`
- **Interfaces**: `cli/cmd/` (~40 yargs commands, some in `tui/`, `debug/`), `cli/cmd/tui/` (SolidJS app, 40+ dialogs), `server/` (Hono, routes, SSE, mDNS, WebSocket, OpenAPI), `acp/`
- **Integrations**: `mcp/`, `lsp/`, `connectors/` (Discord, Slack, GitHub, Linear, Teams, GChat via `@chat-adapter/*`), `chatbot/`, `companion/`, `mobile/`, `plugin/`, `scheduler/`, `share/`
- **Internal services**: `permission/` (PermissionNext), `storage/` (JSON), `database/` (central SQLite — Drizzle, `nikcli.db`), `db/` (legacy per-domain SQL modules, being merged), `config/`, `project/` (Instance, bootstrap, vcs), `workspace/`, `worktree/`, `filesystem/`, `file/`, `git/`, `shell/`, `pty/`, `snapshot/`, `patch/`, `sandbox/` (Vercel sandbox), `account/`, `auth/`, `installation/`, `delegation/`, `effect/`, `global/`, `env/`, `flag/`, `id/`, `image/`, `brain/`, `audio.d.ts`, `wasm.d.ts`, `interaction/`, `question/`, `locale/`, `loop/`, `format/`, `prompt/`, `skill/`, `sync/`, `monitor/`, `command/`, `util/`, `ide/`, `background/`

### Image Preview System — `tui-image` Integration (2026-06-10)

**New package**: `tui-image` linked into `packages/nikcli` for native half-block image rendering protocol.

**Integration path** (`image-preview.tsx` + `tui-image.tsx`):

- `loadImagePreview()` in `image-preview.tsx` now uses the new half-block encoder from `tui-image` instead of the hand-rolled braille encoder
- `ImagePreviewList` (legacy) delegates to new `TuiImageList` from `tui-image.tsx` when native protocol is available
- Feature flag in route file (`routes/session/index.tsx`) lets user opt into the new renderer
- `useTerminalDimensions()` already imported in route (no new import needed)
- `Bun.link()` completed: `tui-image` is now linked into nikcli workspace
- `zig.d.ts` exposes `writeOut` on `RenderLib` (not directly on `CliRenderer`); `CliRenderer.writeOut` is private — use `process.stdout.write` for now or pass writer callback

**Note**: `bun run typecheck` ran into SIGTERM timeout (2026-06-10) while integrating. Re-run with longer timeout needed to verify the import paths.

### CLI Commands Catalogue (session `ses_14e6607a2ffeuifEn3QedG7QFS`)

CLI commands grouped by category (per `packages/nikcli/src/cli/cmd/`):

- **Core**: `run` (run.ts), `agent` (agent.ts), `models` (models.ts), `auth` (auth.ts)
- **Server**: `serve` (serve.ts), `workspace-serve` (workspace-serve.ts), `web` (web.ts)
- **Remote**: `remote` (remote/), `attach` (attach.ts), `mobile` (mobile-dev.ts), `companion` (companion.ts)
- **Session**: `session` (session/), `export` (export.ts), `import` (import.ts), `share` (share.ts)
- **Dev**: `debug` (debug/), `doctor` (doctor.ts), `upgrade` (upgrade.ts), `uninstall` (uninstall.ts), `stats` (stats.ts)
- **Model**: `image-model` (image-model.ts), `speak-model` (speak-model.ts), `brain-model` (brain-model.ts)
- **Account**: `account` (account.ts), `usage` (usage.ts), `goal` (goal.ts), `routine` (routine.ts), `heap` (heap.ts), `ads` (ads.ts), `locale` (locale.ts)
- **Integration**: `mcp` (mcp.ts), `github` (github.ts), `acp` (acp.ts), `pr` (pr.ts), `chatbot` (chatbot.ts)
- **Plugin**: `plug` (plug.ts)
- **TUI**: `tui/thread.ts` (default), `tui/plugin/` (plugin routes)

### Default Branch Update (2026-06-10)

**IMPORTANT CORRECTION**: The current default branch is **`live-main`**, NOT `nikoemme-main` (which is in older Brain Pass entries from before 2026-06-07). Confirmed 2026-06-10 by `gh api` checks during CI babysit session.

**Open PRs against `live-main` (2026-06-10)**:

| PR  | Branch → live-main                             | Notable failures                         |
| --- | ---------------------------------------------- | ---------------------------------------- |
| #91 | `nikcli/mobile/nikcli/yrrz85`                  | Multiple failures                        |
| #88 | `claude/npm-publish-error-vCzX7`               | Windows smoke + test failures            |
| #86 | `claude/nikcli-effect-skill-integration-X5AAM` | Windows smoke/test + nix hashes failures |

**Recently merged PRs**: #97, #96 (most recent merges to `live-main`).

### Outstanding TODO from 2026-06-10

- **TUI exit logo**: User requested nikcli to display ASCII logo on terminal kill (like OpenCode does) — added 2026-05-20, still not implemented (re-attempt via renderer cleanup hook)
- **tui-image typecheck**: Needs re-run with longer timeout to confirm integration compiles cleanly (`zig.d.ts` `writeOut` integration)
- **CI babysit resolution**: PR #91 (mobile) and PR #88 (npm-publish) and PR #86 (effect-skill-integration) have unaddressed failures; PR #99 (session.init removal) has 3 Windows failures + 1 pending — root causes and fixes documented in new Brain Pass section below
- **Database centralization**: domain modules still re-export their own tables; need full migration to central `Database` service (cleanup of `storage/db.ts`, `storage/db.bun.ts`, per-domain openers)

## Brain Pass (2026-06-10 evening / 2026-06-11)

### Database Centralization (in progress, 2026-06-10)

Active migration of all domain SQLite modules into a single unified database under `src/database/`. New namespace `Database` replaces per-domain singletons.

**Target state** (per `specs/storage/database.md` + exploration session `ses_14c21e877ffeNnwEosLVtEkvOB`):

- Single SQLite file: `<Global.Path.data>/nikcli.db` (overridable via `NIKCLI_DB` env var)
- One Drizzle client shared across all domain modules
- One `DatabaseMigration` runner tracks applied migrations in a `migration(id, time_completed)` table
- PRAGMAs applied at startup: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `cache_size=-64000`, `foreign_keys=ON`, `wal_checkpoint(PASSIVE)`
- Files re-exporting per-module tables: `src/database/schema.ts` re-exports from `account.sql`, `users.sql`, `auth.sql`, `workspace.sql`

**Module migration status (2026-06-10 end)**:

| Old module (lazy singleton + own DB) | Old DB file         | New location                                      | Status                    |
| ------------------------------------ | ------------------- | ------------------------------------------------- | ------------------------- |
| `db/users.ts` (`UserDB`)             | `users.db`          | re-exported via `Database.db`                     | Re-exported, not migrated |
| `account/db.ts` (`AccountDB`)        | `accounts.db`       | re-exported via `Database.db`                     | Re-exported, not migrated |
| `workspace/db.ts` (`WorkspaceDB`)    | `workspaces.db`     | re-exported via `Database.db`                     | Re-exported, not migrated |
| `mobile/auth.ts` (`MobileAuth`)      | `mobile_auth.db`    | re-exported via `Database.db`                     | Re-exported, not migrated |
| `storage/db.ts` (generic opener)     | n/a                 | removed; only `database/database.ts` opens SQLite | **Removed**               |
| `storage/db.bun.ts`                  | n/a                 | removed                                           | **Removed**               |
| `sync/index.ts` (JSON eventsFile)    | `state/sync/*.json` | leftover dead code removed                        | **Cleaned**               |

**Verification gates (from spec)**: `rg "new Database|drizzle\(" packages/nikcli/src` should return only the central runtime + tests; `rg "CREATE TABLE IF NOT EXISTS|ALTER TABLE" packages/nikcli/src` should be only in `migration/` files.

**Open typecheck errors post-migration (2026-06-10)**: `session/context-breakdown.ts:102,120,121,124` (`Property 'parts'/'info' does not exist on type '{}'`), `session/message-v2.ts:942,980` (`Object is possibly 'undefined'` + `.catch` on `{}`), `session/prompt.ts:665,698` (`AsyncGenerator<{}, void>` not assignable to `AsyncIterable<{info, parts}>`). Root cause: v2 session stream typing — generator yields `{}` instead of the expected `{info, parts}` shape.

### OpenCode Reference Patterns (studied 2026-06-10)

`anomalyco/opencode` (branch `dev`) is the reference implementation. Key patterns (`packages/core/src/database/`):

```ts
// database.ts — Effect-based DB service
const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase
    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    // ... more PRAGMAs ...
    yield* DatabaseMigration.apply(db)
    return { db }
  }).pipe(Effect.orDie),
)

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
}

export function path() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return join(Global.Path.data, Flag.OPENCODE_DB)
  }
  // channel-based DB names: "opencode.db" or "opencode-<channel>.db"
}

export const defaultLayer = Layer.unwrap(
  Effect.gen(function* () {
    return layerFromPath(path())
  }),
).pipe(Layer.provide(Global.defaultLayer))
```

`sqlite.bun.ts` defines a custom `SqliteClient` (extends `Client.SqlClient`) backed by `bun:sqlite` + `drizzle-orm/bun-sqlite`, with `export: Effect.Effect<Uint8Array, SqlError>` and `loadExtension: (path) => Effect.Effect<void, SqlError>` for backup/restore.

**Adoption decision (nikcli)**: Use the same pattern but with our existing `EffectDrizzleSqlite` adapter if available, or hand-roll like opencode if not. The single-file `nikcli.db` is the destination.

### TUI Image Component Fix (2026-06-10)

Two TypeScript errors fixed in `packages/nikcli/src/cli/cmd/tui/component/tui-image.tsx`:

**1. `OverlayRenderer` intersection collapsed to `never`** (lines ~255-286):

The original type was `type OverlayRenderer = CliRenderer & { renderNative, writeOut, renderOffset }`. `renderOffset` is declared `private` on the upstream `CliRenderer` class, so the intersection reduces to `never`, breaking all five property accesses inside `registerNativeOverlay`.

Fix: replaced intersection with a standalone structural type that names only the public members (`requestRender`, `terminalWidth`, `terminalHeight`) plus the three privates, and changed the boundary cast to `renderer as unknown as OverlayRenderer` (TS rejects direct casts when types don't sufficiently overlap).

**2. `Cannot find name 'encodeHalfblock'`** (line 598):

The re-export `export { encodeHalfblock }` was left over from a previous version, but the import was removed when the component switched to the kitty virtual-placement / iTerm2 / Sixel / braille pipeline. No call sites in the repo import `encodeHalfblock` from this file (verified via grep), so the re-export was removed.

**Verification**:

- `bun run typecheck` in `packages/nikcli` is clean for this file. The only remaining typecheck errors are in `packages/tui-image/src/encode.ts` (a different package), outside the scope of this request.
- `bun test test/tui/` passes 147/147 in 2.35s.

**Other `tui-image` integration notes (2026-06-10)**:

- `zig.d.ts` exposes `writeOut` on `RenderLib` (not directly on `CliRenderer`); `CliRenderer.writeOut` is private — use `process.stdout.write` for now or pass writer callback
- `Bun.link()` completed: `tui-image` is now linked into nikcli workspace
- `loadImagePreview()` in `image-preview.tsx` uses the new half-block encoder from `tui-image` instead of the hand-rolled braille encoder
- `ImagePreviewList` (legacy) delegates to new `TuiImageList` from `tui-image.tsx` when native protocol is available
- Feature flag in route file (`routes/session/index.tsx`) lets user opt into the new renderer

### `/support` Chat Feature (added 2026-06-10, session `ses_14c617056ffe5JIjDH54FvxwP7`)

New in-app help assistant with read-only access to project docs.

**Files created**:

| File                                          | Purpose                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/agent/prompt/support-docs.ts`            | Markdown indexer for local docs (cached, ~30ms cold, 0ms cached)                         |
| `src/cli/cmd/tui/context/support-session.tsx` | Context for persistent support session (saves sessionID to `state/support-session.json`) |
| `specs/v2/support-dialog.md`                  | Architecture spec                                                                        |

**Files modified**:

| File                                                 | Change                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/agent/agent.ts`                                 | New builtin agent `support` (hidden, read-only, webfetch+websearch)              |
| `src/cli/cmd/tui/component/dialog-support.tsx`       | Rewritten as full chat UI with streaming SSE, welcome hints, Ctrl+L reset        |
| `src/cli/cmd/tui/app.tsx`                            | Registered `/support` command + `app_support` keybind + `SupportSessionProvider` |
| `src/config/config.ts`                               | Added keybind `app_support` (default `<leader>z`)                                |
| `src/cli/cmd/tui/ui/dialog-help.tsx`                 | Added `/support` + shortcut to help                                              |
| `src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` | Tip mentioning `/support` and `<leader>z`                                        |

**SDK**: `packages/sdk/js/src/v2/gen/types.gen.ts` — added `app_support?: string` to `KeybindsConfig` (line ~1760).

**Entry points**:

- Slash: `/support` (alias `ask`, `help-me`)
- Keybind: `<leader>z`
- Command palette: "Chat with the support assistant" (Support category)

**Verification (2026-06-10)**:

- `bun run typecheck` — only 2 pre-existing errors in `tui-image/src/encode.ts` (unrelated)
- `npx oxlint` — 0 errors, 1 pre-existing warning in `config.ts:831`
- `bun test test/agent/` — 7 pass, 0 fail
- Docs indexer smoke test — ~30ms cold, 0ms cached

**Design intent**: Read-only by design — `support` agent cannot modify files, run destructive bash, or spawn tasks. Docs auto-refresh via live indexer (AGENTS.md, README, specs/**, docs/**, packages/\*/README.md).

### PR #99 — `feat(session)!: remove the dedicated session.init route per the v2 plan` (2026-06-10)

Branch: `claude/session-v2-live-stepper` → `live-main`. Local commit `c79a7ad80` on `live-main` matches PR 99's title.

**CI status (2026-06-10T22:02Z)**:

| Check                             | Result   | Time   |
| --------------------------------- | -------- | ------ |
| `smoke (windows-latest, cmd)`     | **fail** | 10m44s |
| `smoke (windows-latest, pwsh)`    | **fail** | 8m9s   |
| `test (windows)`                  | **fail** | 9m39s  |
| `test (linux)`                    | pending  | 0      |
| `Analyze (actions)`               | pass     | 38s    |
| `Analyze (javascript-typescript)` | pass     | 1m23s  |
| `Analyze (rust)`                  | pass     | 1m39s  |
| `CodeQL`                          | pass     | 2s     |
| `add-contributor-label`           | pass     | 3s     |
| `check-compliance`                | pass     | 3s     |
| `check-duplicates`                | pass     | 6s     |
| `check-standards`                 | pass     | 3s     |
| `nix-eval`                        | pass     | 38s    |
| `typecheck`                       | pass     | 1m23s  |
| `validate`                        | pass     | 1m24s  |

**Root cause of smoke failures** (same in both cmd + pwsh): `packages/nikcli/test/session/prompt-effect-service.test.ts:27` expects `file://${path.join(directory, "notes.md")}` which produces backslash file URLs on Windows. The code under test uses `pathToFileURL` which produces RFC-8089 file URLs (`file:///C:/...`) and percent-encodes `RUNNER~1` → `RUNNER%7E1`. Two fixes needed:

1. Build expected URL via `pathToFileURL(directory) + "notes.md"` instead of `file://${path.join(...)}`
2. Decide whether the resolver should drop unresolved `read @notes.md` text when emitting a file part, or whether the test should assert both parts (test currently receives a `text` part AND a `file` part — resolver is falling through)

**`test (windows)` failure** (run 27306248383 / job 80664732295): aborted with exit code 255 in the "Run" step, after `Set OS-specific paths` and before `Seed nikcli data` completed. Same shape of failure appears on PRs 91, 88, 86 — looks like runner/seed instability on `windows-latest` rather than a code regression, but it's still flagged failing on PR 99.

### Open PRs against `live-main` (updated 2026-06-10T22:02Z)

| PR  | Branch → live-main                             | Status                                                                   |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| #99 | `claude/session-v2-live-stepper`               | 3 failing checks (Windows smoke × 2, test (windows) exit 255), 1 pending |
| #91 | `nikcli/mobile/nikcli/yrrz85`                  | Multiple failures                                                        |
| #88 | `claude/npm-publish-error-vCzX7`               | Windows smoke + test failures                                            |
| #86 | `claude/nikcli-effect-skill-integration-X5AAM` | Windows smoke/test + nix hashes failures                                 |

Recently merged to `live-main`: #97, #96.

### Other 2026-06-10 Sessions

- `ses_14c7fda31ffeykKYasAN0YceBO` — Screenshot review request (image path, ambiguous)
- `ses_14c77c22affeXGgD0IJb7mfhrp` — Loop "babysit PR" run; identified PR 99 via title-match against `live-main` HEAD
- `ses_14c2b6be2ffen1JEDqNco7eZKQ` — Loop run on branch with no open PR; `goal "fixa incoerenze o errori"` aborted early
- `ses_14c21e877ffeNnwEosLVtEkvOB` — `@explore`: comprehensive DB/storage module dump
- `ses_14c21e1b3ffe6yOwU6l1xEfcOJ` — `@researcher`: opencode reference implementation fetch (4 webfetches failed, then discovered default branch is `dev`; all 6 files retrieved from `https://raw.githubusercontent.com/anomalyco/opencode/dev/...`)

### TUI Exit Logo (still pending as of 2026-06-10)

User requested nikcli to display ASCII logo on terminal kill (like OpenCode does). The `logo.tsx` static component exists, but the **kill-time** logo display path is not wired up. Two previous attempts had stability issues; needs reattempt via renderer cleanup hook.

## Brain Pass (2026-06-12)

### Startup Performance Investigation (`src/index.ts` — Eager Imports)

Read-only audit (`ses_1427c4a0cffewkPu5TmoTKu5hp`) found the **main cold-start bottleneck**: `src/index.ts` eagerly imports every command module at the top level before yargs routing. Even `nikcli --version` and `nikcli --help` pay the full cost of the command tree.

**Baseline measurements (2026-06-12, system heavily loaded, single user)**:

| Command            | Median time | Range         | Notes                                           |
| ------------------ | ----------- | ------------- | ----------------------------------------------- |
| `nikcli --version` | ~6.7s       | 3.85 – 7.18s  | Just version print; pays full import cost       |
| `nikcli --help`    | ~6.2s       | 4.93 – 11.95s | Loads all command builders; e.g. `web` not used |

**Heavy importers identified** (do not lazy-load naively without testing):

| File                             | Why it's heavy                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                   | Aggregates all command imports — root cause                                                                                                              |
| `src/cli/cmd/run.ts`             | `@clack/prompts`, SDK v2, `Server`, `Provider`, `Agent`, storage/session repos, `ShareNext`, `effect`, `zod`                                             |
| `src/cli/cmd/serve.ts`           | Top-level `server.ts` import                                                                                                                             |
| `src/cli/cmd/web.ts`             | Top-level `server.ts` import                                                                                                                             |
| `src/cli/cmd/mobile.ts`          | Top-level `server.ts` import                                                                                                                             |
| `src/server/server.ts`           | Hono/OpenAPI, provider, LSP, auth, agent, skill, all route modules, mobile, workspace, share, analytics — likely **biggest single cold-start cost**      |
| `src/cli/cmd/remote.ts`          | `@nikcli-ai/remote`, clipboard, mobile/server pieces, `../remote` barrel eagerly                                                                         |
| `src/cli/remote/index.ts` barrel | Re-exports `RemoteService`, `SessionManager`, QR renderer, notifications, subagent hooks → pulls several remote modules per import                       |
| `src/cli/ui.ts`                  | Imports `./remote` so even basic UI output transitively loads remote support                                                                             |
| `src/cli/cmd/tui/app.tsx`        | OpenTUI + Solid + many dialogs/routes + provider config + DB + brain scheduler + plugin runtime + `open` + `v8` — correctly lazy-loaded from `thread.ts` |

**Optimization plan (safe, ordered)**:

1. Convert `src/index.ts` command imports to **lazy yargs command modules** or thin command stubs — start with `serve`, `web`, `mobile`, `remote`, `run`, debug, model, GitHub, prompt-heavy commands
2. Split server commands so `Server` is imported **inside** handlers, not at top level — avoids Hono/routes for `nikcli --help`, `nikcli auth`
3. Remove remote transitive load from `src/cli/ui.ts`; dynamically import `remoteService` only inside `forwardToRemote`
4. Avoid `../remote` barrel imports in startup-sensitive files; types static, services dynamic
5. Keep `src/cli/cmd/tui/app.tsx` lazy (already is); consider splitting rarely-used dialogs/routes with dynamic imports after first render
6. Review `bin/nikcli` wrapper separately — replacing parent-directory `node_modules` scans with a direct known binary path reduces npm wrapper overhead

**Verification commands**:

```bash
hyperfine --warmup 3 'bun run --conditions=browser ./src/index.ts --help'
time bun run --conditions=browser ./src/index.ts --prompt ""
bun run --conditions=browser ./src/index.ts --help        # smoke after changes
bun run --conditions=browser ./src/index.ts --version
bun run typecheck
```

**Refactor pattern tried (2026-06-12)**: `lazyCommand` in `cli/cmd.ts` for self-contained command builders. Initial measurement showed only `--help` improvement (~6.2s → 4.0s) because `--version` doesn't load `web` anyway. System load confounded measurements — needs re-test under low load.

### Terminal / Browser Compatibility Audit (2026-06-12)

Two parallel `@explore` audits (`ses_1427c49e4…` + `ses_1427c49e7…`) identified cross-terminal/browser support gaps. Both delivered despite 10-min timeout.

**Current support**:

- **Native terminal**: `bin/nikcli` (Node shebang wrapper) → platform-specific Bun binary (`nikcli-ai-{platform}-{arch}` optional dep)
- **Browser-like access**: `nikcli web` (auto-opens browser), `nikcli remote start` (`packages/remote/` web client with `ghostty-web`, canvas, WebSocket, mobile keyboard), SDK has browser-compatible client
- **Dev/build**: `--conditions=browser` influences dep resolution, but CLI is **not actually browser-runnable** because top-level imports use `process`/`Bun`/signals/exit/fs/spawn

**Key support gaps**:

1. **No browser conditional exports** for `@nikcli-ai/sdk`, `@nikcli-ai/remote`, `nikcli-ai` — bundlers can resolve Node-only modules (e.g. `server.ts`) accidentally
2. **CLI entrypoint assumes native runtime**: `process`, `Bun`, signals, fs, child processes, `process.exit`, terminal stdio used at top level
3. **`src/cli/ui.ts` writes through `Bun.stderr` directly** — fails in non-Bun, WebContainer, browser workers
4. **Remote terminal proxies by monkey-patching `stdout.write`** + emits `data` on `process.stdin` — fragile in non-native terminals and browser-hosted shells
5. **`web.ts` always attempts `open(...)`** — inappropriate in SSH, Codespaces, containers, web IDE terminals, headless CI
6. **QR/session card output uses Unicode box drawing + ANSI color unconditionally** — degrades in limited terminals (no `NO_COLOR` / `TERM=dumb` respect)
7. **Tunnel support shells out to `npx`, `cloudflared`, `ngrok`, `ssh`** — unavailable in sandboxed/browser-like environments
8. **`packages/remote/src/server.ts` is Node-only** — serves browser assets from filesystem/package resolution; not Worker/WebContainer friendly
9. **Browser client WebSocket connects to `window.location.host` root** — no path-prefix/reverse-proxy configuration
10. **Companion launches `claude` via `child_process.spawn`** — depends on native server process, not browser-executable

**Practical improvements**:

- Add explicit conditional exports: `browser` → fetch/WebSocket/client-only; `node` → spawn/fs/server
- Split runtime adapters: `stdio`, `process`, `fs`, `spawn`, `clipboard`, `openBrowser`, `terminalCapabilities` — keep native features behind Node/Bun adapter
- Keep `@nikcli-ai/sdk/client` browser-safe; mark `@nikcli-ai/sdk/server` Node-only via conditional exports
- Add `--no-open`, `--print-url` flags to `nikcli web`; detect `CI`, missing `DISPLAY`, SSH, Codespaces/Gitpod, non-TTY before auto-opening
- Centralize terminal capability detection: `isTTY`, color, Unicode, raw-mode, columns/rows + fallbacks for dumb terminals
- Avoid unconditional ANSI/Unicode in QR/session displays; respect `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb`
- Replace stdout monkey-patching with explicit terminal stream abstraction (native PTY | stdio | WebSocket | WebContainer)
- Publish `packages/remote` with separate server/client entries: `@nikcli-ai/remote/server`, `@nikcli-ai/remote/client`, `@nikcli-ai/remote/browser`
- Allow browser terminal WebSocket path/base URL config for reverse proxies
- Document compatibility modes: native CLI, SSH/container, web IDE, browser remote, mobile browser, SDK browser client

### Analytics Dialog — Architecture Deep-Dive (2026-06-12)

Two parallel `@explore` audits (`ses_1424f5698…`, `ses_1426eaa9d…`) confirmed complete architecture of the analytics dialog system. Key files:

| File                                                                         | Purpose                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/nikcli/src/cli/cmd/tui/component/dialog-analytics.tsx` (916 lines) | **Main analytics dialog** with 6 tabs: `Overview`, `Tokens`, `Models`, `Tools`, `Projects`, `Sessions`                                                                                                                                                                               |
| `packages/nikcli/src/cli/cmd/tui/context/analytics.tsx`                      | Solid context (`useAnalytics` / `AnalyticsProvider`) that fetches persisted global/daily/session analytics + calls server (`/analytics/global`, `/analytics/daily?days=90`, `/analytics/sessions`). Exposes signals `global()`, `daily()`, `sessions()`                              |
| `packages/nikcli/src/cli/cmd/tui/util/analytics-aggregator.ts` (1262 lines)  | Pure aggregation: `AggregatedStats`, `DayStats`, `aggregateAnalytics()`, `mergeWithHistorical()`, `augmentAggregatedStatsFromPersistedSessions()`                                                                                                                                    |
| `packages/nikcli/src/analytics/analytics.ts`                                 | Backend: Zod schemas (`GlobalAnalytics`, `DailyAnalytics`, `SessionAnalytics`, `TokenBreakdown`), `recordMessage` / `recordSession` / `recordToolUse` / `recordSessionEnd` / `backfillFromExisting`, `loadPersistedAnalyticsFromDataRoot()`. 365-day retention via `retentionDate()` |
| `packages/nikcli/src/server/routes/analytics.ts`                             | Hono routes: `GET /analytics/global`, `GET /analytics/daily?days=…&from&to`, `GET /analytics/session/:id`, `GET /analytics/sessions`, `GET /analytics/leaderboard`                                                                                                                   |
| `packages/nikcli/src/cli/cmd/tui/component/chart-braille-line.tsx`           | Reusable chart primitives: `BrailleLineChart`, `BrailleAreaChart`, `StackedBarChartV2`, `HBarPrecision`, `KPICard`, `ModelCard`, `getChartColors()`                                                                                                                                  |
| `packages/nikcli/src/cli/cmd/tui/app.tsx` (~1041–1052)                       | Registration: slash command `/analytics` (aliases `stats`) → `dialog.replace(() => <DialogAnalytics onClose={() => dialog.clear()} />)`                                                                                                                                              |

**Note**: `packages/studio` does NOT exist in the repo. The TUI is entirely in `packages/nikcli/src/cli/cmd/tui/`. The `AGENTS.md` reference to "studio" is outdated.

**State flow in `DialogAnalytics` (lines 81–149)**:

1. `useSync()` — live in-memory data (`session`, `message`, `part`, `todo`, `workspaceList`, `background_job`)
2. `useSDK()` + `useAnalytics()` — historical/server data
3. On mount: `dialog.setSize("xlarge")` + `loadAnalytics()`
4. `loadAnalytics()`:
   - Waits for sync bootstrap (`waitForSyncBootstrap`)
   - Builds `liveStats = aggregateAnalytics({ session, message, part, todo, workspaceList, background_job })`
   - If `sdk.url` is set, calls `analyticsCtx.refresh()` → fetches `/analytics/global`, `/analytics/daily`, `/analytics/sessions`
   - Merges with `mergeWithHistorical(liveStats, { global, daily })` and `augmentAggregatedStatsFromPersistedSessions(stats, persistedSessions)`
   - Final `stats` is a single `AggregatedStats` object held in a `createSignal<AggregatedStats | null>(null)`
5. Derived memos: `last14Days`, `last30Days` from `stats()?.days.slice(-14/30)`
6. Arrow keys cycle tabs

**Overview tab current structure (lines 325–494)**:

- `OVERVIEW_SECTIONS = ["trend", "daily", "providers"]` as const
- Each section is a `<CollapsibleSection>` (focus/expand via `useCollapsibleGroup`; **up/down** = focus, **space/enter** = toggle)

1. **KPI row** (always visible, 348–368): four `KPICard`s — `SESSIONS`, `MESSAGES`, `COST`, `TOKENS`
2. **"trend" — Token Usage Over Time** (371–405): `BrailleLineChart` with 3 series (`Input`, `Output`, `Cache`), 30 days, width 60 × height 8
3. **"daily" — Daily Token Breakdown** (408–463): `StackedBarChartV2` per day, segments `[Input, Output, Cache, Reasoning]`, **`r` key cycles `dailyRange` between 7/14/30 days**
4. **"providers" — Top Providers** (466–491): top 5 from `props.stats.providers.values()`

**Existing `HeatmapRenderer` is in the WRONG dialog** (the OpenTUI viz tool, `dialog-opentui-viz.tsx`, lines 1153–1260) — generic 2D `rowLabels × colLabels × values` matrix with `mono`/`diverge`/`traffic` color scales. **Not** a GitHub-contribution-style 7×52 grid.

**No existing heatmap primitive** in `chart-braille-line.tsx` (only heatmap in `dialog-opentui-viz.tsx`). Zod schema for heatmap in `tool/opentui.ts:274-288`.

### Activity Heatmap Feature (in progress 2026-06-12)

User request: add a GitHub-style "Activity" section to the analytics Overview tab, matching a screenshot showing:

- 4 stats: "Longest streak 37 days", "Avg/day 4.85M", "Avg/week 33.9M", "Total 2.55B"
- A 7×52-ish heatmap (rows = day-of-week, columns = week) with month labels
- Cells colored from empty → bright (`Less` → `More` legend)

**Implementation in progress (session `ses_14257cc12…`)**:

1. **Extended `days` array to 365**: bumped fetch in `context/analytics.tsx` from `days=90` to `days=365`; bumped internal `mergeWithHistorical` limit so the merged days array has up to 365 entries
2. **Added helper functions** to `util/analytics-aggregator.ts`:
   - `longestStreak(days: DayStats[])` — longest consecutive days with `total > 0`
   - `avgPerDay(days)` — mean of daily totals
   - `avgPerWeek(days)` — mean of weekly totals (sum of 7-day windows)
   - `activityGrid(days)` — groups into a 7×N grid aligned to the start date
3. **Added `ActivityHeatmap` component** in `dialog-analytics.tsx` (before `OVERVIEW_SECTIONS`):
   - Cells: 2 chars wide × 1 line tall (GitHub-style)
   - 5-step color gradient: `backgroundElement` → `primary`
   - Day-of-week labels on left (M, W, F visible — only every other to save space)
   - Month labels on top
   - `Less ◯◯ More` legend at bottom
4. **Added `ActivityStat` KPI** subcomponent (reuses `KPICard`)
5. **Wired into `OverviewTab`**: new `Activity` section rendered before the existing `trend` section, uses `props.stats.days` directly (the full 365-day slice)

**Known issue**: `RGBA` is imported via `import type { RGBA }` but used as a value (`RGBA.fromInts`). Fix: import as value, not type-only.

**Key design decisions**:

- Reuse `props.stats.days: DayStats[]` directly — already sorted, already date-padded
- Extend API call to `days=365` (was 90) — should not break existing tabs since they slice `.slice(-30)` or `.slice(-14)`
- Theme tokens used: `primary`, `backgroundElement` — falls back to `textMuted` if `textDim` missing
- `RGBA` import comes from `@opentui/core`
- Keep `getChartColors(theme)` for consistency with other charts

### System Status (2026-06-12)

- **System load**: high during morning session (load avg 3.72 / 8.49 / 9.28); multiple long-running `nikcli` processes from user (270min, 30min) competing for resources
- **Startup perf measurements were confounded** by system load — initial "hanging" diagnosis was a system pause, not code issue
- **Process `48029`** (10:24 minutes) and **`83024`** (270:25 minutes) = user-owned long-running nikcli sessions, NOT from build agent testing — do not kill without explicit user approval
- `ps aux | grep nikcli` is the safe way to identify leftover processes before performance testing

### Open PRs against `live-main` (2026-06-12)

| PR  | Branch → live-main                             | Status                                                                   |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| #99 | `claude/session-v2-live-stepper`               | 3 failing checks (Windows smoke × 2, test (windows) exit 255), 1 pending |
| #91 | `nikcli/mobile/nikcli/yrrz85`                  | Multiple failures                                                        |
| #88 | `claude/npm-publish-error-vCzX7`               | Windows smoke + test failures                                            |
| #86 | `claude/nikcli-effect-skill-integration-X5AAM` | Windows smoke/test + nix hashes failures                                 |

Recently merged to `live-main`: #97, #96.

### Other 2026-06-12 Sessions

- `ses_1427cd423ffen4OJr8vC6Aoc4L` — Startup optimization attempts; `lazyCommand` refactor; system load confounded measurements
- `ses_1426f2234ffeFWIx0zffdgyW1l` — Initial screenshot review; user wants GitHub-style activity heatmap in analytics overview
- `ses_1424f5698ffeSZW3J0sqSFYNnW` — `@explore`: detailed analytics dialog architecture
- `ses_1426eaa9dffe1qv8aTcQidVwbm` — `@explore`: analytics/stats/usage files inventory
- `ses_14261283fffe0t4A3nSh175yCB` — `@explore`: analytics view structure + data model
- `ses_1427c4a0cffewkPu5TmoTKu5hp` — `@explore`: startup path performance audit
- `ses_1427c49e4ffeazneHN8QUaSR0Z` + `ses_1427c49e7ffeWKLyaUeLXhqZrL` — `@explore` × 2: terminal/browser compatibility audits (both delivered despite 10-min timeout)

## Brain Pass (2026-06-14)

### Four-Report Audit: Whole-Package Walkthrough

Today's session (`ses_13a97771affewPYi1kM50BEnzM`, "Greeting") launched 4 parallel `@explore` agents to produce a complete structural walkthrough of `packages/nikcli`. All 4 reports were collected to `/tmp/nikcli-reports.md` (1,797 lines / 131,825 bytes) by a follow-up `@general` agent (session `ses_13a83cc7cffeoHVFIG6udQRoXy`).

**Discovery**: session_diff files at `~/.local/share/nikcli/storage/session_diff/` are empty 2-byte stubs (`[]`). The actual transcript content lives in the **SQLite database** at `~/.local/share/nikcli/nikcli.db`, in the `message_info` and `message_part` tables. To retrieve a long report: identify the final assistant message in `message_info` for the target session, then extract the `text` JSON field from the corresponding `message_part` row (filter by `role="assistant"`, `type="text"`, max `created_at`).

**Report topics and worker sessions**:

| #   | Topic                                               | Worker session                   | Supervisor session               |
| --- | --------------------------------------------------- | -------------------------------- | -------------------------------- |
| 1   | Entry / CLI Analysis                                | `ses_13a95f4b6ffezdGtiDumljNzzc` | `ses_13a95f4b1ffeG3poIHv5p2gaZ8` |
| 2   | Core Domain (server, sessions, auth, providers, DB) | `ses_13a95d77affejCvIw0cBaHqnGP` | `ses_13a95d776ffd7xajtH4WJX41oH` |
| 3   | Tools / Agents / Plugins / Extensions               | `ses_13a95b65bffeS7oVpLtLSIaVDL` | `ses_13a95b659ffd5NahlBCw084UiC` |
| 4   | SDK & Monorepo Interop                              | `ses_13a958aadffeTQsxT3J6XvIRGP` | `ses_13a958aa7ffepUOjIFuXXX30P3` |

**Key consolidated findings**:

#### Report 1 — Entry / CLI Analysis (26 KB)

- **Package metadata**: `nikcli-ai` v1.64.0, Bun + TypeScript ESM, 12 platform target triples
- **Bin shim**: `bin/nikcli` (85 lines, Node) — locates native binary from `optionalDependencies` and re-spawns it
- **36 top-level CLI commands** grouped by: agent/run, TUI, server/daemon, auth, integrations, config, install
- **Bootstrap sequence**: `src/index.ts` (204 lines) yargs router → `src/cli/cmd/cmd.ts` command registration → unhandledRejection/SIGHUP handlers
- **Build pipeline**: `script/build.ts` (180 lines) → `Bun.build({ compile: { target, outfile }, conditions: ["browser"], define: { NIKCLI_VERSION, NIKCLI_CHANNEL, ... } })` per triple → 264 MB darwin-arm64 binary
- **Test organization**: 57 subdirs mirroring `src/` (Bun test, 1:1 layout)
- **Spec layout**: `specs/` for design docs (v2, effect, etc.)
- **Configs**: `drizzle.config.ts`, `sst-env.d.ts`, `AGENTS.md` at package root
- **Secret reference**: `VERCEL_OIDC_TOKEN` discovered in build/publish scripts

#### Report 2 — Core Domain (49 KB, largest)

- **Server layer**: Hono + Bun, 18 route prefixes, full middleware chain (onError → share → user auth → server auth → CORS → workspace context → HttpApi bridge → routes)
- **Session/message model**: `Session.Info` Zod, `MessageV2.Info`/`Part` discriminated unions, **v2 read-model strangler** pattern (v2 entries derived from v1 messages via `toEntries()`)
- **Auth separation**: 3 distinct auth layers — provider auth (LLM credentials), user auth (cloud account), mobile auth (bearer tokens for app)
- **Provider registry**: 2,043-line `provider.ts`, 25+ LLM providers, 3 resolution pathways (AI SDK direct, @nikcli-ai/llm route-based, buildState construction)
- **Database**: Drizzle ORM, 7 migrations, unified schema via `src/database/schema.ts` re-exports
- **Concurrency**: `SessionRunState` single-flight runtime, abort cascade, token/cost tracking
- **Routes table** confirms: `/global`, `/project`, `/loop`, `/mission`, `/pty`, `/config`, `/experimental`, `/session`, `/permission`, `/question`, `/provider`, `/companion`, `/user`, `/mobile`, `/`, `/connectors`, `/chatbot`, `/mcp`, `/tui`, `/analytics`

#### Report 3 — Tools / Agents / Plugins

- **Tool base contract** (`src/tool/tool.ts`): `Tool.Info`, `Tool.Def`, `Tool.Context`, `Tool.Result`, `Tool.define()` factory
- **Complete tool inventory** by category:
  - **Filesystem/editor**: `bash`, `monitor`, `read`, `write`, `edit`, `multiedit`, `apply_patch`, `glob`, `grep`, `ls`, `tree`, `invalid`
  - **Web/research**: `webfetch`, `websearch`, `codesearch`, `repo_clone`, `repo_overview`
  - **Delegation/multi-agent**: `task`, `delegation`, `delegator`, `advisor`
  - **Todo/goal/session**: `todowrite`, `todoread`, `create_goal`/`get_goal`/`update_goal`
  - **Context/memory**: `context_collect`, `context_related`, `context_diagnostics`, `context_search`, `memory_search`
  - **Skills/questions/batch**: `skill`, `question`, `batch`, `exec_code`, `search_tools`, `lsp`
  - **Plan mode**: `plan_enter`, `plan_exit`
  - **Voice/media**: `speak` (ElevenLabs + OpenRouter TTS), `voice` (Whisper STT)
- **Agent system**: Built-in agents in `Agent.buildState`, invocation by name via `task` tool or `--agent` flag
- **Permission model**: `PermissionNext` rule engine + `assertExternalDirectory` for cross-worktree access
- **Plugin loader**: scans `plugins/` directories, supports hooks for tool/auth/event/chat
- **Custom slash commands**: Markdown templates in commands/ directory
- **MCP integration**: 3 transports, OAuth 2.0 with dynamic client registration
- **Skill system**: Markdown skill files with auto-discovery
- **Prompt assembly**: system prompt layers + project context (AGENTS.md, CLAUDE.md, .nikcli/instructions)
- **UI pointer**: TUI in `src/cli/cmd/tui/`, mobile in `packages/mobile/`

#### Report 4 — SDK & Monorepo Interop (27 KB)

- **JavaScript SDK build** (`packages/sdk/js/script/build.ts`): 3-stage pipeline
  1. Spec gen: `bun dev --print-logs generate` → `openapi.json` (26,148 lines)
  2. Codegen: `@hey-api/openapi-ts` v0.90.4 → `types.gen.ts` (9,914 lines) + `sdk.gen.ts` + `client.gen.ts`
  3. Post-process: `prettier --write`, `tsc` compile, cleanup
- **SDK public API** (`@nikcli-ai/sdk` v1.64.0): 8 subpath exports (`.`, `./client`, `./server`, `./crypto`, `./cloud`, `./v2`, `./v2/client`, `./v2/server`)
- **NikcliClient resources** (29 lazy `get`-ters): `global`, `project`, `loop`, `mission`, `pty`, `config`, `tool`, `worktree`, `experimental`, `managedWorktree`, `session`, `part`, `permission`, `question`, `provider`, `mobile`, `find`, `file`, `connectors`, `mcp`, `tui`, `analytics`, `instance`, `path`, `vcs`, `command`, `app`, `lsp`, `formatter`, `auth`, `event`
- **Self-consuming OpenAPI pattern**: nikcli runtime has NO direct HTTP calls to its own server — all communication via the regenerated `@nikcli-ai/sdk/v2`
- **~20 import sites** in `packages/nikcli/src` for the SDK
- **Python SDK**: **Not present** (no `pyproject.toml` / `setup.py` in `packages/sdk/`)
- **Sibling packages**:
  - `@nikcli-ai/companion` — Standalone Bun WebSocket bridge (port 3456) that spawns `claude` CLI as child process; React SPA frontend; deployable to Cloudflare Workers. **Unused by nikcli proper** — nikcli ships its own embedded `CompanionRoutes()` mounted at `/companion`
  - `@nikcli-ai/remote` — Remote terminal with ghostty-web, QR code, tunnels (localtunnel, cloudflared, ngrok)
  - `@nikcli-ai/desktop` — Tauri v2 desktop app (16 languages), spawns nikcli CLI as Tauri sidecar
  - `@nikcli-ai/plugin` — Plugin system core (11 built-in plugins)
- **Negative findings**:
  - No Python SDK
  - No telemetry/queue system
  - No `packages/studio` (AGENTS.md reference is outdated)
  - No direct `ghostty-web` reference in TUI (renderer is OpenTUI based)
- **External integrations** touched at runtime:
  - Vercel AI SDK adapters (16+ providers)
  - Effect 4.0.0-beta.65 (dependency injection, services)
  - Persistence: Drizzle, bun:sqlite, Cloudflare D1
  - MCP/agent SDKs: `@modelcontextprotocol/sdk` 1.25.2, `@agentclientprotocol/sdk` 0.5.1
  - Chat platform adapters: Discord, Slack, GitHub, Linear, Teams, GChat (via `@chat-adapter/*`)
  - TUI: `@opentui/solid`, SolidJS 1.9.10
  - VCS: git CLI + `simple-git`
  - Cloud: Cloudflare Workers, SST 3.17.38
  - Auth: `ssh2` 1.17.0, `bonjour-service` (mDNS)

### Babysit PR Session (2026-06-14)

Session `ses_13a60f998ffee72O9edy8uxUq4` ran a `/goal` command to check CI status on the current PR. After investigating, found that:

- Current branch is `live-main` (clean working tree)
- No open PR for the current branch (all `live-main` PRs are merged)
- Most recent open PR is #102 (opened 2 hours before "today")
- "Current PR" is ambiguous — the agent asked the user to clarify

### Updated Open PRs (2026-06-14)

| PR   | Branch → live-main                             | Status                                                                   |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| #102 | (newest)                                       | Status unknown                                                           |
| #99  | `claude/session-v2-live-stepper`               | 3 failing checks (Windows smoke × 2, test (windows) exit 255), 1 pending |
| #91  | `nikcli/mobile/nikcli/yrrz85`                  | Multiple failures                                                        |
| #88  | `claude/npm-publish-error-vCzX7`               | Windows smoke + test failures                                            |
| #86  | `claude/nikcli-effect-skill-integration-X5AAM` | Windows smoke/test + nix hashes failures                                 |

Recently merged to `live-main`: #97, #96.

### Key Architectural Insights from 2026-06-14 Audit

1. **Single-file distribution**: nikcli ships as a 264 MB native binary per platform triple (12 targets total), using `Bun.build({ compile: ... })`. The `bin/nikcli` shim is 85 lines of Node code that re-spawns the native binary.

2. **Self-consuming OpenAPI**: The server contract (Hono routes with `hono-openapi` Zod schemas) is the single source of truth. The SDK is auto-generated from the OpenAPI spec and is the **only** way the CLI/TUI talks to its own server. No file in `packages/nikcli/src` directly implements HTTP calls to its own server.

3. **v1/v2 session coexistence**: Production path is v1 (`MessageV2`/`Session`), v2 is a parallel event-log/reducer (`Stepper.reduce`) with read-side shim (`toEntries()`) that has not yet replaced v1 in the main code path.

4. **Three auth layers** (distinct, not merged):
   - Provider auth — LLM credentials (API keys, OAuth tokens)
   - User auth — Cloud account via `Authorization: Bearer nku_*`
   - Mobile auth — Bearer tokens for mobile app access

5. **Effect as backbone**: `Effect 4.0.0-beta.65` is the DI/service runtime. All storage/config/provider operations return `Effect<A, E>` values. `withCurrentInstance()` provides instance context within Effect fibers.

6. **TUI worker process isolation**: The TUI runs in a separate Bun Worker process so that `SIGUSR2` hot-reload can restart the server without killing the TUI renderer. Three connection modes: direct RPC (default), HTTP server (`--port`/`--hostname`), attach mode (`nikcli attach <url>`).

7. **Database centralization in progress**: Domain modules (`db/users.ts`, `account/db.ts`, `workspace/db.ts`, `mobile/auth.ts`) re-export their tables via `Database.db` but have not been fully migrated. Target: single `nikcli.db` file with `DatabaseMigration` runner.

8. **companion package is dead code** (from nikcli's perspective): The standalone `@nikcli-ai/companion` package is for driving raw Claude Code sessions, not nikcli TUI. Nikcli has its own much smaller companion UI embedded as `CompanionRoutes()`.

9. **Terminal/browser compat gaps**: CLI is not actually browser-runnable (top-level imports use `process`/`Bun`/signals/exit/fs/spawn). No conditional exports for `browser` vs `node` in SDK. Needs runtime adapter layer for true cross-environment support.

10. **OpenCode reference patterns studied**: The OpenCode project (`anomalyco/opencode` `dev` branch) uses similar Effect-based DB service pattern with `EffectDrizzleSqlite` + custom `sqlite.bun.ts` `SqliteClient`. Nikcli adopts the same pattern but with hand-rolled SQLite adapter.

## Brain Pass (2026-06-15)

### Four Parallel Deep-Dives: Tool, Agent, Server/Storage/SDK, TUI Debugging

Today's main session `ses_1337a40a8ffeQ50QP331G9bLvg` (and the parallel analysis `ses_1339d8a9cffem7Eh39qYb0ANd1`) launched 3-4 parallel `@explore` agents for exhaustive read-only audits of the major subsystems. The intent was a follow-up to the 2026-06-14 four-report walkthrough with deeper, more focused investigation per area.

**Worker sessions**:

| #   | Topic                                          | Worker session                   |
| --- | ---------------------------------------------- | -------------------------------- |
| 1   | Tool System (define, registry, execution flow) | `ses_1339cdbefffe4k0w6P0B2MpM4q` |
| 2   | Agent System (subagents, task, dispatch)       | `ses_1339c7decffe3gfDhIYpCua1uv` |
| 3   | Server + Storage + SDK (Hono, Bus, SDK build)  | `ses_1339c4b74ffdw0oiWXRG5thzk4` |
| 4   | TUI debugging (opentui tool schema bug)        | `ses_1337a40a8ffeQ50QP331G9bLvg` |

**Supervisor finalization notes**: All 4 reports delivered via `Action: finalize` despite 10-minute timeouts. Two follow-up `@explore` agents (`ses_13388ac0effeBmfkr3XBE558pu`, `ses_133842e8affeekNHppG0oX6LId`) retrieved truncated tail sections of the Agent and Server reports from disk artifacts at `~/.local/share/nikcli/tool-output/tool_ecc7*`.

### Real-Time Codebase Numbers (as of 2026-06-15)

Confirmed via direct file count + line count:

```
44 tools  ·  19 agents  ·  260 endpoints  ·  99 unique paths
66 bus events  ·  21 route files
```

**Note on count correction**: The 2026-06-14 audit reported "319 endpoints / 99 paths" — the more recent 2026-06-15 report says **260 unique operations across 99 unique paths**. The discrepancy is unverified but the 2026-06-15 measurement is more recent and explicitly cites `openapi.json` (811 KB).

### Tool System — Deep-Dive Findings (2026-06-15)

**File tree `src/tool/`** (consolidated, one-line per file):

```
src/tool/
├── tool.ts                # Tool namespace: define()/Info/Def/Context types, Effect→Promise wrapper, validation + truncation
├── registry.ts            # ToolRegistry Effect service: list/resolve/init tools, plugin/folder discovery, model-gated filtering
├── external-directory.ts  # assertExternalDirectory(ctx, target) — gates paths outside Instance.worktree behind a permission ask
├── truncation.ts          # Truncate service: head/tail truncate >MAX_LINES(2000)/MAX_BYTES(50KB), spills to disk; 7-day retention
├── truncation-dir.ts      # DIR + GLOB constants + outputPath() for truncated tool output files
├── invalid.ts             # "invalid" sink tool — emitted when AI SDK repairToolCall fails
│
├── bash.ts                # bash: shell-spawn (Bun.spawn via spawn()), tree-sitter parse for permission signals, timeout/abort
├── monitor.ts             # monitor: persistent background-job runner (long-running typecheck/builds/tests/dev servers)
├── edit.ts                # edit: string→string file replace with diff + 3-replacer fallback (exact/line-trimmed/levenshtein)
├── write.ts               # write: full file overwrite, runs LSP diagnostics post-write
├── multiedit.ts           # multiedit: sequential edit() calls in one tool_use
├── apply_patch.ts         # apply_patch: Anthropic-style `*** Begin Patch`; only enabled for non-OSS gpt-* models
├── read.ts                # read: file/dir read, line-numbered output, image/PDF base64 attach, binary detection
├── ls.ts                  # list: directory listing w/ ignore globs (exports IGNORE_PATTERNS)
├── tree.ts                # tree: hierarchical tree output with size/depth/hide controls
├── glob.ts                # glob: bun.Glob pattern matching
├── grep.ts                # grep: FFF/SearchBackend regex search with hit formatting
│
├── webfetch.ts            # HTTP fetch + Turndown HTML→Markdown; 5MB cap, 30s/120s timeout
├── websearch.ts           # Exa MCP wrapper (web_search_exa); gated on nikcli provider or NIKCLI_ENABLE_EXA
├── codesearch.ts          # Exa MCP get_code_context_exa; same gating as websearch
├── mcp-exa.ts             # callTool(): raw JSON-RPC client to https://mcp.exa.ai/mcp
│
├── task.ts                # delegates to subagents (foreground/background), Semaphore(5), Delegation manager
├── delegation.ts          # list/read/cancel/count running subagent jobs in current session
├── delegator.ts           # status/progress/summarize for a delegation id
├── advisor.ts             # fire-and-forget strategic guidance via separate "advisor" model
│
├── context_collect.ts     # collect file contents + LSP symbols/diagnostics
├── context_related.ts     # parse imports, resolve related files
├── context_diagnostics.ts # LSP errors across the project
├── memory_search.ts       # full-text + recency search across past session messages
├── generate_image.ts      # experimental_generateImage (gpt-5-image, nano-banana)
│
├── batch.ts               # parallel multi-tool dispatcher (max 25 calls); plan-mode read-only enforcement
├── exec_code.ts           # in-sandbox JS/TS execution with auto-bridged tool globals
│
├── skill.ts               # discover + load named skills, mutate session.skills[]
├── plan.ts                # plan_enter / plan_exit: switch primary agent between build and plan
├── question.ts            # in-stream multi-choice Q&A (gated to non-CLI clients)
├── lsp.ts                 # goToDefinition/findReferences/hover/… LSP operations (experimental flag)
│
├── repo_clone.ts          # clone or update a github/ssh/local repo
├── repo_overview.ts       # top-level entries + sample files of a repo
├── search_tools.ts        # substring-search the registered tool id list
│
├── speak.ts               # TTS via openrouter / elevenlabs providers
├── voice.ts               # STT transcription via openrouter
├── opentui.ts             # render OpenTUI/JSX components (text, chart, table, panel, ...)
│
├── speak/                 # speak provider registry (elevenlabs, openrouter)
└── *.txt                  # tool description strings; loaded via `import DESCRIPTION from "./<name>.txt"`
```

**`Tool.define()` signature** (`src/tool/tool.ts:9-179`):

```ts
export namespace Tool {
  export function define<Parameters extends z.ZodType, M extends Metadata>(
    id: string,
    init:
      | ((ctx?: InitContext) => Promise<AuthoredDef<Parameters, M>>) // factory form
      | AuthoredDef<Parameters, M>, // literal form
  ): Info<Parameters, M>
}
```

Type hierarchy:

| Type               | File:line    | What it is                                                                                       |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------------ |
| `Tool.Info`        | `tool.ts:81` | Registry entry: `{ id: string; init(ctx?) => Promise<Def> }`                                     |
| `Tool.AuthoredDef` | `tool.ts:74` | Tool author body: `{ description, parameters, execute, formatValidationError? }`                 |
| `Tool.Def`         | `tool.ts:51` | Wrapped (Effect-native): `{ description, parameters, execute → Effect, executeAsync → Promise }` |
| `Tool.Context`     | `tool.ts:28` | `{ sessionID, messageID, agent, abort: AbortSignal, callID?, extra?, messages?, metadata, ask }` |
| `Tool.Result`      | `tool.ts:40` | `{ title, metadata, output, attachments? }`                                                      |
| `Tool.InitContext` | `tool.ts:24` | `{ agent?: Agent.Info }`                                                                         |

**Tool registry initialization flow** (`src/tool/registry.ts`):

- `ToolRegistry.Service` is an Effect `Service` (`@nikcli/ToolRegistry`) backed by `InstanceState`
- `all()` (lines 223-271) hardcodes the order: `InvalidTool, ...{conditionals}`
- `all()` returns the **complete built-in tool list** — MCP tools merged in at `tools.ts:203-208` via `MCP.Service.tools()`
- **Model-gated filtering** (`registry.ts:300-303`):
  - `apply_patch` vs `edit`/`write` decided per-model: GPT (except `oss` and `gpt-4`) get `apply_patch`; others get `edit`/`write`
  - `codesearch` and `websearch` only enabled for `nikcli` provider or when `Flag.NIKCLI_ENABLE_EXA` is true
  - `slim` mode: only `["bash", "read", "glob", "grep", "tree", "edit", "write", "task", "search_tools"]` (line 279)
- Plugin tool discovery + custom tools from `{tool,tools}/*.{js,ts}` in config dirs

### Agent System — Deep-Dive Findings (2026-06-15)

**File**: `src/agent/agent.ts` (now 1026 lines — was 919 in 2026-06-08, +107 lines)

**Key facts** (newly confirmed or expanded):

- **No `Agent.define()`** — unlike `Tool.define()`, there is no factory function. Built-in agents are plain object literals in `buildState()` (lines 157-883). Closest "runtime registration" is `ToolRegistry.register` for tools, not agents.
- **Dual prompt system**: inline strings for most agents (`ralph`, `build`, `plan`, `general`, `planner`, `debugger`, `refactor`, `support`, `test-runner`, `code-reviewer`, `fast-explore`, `researcher`); external `prompt/*.txt` files for content-heavy ones (`compaction`, `explore`, `scout`, `summary`, `title`, `delegation`, `delegator`, `ultrareview-reviewer`). No "prompt.md" convention.
- **Agent config layering** (precedence low→high): defaults → `cfg.default_agent` → `--agent` CLI flag → per-agent `cfg.agent.<name>` overrides
- **`SUBAGENT_TOOLSETS`** (lines 98-139) is documentation only — tests assert against it (`test/agent/schema.test.ts:25-43`) but runtime tool gating comes from each agent's `permission` array and `ToolRegistry.tools()` (line 281). The two are not always in sync (e.g., `scout` and `general`).

**Primary agents** (3 visible + 3 hidden):

| Agent        | Mode    | Hidden | Notes                                                                                   |
| ------------ | ------- | ------ | --------------------------------------------------------------------------------------- |
| `ralph`      | primary | no     | Autonomous loop, full permissions, allows `question`                                    |
| `build`      | primary | no     | All tools, allows `plan_enter`, `question`. Inline prompt with `MONITOR_TOOL_AWARENESS` |
| `plan`       | primary | no     | Edit denied except `.nikcli/plans/*.md` + `Global.Path.data/plans/`. Allows `plan_exit` |
| `compaction` | primary | yes    | `compaction.txt`. `*`: deny                                                             |
| `title`      | primary | yes    | `title.txt`. temperature 0.5. `*`: deny                                                 |
| `summary`    | primary | yes    | `summary.txt`. `*`: deny                                                                |

**`task` tool quirks** (10.1–10.15 from the Agent report, preserved verbatim):

1. **No `Agent.define()`** (confirmed again at 2026-06-15).
2. **`SUBAGENT_TOOLSETS` is documentation only**.
3. **Nested delegation limits**: `task` filters out `mode: "primary"` at line 1128 → `ralph`/`build`/`plan`/`compaction`/`title`/`summary` can't be invoked via `task`. `delegator` has `task: "allow"` in permission but its `prompt` sets `task: false` (line 745) — the LLM never sees the `task` tool; follow-up spawning is done by the dispatcher in `launchBackgroundSubtask` (lines 762-815), not by the delegator LLM. `researcher` can only delegate to `fast-explore` and `planner`; recursively to `researcher` is denied (line 432-437).
4. **All subagent sessions** get `todowrite` and `todoread: deny` from `buildSubtaskPermission` (line 380-389).
5. **Concurrency bound**: `Semaphore(5)` (`MAX_CONCURRENT_BACKGROUND_AGENTS = 5`, line 26). 6th simultaneous `task` waits.
6. **Model inheritance**: subagents don't have their own `model`; inherit parent via `task.ts:973` (`agent.model ?? msg.info.modelID/providerID`). `cfg.agent.<name>.model` overrides. `compaction` and `title` agents have implicit special handling (`compaction.ts:236-238`, `prompt.ts:2286-2293` for title's `providerGetSmallModel`).
7. **Default primary agent**: `Agent.defaultAgent()` (line 925-942) picks `cfg.default_agent` if set, visible, not subagent. Otherwise the first non-subagent, non-hidden agent, with `build` sorted to the top (line 917: `sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"])`).
8. **Researcher dedup**: a 2nd `researcher` task while one is running for the same parent returns the first's metadata with `reused: true` (line 910-935).
9. **`task.txt` description replacement**: the `{agents}` placeholder in `src/tool/task.txt:3` is dynamically replaced at tool init (line 1135-1140), filtered by caller's permissions.
10. **`bypassAgentCheck` is a security boundary** (comment at `task.ts:881-883`): only set by internal system code, never derived from user-controllable data. Set in `session/prompt.ts:810` when a `task` tool call comes from a model's tool-use part (model-subtask).
11. **Background default + foreground path exists**: `background` defaults to `true` (line 39). Foreground path (`background: false`) at lines 1040-1124 still implemented, blocks until subagent finishes, subscribes to `MessageV2.Event.PartUpdated` for live tool UI.
12. **Wake-up via synthetic user message**: `wakeParentSession` (line 575-626) directly calls `SessionPrompt.prompt()` on parent (line 610-615). The `delegation` tool's `read` action is for getting the full artifact _before_ the wake arrives.
13. **Timeouts per source**: `Delegation.TIMEOUTS` (line 118-128) — `research` 20 min, `advisor` 5 min, `delegator`/`delegator-followup` 10 min, `model-subtask` 10 min, others 15 min. Heartbeat refreshes lease every `LEASE_TIMEOUT_MS / 3` (line 358).
14. **MCP tools also registered**: beyond `ToolRegistry.all()`, MCP tools merged in at `tools.ts:203-208` via `MCP.Service.tools()`.
15. **`Tool.Context` is per-call**: built fresh by `context(args, options)` factory in `tools.ts:106-138` with the current `sessionID`, `messageID`, `callID`, `agent`, `model`, `bypassAgentCheck`, `metadata()`, `ask()`.

**Defaults** (`src/agent/agent.ts:157-175`):

```ts
const defaults = PermissionNext.fromConfig({
  "*": "allow",
  doom_loop: "ask",
  external_directory: { "*": "ask", [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
  question: "deny",
  plan_enter: "deny",
  plan_exit: "deny",
  read: { "*": "allow", "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" },
})
```

### Server + Storage + SDK — Confirmed Architecture (2026-06-15)

**Server** (`packages/nikcli/src/server/server.ts`, 1192 lines):

- **HTTP framework**: Hono with `websocket`, `cors`, `basicAuth`, `streamSSE`, `hono/proxy`, `hono-openapi` (`describeRoute`, `generateSpecs`, `validator`, `resolver`, `openAPIRouteHandler`)
- **Runtime**: Bun. `Bun.serve({ hostname, port, idleTimeout: 0, fetch: App().fetch, websocket })` (`server.ts:1137-1149`)
- **Default port**: `4096` (`server.ts:177` `new URL("http://localhost:4096")`). When `opts.port === 0` tries 4096 first, then 0.
- **App construction** wrapped in `lazy()` (`server.ts:181`) — breaks import cycle with route files.
- **CORS** (`server.ts:355-402`): loopback + `http://*.local` + Tauri/Capacitor/Expo schemes + `https://*.ts.net` (Tailscale) + `https://*.nikcli.store` + `NIKCLI_SERVER_CORS_ORIGINS` env + opts
- **Auth chain** (`server.ts:285-337`):
  - Public bypass: `/user/login`, `/user/register`, `/user/status`, `GET /global/health`, OPTIONS
  - **Bearer + query-token** (mobile): `MobileAuth.bearer(c.req.raw) || c.req.query("token")` (`server.ts:303`)
  - **Tailscale**: only trusted if bound to loopback; honors `Tailscale-User-Login` header + `NIKCLI_SERVER_TAILSCALE_USERS` csv
  - **Basic auth**: `basicAuth({ username, password })` where `password = Flag.NIKCLI_SERVER_PASSWORD`
- **Request logging** middleware: `log.info("request", ...)` + `log.time("request", ...)` for every path except `/log` (`server.ts:338-354`)
- **Instance/workspace context** middleware (`server.ts:404-444`): resolves `directory` from `?directory` → `x-nikcli-directory` header → `process.cwd()`; resolves `workspace` similarly; if workspace is `remote`, **proxies the request** via `ServerProxy.http()` / `ServerProxy.websocket()` (`server.ts:428-432`); otherwise `WorkspaceContext.provide({ ...})` + `withInstanceAsync({ directory, init: InstanceBootstrap }, ...)`
- **HTTP API bridge** (experimental, opt-in via `Flag.NIKCLI_EXPERIMENTAL_HTTPAPI`): `server.ts:467-472` forwards through `HttpApiBridge.handle()`. Effect-schema alternative backend in `server/httpapi/`.
- **OpenAPI**: GET `/doc` returns generated `openapi.json` (lines 445-457 + `openapi()` line 1107-1120)
- **Wildcard fallback**: `app.all("/*", ...)` proxies unmatched paths to `https://app.nikcli.store{path}` with relaxed CSP (line 1089-1103)
- **mDNS**: `MDNS.publish(server.port!)` when `opts.mdns === true` and not loopback (`server.ts:1155-1165`); unpublish hooked into wrapped `server.stop` (`server.ts:1182-1187`)

**Storage layer** (`packages/nikcli/src/storage/storage.ts`, 444 lines):

- **Hybrid backend**: filesystem JSON (legacy, still in use) + **central SQLite via Drizzle ORM (Bun driver)** — confirmed for sessions (`Database.syncDb`)
- **Storage namespace** operations: `read`, `write`, `update`, `remove`, `list`
- **Key format**: `["collection", "id1", "id2"]` → `storage/collection/id1/id2.json`
- **Read-through cache**: 5s TTL (`DEFAULT_TTL_MS = 5000`); `Cache.get()` returns undefined on miss/expired, auto-deletes; `Cache.set()` with optional TTL; `invalidate(key)` / `invalidatePrefix(prefix)`
- **Write-through**: all write/update calls `Cache.set()` after file write
- **`update()` uses `structuredClone`** for draft copy (handles circular refs, BigInt, Date, Typed arrays)
- **Two lock types**: `Lock` (in-memory reader-writer, single-process), `Flock` (file-based distributed with lease, for cross-process)
- **`Storage.NotFoundError`**: thrown via `withErrorHandling` on ENOENT; other errors propagate as-is
- **Migrations**: tracked in `<data>/storage/migration` marker file (JSON migrations 0 and 1); DB migrations in `migration/` (timestamped subdirs, applied via `DatabaseMigration`)

**Project + Config**:

- `Project.Info` includes git root SHA, worktree, time created/updated, icon
- `projectID` derived from git root SHA (for repos) or directory hash
- `Config.Info` massive Zod schema; 1847 lines; precedence (lowest→highest): remote → global user → `NIKCLI_CONFIG` env → project `nikcli.json` → `NIKCLI_CONFIG_CONTENT` env → config directories (`agent/`, `command/`, `plugin/`) → CLI flags
- Supports JSONC + variable substitution (`{env:VAR}`, `{file:path}`)
- `mergeDeep` from `remeda` for array concatenation on `plugin`/`instructions` fields

**SDK** (`packages/sdk/js/`) — confirmed structure:

- **Build pipeline** (`script/build.ts`): 3-stage:
  1. Spec gen: `bun dev --print-logs generate` → `openapi.json` (26,148 lines)
  2. Codegen: `@hey-api/openapi-ts` v0.90.4 → `types.gen.ts` (9,914 lines) + `sdk.gen.ts` + `client.gen.ts`
  3. Post-process: `prettier --write`, `tsc` compile, cleanup
- **Public API** (`@nikcli-ai/sdk` v1.64.0): 8 subpath exports — `.`, `./client`, `./server`, `./crypto`, `./cloud`, `./v2`, `./v2/client`, `./v2/server`
- **29 lazy `get`-ters** on `NikcliClient`: `global, project, loop, mission, pty, config, tool, worktree, experimental, managedWorktree, session, part, permission, question, provider, mobile, find, file, connectors, mcp, tui, analytics, instance, path, vcs, command, app, lsp, formatter, auth, event`
- **Self-consuming pattern**: nikcli runtime has NO direct HTTP calls to its own server — all via regenerated `@nikcli-ai/sdk/v2`
- **~20 import sites** in `packages/nikcli/src` for the SDK
- **Python SDK**: not present
- **`x-nikcli-directory` header** set automatically by SDK client from `directory` option (`packages/sdk/js/src/v2/client.ts:21-27`)

**Event bus / pubsub**:

- **Two layers**: per-instance `Bus` (typed callbacks, wildcard `*`, local-only) + process-wide `GlobalBus` (Node EventEmitter, cross-instance forwarding)
- **40+ event types** catalogued (no explicit backpressure; `await Promise.all` on local subscribers)
- **Transport**: SSE (`/event` for per-instance, `/global/event` for cross-instance) + WebSocket for PTY + workspace proxying
- **30s heartbeat** on both SSE endpoints
- **No polling** — TUI uses SSE exclusively

**CLI entrypoint** (`packages/nikcli/src/index.ts`, 199 lines):

- Built on `yargs/hideBin`. Middleware: `await initialize()` (resolves `Global.Path` and friends), `Log.init(...)` with `--print-logs` and `--log-level`, then sets `process.env.AGENT = "1"` and `process.env.NIKCLI = "1"` (`index.ts:85-105`)
- **Process guards**: `unhandledRejection`/`uncaughtException` → `Log.Default`; `SIGHUP` → `process.exit()` (`index.ts:51-66`)
- **Registered yargs commands** (`index.ts:108-145`): `acp, mcp, ads, tui.thread, attach, run, goal, generate, debug, auth, account, agent, upgrade, quickstart, doctor, uninstall, serve, workspaceServe, web, heap, models, locale, stats, export, import, github, pr, session, imageModel, speakModel, brainModel, remote, companion, mobile, routine, mission, usage, plugin`
- **Fail handler** (`index.ts:146-157`): renders help on `Unknown argument`/`Not enough non-option arguments`/`Invalid values`; otherwise re-throws and exits 1
- **Final `try/finally`** (`index.ts:160-198`): `process.exit()` in the `finally` so docker-container-based MCP servers that don't honor SIGTERM don't leave orphans

**`serve` command** (`packages/nikcli/src/cli/cmd/serve.ts`, 55 lines):

- Resolves network options via `resolveNetworkOptions` (from `cli/network.ts`)
- Warns if `NIKCLI_SERVER_PASSWORD` unset + Tailscale auth inactive
- Calls `Server.listen(opts)` → `Bun.serve(...)`
- For local installs, kicks off `Workspace.startSyncing(project)` for every project
- `await new Promise(() => {})` keeps the process alive

**Bootstrap (in-process startup)** (`project/bootstrap.ts`, 187 lines):

- Runs once per directory when `Instance.provide` creates the context
- Awaits `Plugin.init()` + `LSP.init()`
- Fire-and-forget inits: `ShareNext, Format, FileWatcher, File, Vcs, Snapshot, Truncate, Todo`, the v2 projector (`SessionV2.init()`), `Delegation.init()`, `Monitor.reconcile()`, `LoopEngine.restore()`, `MissionOrchestrator.restore()`
- Subscribes to `Command.Event.Executed` to call `Project.setInitialized` on default `init` command

**Multi-tenant model** (per-directory, not per-user):

- `Instance` cache (`project/instance.ts:22`) deduplicates per-directory
- Every HTTP request scopes services to `directory`/`workspace`
- **Workspace proxying**: if `workspace === "remote"`, the server proxies the request (`ServerProxy.http/websocket`)

**Server startup + event flow** (ASCII diagram):

```
                                  ┌─────────────────────────────────────────────┐
                                  │ packages/nikcli/src/index.ts (yargs CLI)    │
                                  │   middleware: initialize() + Log.init()    │
                                  └──────────────────────┬──────────────────────┘
                                                         │
                ┌────────────────────┬───────────────────┼────────────┬─────────────────────┐
                ▼                    ▼                   ▼            ▼                     ▼
       run/goal/generate/...     serve (headless)    attach       tui/thread          acp/web/...
       (in-process)             (HTTP server)       (HTTP client) (worker)            (in-process)
                │                    │ Server.listen    │            │                     │
                │                    ▼                  │            │                     │
                │         ┌───────────────────────┐      │            │                     │
                │         │ Bun.serve({           │      │            │                     │
                │         │   fetch: App().fetch, │      │            │                     │
                │         │   websocket,          │      │            │                     │
                │         │   idleTimeout: 0 })   │      │            │                     │
                │         └──────────┬────────────┘      │            │                     │
                │                    │                  │            │                     │
                │                    ▼                  │            │                     │
                │         ┌───────────────────────┐      │            │                     │
                │         │ Hono app (lazy-built) │      │            │                     │
                │         │   onError, public auth│      │            │                     │
                │         │   userAuth, req log   │      │            │                     │
                │         │   CORS, workspace+inst│      │            │                     │
                │         │   httpapi bridge      │      │            │                     │
                │         │   260 endpoints (.route, .all proxy)
                │         └──────────┬────────────┘      │            │                     │
                │                    │ per request:     │            │                     │
                │                    │   WorkspaceContext           │                     │
                │                    │   Instance.provide({       │                     │
                │                    │       directory, init:       │                     │
                │                    │       InstanceBootstrap})    │                     │
                │                    │   withCurrentInstance(eff)  │                     │
                │                    │                  │            │                     │
                │                    ▼                  │            │                     │
                │   ┌────────────────────────────────────────┐       │                     │
                │   │ Bus.publish(def, properties)            │       │                     │
                │   │   - subs[type] + subs['*']              │       │                     │
                │   │   - emits to GlobalBus                  │       │                     │
                │   └────────┬───────────────────┬───────────┘       │                     │
                │            │                   │                   │                     │
                │   ┌────────▼─────────┐ ┌───────▼──────────┐        │                     │
                │   │ per-instance SSE │ │ GlobalBus        │        │                     │
                │   │  GET /event      │ │  GET /global/    │        │                     │
                │   │  Bus.subscribeAll│ │   event          │        │                     │
                │   │  30s heartbeat   │ │  30s heartbeat   │        │                     │
                │   └────────┬─────────┘ └───────┬──────────┘        │                     │
                │            │                   │                   │                     │
                └────────────┼───────────────────┼───────────────────┼─────────────────────┘
                             │                   │                   │
                             ▼                   ▼                   ▼
                     SDK client:        SDK client:           SDK client:
                     client.event       client.event          client.event
                     .subscribe()       .subscribe()          .subscribe()
                     (SSE per-inst)     (SSE cross-inst)     (SSE per-inst)
```

### Opentui Tool Bug — Detailed Reproduction (2026-06-15)

The `opentui` tool bug investigation (`ses_1337a40a8ffeQ50QP331G9bLvg`) confirmed the previously-suspected schema validation issue with a specific reproducible error pattern. **Plain `text` components work**; **components with array fields (`items`, `nodes`, `headers`, `rows`) consistently fail**.

**What works** (confirmed at 2026-06-15):

```json
{ "type": "text", "title": "hello", "content": "world" }
```

Passes validation, renders correctly.

**What fails** (confirmed at 2026-06-15):

```json
{ "type": "stat_grid", "title": "X", "columns": 3, "items": [{ "label": "A", "value": 1 }] }
```

Error pattern: `code: "invalid_type", path: ["items"], message: "Invalid input: expected array, received object"` — even though the input is a valid 1-element array.

Same error pattern repeats for:

- `stat_grid.items` — "expected array, received object"
- `key_value.items` — same
- `tree.nodes` — same (even with 2 elements)
- `table.headers` + `table.rows` — same
- `bar_chart.items` — same
- `status_grid.items` — same
- `progress_bars.items` — same
- `gauge` (no array but): `value` and `max` reported as "received string" when passed as numbers; suggests the JSON encoding step is treating numbers as strings

**Diagnosis so far**: The error messages are consistent regardless of array length (1, 2, 3 elements all fail identically). The discriminator (`type`) check appears to work correctly — the `type` value is accepted, but the array fields underneath are being misinterpreted as objects. The bug appears to be in the **input transformation/coercion step** between the LLM's JSON output and the Zod validator, not in the Zod schema itself.

**Attempted workarounds** (all failed in 2026-06-15):

- Wrapping in `{"item": {...}}` — unrecognized key
- Passing values as strings instead of numbers — still rejected
- Using a single primitive component (`alert`, `text`) — works (so the issue is specifically with collection-of-component types)
- Using `progress_bars` with single item — same "received object" error

**Confirmed working components** (2026-06-15):

- `text` ✅
- `alert` ✅
- `markdown` (not tested directly but no collection fields)
- `code` (not tested directly)
- `key_value` (with `key`, `value` flat object) ✅ (the `items` array still fails)

**Renderer/parser files to investigate for the fix**:

- `src/cli/cmd/tui/component/dialog-opentui-viz.tsx` (1856 lines, the dialog renderer)
- `src/tool/opentui.ts:422-434` (the Effect Schema)
- `src/tool/opentui.ts:438` (`zod(Parameters)` call)
- `src/util/effect-zod.ts:489` (the walker)
- `src/util/effect-zod.ts:372` (the `Schema.Union` → `z.union` flattening — weak point)
- `src/util/effect-zod.ts:421-433` (`Schema.check` cross-field refinement fallback)
- `src/session/tools.ts:147` (the `z.toJSONSchema` conversion)
- `src/provider/transform.ts:1312` (the `ProviderTransform.schema` sanitizer)

**Fix path status (unchanged from 2026-06-07)**:

- **A**: Convert to `z.discriminatedUnion("type", [...])` — produces `oneOf+discriminator` JSON Schema; Zod returns single issue on error. Zod 4.1.8 supports this. **Status**: not yet attempted.
- **B**: Improve `formatValidationError` to surface actionable messages. **Status**: not yet attempted.
- **C**: User-design workstream for "vere e proppie interfacce" (AI-generated mini-app TUIs). **Status**: design only.

### TUI Realtime Visualization (Out-of-Repo, 2026-06-15)

Session `ses_1339d8a9cffem7Eh39qYb0ANd1` generated a **standalone Bun-based TUI at `/tmp/nikcli-tui.mjs`** (1172 lines) that renders in an alt-screen with:

- **Hero stats** color-coded per flow (44 tools, 19 agents, 260 endpoints, 21 route files, 66 bus events, 29 files, 119,343 LOC)
- **4 analysis sections** with file:line citations from the deep-dive reports
- **End-to-end ASCII diagram** of the entire flow (user → server → session/prompt → processor → tool → bus → TUI)
- **Permission section** showing the 3-layer gating (PermissionNext, ask(ctx), external_directory)
- **3 live simulators** (different per frame):
  - tool activity (read/edit/bash/webfetch/task/...)
  - message stream (text/reasoning/tool/step/compaction/subtask)
  - bus event ticker (server.connected → session._ → message._ → permission.\* → ...)
- **Animated header** with braille ticker, uptime, frame counter, current time

Launch: `REFRESH_MS=120 bun /tmp/nikcli-tui.mjs`

**Notes**:

- No files in `packages/nikcli` were modified by this work — analysis is read-only
- The TUI script lives in `/tmp/` so it doesn't pollute the repo
- Reports from the 4 background agents persisted as artifacts, available via `delegation(action="read", delegationId=...)`
- A static ANSI-stripped capture is at `/tmp/tui-capture.txt` (490 lines) — full frame
- TUI has known padding issues with ANSI escape codes inside table cells — initial render was buggy, then a `padL` → visual-width aware padding fix was applied
- For long-running TUI capture, can use `script` or `unbuffer` to allocate a pseudo-tty

### Other 2026-06-15 Sessions

- `ses_1339c4b78ffeWftlXtfrckaEOk` — `@explore`: server/storage/SDK deep-read (4 sections: 11/12/13/15 + file index)
- `ses_1339cdbf5ffeyPSYxFup1Cy2K9` — `@explore`: tool system (44 tools grouped by category, registry init flow, permissions, execution lifecycle)
- `ses_1339c7df4ffeWPoejXJLRWZPx2` — `@explore`: agent subsystem (agent.ts:73-96 schema, 21 agents inventory, task dispatch, 15 quirks)
- `ses_13388ac0effeBmfkr3XBE558pu` — `@explore`: retrieved Sections 10-15 of agent report from tool-output file
- `ses_133842e8affeekNHppG0oX6LId` — `@explore`: retrieved Sections 11-15 of server report from tool-output file
- `ses_1337a40a8ffeQ50QP331G9bLvg` — Primary session: investigated opentui tool bug end-to-end, then user directed to use the tool, multiple failure modes documented
