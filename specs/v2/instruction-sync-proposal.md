# Instruction Sync

| Field  | Value                                                       |
| ------ | ----------------------------------------------------------- |
| Status | **Implemented** |
| Scope  | `src/session/instruction.ts`, `instruction-sync.ts`, `instruction-repo.ts`, `sync_event` |
| Buys   | A stable prompt prefix, an auditable instruction history, and drift the user can see |

## Principle

The model is a replica nikcli can write but cannot read or edit. The transcript is the only channel. Instruction sync keeps mutable privileged context — `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, skill guidance, profile, date, environment — current over that channel **without rewriting text that was already sent**.

The durable log stores only irreducible facts: which source values changed, and when. Bodies live in a content-addressed table. Rendering is a function of the log plus current renderer code.

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

## Contract

### InstructionKey

A key is a string with an explicit namespace. Keys are machine-local for files; they are not cross-machine identities.

| Kind      | Key                    | Identity                                              |
| --------- | ---------------------- | ----------------------------------------------------- |
| File      | `file:<absolute-path>` | `path.resolve` of the discovered path, no symlink walk |
| URL       | `url:<url>`            | The URL as declared in config, not the redirect target |
| Environment | `env`                | Singleton per session                                  |
| Profile   | `profile`              | Singleton per session                                  |
| Skill     | `skill:<name>`         | The skill's configured name                            |

Out of scope for this contract (still composed elsewhere, not folded here):

- MCP tool advertisement and MCP resource reads mid-turn
- Nearby instruction files attached by `Instruction.resolve` on a `read`
- Static provider prompt templates (`anthropic.txt`, spoof headers, …)
- Model selection

### Read result

Every source read is tri-state. Empty content is observed absence, matching today's `filter(Boolean)` drop.

| Status         | When                                                                 | Initial delta                         | Later delta                          |
| -------------- | -------------------------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| `value`        | Read succeeded and the body is non-empty                             | Include hash                          | Include hash if it changed           |
| `removed`      | Observed absence: missing file, empty file, HTTP 404                 | Omit (never present)                  | `"removed"` if it was stored         |
| `unavailable`  | Transient: timeout, non-404 HTTP error, I/O error other than ENOENT  | **Blocks** the whole initial delta    | Keep the stored value, no key in delta |

Skill load failure and a missing profile are `removed` (observed absence of that optional source), not `unavailable`. Environment construction failure is `unavailable`.

### Canonical body and hash

A blob body is canonical JSON with sorted object keys, no extra whitespace. The SHA-256 hex of the UTF-8 canonical form is the hash (64 lowercase hex chars). The literal `"removed"` cannot collide with a hash.

Bodies store the irreducible text, not the `"Instructions from:"` prefix:

```ts
{ kind: "file", text: string }
{ kind: "url", text: string }
{ kind: "env", parts: string[] }
{ kind: "profile", parts: string[] }
{ kind: "skill", name: string, text: string }
```

The renderer adds `"Instructions from: <path-or-url>\n"` for files and URLs, wraps skill blocks in `<active_skills>`, and spreads `env` / `profile` parts. Two files with identical text share a blob.

### Durable fact

One event, carrying only a delta of content hashes:

```ts
"session.instructions.updated" {
  sessionID: Session.ID
  delta: Record<InstructionKey, InstructionHash | "removed">
}
```

A hash overwrites one source value. `"removed"` marks observed absence — chosen over JSON `null` because record-value nullability does not survive every client generator, and because it cannot collide with a 64-hex hash.

The event stores **no rendered prose**, no baseline, and no snapshot. An empty delta is not an event.

### SQL

```sql
CREATE TABLE instruction_blob (
  hash TEXT NOT NULL PRIMARY KEY, -- 64 hex sha256
  body TEXT NOT NULL              -- canonical JSON
);

