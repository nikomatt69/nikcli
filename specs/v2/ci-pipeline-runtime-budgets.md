# CI Pipeline Runtime Budgets

| Field  | Value                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | **Proposed**                                                                                                                                   |
| Scope  | `script/ci-validate.ts`, `script/test-ci.ts`, `script/check-railway-context.ts`, `script/check-docker-versions.ts`, `script/railway-deploy.sh` |

The question this records: what are the operational constraints of `ci-pipeline`, how are they enforced, and what failures the pipeline must refuse to paper over.

The answer is a **sharded-by-memory runtime with a validated release surface**: the nikcli test suite is sharded because the per-process memory cost is real, the railway deploy is gated by preflight checks because the `--detach` flag reports success before building, and the contract is the enforceability of those constraints in CI.

## The Surface

The pipeline is `script/ci-validate.ts`. The test sharding is `script/test-ci.ts`. The railway preflight is `script/check-railway-context.ts`, `script/check-docker-versions.ts`, and the preflight inside `script/railway-deploy.sh`. The pipeline is the gate; the scripts are the rules.

## The Memory Constraint

### 1. The 350-file suite memory model

The nikcli test suite is ~350 files. Each file builds a nikcli instance and a SQLite database. The per-process memory cost is roughly 80 MB per file. The reason is the side effects of constructing a `Server` instance: the runtime, the repos, the migrations, the in-memory caches. The cost is the same on every file, irrespective of what the file tests.

The math is the budget. A 16 GB runner running the suite in a single `bun test` process:

- 350 files × 80 MB = ~28 GB
- The runtime reaches 14.5 GB at file 175
- The OOM killer fires at 16 GB
- The job exits 143

The pipeline cannot run the suite in a single process.

### 2. `script/test-ci.ts` and the sharding

The sharding is `script/test-ci.ts`. The script splits the suite into short-lived bun processes — each batch is a separate invocation, with `--isolate` and `--parallel=1` to keep the suite single-threaded inside the batch. The benefit is the memory ceiling: a batch reaches the suite's per-file cost but the next batch is a fresh process.

The two halves matter:

- **Isolation per file** — `--isolate` guarantees the next file is a fresh process. The next file's nikcli instance is a fresh process. The leak does not chain.
- **Memory ceiling per batch** — the batch size is bounded by the per-batch memory ceiling. A batch that grows above the ceiling is the script's terminator.

The sharding is not optional. A single-process `bun test` against the suite is what produced the 14.5 GB at file 175. The CI pipeline does not run the suite in a single process.

### 3. Why the nikcli suite does not run in CI

The pipeline runs `script/ci-validate.ts`, which executes the cheaper checks: typecheck, generate:httpapi-clients, check:routes, and the railway preflight. The full nikcli suite does **not** run. The reason is the memory cost; the sharding is the half-measure that does not pay for itself.

The decision is recorded in `packages/nikcli/AGENTS.md:55-95`. The suite is run locally via `bun run test:ci`, which uses the same sharding script. The CI pipeline does not run it.

The release gates are separate. `publish` needs `validate`; `railway-deploy` needs `publish`. The release path is typecheck-gated, not test-gated.

### 4. Windows-compat.yml

Windows compatibility is checked by `windows-compat.yml`. The four suites that run on real Windows are:

- `test/cli/double-esc.test.ts`
- `test/session/restart-continuation.test.ts`
- `test/config/worktree.test.ts`
- `test/util/...`

The four run in ~40s on real Windows. The check is the operator's signal that the cross-platform surface is intact. The check is `critical: true`; a failure fails the pipeline.

## The Railway Deploy

### 1. The `--detach` footgun

Railway's `--detach` API reports success when the upload is accepted, not when the build has run. A deploy that fails to build looks green. The pipeline must catch this.

The `--detach` footgun is recorded in `packages/nikcli/AGENTS.md:55-95`. The pipeline refuses to ship a deploy that has not been preflighted.

### 2. The three guards

The guards are wired into `ci-validate.ts`:

1. **`script/check-railway-context.ts`** — reads the railway context and verifies the workspace, project, and environment match the expected configuration. A drift fails the check.
2. **`script/check-docker-versions.ts`** — checks the pinned Docker versions against the lockfile. The versions are the runtime; a mismatch is a deploy-time surprise.
3. **Preflight inside `script/railway-deploy.sh`** — runs before the deploy. The script checks the per-deploy preconditions: the image is buildable, the env vars are set, the secrets are present.

The three guards are independent. A missing guard is a known failure; a missing guard is quoted in `packages/nikcli/AGENTS.md:55-95`.

### 3. The release gates

`publish` needs `validate`. `railway-deploy` needs `publish`. The release path is:

```
typecheck → generate:httpapi-clients → check:routes → publish
railway-deploy (after publish) → railway preflight
```

The pipeline refuses to skip a step. The pipeline is the gate; the steps are the contract.

## The CI Must Never Be Left Failing

`packages/nikcli/AGENTS.md:55-95` records the rule: **CI must never be left failing**. The pipeline going red is never acceptable and is never "someone else's problem". A change that turns the pipeline red is fixed before any other work.

The anti-patterns are documented:

- **Skipping a failing test.** The change is the test; the failure is the signal.
- **Quarantining a test.** A test that is quarantined is a test that is skipped, with documentation. The CI does not have a quarantine mode.
- **Flipping a step to `critical: false`.** A step that is non-critical is a step that is ignored. The pipeline ignores what is non-critical.
- **Re-running a job hoping for a different answer.** The CI is deterministic; the re-run is a delay.

The rule is the contract: the pipeline is green or the change is reverted.

## Alternatives Rejected

**Running the suite in CI with more RAM.** Rejected because the runner is a 16 GB runner and the suite is 28 GB. The bottleneck is the suite, not the runner.

**Running the suite in CI with a smaller batch size.** Rejected because the suite is already sharded; the smaller batch is what kicked the per-file cost up to 80 MB. The cost is the per-file cost; the sharding is the ceiling.

**A `--detach` deploy without preflight.** Rejected because the footgun is real. The deploy looks green; the build is red; the operator finds out in production.

**Per-suite `critical: false` flags.** A failing util test as `critical: false`. Rejected because the util tests are the foundation. The flag is the bypass.

## Invariants

- The nikcli suite does not run in CI. The release is typecheck-gated.
- The CI pipeline refuses to run a single-process `bun test` against the suite.
- The four Windows-compat suites are `critical: true` and run on real Windows.
- The railway deploy is preflighted by three guards. A missing guard is a failure.
- `publish` needs `validate`. `railway-deploy` needs `publish`. The pipeline is the gate.
- The CI is green or the change is reverted. No quarantine. No `critical: false`.
- A failing test is the signal. The signal is the change.

## What Is Explicitly Not Covered

- The local `bun run test:ci` script is the operator's path. The pipeline is the gate.
- The cost of the per-file memory leak. The leak is real; the fix is a separate spec.
- The cross-platform suite beyond the four Windows-targeted files. The signal is the four; the gap is documented.
- The release-gate enforcement on `publish` — the gate is the pipeline; the implementation is the GitHub Action.
