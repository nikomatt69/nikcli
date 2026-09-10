# CI Pipeline Runtime Budgets

| Field  | Value                                                                                                                                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | **Accepted and implemented** (reconciled against the scripts 2026-09-10)                                                                                                                                                         |
| Scope  | `script/ci-validate.ts`, `packages/nikcli/script/test-ci.ts`, `script/check-railway-context.ts`, `script/check-docker-versions.ts`, `script/railway-deploy.sh`                                                                   |
| Tests  | `test/release/ci-targeted.test.ts`, `test/release/ci-coherence.test.ts`, `test/release/automation.test.ts`, `test/release/docker-versions.test.ts`, `test/release/patched-deps.test.ts`, `test/release/release-identity.test.ts` |

The question this records: what are the operational constraints of `ci-pipeline`, how are they enforced, and what failures the pipeline must refuse to paper over.

The answer is a **sharded-by-memory runtime with a validated release surface**: the nikcli test suite is sharded because the per-process memory cost is real, the railway deploy is gated by preflight checks because the `--detach` flag reports success before building, and the contract is the enforceability of those constraints in CI.

## The Surface

The pipeline is `script/ci-validate.ts`, run by the `validate` job in `.github/workflows/ci-pipeline.yml`. The test sharding is `packages/nikcli/script/test-ci.ts` (`bun run test:ci`), which no workflow calls. The railway preflight is `script/check-railway-context.ts`, `script/check-docker-versions.ts`, and the preflight inside `script/railway-deploy.sh`. The pipeline is the gate; the scripts are the rules.

`ci-validate.ts` runs twelve steps in this order, all `critical` (a failure stops the run):

