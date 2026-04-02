# Nikcli Workspace Analysis Report

## Overview
- **Project Name**: Nikcli
- **Type**: Monorepo (Bun workspace with Turbo)
- **Version**: 0.0.6
- **Package Manager**: Bun 1.3.10
- **License**: MIT
- **Repository**: https://github.com/nikomatt69/nikcli
- **Current Branch**: `nikcli/mobile/nikcli/6yj20f`
- **Default Branch**: `dev`

## Architecture Summary

### Core Packages (20 packages + 10 plugins)

| Package | Purpose |
|---------|---------|
| `packages/nikcli` | Core CLI/TUI business logic & server |
| `packages/app` | Shared web UI components (SolidJS) |
| `packages/desktop` | Native Tauri desktop app |
| `packages/mobile` | Native mobile app (iOS/Android via Expo + Tauri) |
| `packages/web` | Marketing website (Astro) |
| `packages/plugin` | Plugin system with 10 plugins |
| `packages/sdk/js` | JavaScript SDK |
| `packages/remote` | Remote attach functionality |
| `packages/slack` | Slack integration |
| `packages/console` | Multi-package console app (app, core, function, mail, resource) |
| `packages/cloud` | Cloudflare Workers deployment |
| `packages/enterprise` | Enterprise features |
| `packages/companion` | Companion UI/browser extension |
| `packages/ui` | UI component library |
| `packages/util` | Utilities |
| `packages/function` | Serverless functions |
| `packages/containers` | Docker/container solutions |
| `packages/script` | Build and release scripts |
| `github` | GitHub Actions integration |

### Plugin Ecosystem (10 plugins)
- `agent-memory` - Memory management for agents
- `background` - Background task execution
- `background-agents` - Multi-agent background processing
- `context-analysis` - Context analysis
- `direnv` - Environment variable management
- `dynamic-context-pruning` - Smart context optimization
- `envsitter-guard` - Environment safety guard
- `handoff` - Agent handoff
- `safety-net` - Safety features
- `smart-title` - Smart conversation titling

## Technology Stack

### Frontend
- **SolidJS** - Primary UI framework
- **TailwindCSS** - Styling
- **Vite** - Build tool
- **Astro** - Marketing site

### Backend/Server
- **Bun** - Runtime
- **Hono** - HTTP framework with SSE support
- **SST** - Deployment framework

### Desktop/Mobile
- **Tauri** - Native desktop shell
- **Expo** - Mobile development (React Native)
- **NativeWind** - Tailwind for React Native

### Infrastructure
- **Docker** - Containerization
- **Cloudflare Workers** - Edge deployment
- **Railway** - Hosting
- **Fly.io** - Hosting
- **Nix** - Reproducible builds

## Development Setup

### Quick Start
```bash
bun install
bun dev  # Runs nikcli in packages/nikcli
```

### Testing
```bash
bun run --cwd packages/nikcli test
bun run --cwd packages/app test
```

### Building
```bash
bun turbo build
./packages/nikcli/script/build.ts --single  # Standalone executable
bun run --cwd packages/desktop tauri build  # Desktop app
```

### Key Scripts
- `script/generate.ts` - SDK generation
- `script/publish.ts` - Package publishing
- `script/changelog.ts` - Changelog generation
- `packages/sdk/js/script/build.ts` - JS SDK regeneration

## CI/CD Pipeline

### GitHub Workflows (22 workflows)
- **deploy.yml** - Production deployments
- **publish.yml** - NPM package publishing
- **test.yml** - Test suite
- **typecheck.yml** - Type checking
- **nikcli.yml** - Main CI pipeline
- **nikcli-agent.yml** - AI agent workflows
- **pr-standards.yml** - PR quality checks
- **review.yml** - Code review automation
- **docs-update.yml** - Documentation updates
- **stale-issues.yml** - Issue maintenance
- **duplicate-prs.yml** / `duplicate-issues.yml` - Deduplication
- **publish-github-action.yml** / `publish-vscode.yml` - Extension publishing
- **nix-desktop.yml** / `update-nix-hashes.yml** - NixOS builds
- **stats.yml** - Usage statistics
- **triage.yml** - Issue triage
- **release-github-action.yml** - Release automation
- **generate.yml** - Code generation
- **notify-discord.yml** - Discord notifications

## Configuration

### Package Catalogs
Shared dependency versions via `catalog:` in `package.json`:
- UI: `@kobalte/core`, `@solidjs/*`, `solid-js`, `tailwindcss`, `vite`
- Core: `typescript`, `zod`, `hono`, `ai`, `luxon`
- Build: `@playwright/test`, `shiki`, `marked`

### Config Resolution Order
1. Remote: `/.well-known/nikcli`
2. Global: `~/.config/nikcli/nikcli.jsonc`
3. Environment: `NIKCLI_CONFIG` or `NIKCLI_CONFIG_CONTENT`
4. Project: `nikcli.jsonc` (discovered upward)

## Recent Activity (Last 10 commits)
1. `43ad510` - feat(plugin): introduce multiple new plugins
2. `5c83a06` - feat(ui): enhance session and message components
3. `87b1ebe` - fix(ci): use direct npm auth token
4. `f457ed6` - fix(publish): Buffer stderr parsing
5. `5003421` - fix(publish): handle missing nikcli binary
6. `81f7491` - chore: bump package versions to 0.0.6
7. `e2c4dda` - fix(publish): skip already-published versions
8. `4139843` - fix(script): handle 404 when nikcli-ai not yet published
9. `69070c2` - fix(publish): sequential npm publish with E429 retry
10. `4f9ce27` - fix(ci): switch runners to ubuntu-latest

## Documentation
- `README.md` - Project overview
- `CONTRIBUTING.md` - Development guidelines
- `DEPLOYMENT.md` - Deployment instructions
- `SECURITY.md` - Security policy
- `STYLE_GUIDE.md` - Code style
- `SPEAK_SETUP.md` - Voice/speech setup
- `AGENTS.md` - Agent instructions

## Themes
- `themes/deltarune.json` - Deltarune theme
- `themes/undertale.json` - Undertale theme

## Specs/Roadmap
Performance and feature specs in `specs/`:
- Payload limits, cache eviction, request throttling
- Scroll spy optimization
- Modularization and deduplication
- i18n audits for app and UI

## Git Status
- **Working tree**: Clean (no uncommitted changes)
- **Last commit**: `43ad510` - feat(plugin): introduce multiple new plugins
