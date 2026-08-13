# Instruction Sync

| Field  | Value                                                       |
| ------ | ----------------------------------------------------------- |
| Status | **Proposed and unimplemented**                              |
| Scope  | `src/session/instruction.ts`, `src/session/system.ts`, `sync_event` |
| Buys   | A stable prompt prefix, an auditable instruction history, and drift the user can see |

## Principle

The model is a replica nikcli can write but cannot read or edit. The transcript is the only channel. Instruction sync keeps mutable privileged context — `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, skill guidance, MCP guidance, date, environment — current over that channel **without rewriting text that was already sent**.

The durable log should store only irreducible facts: which source values changed, and when. Everything else is a function of the log plus current renderer code.

## Current Behavior

`Instruction.system()` runs on every request assembly:

1. `collectSystemPaths` walks up from the instance directory to the worktree root for each of `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `.github/instructions/memory.instruction.md`, then adds `~/.config/nikcli/AGENTS.md`, `~/.claude/CLAUDE.md` (unless `NIKCLI_DISABLE_CLAUDE_CODE_PROMPT`), and `$NIKCLI_CONFIG_DIR/AGENTS.md`. Config-declared instruction globs and URLs resolve the same way.
2. `readInstructionContents` reads every matched file with a bounded fan-out of 10, prefixing each with `Instructions from: <path>`. A read failure becomes an empty string and disappears.
3. `fetchInstructionUrls` fetches every instruction URL with a 5s timeout. A non-`ok` response or a timeout also becomes an empty string and disappears.
4. The concatenation is spliced into the system prompt for that request and thrown away.

Four consequences follow, and all four are load-bearing:

- **Prompt-cache churn.** Editing any instruction file mid-session changes the prefix of the next request. The provider prompt cache misses, and the cost shows up as latency and tokens, not as a visible event.
- **Silent divergence.** A transient network failure or an unreadable file drops guidance from one request and restores it on the next, with nothing recorded either way.
- **No history.** Nothing can answer "what was this session actually told, and when did that change".
- **Repeated I/O.** Every step re-reads the same files. The fan-out is bounded, so this is a constant cost per step rather than a spike, but it is paid unconditionally.

## Proposal

### Durable Fact

One event, carrying only a delta of content hashes:

```ts
"session.instructions.updated" {
  sessionID: Session.ID
  delta: Record<InstructionKey, InstructionHash | "removed">
}
```

A hash overwrites one source value. The literal string `"removed"` marks observed absence — chosen over JSON `null` because record-value nullability does not survive every client generator, and because it cannot collide with a 64-hex hash.

The event stores **no rendered prose**, no baseline, and no snapshot. Bodies are canonical JSON stored once in a machine-local content-addressed table (`instruction_blob`), keyed by hash. Hashes are local pointers, not cross-machine promises — a sync or export boundary must hydrate referenced blobs on the wire and re-hash on ingestion.

A per-session fold cache (`instruction_state`) is a rebuildable projection, never primary state.

### Admission

At each safe step boundary — before the next request is assembled, and before any newly admitted input is visible — the runner reads every source concurrently **exactly once**, hashes the encoded values, and admits one delta atomically with its new blobs.

- The initial delta must be complete: an unavailable source blocks only that initial delta.
- Afterwards an unavailable source silently retains the stored value instead of dropping it. This is the direct fix for silent divergence.
- Sources are combined explicitly by the runner — built-ins, ambient discovery, selected-agent skill guidance, references, MCP guidance, API-managed entries. There is no instruction registry to consult.

### Rendering

Initial instructions and chronological update messages are rendered from stored values during request assembly and are **never persisted as messages**. Clients display the changed keys from the durable delta; they do not re-render the prose.

This is what preserves the cache prefix: previously sent text is never rewritten, and a change appends a small update rather than mutating the head of the request.

### Epochs

An instruction epoch spans completed compactions. When compaction ends, the epoch start moves to that exact sequence, making current values initial again — without reading any source and without authoring an instruction event.

- Session movement and a committed revert clear the fold.
- A fork records an authoritative parent sequence and derives its values from the parent's ancestry through that cutoff, rather than copying the parent's latest state.
- Model selection affects request assembly but is not itself an instruction source.

## Migration

1. Add the `instruction_blob` table and the `instruction_state` fold cache. Both are new tables; no existing row changes.
2. Emit the delta event from the existing safe boundary in `SessionPrompt.loop` while still rendering from a live read. The event is observable before anything depends on it.
3. Switch request assembly to render from stored values. This is the step that fixes cache churn and is the only behavior-visible one.
4. Move `Instruction.system()` to a hash-first read that skips file I/O when `mtime` and size are unchanged.
5. Surface changed keys in the TUI and desktop clients.

Steps 1–2 are additive and independently revertible. Step 3 requires the compaction epoch rule to land with it, or a compaction will re-send the entire instruction set as an update rather than as initial context.

## Non-Goals

- Instruction sync does not decide *what* guidance a session should have — that is agent and skill selection.
- It does not make instruction files editable by the model.
- Blob garbage collection is deliberately deferred; it needs the sync boundary defined first.
