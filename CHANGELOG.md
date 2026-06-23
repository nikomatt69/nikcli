# Changelog

<!-- UNRELEASED:START -->
<!-- UNRELEASED:END -->

## v1.108.0 (June 2026)

- No notable changes

## v1.107.0 (June 2026)

- No notable changes

## v1.106.0 (June 2026)

- No notable changes

## v1.5.0 (May 2026)

### Highlights

- **Effect Schema Migration Phase P**: Completed migration of core domains to Effect Schema for improved type safety and composability.
- **New modules migrated**: Sync, Workspace, SessionStatus, File.Node/Content, Sandbox.Ref/State, BackgroundRun, Log.Level, ModelsDev, Provider.Model/Info
- **Additional migrations**: Connectors, Vcs.Info, Worktree, Project, ProviderAuth, MCP resources/auth, BusEvent, Delegation, Bus
- **Docker improvements**: Added wake notification for background tasks, Dockerfile updates

### Migration Notes

This release continues the Effect Schema migration pattern established in previous versions. Key changes include:

- Schema definitions now use `effect`'s `Schema` module instead of Zod for internal validation
- Service interfaces remain unchanged; consumers of existing APIs should experience no breaking changes
- New Effect-based error types provide better stack traces and cause chain debugging

### Commits

- feat(effect): Integrate Sync and Workspace modules as Effect Services
- feat(docker): Update Dockerfile and add wake notification for background tasks
- feat(effect): Phase P — SessionStatus.Info + session domain Inputs
- feat(effect): Phase P — Workspace.Info, Restore, SessionRestore, ConnectionStatus
- feat(effect): Phase P — File.Node/Content + Workspace.Config
- feat(effect): Phase P — Sandbox.Ref/State + BackgroundRun.Record
- feat(effect): Phase P — Log.Level + spec consolidation
- feat(effect): Phase P — ModelsDev.Model + ModelsDev.Provider + Monitor.Record
- feat(effect): Phase P — Provider.Model + Provider.Info to Effect Schema
- feat(effect): Phase P — Connectors.Entry, Vcs.Info, Worktree schemas + DeepMutable shared

---

## Week of February 3, 2026

### Highlights

- Added end-to-end connectors management in `nikcli`, including CLI/TUI flows, connector auth, and API routes.
- Improved connector validation and shared helpers to make connector setup and usage more reliable.
- Integrated `@nikcli-ai/sdk` across the app stack and expanded deployment/setup documentation.
- Added a new mobile package with events, sessions, settings, and SSE-driven realtime updates.
- Released `v0.0.2` and updated install/publish scripts for smoother release operations.