| #   | Step                            | What it refuses to paper over                                                                   |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Install dependencies            | Lockfile drift (`--frozen-lockfile`)                                                            |
| 2   | Typecheck                       | The only correctness signal in the job                                                          |
| 3   | Route coverage gate             | A declared endpoint with no handler (`check:routes --strict`)                                   |
| 4   | Generated HTTP client drift     | Regenerates the clients and fails on a tracked diff                                             |
| 5   | Formatting                      | Blocking since C1; it was advisory before                                                       |
| 6   | Lint                            | Blocking since C1                                                                               |
| 7   | Shell syntax (`install`)        | A broken installer that only fails on a user's machine                                          |
| 8   | Shell syntax (`railway-deploy`) | A parse error that would surface as a silent failed deploy                                      |
| 9   | Docker nikcli version check     | A literal `NIKCLI_VERSION`, and positional installs that change the validated Effect graph (C2) |
| 10  | Patched dependency check        | A `patchedDependencies` key whose version no longer resolves (C1's fifth drift channel)         |
| 11  | Railway upload context check    | A `.railwayignore` rule that drops something `Dockerfile.serve` COPYs                           |
| 12  | PowerShell syntax (install.ps1) | Skipped, not failed, where `pwsh` is absent                                                     |

The order is pinned by `test/release/ci-targeted.test.ts`, which also asserts that formatting and lint stay blocking and that the client-drift step fails on a tracked diff.

## The Memory Constraint

### 1. The 350-file suite memory model

The suite is 385 selected files (`bun run test:ci --dry-run`, 2026-09-10; 21 benchmark/integration files are excluded by `IGNORE_PATTERNS`). Each file builds nikcli instances and SQLite databases whose memory is never returned to the OS, so RSS climbs for the life of the process rather than per file.

The observed failure, which is the budget:

- CI died at file 175 of 348 with one bun process holding 14.5 GB
- `MemAvailable` was 447 MB with no swap
- The runner itself was killed, so the step exited 143

`critical: false` cannot contain that: the runner is gone, not the step. The suite therefore does not run in a single process anywhere.

### 2. `script/test-ci.ts` and the sharding

The sharding is `packages/nikcli/script/test-ci.ts`. It splits the suite into short-lived bun processes: batches of `--batch=` files (default 25, so 16 batches today), each a separate `bun test` invocation handed explicit file paths.

The two halves are orthogonal, and dropping either brings back a different bug:

- **Isolation per file** — `--parallel=1` implies `--isolate`, so every file gets a fresh global and module registry. That is what keeps one file's state out of the next one. It cannot hand memory back, because the process never exits.
- **Memory ceiling per batch** — a batch is a process that exits, and the kernel reclaims its heap. Peak RSS is capped at roughly batch size × per-file cost instead of running to the length of the suite.

File selection is not reimplemented: the ignore patterns are matched with `Bun.Glob`, the same engine `--path-ignore-patterns` uses, and the batches are then given explicit paths. An empty match refuses to report a vacuous pass. `--dry-run` prints the partition and asserts it covers every selected file exactly once.

### 3. Why the nikcli suite does not run in CI

No workflow runs it. `ci-validate.ts` runs the twelve static steps above and no tests at all — the comment at the step list says so, and `.github/workflows/test.yml` says the same from the other side: its matrix was reduced to a single `bun turbo typecheck` entry, with the removal and its reason written into the file. Sharding is what makes the suite runnable on a laptop, not what would make it affordable in the `validate` job.

The consequence is stated plainly rather than hidden: **the release path is typecheck-gated, not test-gated.** `publish` needs `validate`; `railway-deploy` needs `publish`. Both gates are pinned by `test/release/automation.test.ts` and `test/release/ci-coherence.test.ts`.

The suite is run with `bun run test:ci` in `packages/nikcli`.

### 4. Windows-compat.yml

Windows compatibility is checked by `.github/workflows/windows-compat.yml`, on a shell matrix, and it is considerably more than four test files. What runs on real Windows:

- `bun test test/tui/util/double-esc.test.ts` — the double-ESC interrupt state machine
- `bun test test/session` — retry jitter and prompt resolution
- `bun test test/config test/worktree` — Effect `TaggedError` tags
- `bun test test/util` — filesystem, lock, wildcard
- Inline invariants: `pathToFileURL` round-trip with drive letters, `Global.Path` under AppData, `Shell.preferred` / `Shell.select`
- A single-target `nikcli.exe` build, then `--help`, `--version`, a TUI boot, the npm postinstall/wrapper path, and a `cmd.exe` re-run
- `install.ps1` end to end: parsing, `iex`, a working install, and the deferred swap when the target exe is locked

That workflow is the cross-platform signal. It is separate from `ci-pipeline.yml`, so it does not gate the release path.

## The Railway Deploy

### 1. The `--detach` footgun

Railway's `--detach` API reports success when the upload is accepted, not when the build has run. A deploy that fails to build looks green. The pipeline must catch this.

The footgun is recorded in the root [AGENTS.md](../../AGENTS.md) "CI" section. The pipeline refuses to ship a deploy that has not been preflighted.

### 2. The three guards

The guards are wired into `ci-validate.ts`:

1. **`script/check-railway-context.ts`** — every path `Dockerfile.serve` COPYs out of the build context must survive `.railwayignore`. Matching is delegated to `git ls-files -c -i --exclude-from=`, so git's own gitignore implementation decides, not a reimplementation of it. `packages/discord` was filtered out this way and every deploy failed for two days on a bare `failed to compute cache key`.
2. **`script/check-docker-versions.ts`** — rejects a literal `NIKCLI_VERSION` in a Dockerfile (both images sat at 1.216.0 while the repo shipped 1.302.0), requires Bun image tags and build-arg defaults to match the root `packageManager`, and rejects positional Effect installs that would change the validated workspace graph. That last rule is C2's.
3. **Preflight inside `script/railway-deploy.sh`** — builds its own ~10 MB upload context, derives the package list from the Dockerfile rather than a second hardcoded copy, refuses to upload when the expected revision cannot be determined, and fails on a context path the Dockerfile COPYs but the sync did not produce.

The three guards are independent and cover different contexts: guard 1 is the repo-root `railway up` path, guard 3 is the script's own build context. `test/release/docker-versions.test.ts` pins guard 2, including the Railway override that reintroduced Effect `beta.83` after E6.

### 4. What `--detach` still cannot tell you

None of the three guards observes the deployed instance. That gap is **C3**: the validated commit is baked into the image (`NIKCLI_REVISION`), served as an optional `revision` on `GET /global/health`, and confirmed by `script/check-release-identity.ts`, which treats an unconfirmed upload as a failed release rather than a pending one. `test/release/release-identity.test.ts` covers its five outcomes.

### 5. The release gates

`publish` needs `validate`. `railway-deploy` needs `publish`. The release path is:

```
ci-validate.ts (12 critical steps) → publish → railway-deploy --detach → check-release-identity.ts
```

A direct or manual publish runs the same central validation unless the `ci-pipeline` caller explicitly marks it prevalidated, and a missing `RAILWAY_TOKEN` fails the required deploy job rather than skipping it (C1). The pipeline refuses to skip a step. The pipeline is the gate; the steps are the contract.

## The CI Must Never Be Left Failing

The root [AGENTS.md](../../AGENTS.md) records the rule as Important Rule 6: **CI must never be left failing**. The pipeline going red is never acceptable and is never "someone else's problem". A change that turns the pipeline red is fixed before any other work.

The anti-patterns are documented:

- **Skipping a failing test.** The change is the test; the failure is the signal.
- **Quarantining a test.** A test that is quarantined is a test that is skipped, with documentation. The CI does not have a quarantine mode.
- **Flipping a step to `critical: false`.** A step that is non-critical is a step that is ignored. The pipeline ignores what is non-critical.
- **Re-running a job hoping for a different answer.** The CI is deterministic; the re-run is a delay.

The rule is the contract: the pipeline is green or the change is reverted.

## Alternatives Rejected

**Running the suite in CI with more RAM.** Rejected: the leak is proportional to the number of files in one process, so a bigger runner moves the file it dies at, not whether it dies.

**Running the sharded suite in the `validate` job.** Rejected on time, not on memory — sharding does fix the OOM. Sixteen sequential bun processes cost the release path minutes on every push, and the job's purpose is to gate a publish, which typecheck already does. Running it as a non-critical step was tried and was worse than not running it: it burned the time and then reported "Validation passed (non-blocking failures: Run tests)", so real failures were logged and ignored.

**A `--detach` deploy without preflight.** Rejected because the footgun is real. The deploy looks green; the build is red; the operator finds out in production.

**Per-suite `critical: false` flags.** A failing util test as `critical: false`. Rejected because the util tests are the foundation. The flag is the bypass.

## Invariants

- The nikcli suite does not run in CI, in `ci-validate.ts` or in `test.yml`. The release is typecheck-gated, and that is stated rather than implied.
- The suite never runs in a single process. `test:ci` batches it, and `--parallel=1` (which implies `--isolate`) stays on inside each batch.
- `test:ci` refuses to report a pass when no file matched.
- Every `ci-validate.ts` step is critical, in the order the table above records; formatting and lint are blocking.
- The railway deploy is preflighted by three guards covering two different upload contexts, and the deployed instance is confirmed by identity (C3), not by `--detach` exiting 0.
- `publish` needs `validate`. `railway-deploy` needs `publish`. The pipeline is the gate.
- The CI is green or the change is reverted. No quarantine. No `critical: false`.

## What Is Explicitly Not Covered

- The per-file memory leak itself. It is characterised here as a budget, not diagnosed; fixing it would be its own item, and none is admitted.
- Which tests should run in CI if the leak were fixed. This document records why none do today.
- The `windows-compat.yml` matrix beyond the list above, and its runtime.
- The two-upload release-identity observation window, which needs deploy permission (see the product roadmap).
