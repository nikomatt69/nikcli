# CI Pipeline Runtime Budgets

| Field  | Value                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status | **Accepted and implemented** (reconciled against the source 2026-09-07, C3)                                                                                                    |
| Scope  | `script/ci-validate.ts`, `script/test-ci.ts`, `script/check-railway-context.ts`, `script/check-docker-versions.ts`, `script/check-patched-deps.ts`, `script/railway-deploy.sh` |

The question this records: what are the operational constraints of `ci-pipeline`, how are they enforced, and what failures the pipeline must refuse to paper over.

The answer is a **memory-bounded validation surface**: the nikcli test suite does not run in CI because its per-file memory cost is real, the checks that stand in for it are static and finish in seconds, the guards on the release path have a suite of their own that does run, and the Railway deploy is preflighted because `--detach` reports success before it has built anything.

## The Surface

The pipeline is `script/ci-validate.ts`. The test sharding used everywhere else is `script/test-ci.ts`. The release-path guards are `script/check-railway-context.ts`, `script/check-docker-versions.ts`, `script/check-patched-deps.ts`, and the preflight inside `script/railway-deploy.sh`. The pipeline is the gate; the scripts are the rules.

The contributor rule these encode is in the **root** [`AGENTS.md`](../../AGENTS.md) under `## CI`. It is not in `packages/nikcli/AGENTS.md`, which owns the HTTP and schema guardrails instead.

## The Memory Constraint

### 1. The 350-file suite memory model

The nikcli test suite is ~350 files. Each file builds nikcli instances and SQLite databases whose memory is never returned to the OS, so RSS climbs for the length of the run. The cost is roughly 80 MB per file and is the same on every file, irrespective of what the file tests.

The math is the budget. A ~16 GB runner running the suite in a single `bun test` process:

- 350 files × 80 MB ≈ 28 GB
- The runtime reaches 14.5 GB at file 175
- The runner is killed and the job exits 143

`critical: false` cannot contain that: the step is not what died, the runner is.

### 2. `script/test-ci.ts` and the sharding

`script/test-ci.ts` splits the suite into short-lived bun processes. Each batch is a separate `bun test --smol --parallel=1` invocation over an explicit file list, and the batch size defaults to 25 (`--batch=N` to change it, `--dry-run` to print the partition without running it).

The two halves are orthogonal and both are load-bearing:

- **Isolation per file** — `--parallel=1` implies `--isolate`, so each file gets a fresh global and module registry. Without it a top-level `beforeEach` registered by one file escapes into the root scope and runs before every later file in the batch.
- **Memory ceiling per batch** — the batch is a short-lived process whose heap the kernel reclaims on exit, capping peak RSS at roughly batch-size × per-file cost instead of at suite length.

Dropping either brings back a different bug.

### 3. What runs in CI and what does not

`ci-validate.ts` runs, in order: install (`--frozen-lockfile`), typecheck, the route-coverage gate, generated-HttpApi-client drift, formatting, lint, **the release-guard tests**, the two shell syntax checks, the Docker version check, the patched-dependency check, the Railway upload-context check, and the PowerShell syntax check. Every step is blocking; there is no `critical: false` in the array.

The **nikcli suite does not run**, in `ci-validate.ts` or in `test.yml`. Sharding stopped the crash but left the job spending 2.5 minutes to print `Validation passed (non-blocking failures: Run tests)` — the cost paid and the failures ignored, which is worse than not running them. The release path is gated on typecheck plus these static checks. Run the suite with `bun run test:ci` in `packages/nikcli`.

The **release-guard suite does run** (C3, 2026-09-07). `test/release` is 8 files that import `bun:test`, `node:fs`, `node:path` and `Bun.spawn`; they construct no nikcli instance and no database, so none of the per-file cost in §1 applies to them — 229 tests in about 9s. They are the only tests of the guards below, and until C3 no workflow ran them: a guard neutered into a no-op left every signal a reviewer reads green, which is the C1 silent-drift shape one level up, in the detector rather than in what it detects. The step is placed **before** the guards it covers, so a broken guard reads as a failing guard test rather than as the repository violating the guard.

That suite must stay hermetic, because `ci-validate.ts` is also re-run by the autofix job, which has a real `GITHUB_TOKEN` in scope. A case asserting the absence of a credential passes it as `""` rather than inheriting the runner's environment.

### 4. `windows-compat.yml`

Windows compatibility is a separate workflow, not a `ci-validate.ts` step. It runs `bun run typecheck` (with `NODE_OPTIONS=--max-old-space-size=8192`, because tsc on `windows-latest` otherwise exits 134 on the default 4 GB V8 heap) and four targeted test scopes, in `packages/nikcli`, on a `pwsh` × `cmd` matrix:

