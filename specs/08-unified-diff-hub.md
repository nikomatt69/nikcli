# Unified Diff Hub

Consolidate `changes`, `github`, `git-graph`, and a new working-tree diff source into a single coherent TUI experience, borrowing the best UX ideas from opencode's diff-viewer PR series (#28476, #28512, #28513, #28641, #28676, #28728, #28878, #28896, #28903) without porting them verbatim.

---

## Summary

nikcli already has three substantial TUI routes that overlap on responsibilities:

- `routes/changes` (657 lines) — session-diff review with inline AI feedback, comments, filter, unified/split toggle, word-wrap.
- `routes/github` (1286 lines) — GitHub PRs/issues/branches/commits browser.
- `routes/git-graph` (1015 lines) — git log + commit graph + PR enrichment.

opencode's diff-viewer (~960 lines) introduces a fourth angle: a unified diff browser that works in **two modes** — `git` (working tree) and `last-turn` (session diff) — sharing a single file tree + patch pane.

This plan **does not** duplicate opencode's `feature-plugins/system/` plugin pattern (nikcli's `feature-plugins/system/` is for the external plugin catalog UI). Instead it unifies the diff/git/github surfaces into one **Diff Hub** route with pluggable sources, picks up opencode's best interaction primitives, and reuses the existing AI-comment flow that's unique to nikcli.

---

## Goals

- One coherent way to look at diffs: working tree, last AI turn, arbitrary commit, PR.
- Preserve nikcli's killer differentiator: line-level AI-review comments that loop back to the LLM.
- Borrow opencode's strongest primitives: collapsible file tree, single-patch mode, jump-by-file (`n`/`p`), split/unified auto-fit, KV-persisted view preferences, return-route param, mark-reviewed.
- Reduce code: cut the combined 2958 LOC across `changes` + `git-graph` + `github` by extracting shared primitives.
- Stable keybind contract — no surprise rebinds for existing users.

## Non-goals

- Rewriting `github` and `git-graph` from scratch. They keep their browsers; only their **diff/preview pane** becomes a Diff Hub embed.
- Porting opencode's TUI plugin-module pattern (`TuiPluginModule`, `internalTuiPlugins(flags)`, `@opencode-ai/plugin/tui` types).
- Building a new `RuntimeFlags` Effect service — reuse `Flag.NIKCLI_*` env vars.
- Persisting session-level review comments to disk (still ephemeral, same as today).

---

## Current state

### `routes/changes/index.tsx`

- Loads `sync.data.session_diff[sessionID]` (already populated by `sync.tsx`).
- `FileList` (left, 40 cols) + diff pane (right) using `DiffRenderable` + `structuredPatch`/`formatPatch`.
- Filter-as-you-type (`/`) over filename; `j`/`k`/`g`/`G`/`Tab` navigation.
- Two KV-backed signals: `changes_diff_wrap_mode`, `changes_diff_view_mode`.
- Line-level comment system (`comment-box.tsx`, 357 lines): per-line commenting, `applyLineComment`, send back to LLM via `formatCommentsForAI`.
- Auto-fits `split` view above 112 cols, otherwise `unified`.

### `routes/github/index.tsx`

- Sections: `branches | commits | prs | issues` with section-specific keymap.
- Field-separator parsed git output (`\x1f`).
- Inline PR/issue detail panes; no diff rendering at all — relies on `open` to launch browser.

### `routes/git-graph/index.tsx`

- Reads via `git log --graph --pretty='%h%x1f%H%x1f...'`.
- Per-commit details: body, files-changed list, +/- stats.
- No actual patch view — same gap as `github`.

### What's missing today

- No working-tree diff view (you have to `git diff` in a separate terminal).
- No way to see a specific commit's patch inside the TUI; clicking a commit in `git-graph` shows file list but not the diff content.
- No way to diff a PR head against base in-TUI.
- `changes` is reachable only when there's an active session diff; it doesn't share UI with the git/github surfaces.

---

## Best ideas worth importing from opencode

| Idea                                                                | Source          | Why it's worth taking                                                               |
| ------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| Pluggable **diff sources** (`git`, `last-turn`, …)                  | #28476          | Lets one component handle session, working-tree, commit, PR.                        |
| Collapsible **file tree** with directory chains (`src/cli/cmd/tui`) | #28476 + #28512 | Much better than flat list when patches span dozens of files.                       |
| **Single-patch mode** (`s` key)                                     | #28476          | Cuts noise when reviewing one file at a time; pairs well with `n`/`p`.              |
| `n` / `p` to **jump between files** in the patches pane             | #28476 / #28896 | Faster than scrolling; preserves vertical position context.                         |
| **Mark-reviewed** state per file                                    | #28476          | Visually fade or strike completed files; helps long reviews.                        |
| **KV-persisted** view prefs (view, file-tree visible, single-patch) | #28476          | Settings stick across sessions — nikcli's `changes` already does this for 2 keys.   |
| **Return route** param                                              | #28676 / #28903 | Closing diff lands you exactly where you came from (session, git-graph, github PR). |
| **Empty-state** copy + helper hints                                 | #28878          | Friendlier than a blank pane.                                                       |
| **Focus first file** on open                                        | #28513          | One less keypress to start reviewing.                                               |
| **Help dialog** with current keybinds                               | #28476          | Discovery without a separate page.                                                  |

