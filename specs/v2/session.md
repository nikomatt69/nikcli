# Session API

## Remove Dedicated `session.init` Route

The dedicated `POST /session/:sessionID/init` endpoint exists only as a compatibility wrapper around the normal `/init` command flow.

Current behavior:

- the route calls `SessionPrompt.command(...)`
- it sends `Command.Default.INIT`
- it does not provide distinct session-core behavior beyond running the existing init command in an existing session

V2 plan:

- remove the dedicated `session.init` endpoint
- rely on the normal `/init` command flow instead
- avoid reintroducing `Session.initialize`-style special cases in the session service layer

Status: **done** (2026-06-10). The route, `Session.InitializeInput`,
`Session.Service.initialize` and its `initializeImpl`/`runSessionPrompt`
plumbing were removed — the handler had drifted anyway (it declared a
boolean response but returned instruction paths, and ignored its validated
body). The `/init` command flow (`Command.Default.INIT` via the command
route) is the only path. Removing the `session/index.ts → session/prompt.ts`
import also breaks that static cycle. SDK `session.init` disappears at the
next release-time regeneration.
