# Nikcli Package Analysis Plan

## Understanding Summary

Based on exploration, the nikcli package is a sophisticated AI agent CLI system with the following key components:

### 1. Package Structure

- **Main Entry**: `src/index.ts` - yargs CLI with 35+ commands
- **Server**: `src/server/server.ts` - HTTP server with routes for mobile, session, config, file, etc.
- **Core Directories**: `cli/`, `session/`, `tool/`, `agent/`, `provider/`, `storage/`, `workspace/`

### 2. Agent System

| Component         | Key File                    | Purpose                                    |
| ----------------- | --------------------------- | ------------------------------------------ |
| Agent Definitions | `src/agent/agent.ts`        | Zod schema with permissions, models, steps |
| Tool Registry     | `src/tool/registry.ts`      | Loads core + custom + plugin tools         |
| Execution         | `src/session/prompt.ts`     | Main loop with tool resolution             |
| Delegation        | `src/delegation/manager.ts` | Background task management                 |

**Agent Types:**

- Primary: `ralph`, `build`, `plan`
- Subagents: `explore`, `fast-explore`, `planner`, `researcher`, `code-reviewer`, `debugger`, `test-runner`, `refactor`, `delegator`
- Internal: `compaction`, `title`, `summary`

### 3. Storage System

- **Pattern**: Effect-based DI with Layer pattern
- **Persistence**: JSON files at `<data>/storage/`
- **Cache**: 5s TTL read-through cache
- **Locking**: In-memory rw locks + file-based distributed locks

**Data Keys:**

- `session/<projectID>/<id>.json`
- `message/<sessionID>/<id>.json`
- `part/<messageID>/<id>.json`
- `project/<id>.json`

### 4. ID System

- **Format**: `<prefix>_<timestamp-hex>_<random-base62>`
- **Prefixes**: `ses`, `msg`, `prt`, `per`, `que`, `usr`, `tool`, `wrk`, etc.
- **Ordering**: Descending for sessions (recent-first), ascending for messages/parts (chronological)

### 5. Message System

- **Types**: User, Assistant (discriminated union)
- **Parts**: TextPart, ReasoningPart, ToolPart, FilePart, AgentPart, StepStartPart, StepFinishPart, CompactionPart, SubtaskPart, RetryPart, SnapshotPart, PatchPart

---

## Analysis Scope

What kind of analysis would you like me to perform?

| Option                    | Description                                                |
| ------------------------- | ---------------------------------------------------------- |
| **Architecture Overview** | High-level system design and component relationships       |
| **Code Quality Review**   | Identify patterns, potential issues, areas for improvement |
| **Performance Analysis**  | Bottlenecks, caching effectiveness, concurrency patterns   |
| **Security Review**       | Permission system, input validation, safe patterns         |
| **Documentation**         | Generate detailed docs for a specific component            |
| **Custom Analysis**       | Tell me what you want to know                              |

---

## Next Steps

1. **Confirm scope** - Which analysis type interests you?
2. **Focus areas** - Any specific files/directories to emphasize?
3. **Depth level** - Quick scan vs. deep dive?

Please let me know what aspect of nikcli you'd like me to analyze in detail.
