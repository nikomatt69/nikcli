# Share v2 Contract

| Field  | Value                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| Status | **Proposed**                                                                                                     |
| Scope  | `src/share/share-next.ts`, `src/share/share.sql.ts`, `src/share/repo.ts`, `src/server/httpapi/contract-extra.ts` |

The question this records: what a share is on the wire and on disk after v1 was deleted.

The answer is **a session-scoped handle plus a typed `Data` envelope list**. Mode is `remote` | `local`, not a public/private/unlisted visibility lattice. Remove deletes rows (and DELETEs the remote), it does not tombstone.

## The Surface

`ShareNext` in `src/share/share-next.ts`. SQL in `src/share/share.sql.ts` (`session_share`, `local_share`). Repo in `src/share/repo.ts`. Short-link redirects stay a justified open payload in `specs/README.md` §Open payloads.

`NIKCLI_DISABLE_SHARE` makes create/remove no-ops / throws.

## Envelope

```ts
type Data =
  | { type: "session"; data: SDK.Session }
  | { type: "message"; data: SDK.Message }
  | { type: "part"; data: SDK.Part }
  | { type: "session_diff"; data: SDK.FileDiff[] }
  | { type: "model"; data: SDK.Model[] }
```

`session_diff` and `model` are **arrays**, not single SDK objects. `payload(sessionID)` builds: the session, every message info, every part, the session diff list, and the models used on user messages.

## Stored vs local

`StoredShare` is `Session.ShareInfo`:

- `url: string` (required)
- `id?`, `secret?`
- `mode?: "remote" | "local"`

Remote create POSTs `{ sessionID }` to the share service, stores `{ id, mode: "remote", secret, url }`, then `fullSync`. If that fails and the caller passed `baseUrl`, create falls back to local.

Local create: ulid id, `mode: "local"`, url `{baseUrl}/share/{id}`, and a `LocalShare` row:

```ts
type LocalShare = {
  id: string
  sessionID: string
  url: string
  time: { created: number; updated: number }
  items: Record<string, Data> // keyed, not a bare array
}
```

Sync of a local share merges `toItemMap(data)` into `items`. Remote sync POSTs `{ secret, data }` to `/api/share/{id}/sync`.

## Public read

`ShareNext.publicData(shareID)` loads the **local** row and returns `Object.values(share.items)` or `undefined` if missing. It does not consult `mode`, owner, or a `removed_at` column.

## Remove

`remove(sessionID)`:

- Local: transaction deletes `local_share` and `session_share`.
- Remote: DELETE `/api/share/{id}` with `{ secret }` (404 ignored), then delete the session_share row.

No tombstone. No `owner_id`. Privacy of parts is whatever `payload()` included — there is no write-time redaction pass in this module (logging redaction is a different path).

## Alternatives Rejected

**Visibility enum on the row.** Not in `ShareInfo`. Remote vs local is the split that exists.

**Keep v1 JSON blob alongside.** X2 deleted the v1 adapter. One envelope.

**Stream the parts.** Share payload is a finite list built from the session.

## Invariants

- Envelope types are the five above; inner `session_diff` / `model` are arrays.
- `publicData` is local-only and returns `Data[] | undefined`.
- `remove` deletes; it does not set `removed_at`.
- Remote shares need `id` + `secret`; local shares need `id` + `url`.

## What Is Explicitly Not Covered

- Cross-account identity and indexing of “public” shares (not in this module).
- TTL / expiration.
- Part-level secret stripping at share time (would be a new leftover if someone measures a leak).
- The later product called “share v2” in ROADMAP §later — this file is the **shipped** ShareNext contract.
