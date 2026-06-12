# Support Dialog

A read-only documentation & how-to assistant embedded in the TUI as a
chat-style dialog. Lets users ask questions about nikcli features, commands,
configuration, and troubleshooting without leaving the terminal.

## Goals

- **Self-serve help**: users can get unstuck without leaving the TUI or
  opening a browser.
- **Always up to date**: reads the local docs in the workspace (AGENTS.md,
  README.md, specs/**, docs/**) so the answer reflects the actual code.
- **Safe by construction**: the support agent cannot modify files, run
  destructive commands, or start long-running processes.
- **Conversational continuity**: the same session is reused across TUI
  restarts so the user can close the dialog and come back to it later.

## Non-goals

- Modifying the user's project.
- Running long-lived commands (`bun run dev`, watchers, etc.).
- Web search for general questions (only docs, release notes, and GitHub
  issues).
- Multi-language translation (responds in the user's language).

## Entry points

- **Slash command**: `/support` (aliases: `ask`, `help-me`).
- **Keybind**: `<leader>z` (configurable via the `app_support` keybind).
- **Command palette**: shown as `Chat with the support assistant` in the
  Support category.

All three paths open `DialogSupport`.

## Architecture

```
   ┌─ DialogSupport ───────────────────────────────────────────┐
   │  Header (agent + model · status)                          │
   │  ┌────────────────────────────────────────────────────┐   │
   │  │ scrollbox: messages (user / support / pending)    │   │
   │  │  + welcome hints on empty                         │   │
   │  └────────────────────────────────────────────────────┘   │
   │  textarea: Enter to send · Ctrl+L new conversation       │
   └────────────────────────────────────────────────────────────┘
        │
        ▼  useSDK()  +  useSupportSession()  +  useLocal()
   ┌───────────────────────────────────────────────────────────┐
   │ SDK v2 client                                             │
   │  session.create({ title: "nikcli support" })              │
   │  session.messages({ sessionID })                          │
   │  session.prompt({ sessionID, agent: "support", parts })   │
   │  session.delete({ sessionID })  // on reset               │
   │                                                           │
   │ SSE: message.part.updated, session.idle, session.error    │
   └───────────────────────────────────────────────────────────┘
        │
        ▼
   ┌───────────────────────────────────────────────────────────┐
   │ Server: agent "support" (builtin, hidden)                 │
   │  prompt:    role + style guide + docs index               │
   │  tools:     read, glob, grep, list, webfetch,             │
   │             websearch, codesearch (read-only bash)        │
   └───────────────────────────────────────────────────────────┘
```

## Components

### `Agent.support` (builtin, hidden)

Defined in `src/agent/agent.ts`. Read-only by construction:

- `mode: "all"`, `hidden: true` (excluded from `/agents` picker)
- `prompt` describes the role, available knowledge, style guidelines, and
  the `<docs_index>` block the agent should expect.
- `permission` is deny-by-default with an explicit allowlist:
  `read`, `grep`, `glob`, `list`, `webfetch`, `websearch`, `codesearch`,
  plus a small bash read-only whitelist (`nikcli --version`, `cat`, `ls`,
  `find`, …). `edit`, `write`, `patch` are explicitly denied.

### `buildSupportDocsIndex(root)`

Lives in `src/agent/prompt/support-docs.ts`. Scans the workspace for
markdown files matching a curated pattern list and returns a markdown
index block. Results are cached in-process per `root`. The block is
appended to the `system` parameter of `session.prompt` so the agent knows
where to `read` for each topic.

Indexed patterns:

- `AGENTS.md`, `README.md` (root)
- `packages/*/AGENTS.md`, `packages/*/README.md`
- `packages/nikcli/AGENTS.md`
- `packages/nikcli/specs/**/*.md` (capped at 40)
- `packages/nikcli/docs/**/*.md`
- `docs/**/*.md`
- `CHANGELOG.md`

### `useSupportSession()` (context)

Lives in `src/cli/cmd/tui/context/support-session.tsx`. Owns a single
session for the support dialog, persisted in
`Global.Path.state/support-session.json`.

- `ensure()` → returns the cached sessionID, or creates a new one
  (verifying server-side that it still exists first).
- `reset()` → deletes the session server-side and clears the cache.
- `id` / `createdAt` / `ready` accessors.

Persisting the sessionID means the conversation survives TUI restarts.

### `DialogSupport`

Lives in `src/cli/cmd/tui/component/dialog-support.tsx`.

- On mount: `support.ensure()` → load history → subscribe to
  `message.part.updated`, `session.idle`, `session.error`.
- On send: optimistic user message, then `session.prompt` with
  `agent: "support"`, `system: <docs_index>`, and a single text part.
- The assistant text is streamed by appending `delta`s (or the full
  `part.text` when provided) to the message identified by `part.messageID`.
- `Ctrl+L` clears the conversation; `Esc` closes the dialog.
- Welcome screen with 6 clickable hint prompts for first-time users.

## Failure modes

| Failure                                | Handling                                                |
| -------------------------------------- | ------------------------------------------------------- |
| No provider connected                  | Toast warning, send is blocked                          |
| `session.create` fails                 | Error banner inside the dialog                          |
| `session.prompt` rejects the user text | Error attached to the optimistic user message           |
| Stream `session.error`                 | Error attached to the in-flight assistant message       |
| `support.id` is null on send           | Error banner, user can retry                            |
| Cached session no longer exists        | `ensure()` detects via `session.get`, creates a new one |
| Docs index build fails                 | `system` is set to undefined, agent still works         |
| Server SSE drops                       | `setBusy` stays true until next `session.idle` / error  |

## Privacy

- The agent has no network access by default beyond `webfetch` /
  `websearch` / `codesearch`. The bash allowlist is read-only.
- The user message and assistant response are sent to the configured
  model provider just like any other `session.prompt`. No special
  telemetry is emitted.
- The persistent sessionID file in `Global.Path.state` contains only the
  opaque session identifier, not the conversation content.

## Open questions / future work

- [x] Markdown rendering of assistant messages (2026-06-12 — `<markdown>`
      element with the theme's syntax style; user messages stay plain text).
- [x] Copy-to-clipboard (2026-06-12 — Ctrl+Y copies the last assistant
      reply; hover isn't practical in a terminal).
- [ ] Attach a file via the prompt (drag-and-drop / `@`-mention).
- [ ] Allow the user to pick a different model for the support session
      (currently uses the active session model).
- [ ] A `quickstart` variant of the welcome screen that adapts to the
      user's setup (e.g. "no provider connected" → "let me help you
      connect one").
