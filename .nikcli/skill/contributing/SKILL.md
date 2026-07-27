---
name: contributing
description: Use this before filing an issue, branching, committing, pushing, or opening a PR against nikcli. It covers the issue-template bot that auto-closes free-form issues, the branch and commit conventions, how to verify a change so CI agrees with you, and which CI jobs are already red on live-main.
---

## Use this when

- Filing an issue or opening a PR against `nikomatt69/nikcli`
- Deciding how to verify a change before pushing
- A CI check is red and you need to know whether you caused it

Sources: `CONTRIBUTING.md`, `STYLE_GUIDE.md`, `.github/pull_request_template.md`,
`.github/ISSUE_TEMPLATE/`, `.husky/pre-push`.

## Repo facts

| Fact | Value |
|---|---|
| Default branch | `live-main` |
| Package manager | Bun, version pinned by `packageManager` in `package.json` |
| Pre-push hook | `.husky/pre-push` → bun version match + `bun typecheck` |
| Issue bot | labels `needs:compliance` on filing, closes it 2 hours later |

## Filing an issue: template or it gets closed

`.github/ISSUE_TEMPLATE/` holds `bug-report.yml`, `feature-request.yml` and
`question.yml`. Every issue must use one. A workflow checks this on
`issues.opened`, applies `needs:compliance`, and `compliance-close.yml` (cron,
every 30 minutes) closes anything still carrying that label after **2 hours**.

`gh issue create` does not apply a template, so write the body to match what the
form produces — field labels as `###` headings:

```markdown
### Description

<what happens, evidence: command, output, file:line, root cause>

### Nikcli version

### Steps to reproduce

1.
2.

### Operating System

### Terminal
```

Then apply the label the web form would have applied:

```bash
gh issue create --title "…" --body-file issue.md
gh issue edit <N> --add-label bug
```

The compliance check only runs on `opened`. Editing a flagged issue does not
re-run it and does not clear the label — fix the body inside the two hours, or
edit and reopen after it closes.

Keep it factual and short. `CONTRIBUTING.md` rejects AI-generated walls of text
for issues as well as PRs.

## Branch and commit

```bash
git fetch origin --prune
git switch -c feat/<short-slug> origin/live-main
```

Prefixes: `feat/`, `fix/`, `refactor/`, `perf/`, `docs/`, `test/`, `build/`,
`ci/`, `chore/`, `style/`. One branch, one objective. Never commit on `live-main`.

Commit subject: conventional, imperative, under 72 characters, no trailing
period, no emoji. Body explains **why**, not what — the diff already says what.
Scope is the package: `nikcli`, `tui`, `cli`, `server`, `mobile`, `desktop`,
`app`, `sdk`, `remote`, `llm`, `identity`, `inference`, `plugins`.

Squash the `wip` commits with `git rebase -i origin/live-main` before pushing.
After a rebase, `git push --force-with-lease`, never plain `--force`.

## Verify before pushing

```bash
bun --version                 # must equal packageManager in package.json
ASTRO_TELEMETRY_DISABLED=1 bun turbo typecheck --force --continue
bun test <the suites you touched>
bun run check:routes          # if packages/nikcli/src/server/** changed
./packages/sdk/js/script/build.ts   # if server endpoints changed
```

`--force` matters: turbo caches per package, so a cached pass from before your
change will hide a package your change actually breaks, and CI finds it instead
of you. `--continue` reports every failure rather than stopping at the first.

`ASTRO_TELEMETRY_DISABLED=1` avoids an `EPERM` when the telemetry config
directory is not writable; the same applies to `astro build`.

New logic ships with a test. Prove the test earns its place — stash the source
change, watch it fail, restore, watch it pass.

## Open the PR

Fill every section of `.github/pull_request_template.md`: linked issue
(`Closes #N`, and PRs without one may be closed unreviewed), type of change, what
it does in your own words, how you verified it with the commands and numbers you
actually ran, and screenshots for UI. Keep the diff under roughly 500 lines.

Check the diff for things that are not the change: editor and agent config,
generated output such as `packages/*/.astro/**`, lockfile line-ending churn.

For net-new functionality, `CONTRIBUTING.md` asks for a design conversation in an
issue first — open that and wait rather than sending the feature PR.

## Reading CI

Some jobs are red on `live-main` itself. Before assuming your branch caused a
failure, compare against the last upstream push:

```bash
gh run list --branch live-main --limit 5
gh api "repos/nikomatt69/nikcli/actions/jobs/<jobId>" \
  --jq '.steps[] | select(.conclusion=="failure") | .name'
```

Same job **and** same failing step means pre-existing — say so in a PR comment
with the run link so a reviewer is not misled, and move on. Anything else is
yours to fix.

`/autofix` does not run on PRs from a fork, so a contributor working from a fork
fixes CI by hand.

## Style the reviewers enforce

No `else` where an early return works. `.catch(...)` over `try`/`catch`. No
`let`, no `any`. Concise identifiers that stay descriptive. Bun helpers such as
`Bun.file()` over the Node equivalents. No TODO, FIXME, mock or placeholder —
production-ready only. Prefer editing an existing file over adding one.

## Security

Never commit API keys, tokens or `.env*`. If one is pushed, rotate the secret
first, then purge the history, then tell the team. Do not add entries to
`.gitleaksignore` unless certain it is a false positive.

A vulnerability in nikcli itself does not go in a public issue or PR.
`SECURITY.md` routes it to a private advisory, so report there and keep the fix
branch local until a maintainer has seen it.
