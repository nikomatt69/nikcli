# Plan: 10 Plugins for `packages/plugin/plugins/`

## Context
Expand the `packages/plugin` package with a `plugins/` directory containing 10 standalone plugin implementations, modeled after the opencode plugin ecosystem. Three are explicitly requested:
- **background** — background process management
- **background-agents** — async agent delegation
- **dynamic-context-pruning** — token usage optimization

Seven more chosen from the awesome-opencode list for practical utility:
- **smart-title** — auto-generate session titles
- **safety-net** — catch destructive git/filesystem commands
- **agent-memory** — persistent self-editable memory blocks
- **context-analysis** — token usage analytics
- **envsitter-guard** — protect `.env` files from agent reads/writes
- **direnv** — auto-load direnv environment at session start
- **handoff** — generate structured handoff prompts

---

## Directory Structure

```
packages/plugin/plugins/
├── background/
│   ├── index.ts
│   └── package.json
├── background-agents/
│   ├── index.ts
│   └── package.json
├── dynamic-context-pruning/
│   ├── index.ts
│   └── package.json
├── smart-title/
│   ├── index.ts
│   └── package.json
├── safety-net/
│   ├── index.ts
│   └── package.json
├── agent-memory/
│   ├── index.ts
│   └── package.json
├── context-analysis/
│   ├── index.ts
│   └── package.json
├── envsitter-guard/
│   ├── index.ts
│   └── package.json
├── direnv/
│   ├── index.ts
│   └── package.json
└── handoff/
    ├── index.ts
    └── package.json
```

Each plugin is a self-contained module using `@nikcli-ai/plugin` as peer dependency.

---

## Critical Files (read-only references)

- `packages/plugin/src/index.ts` — `Plugin`, `PluginInput`, `Hooks` types
- `packages/plugin/src/tool.ts` — `tool()` helper + Zod access via `tool.schema`
- `packages/plugin/src/example.ts` — reference pattern
- `packages/plugin/package.json` — version/dep baseline to mirror

---

## Plugin Implementations

### 1. `background/` — Background Process Management
**Hooks:** `tool`
**Tools:** `bg_start`, `bg_stop`, `bg_status`, `bg_list`, `bg_logs`
**State:** Module-level `Map<string, { proc: ReturnType<typeof Bun.spawn>, logs: string[], name: string, command: string, startedAt: number }>`
- `bg_start(name, command, cwd?)` → spawns via `Bun.spawn(...)`, streams stdout/stderr into log buffer
- `bg_stop(name)` → kills process, cleans map
- `bg_status(name)` → returns exit code / "running"
- `bg_list()` → lists all tracked processes with status
- `bg_logs(name, lines?)` → returns last N lines of combined output

### 2. `background-agents/` — Async Agent Delegation
**Hooks:** `tool`
**Tools:** `agent_spawn`, `agent_status`, `agent_result`, `agent_list`, `agent_cancel`
**State:** `Map<string, { sessionID: string, prompt: string, startedAt: number, done: boolean, result?: string }>`
- `agent_spawn(task, context?)` → creates a new session via `client.session.create()`, sends initial message, returns agentID
- `agent_status(agentID)` → polls session state, returns "running" | "done" | "error"
- `agent_result(agentID)` → returns final assistant message from the session
- `agent_list()` → lists all tracked agents
- `agent_cancel(agentID)` → aborts the session

### 3. `dynamic-context-pruning/` — Token Optimization
**Hooks:** `experimental.chat.messages.transform`
**Options:** `keepRecent?: number` (default 10), `maxOutputLength?: number` (default 2000), `pruneThreshold?: number` (total messages before pruning kicks in, default 20)
**Logic:**
1. Count total messages — if below `pruneThreshold`, return unchanged
2. For tool-result parts older than the most recent `keepRecent` messages, truncate output to `maxOutputLength` with `[...pruned N chars]` suffix
3. Never prune the last `keepRecent` messages regardless of length

### 4. `smart-title/` — Auto-Generate Session Titles
**Hooks:** `chat.message`
**State:** `Set<string>` of already-titled sessionIDs
**Logic:**
- On first user message in a session (detect by sessionID not in set), extract first 500 chars of message text
- Call `client.session.chat(sessionID, ...)` with a meta-prompt to generate a ≤8-word title
- Update session title via `client.session.update(sessionID, { title })`
- Add sessionID to set to avoid re-triggering
**Options:** `maxTitleWords?: number` (default 8), `minMessageLength?: number` (default 10)