- `bun test test/tui/util/double-esc.test.ts`
- `bun test test/session`
- `bun test test/config test/worktree`
- `bun test test/util`

They run in about 40s and they pass. They were briefly deleted when test execution was stripped from CI and then put back: the rule is to remove what is broken or unaffordable, never what works. The workflow also asserts Windows runtime invariants (drive-letter file-URL round-trip, `Global.Path` under AppData) and a packaging smoke.

## The Railway Deploy

### 1. The `--detach` footgun

Railway's `--detach` reports success when the upload is accepted, not when the build has run. A deploy that fails to build looks green. The pipeline must catch this before the upload.

### 2. The guards

Wired into `ci-validate.ts`, all blocking:

1. **`script/check-railway-context.ts`** — `.railwayignore` filters the repo-root `railway up` upload. A rule that drops something `Dockerfile.serve` copies fails the Railway build, not CI.
2. **`script/check-docker-versions.ts`** — reads root `package.json` `packageManager` and `packages/nikcli/package.json`; every tracked Dockerfile and compose file must defer its `NIKCLI_VERSION` to build time rather than pin a literal, its Bun image tags and build-arg defaults must match the pinned runtime (floating tags included), and no positional Effect install may change the workspace graph the repository just validated (C2). It does **not** read the lockfile.
3. **`script/check-patched-deps.ts`** — reads `bun.lock`, so it answers the same before and after an install. `patchedDependencies` is keyed by an exact `name@version`, so a version bump silently stops the patch applying and bun says nothing. It fails on a patch whose version is not installed, a missing patch file, a patch file nothing references, and a workspace resolving to a version no patch covers.
4. **Preflight inside `script/railway-deploy.sh`** — builds the upload context, then refuses to upload if any path `Dockerfile.serve` copies is missing from it. `ci-validate.ts` additionally parses the script with `bash -n`, because a syntax error in a `--detach` deploy surfaces as a failed build nobody is watching.

`test/release/docker-versions.test.ts` and `test/release/patched-deps.test.ts` exercise (2) and (3) against synthetic fixture roots rather than the live tree, so they pin behavior instead of today's state.

### 3. The release gates

`publish` needs `validate`. `railway-deploy` needs `publish`. Direct snapshot and manual publishes run `ci-validate.ts` themselves unless the `ci-pipeline` caller marks them prevalidated. A missing `RAILWAY_TOKEN` is a failed required deploy, not a successful skip.

## The CI Must Never Be Left Failing

The root `AGENTS.md` records the rule: **CI must never be left failing.** `ci-pipeline` going red is never acceptable and is never "someone else's problem". A change that turns it red is fixed before any other work, and a red pipeline is never a reason to stop and wait for review.

Never get to green by weakening the signal:

- **Skipping, deleting or quarantining a test.** The failure is the signal.
- **Flipping a step to `critical: false`.** A non-critical step is an ignored step — and it does not even work as a bypass when the failure took the runner with it.
- **Re-running a job hoping for a different answer.**

## Alternatives Rejected

**Running the nikcli suite in CI with more RAM.** The runner is ~16 GB and the suite needs ~28 GB. The bottleneck is the suite.

**Running the nikcli suite in CI sharded.** Sharding fixes the crash, not the economics: 2.5 minutes for a result the job then reported as non-blocking.

**Treating the release-guard suite as "tests in CI" and leaving it out.** Rejected by measurement: the rule is about the ~350-file suite's memory cost, and `test/release` has none of it. Leaving it out bought nothing and left every release guard untested.

**A `--detach` deploy without preflight.** The deploy looks green, the build is red, and the operator finds out in production.

## Invariants

- The nikcli suite does not run in CI. The release path is gated on typecheck plus static checks.
- `ci-validate.ts` never runs a single-process `bun test` over the whole suite.
- `test/release` runs in `ci-validate.ts`, blocking, before the guards it covers.
- No step in `ci-validate.ts` is `critical: false`.
- The Windows-compat scopes run on real Windows and stay as long as they pass.
- The release path is preflighted by four guards. A missing guard is a failure.
- `publish` needs `validate`. `railway-deploy` needs `publish`.
- The CI is green or the change is reverted. No quarantine. No `critical: false`.

## What Is Explicitly Not Covered

- The per-file memory leak itself. It is real; fixing it is a separate item that does not exist yet.
- The cross-platform surface beyond the four Windows-targeted scopes.
- `test/server`, which still runs in no workflow — recorded by E9 in [ROADMAP.md](../ROADMAP.md) and not closed by C3.
