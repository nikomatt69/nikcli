# nikcli Agent Guidelines

This file contains guidelines for AI agents operating in the nikcli repository.

## Build/Test Commands

### Package Manager

- **Install dependencies**: `bun install`
- **Lockfile update**: `bun update`
- **Clean**: `bun run clean`

### Development

- **Run nikcli**: `bun run dev` (runs in browser mode)
- **Build**: `bun run build`
- **Watch mode**: Use `--watch` flag with appropriate commands

### Type Checking & Linting

- **Typecheck**: `bun run typecheck` (uses tsgo)
- **Lint**: `bun run lint` (runs tests with coverage)

### Testing

- **Unit (PR-blocker)**: `bun run test` — ignores `*benchmark*` and `*integration*` suites
- **Integration**: `bun run test:integration`
- **Benchmarks**: `bun run test:bench` (or set `NIKCLI_TEST_BENCH=1` to enable preload bookkeeping)
- **E2E / TUI**: `bun run test:e2e`
- **Single file**: `bun test test/tool/tool.test.ts`
- **Pattern**: `bun test --match "pattern"`
- Prefer `withIsolatedDatabase` (`test/helpers/sqlite.ts`) for SQLite-touching suites and `makeToolContext` + `withProjectDirectory` (`test/helpers/tool-context.ts`) for tool behavioural tests

### SDK Generation

- **Regenerate JavaScript SDK**: `./packages/sdk/js/script/build.ts`
- **HttpApi route coverage**: `bun run check:routes` (advisory; pass `--strict` to fail on uncovered Hono routes)

## Security & quality gates

### Logging redaction

- All `Log` serialisation goes through `safeStringify` / `redactUrl` (`src/util/redact.ts`).
- Default on; set `NIKCLI_LOG_REDACT=0` to disable for local debugging.
- Do not bypass `safeStringify` in logging paths.

### Plugin / custom-tool autoload

- Config-dir `{tool,tools}/*.{js,ts}` is **not** imported by default.
- Opt in with `NIKCLI_ALLOW_PLUGIN_AUTOLOAD=1`, or pin via nikcli.json:
  `{ "tool": { "allow": ["my-tool.ts"], "pin": { "my-tool.ts": "<sha256>" } } }`.
- `Plugin.Service` hook tools still load as before.

### Permission coupling

- Explicit map: `PermissionRuleset.TOOL_PERMISSION` (e.g. `monitor` → `bash`, edit-family → `edit`).
- A deny on `bash` covers `monitor`; a deny on `monitor` alone does **not**.

### Stack traces

- User-facing formatters suppress stacks unless `NIKCLI_DEBUG=1` (`formatStack` in `src/cli/error.ts`).

## Code Style Guidelines

### Runtime & Modules

- **Runtime**: Bun with TypeScript ESM modules (`.ts` extension, `"type": "module"` in package.json)
- **File naming**: camelCase for files (e.g., `tool.ts`, `memorySearch.ts`)
- **Module paths**: Use `@/` alias for project-relative imports (e.g., `@/util/fn`)

### Imports

- Use named imports for clarity: `import { Log } from "./util/log"`
- Use `import z from "zod"` (not `import { z }`)
- Use type-only imports where appropriate: `import type { Foo } from "./types"`
- Import Zod schemas as default: `import z from "zod"`

### Naming Conventions

- **Variables/functions**: camelCase
- **Classes/types/interfaces**: PascalCase
- **Namespaces**: PascalCase (e.g., `Tool.define()`, `Session.create()`)
- **Agent names**: kebab-case (e.g., `fast-explore`, `code-reviewer`)

### Type System

- **Validation**: Use Zod schemas for all input validation
- **Type inference**: Use `z.infer<typeof Schema>` for type extraction
- **Metadata types**: Use `Record<string, unknown>` for flexible metadata
- **Avoid `any`**: Prefer specific types or `z.unknown()`

### Zod Schema Patterns

```typescript
// Basic schema definition
const MySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
})

// With metadata
export const Info = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .meta({
    ref: "MyInfo",
  })

// Export types
export type Info = z.infer<typeof Info>
export type Output = z.output<typeof Info>
```

### Error Handling

- Use Result patterns for tool results (return error info in output)
- Avoid throwing exceptions in tool `execute()` methods
- For fatal errors, use `NamedError` from `@nikcli-ai/util/error`
- Storage errors throw `Storage.NotFoundError` for missing resources

