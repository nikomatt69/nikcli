# Changelog

<!-- UNRELEASED:START -->

## Unreleased

### Core

- Sync subsystem: per-project SQLite event journal, typed projections, cold-start snapshots, idempotent outbox, and optional remote hub transport (`/sync` route group + `nikcli sync` CLI + TUI dialog).
- Workspace session proxying: route-session lookup recovers the original workspace context for `/session/:id` requests, and remote workspaces are proxied through `ServerProxy`.
- HTTP API: new typed groups for `brain`, `chatbot`, `sync`, `pty`, `doctor`, `analytics`, and `loop`; classic route groups extended with `/sync`, `/brain`, `/mission`, `/doctor`, `/workspace`, and `/loop`.
- Telegram-style bot webhooks expanded to all six connectors (Slack, Discord, Teams, Google Chat, Linear, GitHub) with consistent handler registration.
- Brain model and scheduler exposed through the server, the TUI feature plugin, and the CLI (`nikcli brain-model`).
- Workspace lifecycle events and projection surfaced through `workspace/connection.ts` and the mobile workspace switcher sheet.
- New CLI commands: `nikcli sync` (status / connect / disconnect / token create), `nikcli teleport` (archive + upload a session to a remote host), and `nikcli brain-model`.
- Mobile pairing flow rewritten: deeper connect screen, host-scoped tokens, Git identity config, and a session teleport sheet that prefills the last successful target.
- Session artifacts (URLs, HTML, SVG, Mermaid) rendered inline inside the mobile chat surface.
- Session queue banner surfaces pending offline messages and the queue is drained on reconnect.

### TUI

- Island plugin: macOS notch integration via `plugin/island/bridge.ts`. The bridge writes one JSON snapshot per session under `~/Library/Application Support/NikcliIsland/state.d/` and the TUI plugin toggles it without races.
- New internal feature plugins: `brain`, `browser`, `chatbot`, `computer`, `connectors`, `deepsec`, `island`, `observability`.
- New dialogs: `dialog-browser-use`, `dialog-mobile-connect`, `dialog-sync`, `dialog-teleport`, `dialog-routine`.
- Workspace and event handling: typed event catch-up on every workspace on TUI start / reconnect; command palette dedup, slash projection, and trigger API preserved.
- Terminal key bar / key strip: focus / blur command handling, opt-in scroll behavior, and a new compact key strip on small screens.

### Mobile

- Brand wordmark now shared across surfaces: `BrandMark` consumes the same PNGs as the docs navbar, footer, and dashboard connect screen.
- Workspace switcher sheet (`WorkspaceSwitcherSheet`) for swapping the active workspace from the session header.
- Session teleport sheet (`SessionTeleportSheet`) prefills the last successful URL + token.
- Session artifacts viewer with inline URL, HTML, SVG, and Mermaid previews.
- Terminal key bar and key strip with configurable "extra" key.
- Session queue banner for offline messages.
- Per-host Git identity settings for commit / push / publish PR from mobile.

### Web (docs site)

- Replaced the SVG icon + text logo in the navbar, footer, dashboard connect screen, and docs footer with the nikcli pixel wordmark. The same PNGs are mirrored into `public/brand/` so the docs site serves them statically.
- New reference pages: `/docs/sync` (event log, projections, outbox, hub transport, CLI, TUI dialog) and `/docs/brand` (wordmark variants, theme switching, asset locations, usage guidelines).
- Updated `tui.astro`, `plugins.astro`, `server-api.astro`, and `mobile.astro` to cover the new subsystems, routes, dialogs, plugins, and mobile sheets.
- Docs landing page now links to "What's new" so the new surfaces are discoverable.

<!-- UNRELEASED:END -->

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
