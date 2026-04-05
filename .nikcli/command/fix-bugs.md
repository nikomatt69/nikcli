---
description: fix critical bugs in nikcli codebase
model: nikcli/claude-sonnet-4-5
subtask: true
---

fix critical bugs

## Priority Order

### 1. CRITICAL - Fix Immediately

**Missing await (fire-and-forget):**

- `src/session/prompt.ts:1256` - FileTime.read() not awaited
- `src/session/prompt.ts:1214` - ReadTool.init().then() race condition
- `src/session/index.ts:306` - share() + update() not awaited

**Auth bypass (security):**

- `src/server/routes/permission.ts:11` - Permission reply has NO auth check
- `src/server/routes/dbedit.ts:10` - DB edit reply has NO auth check

**Info leak:**

- `src/server/server.ts:116` - Stack traces exposed in production

**Null dereference:**

- `src/session/compaction.ts:103` - findLast()!.info can throw

**Resource leaks:**

- `src/tool/voice.ts:86-112` - Temp files not cleaned on abort
- `src/tool/edit.ts:71` - file.stat().catch(()=>{}) hides errors

### 2. HIGH - Should Fix

- `src/tool/grep.ts` - Process not killed on early return
- `src/tool/read.ts` - OOM risk - reads entire file for binary check
- `src/tool/apply_patch.ts` - Error handling logic bug
- `src/server/routes/file.ts` - Path traversal possible
- `src/session/retry.ts` - JSON.parse() without try/catch

### 3. MEDIUM - Good Practice

**Empty catch blocks (15+ locations):**

- plugin/copilot.ts
- message-v2.ts
- studio.ts
- retry.ts
- mobile/project-detect.ts
- cli/cmd/mcp.ts
- server/mdns.ts
- pty/index.ts
- storage/storage.ts

**Replace with logging:**

```typescript
// Bad:
} catch {}

// Good:
} catch (error) {
  log.debug("operation failed", { error: String(error) })
}
```

**Unbounded JSON parse (3 locations):**

- src/tool/websearch.ts
- src/tool/codesearch.ts

### 4. Fix Patterns

**Missing await:**

```typescript
// Before (BUG):
FileTime.read(sessionID, filepath)

// After (FIX):
await FileTime.read(sessionID, filepath)
```

**Race condition:**

```typescript
// Before (BUG):
await ReadTool.init()
  .then(async (t) => { ... pieces.push(...) })
return pieces  // Returns before async completes!

// After (FIX):
const pieces: string[] = []
const tool = await ReadTool.init()
for (const file of files) {
  const result = await tool.execute({ ... })
  pieces.push(result.output)
}
return pieces
```

**Empty catch blocks:**

```typescript
// Before (BUG):
} catch {}

// After (FIX):
} catch (error) {
  log.debug("description of what failed", { error: String(error) })
}
```

**JSON.parse without try/catch:**

```typescript
// Before (BUG):
const json = JSON.parse(error.data.message)

// After (FIX):
let json
try {
  json = JSON.parse(error.data.message)
} catch {
  json = { message: error.data.message }
}
```

### 5. Verification

After fixing:

1. Run `bun run typecheck` to ensure no type errors
2. Run `bun test` to ensure tests pass
3. Check that the fixes don't break existing functionality

Do NOT create new files. Only edit existing files to fix the bugs.
