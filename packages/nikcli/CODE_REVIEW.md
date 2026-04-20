# nikcli Package - Code Review Report

**Generated:** 2026-04-20
**Review Scope:** Full codebase analysis via 9 parallel code-reviewer agents
**Total Issues Found:** 28 Critical, 35 Warnings, 28 Suggestions

---

## Executive Summary

The nikcli codebase is generally well-structured with good patterns (Zod validation, AsyncLocalStorage DI, Result-style error handling). However, several **critical security vulnerabilities**, **race conditions**, and **data integrity issues** require immediate attention.

### Critical Issues by Category

| Category       | Critical | High Priority                                     |
| -------------- | -------- | ------------------------------------------------- |
| Security       | 8        | Path traversal, Command injection, HTML injection |
| Data Integrity | 6        | Race conditions, ID collisions, token estimation  |
| Memory/Safety  | 5        | Memory leaks, unbounded growth                    |
| Concurrency    | 4        | Lock bugs, TOCTOU vulnerabilities                 |
| Error Handling | 4        | Silent swallowing, type mismatches                |

---

## 🚨 CRITICAL ISSUES (Must Fix Immediately)

### 1. SECURITY VULNERABILITIES

#### 1.1 BashTool Command Injection

**File:** `src/tool/bash.ts`
**Severity:** CRITICAL

The BashTool uses `spawn(params.command, { shell })` which passes the entire command string to the shell, bypassing tree-sitter parsing.

```typescript
// Vulnerable code
const proc = spawn(params.command, {
  shell, // Shell executes entire string!
  env: { ...process.env }, // Full environment inherited!
})
```

**Impact:** Arbitrary code execution via commands like `echo "test"; rm -rf /`

**Fix:** Use `spawn` with argument array instead of shell string.

---

#### 1.2 Path Traversal in File Routes

**File:** `src/server/routes/file.ts`
**Severity:** CRITICAL

```typescript
// No path validation
validator("query", z.object({ path: z.string() })),
async (c) => {
  const path = c.req.valid("query").path
  const content = await File.list(path)  // Could read any file!
```

**Impact:** Attackers can read `/etc/passwd`, SSH keys, etc.

---

#### 1.3 HTML Injection via Query Parameter

**File:** `src/server/routes/companion.ts`
**Severity:** CRITICAL

```typescript
const host = c.req.query("host")
return c.html(HTML.replace("const API_BASE = '';", `const API_BASE = '${protocol}://${hostPart}';`))
```

**Impact:** XSS attacks via `?host=http://evil.com'><script>...</script>`

---

#### 1.4 Unrestricted CORS

**File:** `src/server/routes/companion.ts`
**Severity:** HIGH

```typescript
cors({ origin: "*" }) // Allows ANY origin
```

---

#### 1.5 Inherited Environment Variables in BashTool

**File:** `src/tool/bash.ts`
**Severity:** HIGH

```typescript
env: { ...process.env }  // Includes API keys, tokens!
```

---

#### 1.6 Weak bcrypt Cost

**File:** `src/db/users.ts`
**Severity:** MEDIUM

```typescript
const hash = await Bun.password.hash(password, { cost: 10 }) // Should be 12+
```

---

### 2. DATA INTEGRITY ISSUES

#### 2.1 ID Collision via Bitwise NOT

**File:** `src/id/id.ts:68`
**Severity:** CRITICAL

```typescript
now = descending ? ~now : now // BUG: Bitwise NOT causes unpredictable sorting!
```

**Impact:** Two sessions created milliseconds apart could get identical descending IDs.

---

#### 2.2 Counter Overflow

**File:** `src/id/id.ts:64-66`
**Severity:** CRITICAL

```typescript
counter++ // When counter exceeds 0xFFF, it overflows into timestamp bits!
let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)
```

---

#### 2.3 Token Estimation Inaccuracy

**File:** `src/util/token.ts`
**Severity:** HIGH

```typescript
const CHARS_PER_TOKEN = 4 // Outdated heuristic!
```