Ideas to **skip**:

- `@opencode-ai/plugin/tui` plugin-module pattern — not worth the infrastructure cost in nikcli.
- `OPENCODE_DIFF_VIEWER` env-flag gating — ship it on by default behind a stable route.
- `Panel`/`PanelGroup`/`Separator` UI primitives from opencode — nikcli already has equivalent box composition; another layer would just be churn.

---

## Proposed architecture

### Single route, multiple sources

New route: `diff` with params:

```ts
type DiffSource =
  | { kind: "session"; sessionID: string; messageID?: string } // replaces /changes
  | { kind: "working-tree"; directory?: string } // new
  | { kind: "commit"; hash: string; directory?: string } // entered from git-graph
  | { kind: "pr"; number: number; repo: string } // entered from github
type DiffRouteParams = {
  source: DiffSource
  returnRoute?: TuiRouteCurrent // borrowed from opencode #28676
}
```

`routes/changes` becomes a thin shim that constructs `source: { kind: "session", ... }` and forwards.

### Component layout

```
routes/diff/
├── index.tsx                       — orchestrator, route data, KV signals, source switching
├── source.ts                       — load+normalize diffs per source kind (one place)
├── file-tree.tsx                   — collapsible tree (port file-tree-utils logic)
├── file-tree-utils.ts              — pure data fns + unit tests
├── patch-pane.tsx                  — scrollable patch list, single-patch mode, n/p nav
├── review-panel.tsx                — extracted from changes/comment-box.tsx, AI-comment flow
├── empty-state.tsx                 — friendly messaging per source kind
├── help-dialog.tsx                 — keybind cheat sheet
├── footer.tsx                      — moved from changes/footer.tsx, source-aware
└── header.tsx                      — moved from changes/header.tsx, source-aware
```

### Server-side endpoints needed

- ✅ Already exists: `client.session.diff({ sessionID, messageID })` → `Snapshot.FileDiff[]`.
- ✅ Already exists (mobile-only currently): `/mobile/git/diff` returns parsed file diffs for the current git state. **Action:** add `/git/diff` (non-mobile) wrapping the same parser, or expose `vcs.diff` properly in v2.
- ❌ Missing: commit-by-hash diff. **Action:** add `/git/show?hash=...` (or similar) returning `Snapshot.FileDiff[]` via `git show --format='' <hash>` parsed by the same util.
- ❌ Missing: PR head-vs-base diff. **Action:** add `/github/pr/:number/diff` shelling to `gh pr diff` and parsing, OR fetch directly from the GitHub API.

### Keybind reservations

