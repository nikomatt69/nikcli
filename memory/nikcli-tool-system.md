# nikcli Tool System Architecture

## Overview

The tool system is the core extension mechanism for nikcli, enabling agents to interact with the filesystem, execute commands, and delegate work to subagents.

---

## Tool Definition Patterns

### Basic Pattern (`Tool.define()`)

```typescript
import { Tool } from "@/tool/tool"
import z from "zod"

export const MyTool = Tool.define("my-tool", async (ctx) => {
  return {
    description: "Tool description for LLM",
    parameters: z.object({
      input: z.string(),
    }),
    async execute(params, ctx) {
      return {
        title: "Result",
        metadata: {},
        output: result,
      }
    },
  }
})
```

### Key Concepts

1. **Two-phase initialization**: `Tool.define()` returns `Tool.Info` with an `init()` method that returns `Tool.Def`
2. **Async init**: The first argument to `Tool.define()` can be an async function that receives `InitContext` with optional `agent`
3. **Zod validation**: Parameters are validated via `z.object()` schema; `formatValidationError` customizes error messages
4. **Effect wrapper**: `Tool.define()` automatically wraps Promise returns in `Effect.tryPromise()` for consistent error handling
5. **Output truncation**: Built-in truncation via `Truncate.Service` adds `truncated` metadata flag

---

## Tool Context (`Tool.Context`)

```typescript
type Context<M extends Metadata = Metadata> = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal           // Listen for cancellation
  callID?: string
  extra?: Record<string, unknown>
  messages?: MessageV2.WithParts[]
  metadata(input: { title?: string; metadata?: M }): void  // Stream live updates
  ask(input: PermissionRequest): Promise<void  // Request permission
}
```

---

## Permission Evaluation System

### PermissionNext Service (`src/permission/next.ts`)

**Rule Structure:**

```typescript
type Rule = {
  permission: string // Tool name or pattern (e.g., "bash", "edit", "external_directory")
  pattern: string // File path pattern or command pattern
  action: "allow" | "deny" | "ask"
}
```

**Evaluation (`PermissionNext.evaluate()`):**

- Merges multiple rulesets, finds last matching rule via `Wildcard.match()`
- Returns default action `"ask"` if no rule matches
- Supports path expansion: `~/`, `$HOME/`

**Permission Flow:**

1. Tool calls `ctx.ask({ permission, patterns, always, metadata })`
2. `PermissionNext.Service.ask()` evaluates rules against patterns
3. `"deny"` → throws `DeniedError`
4. `"ask"` → publishes `permission.asked` event, awaits user response
5. `"allow"` → proceeds

**Replies:** `"once"` (single use), `"always"` (persisted to storage), `"reject"` (with optional correction message)

### Bash Authorization (`src/tool/bash.ts`)

Uses **tree-sitter-bash** to parse command structure:

- Extracts command tokens and file arguments
- For file-manipulating commands (`cd`, `rm`, `cp`, `mv`, etc.), tracks directories
- Registers patterns for permission requests

```typescript
// Pattern registration for bash authorization
registerCommandSignals(cmd, cwd, directories, patterns, always, pendingPathResolutions)
```

---

## Background Agent Execution (TaskTool)

### Launching Background Tasks (`src/tool/task.ts`)

**Parameters:**

```typescript
{
  description: string,       // Short 3-5 word description
  prompt: string,           // Task for agent
  subagent_type: string,    // Agent type (e.g., "explore", "code-reviewer")
  background?: boolean,      // Run in background, return immediately
  session_id?: string,      // Continue existing session
  command?: string,         // Triggering command
}
```

**Foreground Execution:**

- Creates child session with parent ID
- Builds permission rules via `buildSubtaskPermission()`
- Subscribes to `MessageV2.Event.PartUpdated` for live metadata updates
- Runs prompt and returns summary

**Background Execution (`launchBackgroundSubtask()`):**

1. Creates **worker session** (runs the agent)
2. Creates **delegator session** (synthesizes results)
3. Creates two `Delegation` records linked together
4. Returns immediately with job/delegation IDs

### Follow-up Rounds (Delegator Loop)

After worker completes, delegator can spawn follow-up agents:

- Max 3 iterations
- Each round: delegator analyzes results, decides `finalize` or `continue`
- `continue` spawns a new follow-up task
- Results accumulate across rounds

