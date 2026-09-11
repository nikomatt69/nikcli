# EOT-06: Measured Terminal Rendering

Status: proposed. Tier: 2. Phase: P3. Dependencies: EOT-05.
Owner: TUI session/renderer maintainers. [Roadmap](../ROADMAP.md).

## Problem and Evidence

Evidence B08, B09, B10, B17: stable v2 turns and windowing math exist. Live windowing still uses a constant six-row estimate,
polls at 50 ms, and disables itself during streaming. The goal is measured, stable rendering under streaming, not a new
virtualization helper disconnected from the production route.

## Scope and Non-Goals

Integrate measured heights and incremental rendering in `packages/tui/src/routes/session/index.tsx`, retaining existing
view/row seams. Preserve markdown/math/images, selection, search, pending inputs, and terminal compatibility. No browser
DOM virtualizer, renderer fork, default FPS increase, or unmeasured thread-mode change.

## Design and Requirements

1. Key measured row heights by stable turn ID plus layout generation (width, theme metrics, collapsed state, content
   version). Measure actual OpenTUI renderable layout after it settles. Invalidate only affected keys; width changes
   invalidate layout, not message identity. Use estimates only for unmeasured rows.
2. Maintain a cumulative-height index supporting bounded updates and offset lookup. Reuse `message-window.ts` for pure
   range math; choose prefix sums versus a tree from EOT-01 measurements. Do not rebuild two full offset arrays on every
   scroll event. Target logarithmic lookup and affected-row updates for large transcripts.
3. Preserve scroll position as anchor turn ID plus intra-row offset. On height changes above the viewport, recompute the
   offset from that anchor. If the anchor is deleted, choose the next surviving neighbor deterministically. Preserve the
   user's manual-scroll state; OpenTUI sticky-bottom remains the single authority while the user follows the tail.
4. Keep streaming virtualization active. Update measured height of the live turn without mounting the entire history.
   Candidate overscan remains five turns initially. Mounted rows are bounded by visible rows plus overscan plus explicitly
   pinned rows; pin active selection/search targets only as needed and release them deterministically.
5. Integrate scroll/resize/layout notifications only using APIs present in OpenTUI 0.5.11. Inspect installed declarations
   and test actual event delivery; do not invent an `onScroll` prop. Typed `scrollTop`/`scrollHeight`, `scrollChildIntoView`,
   `viewportCulling`, and `MacOSScrollAccel` exist in this pin. If no reliable public notification exists, use one
   owner-scoped sampler active only during interaction/streaming, with idle teardown and measured cost. Never compute
   scroll offset as `child.y - scroll.y`: `y` is the box origin, not the scroll position.
6. Preserve `fromEntries`/`stabilize`, `<For>` identity, settled/live markdown splitting, and existing parse/highlight
   caches. Token deltas update the active tail; completed markdown must not be reparsed and remounted on every token.
   Cache keys include layout/language/theme where relevant and obey a bounded memory policy.
7. Use renderer invalidation (`requestRender`) rather than a permanent application frame timer. Pair any `requestLive`
   acquisition with `dropLive` on completion and cleanup. Hidden animations and offscreen previews must not retain live
   rendering or decoding resources. Keep current 45 FPS/thread compatibility defaults until measured otherwise.
8. Separate interaction-critical content from transcript culling: pending permissions/questions, queued inputs, and revert
   controls remain reachable. Transcript export/search operates on data, not only mounted renderables.

## Interaction and Layout Invariants

- Scroll units are terminal rows/cells, not browser pixels. Handle wide glyphs, combining characters, CJK, emoji, tabs,
  wrapped code, multiline math, and image rows using the renderer's layout semantics.
- Appending while following tail remains at tail; appending while reading history does not jump to bottom.
- Expand/collapse, image decode completion, sidebar toggle, and resize preserve the logical anchor within one terminal row
  after layout stabilization. Empty history and a single exceptionally tall row must not create negative spacers.
- Selection across a window boundary remains faithful; if native selection needs mounted rows, bound temporary pinning and
  provide data-backed copy rather than silently copying only the visible slice.

## Failure and Cancellation

An invalid measurement or unavailable renderer capability produces a logged degraded mode and a safe bounded fallback,
not an invisible missing transcript. During initial migration, the existing full-render fallback may remain behind the
old flag path, but promotion requires a safe policy for large sessions and explicit regression counters. Cancel async
highlighting/image work on owner or generation change; late results cannot overwrite newer layout or resurrect rows.

## Acceptance and Verification

- Wire the virtualizer into the real route: a 10,000-turn streaming fixture keeps mounted rows bounded and the live answer
  visible without full-list fallback. Pure `visibleRange` tests alone cannot satisfy this spec.
- Record anchor before prepend, stream growth, collapse, and resize; assert same logical content within one row after settle.
- Compare displayed text, export, search results, pending prompts, and copy across flag-off/flag-on runs. No truncation,
  duplicate rows, hidden decisions, or stale usage counters.
- Assert unchanged turns keep identity and do not incur extra `Renderable.destroy` calls. Existing churn assertions must
  stay strict; capture mount/destruction counts as well as frames.
- Extend `packages/nikcli/test/tui/streaming-churn.test.tsx`, `packages/nikcli/test/tui/streaming-cost.test.ts`,
  `packages/nikcli/test/tui/session-view.test.ts`, and `packages/nikcli/test/tui/routes/session/`.
- From `packages/nikcli`: `bun test test/tui/streaming-churn.test.tsx test/tui/streaming-cost.test.ts test/tui/session-view.test.ts`.
  Use real `testRender` and PTY smoke at 80x24/160x48; run supported Windows terminal checks before changing defaults.
- Meet EOT-01's 50 ms input and 22.2 ms frame-work candidate gates after ratification. Target at least 30% less streaming
  frame work versus the full-list reference at equal content fidelity; record RSS and native memory alongside JS heap.

## Migration and Rollback

Extend measured layout/index tests, integrate behind the existing message-virtualization feature, prove streaming and
selection, then consider default promotion. Each stage has flag-on/off tests. Roll back the optimized path using that
existing flag without removing baseline tests or changing stored session data. Keep new measurement caches ephemeral and
clear them on scope/layout changes; a rollback must not require a database migration.
