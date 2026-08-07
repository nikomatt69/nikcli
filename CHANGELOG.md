# Changelog

<!-- UNRELEASED:START -->
<!-- UNRELEASED:END -->

## v1.257.0 (August 2026)

## Core

- Collapse @opentui/core to a single version in the bundle (@nikomatt69)
- Update README formatting for clarity (@nikomatt69)
- Route package-manager installs through their own manager (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - fix(upgrade): route package-manager installs through their own manager
  - fix(install.ps1): escape the target path in the deferred-swap log line
  - fix(release): stop tracked astro artifacts from breaking the release rebase
  - fix(docs): update README formatting for clarity
  - fix(deps): collapse @opentui/core to a single version in the bundle

## v1.250.0 (August 2026)

## Core

- Repair upgrade strategy, verify applied version, surface real errors (@SandroHub013)

## Desktop

- Restore broken triple-slash reference in custom-elements.d.ts (@SandroHub013)

**Thank you to 1 community contributor:**

- @SandroHub013:
  - fix(installation): repair upgrade strategy, verify applied version, surface real errors
  - fix(app): restore broken triple-slash reference in custom-elements.d.ts
  - fix(enterprise): restore broken triple-slash reference in custom-elements.d.ts

## v1.249.0 (August 2026)

- No notable changes

## v1.247.0 (August 2026)

## Core

- Add Herdr integration for nikcli (@nikomatt69)
- Standardize code formatting and improve readability (@nikomatt69)
- Implement patching for reasoning options in model variants (@nikomatt69)

## TUI

- Correct import statement for useTheme (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(variants): implement patching for reasoning options in model variants
  - refactor(variants): standardize code formatting and improve readability
  - feat(herdr): add Herdr integration for nikcli
  - fix(browser-surface): correct import statement for useTheme
  - fix(ci): unblock validate — pwsh exit hang, herdr env gate, pty output race

## v1.242.0 (August 2026)

## Core

- Show what the runtime is actually doing, behind /devtools (@nikomatt69)
- Pull the dialog and path logic out of the components (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - refactor(tui): pull the dialog and path logic out of the components
  - feat(tui): show what the runtime is actually doing, behind /devtools

## v1.241.0 (August 2026)

## Core

- Ensure consistent export syntax and improve type definitions (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - fix: ensure consistent export syntax and improve type definitions

## v1.240.0 (August 2026)

## Core

- Introduce math rendering plugin for LaTeX in messages (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(tui): introduce math rendering plugin for LaTeX in messages

## v1.239.0 (August 2026)

## Core

- Ensure consistent export syntax and update type definitions (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - fix: ensure consistent export syntax and update type definitions

## v1.237.0 (August 2026)

## Core

- Add a golden-screen corpus for the session renderer (@nikomatt69)
- Add the session view seam, and make entry conversion deterministic (@nikomatt69)
- Stop describing deleted code as current (@nikomatt69)
- Make the entry id the sort key, and fold user parts (@nikomatt69)
- Collapse the two v2 projections into one (@nikomatt69)
- Stop double-journaling session events (@nikomatt69)
- Persist entries as a first-class projection (@nikomatt69)
- Event-source the session write path (@nikomatt69)
- Flatten SessionEntry into a type-discriminated union (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - refactor(session/v2): flatten SessionEntry into a type-discriminated union
  - feat(sync): event-source the session write path
  - feat(session/v2): persist entries as a first-class projection
  - fix(sync): stop double-journaling session events
  - refactor(session/v2): collapse the two v2 projections into one
  - fix(session/v2): make the entry id the sort key, and fold user parts
  - docs(v2): stop describing deleted code as current
  - feat(tui): add the session view seam, and make entry conversion deterministic
  - test(simulation): add a golden-screen corpus for the session renderer
  - test(simulation): cover tool rendering in the golden corpus

## v1.235.0 (August 2026)

- No notable changes

## v1.233.0 (August 2026)

## Core

- Invoke bun by execPath, not by name (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - fix(build): invoke bun by execPath, not by name

## v1.232.0 (August 2026)

## Core

- Canonicalize with the native realpath on Windows (@nikomatt69)
- Open and close the step for native LLM protocols (@nikomatt69)
- Rename the browser tool to browser_control (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - refactor(tool): rename the browser tool to browser_control
  - fix(session): open and close the step for native LLM protocols
  - fix(filesystem): canonicalize with the native realpath on Windows

## v1.230.0 (August 2026)

## Core

- Replace the running nikcli.exe on Windows (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - fix(upgrade): replace the running nikcli.exe on Windows

## v1.229.0 (August 2026)

## Core

- Update classification handling and message structure in tests (@nikomatt69)
- Enhance cache policy and request handling across protocols (@nikomatt69)

**Thank you to 1 community contributor:**

- @nikomatt69:
  - feat(llm): enhance cache policy and request handling across protocols
  - fix(test): update message structure in OpenRouter tests to include optional role field
  - fix(session): update classification handling and message structure in tests

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