**Delegator Decision Format:**

```
**Action:** finalize | continue
**Reason:** <one sentence>
If continue, include:
**Spawn:**
- description: <short>
- prompt: <task>
- agent: <type>
```

---

## Tool Execution Flow

### Before/After Hooks Pattern

Tools handle hooks via context callbacks:

1. **Before execution**: Validate params, request permissions via `ctx.ask()`
2. **Live metadata**: Call `ctx.metadata({ title, metadata })` during execution
3. **Abort handling**: Listen to `ctx.abort` for cancellation

**Example from BashTool:**

```typescript
// Authorization before execution
await authorizeBashCommand(params.command, cwd, ctx)

// Stream output metadata during execution
const append = (chunk: Buffer) => {
  output += chunk.toString()
  ctx.metadata({ metadata: { output, description: params.description } })
}
proc.stdout?.on("data", append)
proc.stderr?.on("data", append)

// Abort handling
ctx.abort.addEventListener("abort", abortHandler, { once: true })
```

---

## Doom-Loop Detection

### Delegation Tracking

Background runs track status to prevent infinite loops:

1. **Timers**: Each delegation has a `DEFAULT_TIMEOUT_MS` (10 minutes)
2. **Heartbeats**: Leases refreshed at `LEASE_TIMEOUT_MS / 3` intervals
3. **Forced finalization**: After cancellation/timeout, forced finalize after delay
4. **Job grouping**: Multiple delegations share a `jobID` via `rootDelegationID`

### Research Agent Optimization

The `researcher` agent has special handling:

- `findRunningForParent()` reuses existing running research task
- Metadata tracks `question`, `sourceCount`, `confidence`, `followUpRounds`

---

## Delegation System Architecture (`src/delegation/manager.ts`)

### Key Types

```typescript
type Record = BackgroundRun.Record // Durable persistence record
type Status = "running" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"
type Role = "worker" | "delegator" | "followup"
```

### Delegation Lifecycle

1. **`create()`**: Create record, set timer, set heartbeat
2. **`setSessionID()`**: Attach worker session
3. **`updateProgress()`**: Stream progress to durable storage
4. **`finalize()`**: Complete with status, cleanup timers
5. **`cancel()`**: Request finalization, cancel session prompt

### Job Management

- **Jobs** group related delegations (worker + delegator + followups)
- **`projectJob()`**: Aggregates records into single `JobItem`
- **`collectResultsForJob()`**: Gathers results from all worker delegations
- **`waitForSettledJob()`**: Polls until all non-delegator records complete

### Session Linking

```typescript
// O(1) lookup via in-memory index
sessionToDelegation: Map<string, string>

// Find delegation by worker session
Delegation.getBySessionID(sessionID)

// Cancel delegation by worker session
Delegation.cancelOwnedBySessionID(sessionID)
```

---

## Tool Registry (`src/tool/registry.ts`)

### Core Tools (Always Loaded)

- `bash`, `read`, `glob`, `grep`, `tree`, `edit`, `write`, `task`, `search_tools`

### Slim Mode

Subset loaded for lightweight interactions:

```typescript
const SLIM_TOOLS = new Set(["bash", "read", "glob", "grep", "tree", "edit", "write", "task", "search_tools"])
```

### Model-Specific Tools

- `codesearch`, `websearch`: Only with `nikcli` provider or `NIKCLI_ENABLE_EXA`
- `apply_patch`: Only for GPT models (non-oss, non-gpt-4)
- `advisor`: Only if agent has advisor configured

### Plugin Integration

- Loads custom tools from `config.directories()/tool` or `config.directories()/tools`
- Integrates with plugin system via `Plugin.Service.list()`

---

## Related Files

- `src/tool/tool.ts` - Core Tool namespace with `define()` and types
- `src/tool/task.ts` - TaskTool with background execution
- `src/tool/bash.ts` - BashTool with tree-sitter parsing
- `src/tool/edit.ts` - EditTool with multiple replacers
- `src/permission/next.ts` - Permission evaluation service
- `src/delegation/manager.ts` - Delegation tracking
- `src/tool/registry.ts` - Tool registration and discovery
- `src/background/run.ts` - Durable background run storage