CREATE TABLE instruction_state (
  session_id TEXT NOT NULL PRIMARY KEY,
  epoch_seq INTEGER NOT NULL,     -- last seq included in the initial snapshot
  updated_seq INTEGER NOT NULL,   -- last applied instruction event seq
  parent_session_id TEXT,         -- fork parent, if any
  parent_seq INTEGER,             -- parent updated_seq captured at fork
  data TEXT NOT NULL              -- fold projection, see below
);
```

`instruction_state.data`:

```ts
{
  values: Record<InstructionKey, InstructionHash>       // latest fold
  order: InstructionKey[]                               // discovery order for latest
  epoch_values: Record<InstructionKey, InstructionHash> // fold at epoch start
  epoch_order: InstructionKey[]
}
```

The fold is a rebuildable projection, never primary state. Blob GC is deferred. Session delete drops `instruction_state` only.

### Atomicity

Blob upserts, the log row, sequence bump, and fold write land in one `Database.transaction`. Nested `SyncEvent.run` joins the outer transaction. A projector throw rolls back blobs and the event together.

The projector receives the allocated `event.seq`. On first insert, `epoch_seq = updated_seq = seq` and `epoch_values = values`. Later events update `values` / `order` / `updated_seq` only.

### Admission

Admission runs at the **model-request** safe boundary in `SessionPrompt.loop` — after pending-input promotion (S1), after compaction/subtask handling, immediately before tools and the provider call. It does not delay pending-input visibility.

The runner reads every in-scope source concurrently **exactly once**, hashes the encoded values, and admits one delta atomically with its new blobs.

- The initial delta must be complete: any `unavailable` source blocks that attempt. The request still proceeds from the live snapshot; nothing is stored. The next request retries.
- Afterwards an `unavailable` source silently retains the stored value. This is the direct fix for silent divergence.
- Disabled instruction paths/URLs are omitted from the snapshot; if they were stored, the delta marks them `removed`.
- Sources are combined explicitly: discovered files, config URLs, environment parts, profile parts, selected-agent skills. There is no instruction registry.

### Rendering

Request assembly renders from stored values and **never persists** those renders as messages.

- **System prefix** = epoch snapshot (`epoch_order` / `epoch_values`), in that order: `env` parts, files, URLs, `profile` parts.
- **Skill user messages** = epoch skill keys, wrapped as today.
- **Updates** = one synthetic user message per `session.instructions.updated` with `seq > epoch_seq`, appended after conversation history so the cached prefix does not move.

A missing blob at render time omits that key for the request and logs; it does not emit `removed`.

Clients display the changed keys from the durable delta; they do not re-render the prose.

This is what preserves the cache prefix: previously sent text is never rewritten, and a change appends a small update rather than mutating the head of the request.

### Epochs

An instruction epoch spans completed compactions. When compaction **succeeds** (circuit not open, `Event.Compacted` published), the epoch start moves to the session aggregate's current sequence. Current stored values become initial again — without reading any source and without authoring an instruction event.

- A committed revert that actually truncates messages clears the fold. The next admission is a new complete initial delta.
- Session movement (workspace warp / restore that changes `session.directory`) clears the fold.
- A fork records `parent_session_id` + `parent_seq = parent.updated_seq` and copies the parent's **latest** fold as the child's epoch snapshot. It does not follow the parent after that cutoff.
- Model selection affects request assembly but is not itself an instruction source.

### Remote hydration

Hashes are local pointers. The durable `sync_event.data` stays hash-only.

At a sync or export boundary the sender attaches `blobs: Record<hash, body>` for every hash in the delta. The receiver re-hashes each body, stores it, and rejects a mismatch. Missing blobs are not invented: ingest what arrived, and render omits the rest.

## Migration

1. Add `instruction_blob` and `instruction_state`. Both are new tables; no existing row changes.
2. Emit the delta event from the model-request boundary. Request assembly renders from stored values in the same step. Compaction epoch moves with this step — otherwise a compaction re-sends the entire instruction set as an update rather than as initial context. **Landed.**
3. Surface changed keys in the TUI and desktop clients from the `session.instructions.updated` delta. Clients show labels (basename, URL, `environment`, `profile`, `skill <name>`), never hashes or bodies. The complete first admit for a session is stored but not shown; later one-key changes are. **Landed.**
4. Optional later: hash-first file reads that skip I/O when `mtime` and size are unchanged. That cache is never authoritative.

Step 1 is independently revertible. Step 2 is the behavior-visible change and must include the epoch rule.

## Invariants (testable)

1. An unchanged snapshot emits no event.
2. The first successful admit writes a complete delta; `epoch_seq` equals that event's seq.
3. A later content change emits only the changed keys.
4. Observed absence after a stored value emits `"removed"` and drops the key from the fold.
5. A URL timeout after a stored value emits nothing for that key and keeps the stored hash.
6. A URL timeout on the initial admit stores nothing and still returns a live render.
7. Blob upsert + event + fold share one transaction: a projector throw leaves no log row and no blob.
8. Identical bodies share one `instruction_blob` row.
9. Successful compaction copies `values` → `epoch_values` and does not insert an instruction event.
10. Forked child `epoch_values` equal the parent's fold at `parent_seq`, not a later parent admit.
11. A committed revert that truncates messages deletes `instruction_state`.
12. Hydration re-hash mismatch is rejected; matching bodies are stored under the claimed hash.

## Non-Goals

- Instruction sync does not decide *what* guidance a session should have — that is agent and skill selection.
- It does not make instruction files editable by the model.
- Blob garbage collection is deliberately deferred; it needs the sync boundary defined first.
- Hard-crash recovery of an in-flight admit (the write is transactional; a crash before commit is a no-op retry).
