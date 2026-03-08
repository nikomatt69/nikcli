# Workspace Risk Report

Date: 2026-03-08
Analysis basis: git status, branch inspection, recent commit history, and latest commit diff statistics.

## Primary risk areas

### Cross-surface feature scope

- The latest feature set spans CLI commands, TUI state, HTTP routes, remote services, SDK generation, and Slack runtime code.
- Broad changes like this increase the chance of interface drift between packages when follow-up work lands.

### Deployment path changes

- New Docker and compose assets add operational flexibility, but they also create another runtime path that should be smoke-tested after infrastructure or env changes.
- The new GitHub workflow should be watched for environment assumptions or missing secrets.

### Generated API artifacts

- Regenerated SDK files need to stay in sync with `packages/nikcli/src/server/server.ts` and related route definitions.
- Any future API edits should continue to regenerate `packages/sdk/js` before merge.

### Slack and chatbot integrations

- Multi-platform chatbot support expands external dependency and credential surface area.
- Slack runtime changes and new chatbot handlers deserve end-to-end validation with real connector configuration before wider rollout.

## Recommended follow-up checks

- Run targeted smoke tests for chatbot flows and workspace-serving flows.
- Validate Docker serve startup with the new compose stack.
- Confirm SDK consumers still build cleanly after the generated client/type updates.
- Review docs paths for any stale configuration references after the `config.json` layout change.

## Report purpose

- This document is intended to capture the current repo state in versioned markdown so reviewers can quickly understand where the workspace is stable and where the newest change surface is concentrated.
- The companion report in `specs/workspace-analysis-report.md` records the structural summary; this file focuses on risk and verification priorities.