### 5. `safety-net/` — Catch Destructive Commands
**Hooks:** `permission.ask`, `tool.execute.before`
**Logic (permission.ask):** If `input.metadata.command` matches any destructive pattern, set `output.status = "ask"` (force confirmation even if previously allowed)
**Logic (tool.execute.before):** If tool is `bash`/`run_command` and args contain destructive patterns, set output args to inject a warning prefix
**Destructive patterns (default):**
```
rm -rf, git reset --hard, git push --force, git push -f,
git clean -fd, git checkout -- ., DROP TABLE, truncate,
chmod -R 777, pkill, kill -9, >/dev/null 2>&1 rm
```
**Options:** `extraPatterns?: string[]`, `allowList?: string[]`

### 6. `agent-memory/` — Persistent Memory Blocks
**Hooks:** `experimental.chat.system.transform`, `tool`
**Storage:** `.nikcli/memory.json` in `input.directory`
**Tools:** `memory_save(key, content)`, `memory_recall(key?)`, `memory_delete(key)`, `memory_list()`
**System inject:** Prepends formatted memory block to system prompt:
```
## Agent Memory
<key>: <content>
...
```
- All file I/O is sync (readFileSync/writeFileSync) within tool execute
- Missing file initializes to `{}`

### 7. `context-analysis/` — Token Usage Analytics
**Hooks:** `experimental.chat.messages.transform`, `tool`
**State:** `{ messageCount: number, estimatedTokens: number, toolCallCounts: Record<string, number>, sessionStart: number }`
**Logic (transform hook):** Count messages, estimate tokens as `Math.ceil(totalChars / 4)`, count per-tool invocations
**Tools:** `context_stats()` → returns JSON with all tracked metrics
**Options:** `warnAt?: number` (emit warning in tool output when tokens exceed threshold)

### 8. `envsitter-guard/` — Protect `.env` Files
**Hooks:** `tool.execute.before`
**Blocked tools:** `read_file`, `write_file`, `edit`, `patch_file`, `str_replace_editor`, `view`
**Logic:** Check `output.args` for path/file arguments matching `.env` patterns; if match found, replace args with a sentinel that causes the tool to return an error message
**Pattern matching:** `.env`, `.env.*`, `*.env`, `.envrc`
**Options:** `patterns?: string[]` (append to defaults), `warnOnly?: boolean` (log but allow)

### 9. `direnv/` — Auto-Load direnv Environment
**Hooks:** `event`, `tool`
**Logic (event hook):** On `session.create` event, run `direnv export json` in `input.directory` via `input.$`; parse JSON output and inject each var into `process.env`
**Tools:** `direnv_reload()` — re-runs the export and updates env, `direnv_status()` — shows currently loaded direnv vars and `.envrc` path
**Graceful degradation:** If `direnv` binary not found or no `.envrc`, silently skip

### 10. `handoff/` — Generate Handoff Prompts
**Hooks:** `tool`
**Tools:** `create_handoff(context?, outputPath?)`
**Logic:**
1. Fetch current session messages via `client.session.messages(sessionID)`
2. Extract: task summary (first user message), key decisions made, files modified (from tool calls), current state, next steps
3. Format as structured markdown handoff document
4. Save to `.nikcli/handoffs/<ISO-timestamp>.md` (or `outputPath`)
5. Return path to created file
**Options:** `autoSave?: boolean` (save on session end event)

---

## Package.json Pattern (per plugin)

```json
{
  "name": "@nikcli-ai/plugin-<name>",
  "version": "0.0.6",
  "type": "module",
  "license": "MIT",
  "exports": { ".": "./index.ts" },
  "publishConfig": { "exports": { ".": "./dist/index.js" } },
  "peerDependencies": {
    "@nikcli-ai/plugin": "workspace:*"
  }
}
```

---

## Existing Utilities to Reuse

- `tool()` from `@nikcli-ai/plugin` — all tool definitions
- `tool.schema` (= zod) — all arg validation
- `PluginInput.$` — shell commands (direnv, bg processes)
- `PluginInput.client` — session API calls
- `PluginInput.directory` — file paths for memory/handoff storage
- `Plugin` type from `@nikcli-ai/plugin` — all plugin signatures

---

## Verification

1. TypeScript check: `bun run --cwd packages/plugin typecheck` (no new tsconfig needed — plugins use same types)
2. Functional test per plugin: add to `.nikcli/nikcli.jsonc`:
   ```json
   { "plugin": ["file:///Volumes/SSD/Projects/nikcli/packages/plugin/plugins/background"] }
   ```
3. Start a session and verify tools appear in tool list
4. Targeted test scenarios:
   - **background**: run `bg_start`, check `bg_list`, then `bg_stop`
   - **dynamic-context-pruning**: send 25+ tool-heavy messages, observe truncation
   - **envsitter-guard**: attempt to read `.env`, expect blocked response
   - **direnv**: open project with `.envrc`, confirm vars loaded
   - **safety-net**: run `rm -rf test`, confirm forced confirmation