Modern models vary: English (3.5-4), Code (2-3), CJK (1-1.5)

---

#### 2.4 Race Condition in Lock Mechanism

**File:** `src/util/lock.ts`
**Severity:** CRITICAL

```typescript
lock.waitingWriters.push(() => {
  lock.writer = true  // Set AFTER resolve!
  resolve({ [Symbol.dispose]: () => { ... } })
})
```

Readers can start before writer begins execution.

---

#### 2.5 TOCTOU in Storage.update()

**File:** `src/storage/storage.ts`
**Severity:** CRITICAL

```typescript
const content = await Bun.file(target).json()
fn(content) // Mutation in-place during lock
```

---

#### 2.6 Non-Atomic Sync Append

**File:** `src/sync/index.ts`
**Severity:** HIGH

```typescript
await saveEvents(projectID, events)
await saveSequence(projectID, sequence) // Not atomic!
```

---

### 3. MEMORY & RESOURCE ISSUES

#### 3.1 Unbounded autoBackgroundedTasks

**File:** `src/cli/cmd/tui/routes/session/index.tsx`
**Severity:** HIGH

```typescript
const autoBackgroundedTasks = new Set<string>() // Grows forever!
```

---

#### 3.2 Permission Bypass via bypassAgentCheck

**File:** `src/tool/task.ts:378-389`
**Severity:** CRITICAL

```typescript
const bypass = Boolean(ctx.extra?.bypassAgentCheck)
if (!bypass) await ctx.ask({...})  // Can be bypassed!
```

---

#### 3.3 Infinite Delegation Loops

**File:** `src/tool/task.ts:282-350`
**Severity:** HIGH

No depth limit on nested task-to-task delegation.

---

#### 3.4 Doom Loop Detection Only Sequential

**File:** `src/session/processor.ts:144-169`
**Severity:** MEDIUM

Only detects 3 consecutive identical calls. Pattern `A → B → A` evades detection.

---

### 4. ERROR HANDLING ISSUES

#### 4.1 156 Empty Catch Blocks

**Files:** Throughout codebase
**Severity:** HIGH

Empty catch blocks swallow errors with no logging, making debugging impossible.

---

#### 4.2 Silent Error Swallowing in parseStreamError

**File:** `src/provider/error.ts:78-83`
**Severity:** MEDIUM

```typescript
} catch {
  if (isOverflow(input)) return {...}
  return undefined  // All other errors swallowed!
}
```

---

#### 4.3 Type Coercion Bug in retry.ts

**File:** `src/session/retry.ts:39`
**Severity:** MEDIUM

Function expects `MessageV2.APIError` but receives `ReturnType<NamedError["toObject"]>`.

---

#### 4.4 InitError Missing Message Field

**File:** `src/provider/provider.ts:1510-1515`
**Severity:** LOW

Error cause message is lost.

---

---

## 🟡 WARNINGS (Should Fix)

### CLI & Entry Points

| Issue                              | File                     | Line    |
| ---------------------------------- | ------------------------ | ------- |
| Double `process.exit()` in finally | `src/index.ts`           | 178-184 |
| Race condition in state create     | `src/project/state.ts`   | 12-28   |
| Orphaned promise in project.ts     | `src/project/project.ts` | 139-144 |
| Triple `file.stat()` call          | `src/cli/cmd/run.ts`     | 293-303 |
| Missing Type Safety (`any[]`)      | `src/cli/cmd/run.ts`     | 286     |

### Tool System

| Issue                    | File               | Line  |
| ------------------------ | ------------------ | ----- |
| Edit race condition      | `src/tool/edit.ts` | 91-95 |
| Sync fs in async context | `src/tool/read.ts` | 49    |
| Grep glob injection      | `src/tool/grep.ts` | 49-51 |
| Silent catch in GlobTool | `src/tool/glob.ts` | 47-50 |

### Server/API

