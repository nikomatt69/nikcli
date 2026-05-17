# Plan: Ensure All Workflows Have Explicit Permissions

## Context

The user wants all GitHub Actions workflows in `/Volumes/SSD/Projects/nikcli/.github/workflows/` to have explicit `permissions:` blocks. Currently, some workflows rely on implicit defaults.

## Current State Summary

### Workflows WITH explicit permissions: 29

### Workflows WITHOUT permissions block (using defaults): 6

- `deploy.yml`
- `nix-desktop.yml`
- `notify-discord.yml`
- `storybook.yml`
- `sync-zed-extension.yml`
- `test.yml`
- `typecheck.yml`

## Implementation Plan

Add explicit `permissions:` block to each of the 7 workflows above.

### Files to Modify

| File                     | Current Purpose                         | Recommended Permissions                          |
| ------------------------ | --------------------------------------- | ------------------------------------------------ |
| `deploy.yml`             | SST deployment to Cloudflare/AWS/Stripe | `contents: read` (minimal - deploys via secrets) |
| `nix-desktop.yml`        | Nix desktop builds                      | `contents: read`                                 |
| `notify-discord.yml`     | Discord notifications                   | `contents: read`                                 |
| `storybook.yml`          | Storybook builds                        | `contents: read`                                 |
| `sync-zed-extension.yml` | Zed extension sync                      | `contents: write` (commits changes)              |
| `test.yml`               | Test execution                          | `contents: read`                                 |
| `typecheck.yml`          | TypeScript type checking                | `contents: read`                                 |

## Verification

1. Run `grep -l "permissions:" .github/workflows/*.yml` to confirm all files have permissions
2. Verify syntax with `actionlint` or GitHub CLI
3. Test workflows trigger correctly on next PR/commit
