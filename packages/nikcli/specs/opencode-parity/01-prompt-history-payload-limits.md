## Prompt-history payload limits

Stop persisting base64 image blobs into the TUI prompt history; bound on-disk size.

> Imported from opencode `specs/01-persist-payload-limits.md`, re-scoped to nikcli's TUI
> persistence (`packages/nikcli`). opencode targets web `localStorage` / desktop Tauri store;
> nikcli's equivalent is a plaintext JSONL file written with `Bun.write`.

---

### Summary

The TUI persists prompt history (and stashed prompts) as newline-delimited JSON. Each entry is
a `PromptInfo` whose `parts` can include image `FilePart`s carrying a full
`url: data:<mime>;base64,<...>` payload. Pasting/attaching a few images therefore writes
megabytes of base64 into `prompt-history.jsonl` on every submit, and reloads parse it all back
into memory. We will keep history entries lightweight by storing image **references** to an
out-of-band blob store and hydrating the `dataUrl` only when an entry is actually applied to
the prompt.

---

### Goals

- Stop writing base64 image `dataUrl`s into `prompt-history.jsonl` and the stash store.
- Store image payloads out-of-band (a blob directory under `Global.Path.state`) and load them
  lazily when a history entry is recalled and re-submitted.
- Add per-store byte caps (soft `warnBytes`, hard `maxBytes`) so a single oversized entry can
  never balloon the file or block the write.
- Keep behavior predictable and fully backward compatible with existing history files.

### Non-goals

- Cross-device sync or deduplication/reference-counting of blobs on day one.
- Changing the in-memory `PromptInfo` shape used while composing (UI keeps `url`/`dataUrl`).
- Persisting large pasted-text parts differently (already summarized to `[Pasted ~N lines]`).

---

### Current state

- `src/cli/cmd/tui/component/prompt/history.tsx`
  - Persists to `Bun.file(path.join(Global.Path.state, "prompt-history.jsonl"))`.
  - `writeHistory()` serializes every `PromptInfo` (including `parts`) with `JSON.stringify`.
  - `MAX_HISTORY_ENTRIES = 50` caps the **count** of entries, not their **size**.
- `src/cli/cmd/tui/component/prompt/stash.tsx` — same `PromptInfo` shape, same exposure.
- `src/cli/cmd/tui/component/prompt/index.tsx`
  - `pasteImage()` builds a `FilePart` with `url: data:${mime};base64,${content}` and pushes it
    into `store.prompt.parts`.
  - `history.append({ ...store.prompt, mode })` on submit persists those parts verbatim.

### Evidence

- `parts` type in `history.tsx` includes `Omit<FilePart, "id"|"messageID"|"sessionID">`, and
  `FilePart.url` is the base64 data URL produced by `pasteImage`.
- No byte measurement or cap exists on the write path.

---

### Proposed approach

#### 1) Add a TUI blob store

New module `src/cli/cmd/tui/util/prompt-blob.ts`:

- `put(bytes: Uint8Array, meta: { mime: string; filename?: string }): Promise<string>` → returns
  a `blobID`; writes `Global.Path.state/prompt-blobs/<blobID>` (one file per blob).
- `get(blobID): Promise<{ bytes, mime, filename } | undefined>`.
- `remove(blobID): Promise<void>`.
- All filesystem ops use `Bun.file`/`Bun.write` and never throw to the caller.

#### 2) Reference-based persisted image parts

Extend the image `FilePart` source so the persisted form carries a reference, not the payload:

- In-memory (composing): keep `url` (data URL) for rendering/preview — unchanged.
- Persisted: replace `url` with `{ blobID, mime, filename }` and drop the base64.

Add `transformOut(entry)` / `transformIn(entry)` helpers in `history.tsx`:

- `transformOut`: for each image part, ensure it is in the blob store, then strip `url` and keep
  only `{ type:"file", mime, filename, source: { blobID } }`.
- `transformIn`: leave `blobID` as-is; **do not** eagerly read the blob.

#### 3) Lazy hydration on recall

When a history/stash entry is applied to the prompt (`ref.set(...)` / history navigation in
`prompt/index.tsx`), resolve any `blobID` parts via `prompt-blob.get()` and rebuild the
`url` data URL just-in-time. Before submit, ensure every image part has a usable `url`; if a
blob is missing, drop the image and surface a non-blocking toast.

#### 4) Byte caps on the write path

In `writeHistory()` (and the stash equivalent):

- Compute byte length with `new TextEncoder().encode(line).length`.
- If a single line exceeds `maxBytes` (default 256 KB after image stripping), drop that line's
  heavy parts and persist a placeholder; log once in dev.
- If the whole file would exceed an aggregate cap, evict oldest entries beyond
  `MAX_HISTORY_ENTRIES` first, then by size.

#### 5) Blob lifecycle

TTL-based GC on TUI startup: delete `prompt-blobs/*` whose `mtime` is older than N days
(default 14) and that are not referenced by the current history/stash. Start TTL-only; add a
reference-scan sweep later if orphans accumulate.

---

### Phased implementation steps

1. Add `prompt-blob.ts` (put/get/remove) + unit round-trip test.
2. Add `transformOut`/`transformIn` + byte measurement in `history.tsx` behind flag
   `persist.promptPayloadLimits` (default off). Detect+log oversize, no behavior change yet.
3. Flip image stripping on: persist `blobID` instead of `url`; hydrate on recall.
4. Apply the same path to `stash.tsx`.
5. One-time migration: on read, if a legacy entry has a base64 `url`, move it to the blob
   store and rewrite the reduced entry; on failure, keep the entry but drop the image.
6. Add TTL blob GC on startup behind `persist.promptBlobGc`.

---

### Backward compatibility

- Reader tolerates both shapes: legacy `url` (base64) and new `{ blobID }`.
- Missing `url` = "not hydrated yet"; missing `blobID` on a legacy entry = migrate-on-read.
- New blob files are namespaced under `prompt-blobs/` to avoid collisions.

---

### Risk + mitigations

- Blob store unavailable (fs perms/quota) → keep prompt functional, persist without image, show
  placeholder.
- Hydration fails at submit → pre-submit "ensure hydrated" step; submit without the image with a
  clear toast rather than blocking.
- Migration cost for large legacy files → migrate incrementally (only the entry being read).

---

### Validation plan

- Unit: blob `put/get/remove` round trip; `transformOut` strips base64 and yields a `blobID`;
  byte-cap drops heavy parts.
- Manual: attach 3 images, submit, then `wc -c prompt-history.jsonl` stays small; restart TUI,
  recall the entry from history, confirm the image re-attaches; confirm a corrupted/missing blob
  degrades to a placeholder without crashing.
- Evidence to capture: file size before/after for the same workflow; `bun test` exit code for
  the new unit tests.

---

### Rollout plan

- Phase 1: `persist.promptPayloadLimits` off; log oversize detections in dev.
- Phase 2: enable blob refs (`persist.promptImageBlobs`) for history then stash.
- Phase 3: enable byte caps + TTL GC (`persist.promptBlobGc`).
- Each flag is an independent kill switch.

---

### Open questions

- Canonical persisted image schema (`source.blobID` vs a top-level `ref`)?
- Retain blobs for all `MAX_HISTORY_ENTRIES`, or only the most recent K?
- Should the stash (explicit user save) use a longer TTL than transient history?
