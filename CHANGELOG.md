# Changelog

<!-- UNRELEASED:START -->
<!-- UNRELEASED:END -->

## v1.222.0 (August 2026)

## Core

- Implement live frame streaming and options for screencasting (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(screencast): implement live frame streaming and options for screencasting

## v1.219.0 (July 2026)

## Core

- Discover project plugins, reload tui config, persist plugin state (@nikomatt69)
- Retry failed title generation and stop clobbering renames (@nikomatt69)
- Stop SSE reconnect loops on JSON-RPC errors (@nikomatt69)
- Enhance plugin system with memory storage and error handling (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(tui): enhance plugin system with memory storage and error handling
  - fix(mcp): stop SSE reconnect loops on JSON-RPC errors
  - fix(session): retry failed title generation and stop clobbering renames
  - feat(tui): discover project plugins, reload tui config, persist plugin state
  - feat(tui): add replaceable prompt footer slot
  - feat(nikcli): integrate v2 formatter runtime

## v1.218.0 (July 2026)

## Mobile

- Optimize modal rendering by controlling mount state (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - fix(modal): optimize modal rendering by controlling mount state
  - chore(docker): update NIKCLI_VERSION to 1.216.0 in Dockerfiles

## v1.204.0 (July 2026)

## Core

- Add new package and integrate into workspace (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(computer-use): add new package and integrate into workspace

## v1.201.0 (July 2026)

## Core

- Selective port from opencode TUI v2 (reconnect, row grouping, serve, SSE) (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(tui): selective port from opencode TUI v2 (reconnect, row grouping, serve, SSE)
  - Merge pull request #164 from nikomatt69/feat/tui-v2-selective-port

## v1.200.0 (July 2026)

## Core

- Auto prompt-cache placement and OpenAI cache-write accounting (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(llm): auto prompt-cache placement and OpenAI cache-write accounting
  - Merge pull request #162 from nikomatt69/worktree-cache-improvements

## v1.199.0 (July 2026)

- No notable changes

## v1.196.0 (July 2026)

## Mobile

- Split AnimatedTabButton into native + JS layers (@nikomatt69)
- Use translateX instead of left on SessionComposer mode pill (@nikomatt69)
- Give repeated option/question/pattern lists unique keys
- Make Deny/Allow buttons in approval bar a11y-compliant
- Evict stale entries from CommandPaletteSheet itemScales
- Enable native driver on transform-only animations in ComposerToolDrawer
- Run SessionComposer mode pill transform on UI thread
- Serialize persisted preference writes to prevent races
- Clear stale selectedAnswers on question request swap
- Serialize host config writes to prevent RMW races
- Handle network failures in GitHub device-flow poll
- Stop loop form data-loss from 5s polling
- Add useHostResource hook and pilot in agents.tsx
- Extract useCopiedFeedback hook and migrate 4 sites
- Remove dead code and unused dependencies

**Thank you to 1 community contributor:**

- @nikomatt69:
  - fix(mobile): use translateX instead of left on SessionComposer mode pill
  - fix(mobile): split AnimatedTabButton into native + JS layers

## v1.194.0 (July 2026)

## Core

- Enhance agent guidelines and add new scripts (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(nikcli): enhance agent guidelines and add new scripts

## v1.188.0 (July 2026)

## Core

- Complete opencode reliability ports (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(nikcli): complete opencode reliability ports

## v1.187.0 (July 2026)

## Core

- Implement queued message wrapping and improve shutdown handling (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(nikcli): implement queued message wrapping and improve shutdown handling

## v1.176.0 (July 2026)

- No notable changes

## v1.175.0 (July 2026)

## Mobile

- Notify RN when the terminal WASM engine fails to load (@nikomatt69)
- Enhance user interaction and animations (@nikomatt69)
- Enhance user experience and media handling (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(login, message-bubble, attachment-picker): enhance user experience and media handling
  - feat(bottom-sheet, error-banner, toast-host): enhance user interaction and animations
  - fix(mobile): notify RN when the terminal WASM engine fails to load

## v1.174.0 (July 2026)

## Core

- Standardize import statements and improve code consistency (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - refactor(identity, nikcli): standardize import statements and improve code consistency

## v1.169.0 (July 2026)

## Core

- Integrate terminal-control package and enhance GitHub workflow (@nikomatt69)
- Add all-events module to register bus events for Effect Schema (@nikomatt69)
- Document the BusEvent.define→schema sweep (landed in cce9da311) (@nikomatt69)
- Add missing semicolons and improve type definitions in inference-dashboard (@nikomatt69)
- Event-union groundwork — walker z.enum, BusEvent.schema, Session.Info to Effect (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(schema): Event-union groundwork — walker z.enum, BusEvent.schema, Session.Info to Effect
  - fix: add missing semicolons and improve type definitions in inference-dashboard
  - docs(schema): document the BusEvent.define→schema sweep (landed in cce9da311)
  - feat(bus): add all-events module to register bus events for Effect Schema
  - feat(terminal-control): integrate terminal-control package and enhance GitHub workflow

## v1.167.0 (July 2026)

## Core

- Migrate message-v2/SessionStatus/Todo/FileDiff to Effect Schema, wire into PublicApi (@nikomatt69)
- Embedded in-process SDK over the real Hono router (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(sdk-next): embedded in-process SDK over the real Hono router
  - feat(schema): migrate message-v2/SessionStatus/Todo/FileDiff to Effect Schema, wire into PublicApi

## v1.162.0 (July 2026)

## Core

- Enhance CodeMode with tool call tracking and execution limits (@nikomatt69)
- Enhance Promise client with relative imports and text response handling (@nikomatt69)
- Add new package for HTTP API code generation (@nikomatt69)
- Deprecate exec_code in favor of code_mode (@nikomatt69)
- Implement confined code execution with CodeMode (@nikomatt69)
- Update acorn and eventsource versions (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(dependencies): update acorn and eventsource versions
  - feat(nikcli): implement confined code execution with CodeMode
  - feat(nikcli): deprecate exec_code in favor of code_mode
  - feat(httpapi-codegen): add new package for HTTP API code generation
  - feat(httpapi-codegen): enhance Promise client with relative imports and text response handling
  - feat(nikcli): enhance CodeMode with tool call tracking and execution limits

## v1.160.0 (July 2026)

## Core

- Update TypeScript native preview and add xterm packages (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(dependencies): update TypeScript native preview and add xterm packages

## v1.143.0 (July 2026)

## Core

- Add Island plugin to internal TUI plugins and enhance IslandBridge functionality (@nikomatt69)
- Integrate IslandBridge for improved event handling (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(nikcli): integrate IslandBridge for improved event handling
  - feat(nikcli): add Island plugin to internal TUI plugins and enhance IslandBridge functionality

## v1.137.0 (July 2026)

## Core

- Snapshot projections for sessions, cold-start endpoint, SDK regen (@claude)

**Thank you to 2 community contributors:**

- @claude:
  - feat(sync): snapshot projections for sessions, cold-start endpoint, SDK regen
  - merge: live-main v1.135.0, regenerate openapi.json from merged tree
- @nikomatt69:
  - feat(sync): snapshot projections for sessions, cold-start endpoint, SDK regen (#136)

## v1.135.0 (July 2026)

## Core

- Journal local sessions, idempotent remote sync, bootstrap wiring (@claude)
- Instance hot reload and unified sync backend for workspaces (@claude)

**Thank you to 2 community contributors:**

- @claude:
  - feat: instance hot reload and unified sync backend for workspaces
  - merge: live-main unified sync architecture into hot-reload branch
  - merge: live-main v1.134.0, keep hot-reload config state and restore event filter
  - feat(sync): journal local sessions, idempotent remote sync, bootstrap wiring
  - feat(sync): enforce token scopes, rate-limit and audit hub event pushes
- @nikomatt69:
  - feat: instance hot reload + workspace event catch-up on unified sync log (#133)
  - feat(sync): local session journaling, idempotent remote sync, bootstrap wiring (#134)
  - feat(sync): enforce token scopes, rate-limit and audit hub event pushes (#135)

## v1.134.0 (July 2026)

## Core

- Add missing semicolons and improve type declarations in content modules (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - fix: add missing semicolons and improve type declarations in content modules

## v1.133.0 (June 2026)

## Desktop

- Integrate account management features into the application (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat: integrate account management features into the application

## v1.132.0 (June 2026)

- No notable changes

## v1.129.0 (June 2026)

## Desktop

- Enhance dialog components with summary cards and status pills (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - refactor: enhance dialog components with summary cards and status pills

## v1.128.0 (June 2026)

## Desktop

- Enhance desktop release workflow and version handling (@nikomatt69)
- Implement directory commands in the layout component (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - Implement directory commands in the layout component
  - fix: enhance desktop release workflow and version handling

## v1.124.0 (June 2026)

## Desktop

- Implement directory commands in the layout component (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - Implement directory commands in the layout component

## v1.122.0 (June 2026)

- No notable changes

## v1.120.0 (June 2026)

- No notable changes

## v1.119.0 (June 2026)

## Desktop

- Add download/install instructions for unsigned releases (@nikomatt69)
- Update macOS signing configuration for desktop release (@nikomatt69)
- Enhance side panel and resizing logic (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - refactor(desktop): enhance side panel and resizing logic
  - chore(ci): update macOS signing configuration for desktop release
  - docs(desktop): add download/install instructions for unsigned releases

## v1.116.0 (June 2026)

- No notable changes

## v1.115.0 (June 2026)

## Desktop

- Drop AppImage + avoid bun-run remap so Linux/Windows desktop builds pass (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - fix(ci): drop AppImage + avoid bun-run remap so Linux/Windows desktop builds pass

## v1.113.0 (June 2026)

## Desktop

- Unblock desktop build/bundle/sign on all platforms (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - fix(ci): unblock desktop build/bundle/sign on all platforms

## v1.112.0 (June 2026)

## Desktop

- Slim CLI sidecar artifact + fix sidecar path so desktop builds pass (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - fix(ci): slim CLI sidecar artifact + fix sidecar path so desktop builds pass

## v1.111.0 (June 2026)

- No notable changes

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
