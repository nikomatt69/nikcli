# Project, Directory Binding, and Copies

| Field  | Value                                                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Status | **Current architecture overview** (verified 2026-09-11 against `packages/nikcli/src`)                                                     |
| Scope  | `src/project/*`, `src/effect/instance-state.ts`, `src/server/httpapi/instance-less.ts`, `src/server/httpapi/project.ts`, `src/worktree/*` |
| Buys   | One nikcli server process serving many projects and many worktrees per project                                                            |

## Goal

The same goal opencode states: let a single instance of nikcli run sessions for multiple projects and
different worktrees per project.

nikcli already does this. The document exists because the _mechanism_ is not what the opencode spec
proposes, and the difference is easy to get wrong when porting an upstream route.

## The One Divergence That Matters

Upstream's `specs/project.md` nests everything under a project id:

```text
GET  /project/:projectID/session
POST /project/:projectID/session/:sessionID/abort
```

nikcli does **not**. Every session route is flat and the project is resolved from a **directory the
request names**:

```text
GET  /session
POST /session/:sessionID/abort
```

The directory arrives one of three ways, in this order (`requestedDirectory`,
`src/server/httpapi/instance-less.ts:76`):

1. `?directory=<path>` query parameter
2. `x-nikcli-directory` request header
3. `process.cwd()` of the server process

`ServerRouter.context` uses that same function, so there is exactly one definition of "which
directory is this request about". The value is URI-decoded, falling back to the raw string when the
decode throws.

Upstream treats `?directory=` as the awkward exception at the bottom of its spec ("These are
awkward"). In nikcli it is the rule, and the project id is the derived thing.

## Why Directory, Not Project ID

A project id identifies a repository. A request needs a **worktree**, and one project has many. The
directory is the only input that names both at once: `Project.fromDirectory(directory)` returns
`{ project, sandbox }`, so directory → worktree → project is total, while project → worktree is not.

The persisted data already supports either shape. `session_info` (`src/session/session.sql.ts`)
carries both `project_id` and `directory`, plus a derived `directory_key`
(`Filesystem.comparisonKey(directory)`) written on every upsert so the SQL directory filter is
_exactly_ the JS comparison rather than an approximation of it. Adding project-nested routes later is
a routing change, not a storage migration.

## Instance Resolution

An **instance** is the per-directory container everything else hangs off.

- `src/project/instance.ts` holds a `ScopedCache` keyed by resolved directory. Lookup creates the
  context (`fromDirectory`); `init` is not part of lookup — it is a property of the instance, run by
  `provide` after the entry exists, the same path on first and later acquisition.
- A failed lookup expires immediately so the next caller retries creation. A failed `init` does not
  evict: the instance was already built and other callers may hold it.
- Each entry owns a `ManagedRuntime` whose layer provides `InstanceRef`, so fibers forked onto it see
  the instance without reading `AsyncLocalStorage`.
- Teardown sets `disposed` before the first disposer runs. Accessors throw from that moment;
  `dispose` / `registerDisposer` still resolve off the ambient scope so teardown can finish.

Service state is layered on top of the same key by `InstanceState.make(init, { reloadable })` — see
[v2/catalog-config-plugin-lifecycle.md](./v2/catalog-config-plugin-lifecycle.md) for what invalidates
it and why `reloadable` is opt-in.

`POST /instance/dispose` is one of four instance-**less** roots (`/global`, `/user`, `/account`,
`/instance`). It has to be, because it is the request that destroys the instance a normal request
would have been resolved against.

## Project Identity

`Project.Info` (`src/project/project.ts`):

| Field       | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `id`        | Stable project id, cached in the git directory as a file named `nikcli` |
| `worktree`  | The primary worktree path                                               |
| `canonical` | Realpath of the project root, used for identity comparisons             |
| `vcs`       | `"git"` or absent                                                       |
| `sandboxes` | Additional directories tracked against this project (copies, worktrees) |
| `time`      | `created` / `updated` / optional `initialized`                          |

The id is written to `<gitdir>/nikcli` and read back on later opens, so the identity survives a
rename of the checkout directory and is shared by every worktree of the same repository. When there
is no git directory the id is derived rather than cached.

`Project.Directory` is `{ directory, strategy? }`: the tracked directories of a project, where
`strategy` names how the directory was produced.

## The API As It Exists

`src/server/httpapi/project.ts`, prefix `/project`:

```text
GET    /project                              -> Project[]
GET    /project/current                      -> Project          // from the request's instance
PATCH  /project/:projectID                   -> Project          // { name?, icon? }
GET    /project/:projectID/directory         -> ProjectDirectory[]
POST   /project/:projectID/copy              -> { directory }    // { strategy, directory, name? }
DELETE /project/:projectID/copy                                  // { directory, force }
POST   /project/:projectID/copy/refresh      -> { updated[], removed[] }
```

Everything else — sessions, messages, permissions, files, config, providers, agents — is flat and
directory-bound. There is no `POST /project/init`; discovery happens implicitly when a directory is
first resolved into an instance, and `setInitialized` records the timestamp.

`GET /project/current` is the deliberate shortcut: it answers "which project is this request bound
to" without the caller having to resolve the directory itself.

## Copies

`ProjectCopy` (`src/project/copy.ts`) is nikcli's answer to the upstream "worktree per project"
half of the goal. It has exactly one strategy today: `git_worktree`.

- `create` resolves a free directory name before asking `Worktree.create`, mirroring the slug that
  `Worktree.create` itself applies so the search and the directory git actually creates agree.
- Free-name escalation is `name`, then `name-2` … `name-10`, then give up. `Worktree.create` would
  otherwise fall back to a random word pair, which makes copy directories unpredictable.
- `remove` forwards `force` to `Worktree.remove`. When git refuses (dirty or otherwise unsafe
  worktree) the `WorktreeRemoveFailedError` is translated into a typed `CopyError` carrying
  `forceRequired`, so a client can prompt for confirmation rather than guess.
- `refresh` reconciles the tracked list against what is on disk and reports `{ updated, removed }`.

A copy is registered as a project **sandbox**, which is what makes a session opened in that directory
resolve to the same project id as the primary worktree.

See [v2/workspace-trust-lattice.md](./v2/workspace-trust-lattice.md) for the separate question of
_remote_ directories, and note the naming trap recorded there: a v2 "Workspace" upstream is a
sandboxed compute environment, not nikcli's workspace.

## What Is Not Modeled

- **No project-scoped session routes.** Listing sessions for a project that spans three worktrees
  means three directory-scoped calls, or the flat `GET /session` list filtered client-side. The data
  supports the nested form; the routes do not expose it.
- **No project-level delete.** Removing a project means removing its copies and letting the instance
  cache expire. There is no endpoint that forgets a project id.
- **`strategy` is open but singular.** `Project.Directory.strategy` is a free string while
  `ProjectCopy.Strategy` is the literal `"git_worktree"`. A second strategy (plain copy, remote
  mount) would widen the copy union, not the directory record.

## Open Questions

- Should `GET /session?projectID=` exist as the aggregation path, or should nested routes land
  instead? The nested form matches upstream and would make cross-worktree listing one call; the flat
  form keeps one directory-resolution rule for the whole server.
- Should `POST /project/init` exist as an explicit step, or is implicit discovery on first resolution
  the contract? Today `time.initialized` is recorded but nothing requires it before use.
