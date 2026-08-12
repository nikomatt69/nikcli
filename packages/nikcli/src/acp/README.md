# ACP (Agent Client Protocol) Implementation

This directory contains an exemplary, protocol-compliant implementation of
the [Agent Client Protocol](https://agentclientprotocol.com/) for nikcli.
The structure mirrors opencode's `packages/opencode/src/acp` package so
that anyone familiar with opencode can navigate nikcli's ACP code (and
vice-versa) without re-learning the layout.

The implementation uses `@agentclientprotocol/sdk` v0.21 — the same
major line opencode uses — so the wire-level behaviour is identical for
any client that already speaks opencode (Zed, JetBrains, etc.).

## Architecture

Each module in `src/acp/` owns a single concern. The protocol surface
(initialize / newSession / prompt / etc.) lives in `service.ts` and is
exposed by a thin `Agent` wrapper in `agent.ts` so it can plug straight
into the JSON-RPC `AgentSideConnection`.

| File               | Responsibility                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.ts`         | `Agent` class that implements the SDK's `Agent` interface; delegates every method to the `service` layer and converts typed errors into JSON-RPC `RequestError`.                                   |
| `service.ts`       | Async service object that owns one ACP connection's lifecycle. Holds the session store, the directory snapshot cache, the event subscription, the permission handler, and the per-method handlers. |
| `session.ts`       | `Store` for live ACP sessions: create/load/get/set/remove + the `knownParts` metadata map the event subscription uses to route streamed deltas.                                                    |
| `directory.ts`     | Builds a per-directory snapshot of providers, modes, commands, and the default model by pulling from the Effect services via `withInstance`.                                                       |
| `config-option.ts` | Builds the `SessionConfigOption[]` payload (model + effort + mode) plus `parseModelSelection` and the stable stringify helpers used for MCP-registration keys.                                     |
| `content.ts`       | Bidirectional conversion between ACP `ContentBlock`s and nikcli `PromptPart`s; lossless for text/image/resource with `audience` annotation round-trip.                                             |
| `tool.ts`          | Maps nikcli tool names to ACP `ToolKind`s / locations; builds the canonical pending / running / completed / errored `ToolCall` updates; renders diff blocks and image attachments.                 |
| `event.ts`         | `Subscription` that consumes the nikcli global event stream and projects `message.part.updated` / `permission.asked` into ACP `session/update` notifications.                                      |
| `permission.ts`    | `Handler` that serializes concurrent permission requests per session, prompts the client via `requestPermission`, applies edit diffs, and replies to the SDK.                                      |
| `usage.ts`         | Token-usage tracking — pulls the latest assistant message, resolves the model's context limit, and emits `usage_update` notifications.                                                             |
| `error.ts`         | Tagged ACP error family (`SessionNotFound`, `InvalidModel`, `InvalidMode`, …) plus `toRequestError` mapping them to the right JSON-RPC code.                                                       |
| `profile.ts`       | Disabled-by-default timing helpers (set `NIKCLI_ACP_PROFILE=1`); output goes to stderr so it doesn't pollute the JSON-RPC stream.                                                                  |
| `types.ts`         | `ACPConfig` type passed by `cmd/acp.ts`; small enough that it doesn't justify a separate `index.ts`.                                                                                               |

### Request flow

```
cmd/acp.ts
  └─ new AgentSideConnection((conn) => factory.create(conn, { sdk }), stream)
       └─ src/acp/agent.ts → Agent implements ACP SDK's Agent
            └─ src/acp/service.ts → make(options)
                 ├─ Store         (session lifecycle)
                 ├─ Subscription  (event → session/update)
                 ├─ Handler       (permission.asked → requestPermission)
                 └─ Snapshot map  (per-directory snapshot cache)
