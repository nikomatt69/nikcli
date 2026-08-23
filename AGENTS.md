# nikcli Repository

nikcli is a fork of [OpenCode](https://github.com/anomalyco/opencode). Much of the structure below comes from
there — when in doubt about why something is shaped the way it is, check upstream first.

## Key Commands

- **Test nikcli**: `bun run dev` in `packages/nikcli`
- **Regenerate HTTP clients**: `bun run generate:httpapi-clients` in `packages/nikcli`
- **ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE**
- **Default branch**: `live-main`

## Monorepo Structure

This is a Bun monorepo. Key packages:

- `packages/nikcli` - Main CLI application
- `packages/sdk` - API client SDK
- `packages/studio` - Desktop UI
- `packages/plugin` - Plugin system
- `packages/remote` - Remote execution
- `packages/companion` - Companion services

## Development Guidelines

- **Package manager**: Bun (use `bun install`, `bun update`)
- **Type checking**: `bun run typecheck`
- **Testing**: `bun test` (single file: `bun test test/path/file.test.ts`)
- **Build**: `bun run build`
- **HttpApi route coverage** (nikcli): `bun run check:routes` in `packages/nikcli`. `--strict` is honored as of 2026-08-17 (H4 landed `AccountGroup` + `ConfigManagementGroup.profilesList`; the script reads `process.argv`). Today `--strict` is the same rules as default; future strict-only checks land in `script/check-route-coverage.ts`.

## HTTP integration

The nikcli server is Effect `HttpApi` on `Bun.serve`. There is no Hono app.
The contract lives in `packages/nikcli/src/server/httpapi/*` and **is** the
source for both OpenAPI and the generated clients.

To change any HTTP endpoint: edit the group in `src/server/httpapi/`, then run
`bun run generate:httpapi-clients` from `packages/nikcli`. Full workflow,
schema rules, and verification steps are in `packages/nikcli/AGENTS.md`
("HTTP integration workflow").

Consumers import `@nikcli-ai/sdk/httpapi`. There is no hey-api step and no
`v2` client any more — `packages/sdk/js/script/build.ts` now regenerates from
the contract and emits `dist`, so running it is safe.

## Important Rules

1. **No mocks/placeholders**: All code must be production-ready, no TODO/FIXME placeholders
2. **Minimize new files**: Prefer modifying existing files over creating new ones
3. **Parallel execution**: Use background tasks for independent work
4. **Client regeneration**: After changing an HTTP contract in `packages/nikcli/src/server/httpapi/`, run `bun run generate:httpapi-clients` and commit the generated output
5. **Custom tool autoload**: config-dir `tool/*.ts` requires `NIKCLI_ALLOW_PLUGIN_AUTOLOAD=1` or `tool.allow`/`tool.pin` — see `packages/nikcli/AGENTS.md`
6. **CI must never be left failing — no exceptions.** `ci-pipeline` going red is
   never acceptable and is never "someone else's problem". If a change of yours
   turns it red, fixing it comes before any other work, and a red pipeline is
   never a reason to stop and wait for review. Never get to green by weakening
   the signal: do not skip, delete or quarantine a test, do not flip a step to
   `critical: false` to hide a failure, and do not re-run a job hoping for a
   different answer. Fix the cause.

## CI

`ci-pipeline` runs `script/ci-validate.ts`. Two failure modes have bitten this
repo more than once — check them before changing anything in that file:

- **The nikcli suite does not run in CI — do not add it back.** Not in
  `ci-validate.ts`, not in `test.yml`. Releases gate on typecheck: `publish`
  needs `validate`, and `railway-deploy` needs `publish`.

  This is about the ~350-file suite specifically, not about tests in general.
  `windows-compat.yml` still runs four targeted suites (double-esc, session,
  config + worktree, util) on real Windows in ~40s, and they stay: they pass,
  and a check that passes is signal worth keeping. The rule is only ever to
  remove what is broken or unaffordable, never what works.

  The reason is not taste. The suite leaks roughly 80 MB per test file (each one
  builds nikcli instances and SQLite databases), so all ~350 files in one bun
  process reached 14.5 GB on a ~16 GB runner and got it killed at file 175. That
  fails the job with exit 143 however the step is marked — `critical: false`
  cannot save a step whose runner is gone. Sharding stopped the crash but left
  the job spending 2.5 minutes to print "Validation passed (non-blocking
  failures: Run tests)", which is worse than not running them: the cost is paid
  and the failures are ignored.

- **To run the whole suite anywhere else**, use `bun run test:ci` in
  `packages/nikcli`. It shards across short-lived bun processes via
  `script/test-ci.ts`, keeping `--parallel=1` (hence `--isolate`) inside each
  batch. Both halves matter: isolation per file, memory ceiling per batch. Do
  not collapse it back into a single `bun test`.
- **A `--detach` deploy reports success before it has built anything.** The
  Railway step only confirms the upload was accepted, so a broken image looks
  green here. The guards that stand in for it are
  `script/check-railway-context.ts`, `script/check-docker-versions.ts` and the
  preflight inside `script/railway-deploy.sh`. Keep them wired into
  `ci-validate.ts`.
- **Generated HttpApi clients are a blocking validation artifact.**
  `ci-validate.ts` regenerates both generated client trees and fails on tracked
  drift. Formatting and lint are blocking there as well; do not make them
  advisory to obtain a green release.
- **Every publish path validates.** The primary `live-main` workflow passes the
  reusable publish workflow `prevalidated: true` only after its `validate` job
  succeeds. Snapshot and manual publishes run `ci-validate.ts` themselves. A
  missing `RAILWAY_TOKEN` is a failed required deploy, not a successful skip.