| Issue                           | File                           | Line    |
| ------------------------------- | ------------------------------ | ------- |
| Console.error instead of log    | `src/server/routes/session.ts` | 218-221 |
| Weak ID validation (z.string()) | Multiple routes                | -       |
| WebSocket URL from header       | `src/server/proxy.ts`          | 65, 127 |
| No rate limiting on auth        | `src/server/routes/users.ts`   | 106-110 |
| SQL LIKE injection              | `src/db/users.ts`              | 320-328 |

### Session/Message

| Issue                       | File                        | Line  |
| --------------------------- | --------------------------- | ----- |
| Messages reversed twice     | `src/session/index.ts`      | 418   |
| Part sorting by string      | `src/session/message-v2.ts` | 775   |
| Token sum missing reasoning | `src/session/index.ts`      | 39-40 |

### TUI Components

| Issue                        | File                             | Line       |
| ---------------------------- | -------------------------------- | ---------- |
| Race in background detection | `src/cli/cmd/tui/app.tsx`        | 75-133     |
| any types in KV store        | `src/cli/cmd/tui/context/kv.tsx` | 11, 42, 45 |
| Fire-and-forget dispose      | `src/cli/cmd/tui/app.tsx`        | 285-287    |

### Error Handling

| Issue                            | File                        | Line   |
| -------------------------------- | --------------------------- | ------ |
| Inconsistent naming (PascalCase) | `src/cli/error.ts`          | 7, 43  |
| Duplicate OutputLengthError      | `src/session/message-v2.ts` | 17     |
| Weak `!!json.error` check        | `src/session/retry.ts`      | 91     |
| retryable() returns string       | `src/session/retry.ts`      | 68-101 |

---

## 💡 SUGGESTIONS (Nice to Have)

### Architecture

1. **Lazy initialization** for module-level async operations
2. **Lock file** for cache version race condition
3. **Circuit breaker** for failing delegations
4. **Transaction pattern** for multi-file storage ops

### Type Safety

1. Replace `any` types with proper generics
2. Add error code constants
3. Use `z.output<>` consistently for output types

### Code Organization

1. Extract embedded CSS/JS in companion routes
2. Break server.ts into smaller route files
3. Implement atomic file writes via rename pattern

### Observability

1. Add delegation depth tracking metrics
2. Add deadlock detection to Lock
3. Document security model for bypassAgentCheck

---

## 📊 Summary Statistics

| Metric                      | Count |
| --------------------------- | ----- |
| Critical Issues             | 28    |
| Warnings                    | 35    |
| Suggestions                 | 28    |
| Empty catch blocks          | 156   |
| NamedError usages           | 78    |
| Untyped `throw new Error()` | 467   |

---

## 🎯 Recommended Priority Fixes

### P0 (Immediate - Security)

1. Fix BashTool command injection
2. Fix path traversal in file routes
3. Fix HTML injection in companion
4. Fix permission bypass via bypassAgentCheck

### P1 (High - Data Integrity)

1. Fix ID generation bitwise NOT bug
2. Fix counter overflow risk
3. Fix lock mechanism race condition
4. Fix TOCTOU in Storage.update()

### P2 (Medium - Reliability)

1. Add rate limiting to auth endpoints
2. Add delegation depth limiting
3. Improve doom loop detection
4. Fix token estimation

### P3 (Low - Polish)

1. Replace 156 empty catch blocks with logging
2. Add proper generics to KV store
3. Implement atomic file writes
4. Add error code constants

---

## ✅ Positive Observations

The codebase demonstrates good practices:

- **Zod validation** - Consistent input validation
- **AsyncLocalStorage DI** - Clean dependency injection
- **Result-style errors** - Tools return error info, don't throw
- **SolidJS patterns** - Proper cleanup with `onCleanup()`
- **Batch updates** - Efficient reactive updates
- **Test coverage** - Real implementations, no mocks

---

_Report generated by 9 parallel code-reviewer agents covering: CLI, Tools, Server, Storage, Session, Agent, Error Handling, TUI, and Security._
