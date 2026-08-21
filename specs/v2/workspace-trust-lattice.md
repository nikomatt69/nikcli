# Workspace Request Proxy

| Field  | Value                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Status | **Proposed**                                                                                                                           |
| Scope  | `src/workspace/index.ts`, `src/workspace/connection.ts`, `src/workspace/session-proxy-middleware.ts`, `src/cli/cmd/workspace-serve.ts` |

The question this records: when a request is about a **remote** workspace, where it is forwarded, and what the local path does.

The answer is **a proxy, not an allow-on-header 403 lattice**. `session-proxy-middleware.ts` resolves a workspace id and, if the target is remote, `ServerProxy.http`s the request there. Local targets fall through. Missing workspace is 404, not 403.

The ROADMAP §later “workspace trust lattice” (per-workspace rulesets, budgets, cross-workspace identity, audit) is **not** this file. That product still has no leftover in the tree.

## The Surface

`withSessionProxy(request, next)` in `src/workspace/session-proxy-middleware.ts`. Only runs when `Installation.isLocal()`. GET is never proxied (`proxySessionRequest` returns immediately).

Identity is a workspace id (`wrk_…`), not `(directory, projectID)`.

## Resolution order

`resolveWorkspaceID`:

1. `WorkspaceContext.workspaceID` if already stamped
2. POST JSON body field `workspaceID`
3. Path `/session/ses_…` → `Session.getAnyProject` → `session.workspaceID`

No match → fall through to `next()`.

## Forward vs local

If the id does not start with `wrk_`, fall through.

`Workspace.get` miss → **404** plain text `Workspace not found: …`.

`Workspace.target`:

- missing or `type === "local"` → fall through (`next()`)
- otherwise `ServerProxy.http(target, req)`

`proxyWorkspaceRequest` is the same idea with an explicit `{ workspaceID, method, url, body, headers, signal }` and builds the `Request` itself.

Headers such as `x-nikcli-workspace` are used by workspace-server routes and `Workspace` clients; they are **not** an allow-list check inside this middleware. Instance directory selection lives in `ServerRouter`, a different seam.

## Standalone vs in-process

`nikcli workspace-serve` boots `Server.listen` for a workspace host. In-process hosting embeds `Workspace` services in the same process. They share `Workspace.Info` and the proxy helper; they do not share a header-match 403.

SSE for a workspace is a separate feed (`src/workspace/sse.ts` if present); this document does not claim it is the only cross-boundary channel until that file is the one being changed.

## Alternatives Rejected

**Per-workspace SQLite.** The rest of nikcli is one `nikcli.db`. Remote workspaces are other processes, not other files in this host.

**403 on missing header.** A request without a workspace id is a local-instance request. Rejecting it would break the TUI.

## Invariants

- Local installation + non-GET + resolvable remote `wrk_` target → proxy. Anything else → `next()` or 404 if the id is known-missing.
- Workspace id is `wrk_…`. Directory is not the tenant key in this middleware.
- GET is never proxied here.

## What Is Explicitly Not Covered

- Per-workspace permission rulesets, budgets, audit trail (ROADMAP §later).
- How `ServerRouter` binds `directory` / `x-nikcli-directory`.
- Auth tokens for workspace-serve.
