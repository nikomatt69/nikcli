## project

Status: **obsolete as nested API design** (reconciled 2026-07-30). Kept as historical intent only.

### Original goal

Let a single Nikcli process run sessions for multiple projects and different worktrees per project.

### What actually shipped

Multi-project / worktree is real, but the HTTP surface is **flat**, not nested under `/project/:projectID/session/...`.

| Concern                           | Real location                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| List / current / update project   | `GET/PATCH /project` — `packages/nikcli/src/server/routes/project.ts`                |
| Sessions                          | `GET/POST/PATCH/DELETE /session...` — `packages/nikcli/src/server/routes/session.ts` |
| Workspaces / worktrees            | `/workspace` — `routes/workspace.ts`, `src/workspace/*`                              |
| Instance binding                  | `x-nikcli-directory` / `directory` query + `Instance` middleware                     |
| Provider / config for a directory | `GET /provider`, `GET /config` (directory-resolved), not under `/project/:id`        |

Evidence that nested project session API was never the product surface: opencode-parity README notes multi-project is already implemented via project + workspace routes and is **not** part of the parity gap list.

### Actual project routes (2026-07-30)

```
GET  /project              → Project[]
GET  /project/current      → Project
PATCH /project/:projectID  → Project  (name, icon, color, …)
```

### Actual session routes (sample — not nested under project)

```
GET    /session
GET    /session/status
POST   /session
GET    /session/:sessionID
PATCH  /session/:sessionID
DELETE /session/:sessionID
POST   /session/:sessionID/fork
POST   /session/:sessionID/abort
POST   /session/:sessionID/share
DELETE /session/:sessionID/share
POST   /session/:sessionID/summarize
GET    /session/:sessionID/message
POST   /session/:sessionID/message
POST   /session/:sessionID/prompt_async
POST   /session/:sessionID/command
POST   /session/:sessionID/shell
POST   /session/:sessionID/revert
POST   /session/:sessionID/unrevert
POST   /session/:sessionID/permissions/:permissionID
GET    /session/:sessionID/diff
GET    /session/:sessionID/todo
GET    /session/:sessionID/goal
GET    /session/:sessionID/v2/entries|state|events
… plus background, monitor, context, children, instructions, …
```

Directory / project scoping is **middleware + storage keys**, not URL nesting.

### Do not implement

Do not reintroduce `/project/:projectID/session/...` unless product explicitly reverts to nested multi-tenant URLs. Prefer extending `/session` + `/workspace` + instance headers.
