# API Map and Context Model

| Field  | Value                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Status | **Accepted and implemented** (documented 2026-09-11)                                                                           |
| Scope  | `src/server/server-router.ts`, `src/server/httpapi/*`, `src/server/httpapi/event-feed.ts`, `packages/tui/src/context/sync.tsx` |
| Tests  | `test/server/server-router.test.ts`, `test/server/httpapi-session.test.ts`, `test/server/event-visibility.test.ts`             |

The question this records: for any nikcli route, **where does runtime context come from** — and what
the wire looks like once it does.

The important design question is not route nesting. It is context resolution. Upstream's
`specs/v2/api.html` says the same thing and reaches three context classes; nikcli already has all
three, resolved in one function.

## Three Context Classes

| Class       | Resolves from                                     | Mounts                                      |
| ----------- | ------------------------------------------------- | ------------------------------------------- |
| **Server**  | Nothing. No instance exists.                      | `/global`, `/user`, `/account`, `/instance` |
| **Request** | `?directory=` / `x-nikcli-directory`, else cwd    | Everything else without a `:sessionID`      |
| **Session** | The session row's own `directory` / `workspaceID` | Any path containing a valid `:sessionID`    |

The four server-scoped roots are declared once as `INSTANCE_LESS_ROOTS` in
`src/server/httpapi/instance-less.ts`. Adding a fifth is a single edit that fails `bun run typecheck`
at every incomplete dispatch table, which is why the list is a const tuple and not a runtime check.

`POST /instance/dispose` has to be in that list: it is the request that destroys the instance a
normal request would have been resolved against.

## The Resolution Chain

`ServerRouter.context(request)` runs this, in order:

1. `directory = requestedDirectory(request, url)` — `?directory=`, then `x-nikcli-directory`, then
   `process.cwd()`. URI-decoded, falling back to the raw string when the decode throws.
2. `sessionID = sessionIDFromPath(url.pathname)` — extracted and validated against `Session.ID`. An
   id-shaped segment that is not a valid session id is ignored rather than failing the request.
3. `explicitWorkspace = ?workspace= || x-nikcli-workspace`.
4. If there is a session id **and no explicit workspace**, look the session up with
   `getAnyProject(sessionID)`. The lookup is skipped entirely when the caller already pinned a
   workspace, because the only thing it would have contributed is the workspace.
5. `workspaceID = explicitWorkspace || session.workspaceID`.
6. If that workspace resolves and its target is `local`, **the target directory wins** over
   everything above.
7. Otherwise, if the session had a directory, **the session directory wins** over the requested one.

So the precedence is: **workspace target > session row > request > cwd**.

This is upstream's "session-pinned" model, implemented. A client that posts to
`/session/:sessionID/prompt` does not need to send a directory, and if it sends the wrong one the
session's own directory overrides it. The difference from upstream is that nikcli does not make that
a _route class_ — session routes accept request context, they just lose to the session row.

## Route Surface

338 `HttpApi` endpoints, plus raw `Request`/`Response` handlers for the contract-only groups (share,
users, sync stats, SSE feeds, websocket upgrades).

| Mount                                                                              | Endpoints | Context | Owns                                                                                        |
| ---------------------------------------------------------------------------------- | --------- | ------- | ------------------------------------------------------------------------------------------- |
| `/mobile`                                                                          | 115       | request | The companion surface — see [mobile-companion-protocol.md](./mobile-companion-protocol.md)  |
| `/session`                                                                         | 40        | session | Sessions, messages, parts, permissions, todos, v2 entries                                   |
| `/auth` `/config` `/session` `/experimental/workspace` `/account` (contract-extra) | 26        | mixed   | Contract-only routes served by raw handlers                                                 |
| `/loop`                                                                            | 14        | request | [loop-engine-contract.md](./loop-engine-contract.md)                                        |
| `/tui`                                                                             | 14        | request | TUI-specific state                                                                          |
| `/experimental`                                                                    | 13        | request | Unstable surface                                                                            |
| `/mission`                                                                         | 13        | request | [mission-orchestrator-contract.md](./mission-orchestrator-contract.md)                      |
| _(unprefixed)_                                                                     | 11        | request | `/path`, `/vcs*`, `/command`, `/agent`, `/skill`, `/lsp`, `/formatter`, `/instance/dispose` |
| `/mcp`                                                                             | 9         | request | MCP servers, prompts, resources                                                             |
| `/sync`                                                                            | 9         | request | Sync outbox and cursors                                                                     |
| `/experimental/workspace`                                                          | 9         | server  | [workspace-trust-lattice.md](./workspace-trust-lattice.md)                                  |
| `/file` + `/find`                                                                  | 7         | request | File reads, writes, status, text/file/symbol search                                         |
| `/project`                                                                         | 7         | server  | [../project.md](../project.md)                                                              |
| `/analytics` `/profile` `/provider`                                                | 6 each    | request | Catalog and profile surfaces                                                                |
| `/pty`                                                                             | 5         | request | PTY lifecycle                                                                               |
| `/connectors` `/discord`                                                           | 4 each    | request | External integrations                                                                       |
| `/chatbot` `/config` `/question`                                                   | 3 each    | request | Resolved config, pending questions                                                          |
| `/brain` `/global` `/permission`                                                   | 2 each    | mixed   | `/global` is server-scoped; the others are request                                          |
| `/doctor` `/voice`                                                                 | 1 each    | request | Diagnostics, TTS                                                                            |