```

## Protocol Coverage

Implemented methods:

- `initialize` — negotiates protocol v1, advertises loadSession,
  mcpCapabilities (http+sse), promptCapabilities (embeddedContext+image),
  sessionCapabilities (close/fork/list/resume), and the
  `terminal-auth`-aware login method.
- `authenticate` — accepts only the configured `nikcli-login` method.
- `session/new` — creates a new nikcli session, snapshots the directory,
  registers the client's MCP servers, and pushes an
  `available_commands_update`.
- `session/load` — restores a saved session, replays the message
  history through the same projection as the live stream, and returns
  the current model/variant/mode as config options.
- `session/list` — merges nikcli's server-side session list with the
  in-memory store and supports cursor-based pagination.
- `session/resume` — same as load but uses a small history window for
  faster cold-starts.
- `session/fork` — calls `session.fork`, restores the fork's metadata,
  and replays its history.
- `session/close` — removes the live session and best-effort aborts
  the backing nikcli session.
- `session/cancel` — cancels the in-flight turn on the backing session.
- `session/set_model` / `session/set_mode` — mutates the session store
  and re-emits the canonical `configOptions` payload.
- `session/set_config_option` — single entry point for `model` /
  `effort` / `mode` changes via the unified selector.
- `session/prompt` — converts ACP content blocks to nikcli parts,
  detects slash commands (`/compact`, `/<command>`), and forwards the
  rest to `session.prompt`. Emits a `usage_update` after every turn.

Planned / not yet implemented (extensions via the SDK's `extMethod`):

- terminal creation (`createTerminal`, `terminalOutput`,
  `waitForTerminalExit`, `killTerminal`, `releaseTerminal`)
- document notifications (`unstable_didOpenDocument` et al.)
- NES (next-edit-suggestions) endpoints

## Usage

### As a CLI

```bash
# Start the ACP server in the current directory
nikcli acp

# Start in a specific directory (overrides --cwd)
nikcli acp --cwd /path/to/project
```

### As a library

```ts
import { ACP } from "@/acp/agent"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { createNikcliClient } from "@nikcli-ai/sdk/httpapi"

const sdk = createNikcliClient({ baseUrl: "http://127.0.0.1:4096" })
const stream = ndJsonStream(stdout, stdin)

const factory = await ACP.init({ sdk })
new AgentSideConnection((conn) => factory.create(conn, { sdk }), stream)
```

### Integration with Zed

Add to your Zed configuration (`~/.config/zed/settings.json`):

```json
{
  "agent_servers": {
    "Nikcli": {
      "command": "nikcli",
      "args": ["acp"]
    }
  }
}
```

## Configuration

`ACPConfig` (`./types.ts`) is the typed boundary between the protocol
layer and the rest of nikcli:

```ts
interface ACPConfig {
  sdk: NikcliClient
  defaultModel?: { providerID: string; modelID: string }
  cwd?: string
}
```

## Testing

```bash
# Unit + integration tests for the ACP module
bun test test/acp

# Smoke-test the CLI directly
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"smoke","version":"0.1.0"}}}' \
  | bun run src/index.ts acp
```

The test suite covers:

- `error.test.ts` — tagged errors and `toRequestError` mapping
- `tool.test.ts` — tool kind, location, attachment, diff, shell snapshot
- `content.test.ts` — content block conversion (text/image/resource/file://)
- `config-option.test.ts` — model/effort/mode selectors and parsing
- `session.test.ts` — session store lifecycle and metadata
- `agent.test.ts` — JSON-RPC handshake against the Agent

## Design Decisions

### Effect services where they help, plain async where they don't

opencode leans heavily on Effect for every ACP method. We adopted the
shape of the service layer (a single object exposing async methods per
ACP request) but kept the internals on plain async/await with a single
Effect call (`withInstance`) to bridge into the directory scope. The
result is a protocol boundary that's easy to read and unit-test without
spinning up the Effect runtime.

### `Store` instead of `Ref<State>`

opencode uses `Effect.Ref` for the session map; we use a plain
`Map`-backed class. Session mutations are serialized per-connection by
the JSON-RPC layer's request handler, and the store only lives for one
connection's lifetime, so contention is not a concern.

### Backwards-compatible aliases

`ACPSessionManager` is still exported from `session.ts` so any caller
that imported it from the pre-refactor implementation keeps working.
`ACP.init({ sdk })` + `factory.create(conn, { sdk })` is also preserved
so `cmd/acp.ts` and external scripts need no changes.

### Modular file structure mirrors opencode

Anyone who already knows opencode's ACP layout can navigate nikcli's
package in seconds. Each module is small enough to review in isolation,
and the protocol boundary is enforced by the service layer's typed
errors.

## References

- [ACP Specification](https://agentclientprotocol.com/)
- [TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk)
- [opencode ACP implementation](https://github.com/anomalyco/opencode/tree/dev/packages/opencode/src/acp)
