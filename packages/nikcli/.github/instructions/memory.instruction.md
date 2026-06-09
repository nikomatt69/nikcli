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

### Built-in Agents (17 total)

| Agent                  | Mode     | Hidden | Key Traits                                                           |
| ---------------------- | -------- | ------ | -------------------------------------------------------------------- |
| `ralph`                | primary  | no     | Autonomous loop, allows `question`                                   |
| `build`                | primary  | no     | Feature creation, allows `plan_enter`                                |
| `plan`                 | primary  | no     | Planning, allows `plan_exit`, restricts `edit` to plan files         |
| `general`              | all      | no     | General-purpose parallel execution                                   |
| `explore`              | all      | no     | Fast explorer with bash/web tools                                    |
| `fast-explore`         | all      | no     | Read-only: tree/grep/read only                                       |
| `planner`              | all      | no     | Planning with web search                                             |
| `researcher`           | subagent | yes    | Background evidence collection                                       |
| `code-reviewer`        | all      | no     | Quality/safety focused                                               |
| `ultrareview-reviewer` | subagent | yes    | Domain-specific parallel review (bugs/security/performance/patterns) |
| `debugger`             | all      | no     | Failure/root cause analysis                                          |
| `test-runner`          | all      | no     | Test execution and analysis                                          |
| `refactor`             | all      | no     | Safe cleanup without behavior changes                                |
| `delegator`            | subagent | yes    | Synthesizes background subagent results                              |
| `compaction`           | primary  | yes    | Session compaction (context summarization)                           |
| `title`                | primary  | yes    | Generates conversation titles                                        |
| `summary`              | primary  | yes    | Summarizes conversations                                             |

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

### Storage Backend

Hybrid: **filesystem JSON + SQLite (Drizzle ORM, Bun driver)**.

- `Storage` namespace (`src/storage/storage.ts:62-86`) — JSON file ops with `["collection", "id", ...]` key format
- `src/storage/db.ts` — SQLite with Drizzle, PRAGMAs: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `cache_size=-64000`, `foreign_keys=ON`
- **DB tables** (from `src/db/` schema): `users`, `account`, `workspace`, `mobile_tokens`, `chat`
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
