---
description: load the contribution rules before filing an issue or opening a PR
---

Read the `contributing` skill in `.nikcli/skill/contributing/SKILL.md` and follow it
for the change at hand.

Before doing anything else, work out which of these applies and say so:

- filing an issue — it must use a template from `.github/ISSUE_TEMPLATE/`, or a bot
  closes it two hours later
- starting work — branch off `origin/live-main`, one branch per objective
- verifying — `ASTRO_TELEMETRY_DISABLED=1 bun turbo typecheck --force --continue`,
  plus the test suites the change touches
- opening a PR — every section of the template filled, with the commands and
  numbers actually run under "How did you verify"
- reading a red CI check — compare the same job and the same step against the last
  `live-main` run before assuming the branch caused it

Then do that step. Do not skip to the commit.