Add to `tui/context/keybind.tsx` definitions (names mirror opencode's category but namespaced):

```
diff.close                  esc, q
diff.toggle_file_tree       b
diff.toggle_view            v       (split ↔ unified)
diff.toggle_single_patch    s
diff.switch_focus           tab
diff.next_file              n
diff.previous_file          p
diff.mark_reviewed          m
diff.expand                 right
diff.collapse               left
diff.help                   ?
diff.switch_source          d       (only when ambiguous, e.g. session ↔ working-tree)
diff.review.comment         c       (nikcli-only — opens comment dialog on hovered line)
diff.review.send            <leader>r  (nikcli-only — submits comments to LLM)
```

`/`-to-filter is preserved from current `changes`.

### KV-persisted prefs

Single namespace `diff.*` (vs current `changes_*`):

```
diff_view                    "split" | "unified"
diff_show_file_tree          boolean
diff_single_patch            boolean
diff_wrap_mode               "word" | "none"
```

Migration: read both old and new keys on startup; write new only.

### Entry points

| Where                              | Action                  | Lands on                                                           |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| Session view, message with diff    | open changes (existing) | `diff` route, `source.kind=session`, `returnRoute=session`         |
| `git-graph`, press Enter on commit | new shortcut            | `diff` route, `source.kind=commit`, `returnRoute=git-graph`        |
| `github`, press Enter on PR        | new shortcut            | `diff` route, `source.kind=pr`, `returnRoute=github`               |
| Command palette / `:diff`          | new command             | `diff` route, `source.kind=working-tree`, `returnRoute=<previous>` |

Closing (`esc`/`q`) honors `returnRoute` (opencode #28903 behavior).

### What gets deleted

- `routes/changes/index.tsx` → reduced to `~30-line` redirect/shim.
- `routes/changes/file-list.tsx` → folded into `routes/diff/file-tree.tsx`.
- `routes/changes/footer.tsx`, `header.tsx` → moved to `routes/diff/` and made source-aware.
- `comment-box.tsx` and `format-comments.ts` → moved to `routes/diff/review-*` unchanged in behavior.

Net code shape (estimate): `~1600 LOC` for `routes/diff/*` vs current `~1100 LOC` for `routes/changes/*` — but the new code subsumes working-tree, commit, and PR diff that don't exist today and aren't free elsewhere.

---

## Phasing

Order chosen so each phase ships value independently and a stuck phase doesn't block prior wins.

### Phase 1 — Skeleton + session parity

- New `routes/diff/` directory.
- Implement `source.ts` with only `kind: "session"` initially.
- Move `comment-box.tsx`, `format-comments.ts`, `header.tsx`, `footer.tsx` from `changes/` to `diff/`; thin-shim `changes` to forward.
- New keybind names; old keybind names alias for one release.
- KV key rename with backward read.

**Outcome:** zero regression for the existing `changes` flow, new file layout in place.

### Phase 2 — File tree

- Port `diff-viewer-file-tree-utils.ts` from opencode as `routes/diff/file-tree-utils.ts` (pure data + unit tests under `test/cli/tui/diff-file-tree-utils.test.ts`).
- Port `diff-viewer-file-tree.tsx` rendering as `routes/diff/file-tree.tsx`.
- Replace the flat `FileList` with the tree; keep filter behavior.
- `b` toggles tree; `tab` switches focus tree ↔ patches.

**Outcome:** opencode's tree UX lands in nikcli, still session-only.

### Phase 3 — Working-tree source

- Add `client.vcs.diff` (non-mobile) endpoint OR promote the mobile parser; expose in v2 SDK via `bun run build`.
- Add `source.kind="working-tree"` branch in `source.ts`.
- Command palette command `diff:working-tree`.
- Empty-state copy.

**Outcome:** "see what I've changed without leaving nikcli" is real.

### Phase 4 — Patch pane refinements

- Single-patch mode (`s`).
- `n` / `p` jump-by-file.
- `m` mark-reviewed (per-source, ephemeral).
- Help dialog (`?`).
- Auto-fit split/unified with width check (already in `changes`, generalize).

**Outcome:** parity with the strongest opencode patches.

### Phase 5 — Commit + PR sources

- Add `/git/show` endpoint, wire `source.kind="commit"`.
- `git-graph`: Enter on commit opens diff route.
- Add `/github/pr/:number/diff` endpoint, wire `source.kind="pr"`.
- `github`: Enter on PR row opens diff route.

**Outcome:** the three current routes become entry points into one Diff Hub.

### Phase 6 — Polish (after the above lands)

- Return-route closing behavior across all entry points.
- Focus-first-file on open (#28513).
- Migration message removal (drop old KV keys).
- Telemetry/logging cleanup.

---

## Open questions

1. **Comments across non-session sources?** Today AI-review comments only make sense for session diffs (they get fed back to the LLM). For working-tree / commit / PR sources, do we:
   - Hide the comment affordance entirely (simplest), or
   - Let users jot comments locally for export (nice but adds scope)?

2. **`split` view as default?** opencode picks `split` when `width >= MIN_SPLIT_WIDTH`; nikcli's `changes` uses `>= 112`. Standardize on one threshold and document it.

3. **Workspace awareness.** Some commands route through `routes/changes` carrying `workspaceID`. The new `diff` route should accept and pass it through to all source loaders.

4. **Naming.** Is `/diff` the right route name? Alternatives: `/review`, `/changes` (keep current name and broaden semantics), `/patches`.

5. **Should `git-graph` and `github` lose their inline detail panes?** Or do they stay as quick previews with Enter as the "open in Diff Hub" affordance? Recommended: keep previews, make Enter the explicit open.

6. **Does `gh pr diff` require `gh` to be installed?** If yes, fallback to the GitHub REST API path so users without `gh` still get PR diffs.

---

## Risks

- **Endpoint additions** (`vcs.diff`, `git.show`, `github.pr.diff`) touch server routes and trigger SDK regen via `bun run build` in `packages/sdk/js`. Coordinate with the `*.gen.ts`-is-source-of-truth rule.
- **Comment state migration.** Comments are in-memory today; the route rename means the existing in-flight comment store needs a one-time bridge (or accept resetting it).
- **Keybind aliases.** Releasing new keybind names while honoring the old set for a window adds short-term complexity.
- **`gh` shelling.** PR diff via `gh pr diff` is slower than session diffs (network round trip); UX needs a spinner.

---

## Verification plan

- Unit tests for `file-tree-utils` (mirror opencode's coverage).
- Integration test: open `diff` with each source kind, ensure first file focuses and `n`/`p` cycle.
- Snapshot test for the empty state per source.
- Manual: open from session, from `git-graph`, from `github`, and from the command palette. Confirm `returnRoute` lands you back where you came from.
- Type/lint: `bun run typecheck` clean (modulo the pre-existing `mobile.ts` + `prompt.ts` errors).

---

## Out of scope for this plan

- Session warping (#25768) — separate concern, separate plan.
- Conflict resolution UI.
- Inline edit-and-stage (would essentially require a tiny editor).
- Multi-commit range diffs.