The mobile surface is a third of the route count. That is not an accident of growth — it is a
separate client with its own auth and its own permission-reply union, documented separately.

## Event Envelope

nikcli has **two** wire shapes, and the difference is load-bearing:

```ts
// GET /event          — the instance feed
{ type: "message.part.updated", properties: { …payload } }

// GET /global/event   — the cross-instance feed
{ payload: { directory: "/repo/app", payload: { type, properties } } }
```

The TUI reads `data.type` on one and `envelope.payload.type` on the other. Serving the wrong shape
does not error — it silently drops every event client-side, which is why `event-feed.ts` carries both
an `Envelope` and a `TypeOf` per feed rather than assuming a `type` at the top level.

Each connection has a lag budget of `LAG_BUDGET = 4096`. A client that falls further behind is
dropped rather than retained — see [event-stream-architecture.md](./event-stream-architecture.md).

Visibility is declared on the event, not listed in the feed. `BusEvent.define(type, props, {
visibility: "internal" })` withholds an event from both feeds **and** from the generated `Event`
union, so no client can type against something it will never receive. A list kept away from the thing
it describes is the shape that drifts, and the failure — an internal event quietly going public —
would report itself nowhere. See [public-event-filter.md](./public-event-filter.md).

### Divergence: no `context` on the envelope

Upstream proposes one envelope carrying runtime identity explicitly:

```ts
type ApiEvent<Payload> = {
  id: string
  type: string
  time: number
  context: { directory: string; workspaceID?: string }
  payload: Payload
}
```

nikcli's instance feed carries **no context at all** — the connection _is_ the context, because the
feed was opened against a resolved instance. The global feed carries `directory` but not
`workspaceID`, and no `id` or `time`.

Adopting the upstream envelope would buy one shape instead of two, and would let a single connection
multiplex several directories. It costs a breaking change to every client that reads `data.type`.
That trade has not been made; it is listed in [todo.md](./todo.md) rather than decided here.

## Frontend Sync Store

`packages/tui/src/context/sync.tsx` keeps one flat Solid store, keyed by entity id:

```ts
{
  status: "loading" | "partial" | "complete"
  degraded: string[]                              // best-effort resources that failed, by request name
  provider, provider_default, provider_next, provider_auth
  agent, command, config, path, workspaceList
  session: Session[]
  session_status, session_pending, session_instructions, session_goal
  message:  Record<SessionID, Message[]>
  part:     Record<MessageID, Part[]>
  entry:    Record<SessionID, SessionEntry[]>     // the v2 read model, live off session.entry.updated
  todo, permission, question, session_diff
  background_job, monitor
  lsp, mcp, mcp_resource, connectors, formatter, vcs
}
```

Two details that are easy to misread:

- **`status` answers "has bootstrap finished", not "did everything arrive".** Optional endpoint
  failures go to `degraded`, by request name. Folding one failed connector into `status` left
  machines sitting at `partial` forever, and `partial` gates the empty-provider prompt, which needs
  none of those resources.
- **`entry` is sorted by id, and that is safe** because entry ids derive from the v1 ids they come
  from (`SessionEntry.idForPart` / `idForMessage`), so a delta lands on the entry it updates rather
  than appending a near-duplicate.

### Divergence: no context partition

Upstream partitions runtime data by `contextKey = ${workspaceID ?? "local"}:${directory}` and keeps
durable entities keyed by their own ids alongside it.

nikcli's store is **single-context**: one TUI process, one directory, one flat store. Multi-directory
views are separate processes, not separate partitions in one store. Adopting the partition would be
required before one TUI window could show two worktrees at once; nothing else needs it today.

## Invariants

- Context resolution has exactly one definition. `requestedDirectory` is used by both
  `ServerRouter.context` and the instance-less dispose handler, so "which directory is this request
  about" cannot answer differently in two places.
- A session id in the path overrides the requested directory. A client cannot address a session
  against the wrong instance by sending a stale header.
- An explicit `?workspace=` suppresses the session lookup, and a local workspace target overrides the
  session directory. Explicit beats derived, in both directions.
- An `internal` event reaches in-process `Bus.subscribe` callers and neither SSE feed, and is absent
  from the generated `Event` union.
- The two feed envelopes are per-feed values, never a shared default.

## Alternatives Rejected

**One `/api` prefix.** Upstream mounts everything under `/api/*`. nikcli mounts at the root, and the
generated SDK is the stable caller surface rather than the URL — `client-compat.ts` declares every
endpoint's namespaced path exhaustively, and generation rejects missing, unknown, duplicate,
colliding, or adapter-incompatible entries. Moving the prefix would change every URL and no SDK call.

**Session routes as a distinct context class.** Upstream forbids context input on session routes
entirely. nikcli accepts it and lets it lose. Same outcome for a correct client, one less rule, and a
client that sends a directory out of habit still works.