```typescript
// In tools, handle errors gracefully
export const MyTool = Tool.define("my-tool", async (args, ctx) => {
  try {
    const result = await riskyOperation()
    return { title: "Success", metadata: {}, output: result }
  } catch (error) {
    return { title: "Error", metadata: {}, output: `Failed: ${error}` }
  }
})
```

### Logging

- Use `Log.create({ service: "name" })` for namespaced loggers
- Log levels: `debug()`, `info()`, `warn()`, `error()`
- Timing: Use `logger.time("operation")` for performance tracking

```typescript
const log = Log.create({ service: "my-service" })

// With timing
using _ = log.time("expensive operation")
// Automatically logs duration when scope exits

// With extra data
log.info("operation completed", { count: 42, status: "ok" })
```

### Storage Patterns

- Use `Storage` namespace for persistence
- Key format: `["collection", "id", ...]` for hierarchical storage
- Use `Storage.read()`, `Storage.write()`, `Storage.update()`, `Storage.remove()`

```typescript
await Storage.write(["session", projectID, sessionID], sessionData)
const data = await Storage.read<Session.Info>(["session", projectID, sessionID])
await Storage.update(["session", projectID, sessionID], (draft) => {
  draft.updated = Date.now()
})
```

### Tool Definition Pattern

```typescript
import z from "zod"
import { Tool } from "@/tool/tool"

export const MyTool = Tool.define("my-tool", async (args, ctx) => {
  // ctx contains: sessionID, messageID, agent, abort, ask, etc.
  return {
    title: "Result Title",
    metadata: {
      /* metadata */
    },
    output: "output text",
  }
})

// With parameter schema
export const ParamTool = Tool.define("param-tool", {
  description: "Does something useful",
  parameters: z.object({
    input: z.string(),
    count: z.number().optional().default(1),
  }),
  execute: async (args, ctx) => {
    return {
      title: "Done",
      metadata: {},
      output: `${args.input} x${args.count}`,
    }
  },
})
```

### Session & Message Patterns

- Use `Identifier.schema("type")` for ID validation (session, message, part)
- Session IDs use descending IDs for natural ordering
- Message parts use ascending IDs for chronological ordering

```typescript
import { Identifier } from "@/id/id"

// Generate new IDs
const sessionID = Identifier.descending("session")
const messageID = Identifier.ascending("message")

// Validate with schema
const validated = Identifier.schema("session").parse(inputSessionID)
```

### Agent Configuration

- Agents defined in `Agent` namespace with default tool permissions
- Primary agents: `ralph`, `build`, `plan`
- Subagents: `explore`, `fast-explore`, `planner`, `code-reviewer`, `debugger`, `test-runner`, `refactor`, `delegator`
- Use `Task` tool with `background: true` for parallel subagent work

### Function Wrappers (fn pattern)

- Use `fn()` wrapper for validated async functions
- Provides `.parse()` and `.force()` methods on the function

```typescript
export const getSession = fn(Identifier.schema("session"), async (sessionID) => {
  return Storage.read<Session.Info>(["session", projectID, sessionID])
})

// Usage
const session = await getSession(sessionID) // auto-validated
getSession.force(unvalidatedInput) // skip validation
```

## Architecture

- **Tools**: Implement `Tool.Info` interface with `execute()` method
- **Context**: Pass `sessionID` in tool context, use `App.provide()` for DI
- **Validation**: All inputs validated with Zod schemas
- **Logging**: Use `Log.create({ service: "name" })` pattern
- **Storage**: Use `Storage` namespace for persistence
- **API Client**: The TypeScript TUI (built with SolidJS + OpenTUI) communicates with the Nikcli server using `@nikcli-ai/sdk`. When adding/modifying server endpoints in `src/server/server.ts`, regenerate the SDK in `packages/sdk/js` to keep types in sync.

## Parallel Execution

- **ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE**: Use `task(background: true)` and `delegation` for parallel work
- Launch multiple agents for independent tasks
- Use `delegator` tool to monitor background tasks

## Important Notes

- **Default branch**: `dev`
- **Test files**: Located in `test/` directory, use `.test.ts` suffix
- **Tool files**: Use kebab-case naming (e.g., `memory-search.ts`)
- **Avoid mocks/placeholders**: All code should be production-ready
- **Modify existing files**: Only create new files when absolutely necessary
