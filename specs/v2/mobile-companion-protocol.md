# Mobile Companion Protocol

| Field  | Value                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | **Accepted and implemented** (promoted 2026-09-10)                                                                                                                                                                                                                                                                                                                                                              |
| Scope  | `src/server/mobile/*`, `src/server/httpapi/mobile.ts`, `src/mobile/*`                                                                                                                                                                                                                                                                                                                                           |
| Tests  | `test/server/mobile-permission-auth.test.ts` (reply union, persisted approval, bearer acceptance and refusal), `test/server/mobile-session-route.test.ts`, `test/server/mobile-loop-route.test.ts`, `test/server/mobile-mission-route.test.ts`, `test/server/mobile-github-route.test.ts`, `test/server/mobile-dispatcher.test.ts`, `test/server/mobile-events-host.test.ts`, `test/cli/mobile-pairing.test.ts` |

The question this records: the wire contract between nikcli's server and the mobile companion app.

The answer is **an Effect HttpApi group with typed endpoints for pairing, session control, permission response, and token lifecycle**, accompanied by raw handlers for SSE and teleport streams.

## The Surface

- **Token Lifecycle**: `mobile.ts` exposes `pair`, `token list`, and `token revoke`. Tokens support optional expiration via `expiresInDays` and are persisted in the database.
- **Session Control**: `sessionMessage` enqueues input and returns HTTP `202 Accepted`.
- **Permission Responses**: `permissionRespond` accepts `"once" | "always" | "reject"`, routing directly to `PermissionNext.reply`.
- **Raw Handlers**: Long-lived feeds (SSE events, PTY streams, teleport/upload streams) are served by dedicated raw route handlers listed in `src/server/httpapi/inventory.ts`.
- **Directory Selection**: Mobile requests support `directory` query / headers for workspace instance selection.

## Invariants

- Permission replies from mobile accept the exact union `"once" | "always" | "reject"`.
- Authentication verifies bearer tokens generated during the pairing ceremony.
- Streaming responses bypass JSON schema encoding via raw handlers.
