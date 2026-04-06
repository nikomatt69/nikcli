---
description: create github issues for critical bugs
model: minimax-coding-plan/MiniMax-M2.7
subtask: true
---

Create GitHub issues for the critical bugs found in nikcli codebase analysis.

## Issues to Create

### Issue 1: Auth Bypass in Permission/DBEdit Endpoints

**Title:** SECURITY: Missing authentication on permission and dbedit API endpoints

**Body:**

````markdown
## Summary

The `/permission/:requestID/reply` and `/dbedit/:requestID/reply` endpoints have NO authentication checks, allowing unauthenticated attackers to:

- Approve their own file system permissions
- Approve arbitrary shell execution
- Modify database entries

## Affected Files

- `src/server/routes/permission.ts:11`
- `src/server/routes/dbedit.ts:10`

## Expected Fix

Add authentication middleware similar to other protected routes:

```typescript
app.post("/:requestID/reply", async (c) => {
  const user = c.get("userSession")
  if (!user) return c.json({ error: "Unauthorized" }, 401)
  // existing code...
})
```
````

## Severity

Critical - Security vulnerability allowing privilege escalation.

````

---

### Issue 2: Stack Trace Exposure in Production

**Title:** SECURITY: Full stack traces exposed in production error responses

**Body:**
```markdown
## Summary

The error handler in `src/server/server.ts:116` returns full `err.stack` to clients, exposing:
- Internal file paths
- Function names
- Code structure
- Potentially sensitive environment details

## Affected File

`src/server/server.ts:116`

## Expected Fix

Return sanitized error messages in production:

```typescript
const message = err instanceof Error && err.stack
  ? (process.env.NODE_ENV === "production" ? err.message : err.stack)
  : err.toString()
````

## Severity

Medium - Information disclosure that aids attackers.

````

---

### Issue 3: Race Conditions in Session/Message Handling

**Title:** Race conditions causing data loss in session operations

**Body:**
```markdown
## Summary

Multiple async operations are not properly awaited, causing race conditions:

1. `src/session/prompt.ts:1256` - FileTime.read() not awaited
2. `src/session/prompt.ts:1214` - ReadTool.init().then() returns before async completes
3. `src/session/index.ts:306` - share() + update() not awaited

## Affected Files

- `src/session/prompt.ts`
- `src/session/index.ts`

## Impact

- File timestamps may not be recorded
- File reads may return empty content
- Session share URLs may not be persisted

## Severity

High - Data integrity and reliability issues.
````

---

### Issue 4: Resource Leaks in Tools

**Title:** Resource leaks in voice recording and file tools

**Body:**

```markdown
## Summary

Several tools have resource leaks:

1. `src/tool/voice.ts:86-112` - Temp audio files not cleaned up on abort
2. `src/tool/grep.ts` - Ripgrep process not killed on early return
3. `src/tool/edit.ts:71` - file.stat() errors silently swallowed

## Affected Files

- `src/tool/voice.ts`
- `src/tool/grep.ts`
- `src/tool/edit.ts`

## Impact

- Accumulated temp files consuming disk space
- Orphaned processes consuming CPU/memory
- Hidden errors making debugging difficult

## Severity

Medium - Resource exhaustion over time.
```

---

### Issue 5: Empty Catch Blocks

**Title:** 15+ empty catch blocks hiding errors throughout codebase

**Body:**

````markdown
## Summary

Multiple files use empty catch blocks that silently swallow errors:

- `src/plugin/copilot.ts:77`
- `src/session/message-v2.ts:873`
- `src/server/routes/studio.ts:52`
- `src/session/retry.ts:85`
- `src/mobile/project-detect.ts:61,98,114`
- `src/cli/cmd/mcp.ts:720`
- `src/server/mdns.ts:39`
- `src/pty/index.ts:79,187`
- `src/storage/storage.ts:165`

## Impact

- Errors go unnoticed
- Debugging becomes difficult
- Silent failures in critical paths

## Expected Fix Pattern

```typescript
// Before:
} catch {}

// After:
} catch (error) {
  log.debug("operation failed", { error: String(error) })
}
```
````

## Severity

Low/Medium - Code quality and maintainability.

```

---

## Instructions

1. Run this command to create issues
2. Use `nikcli gh create-issue` or `gh issue create`
3. Assign to appropriate team members
4. Label as `security` for auth bypass issues
```
