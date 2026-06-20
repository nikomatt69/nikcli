## Message-list virtualization

Keep large sessions scrollable by windowing the message render in the TUI session view.

> Imported from opencode `specs/04-scroll-spy-optimization.md`, re-scoped to nikcli's TUI
> (`packages/nikcli`). opencode replaces an O(N) DOM `querySelectorAll` scroll-spy in a browser;
> nikcli's analogous cost is mounting **every** message renderable in an OpenTUI scrollbox.

---

### Summary

`routes/session/index.tsx` renders the full conversation with `<For each={messages()}>` inside a
sticky-bottom scrollbox. Every message (and all of its parts: text, diffs, tool output,
diagnostics) is mounted as a live OpenTUI renderable at once. For long sessions this inflates the
layout tree, slows re-render/scroll, and grows memory linearly with message count. We will window
the render to the messages near the viewport while preserving sticky-bottom behavior and stable
"jump to message" navigation.

---

### Goals

- Stop mounting all message renderables for long sessions; mount only a viewport window
  (plus a small overscan above/below).
- Preserve current UX: sticky-bottom auto-follow during streaming, scroll acceleration, and
  message navigation.
- Provide a safe fallback to the current full-render behavior behind a flag.

### Non-goals

- Redesigning message rendering or part components.
- Changing message IDs or the streaming/event model.
- Perfect pixel accuracy during extreme layout thrash.

---

### Current state

- `src/cli/cmd/tui/routes/session/index.tsx`
  - `<scrollbox stickyScroll stickyStart="bottom" scrollAcceleration=…>` wraps
    `<For each={messages()}>{(message, index) => …}</For>` (≈ line 1325–1331).
  - Nested `<For>`s mount per-message parts (diff files ≈1374, file lists ≈1552, parts ≈1656,
    diagnostics ≈2422/3361). All are mounted for every message regardless of visibility.
- `messages()` is the full per-session array from the sync store (already capped at ~100 most
  recent; see `02-tui-cache-eviction.md`), but 100 richly-parted messages is still a large tree.

### Evidence

- `routes/session/index.tsx:1330` `<For each={messages()}>` with no slice/window around it.
- The file is 3534 LOC and owns rendering for all part kinds.

---

### Proposed approach

#### 1) Extract a windowing primitive

New `src/cli/cmd/tui/routes/session/message-window.ts`:

- Track scrollbox scroll offset + viewport height (from the OpenTUI scrollbox ref).
- Maintain an ordered list of `{ id, height }` estimates (seed with a per-message-type estimate;
  refine from measured renderable heights after mount).
- Expose `visibleRange(): { start: number; end: number }` via binary search over cumulative
  offsets, plus an `overscan` (e.g. 5 messages each side).

#### 2) Window the render

- Replace `<For each={messages()}>` with `<For each={windowed()}>` where
  `windowed = createMemo(() => messages().slice(range().start, range().end))`.
- Reserve space for off-window messages with two spacer boxes (top/bottom) sized from the
  cumulative height estimates, so the scrollbar and sticky-bottom math stay correct.
- Keep `stickyStart="bottom"`: when at bottom, always include the last message(s) and follow
  streaming appends.

#### 3) Stable navigation + active tracking

- "Jump to message" / index-based navigation computes the target offset from the height list and
  scrolls there, expanding the window around it (the binary-search analog of opencode's
  IntersectionObserver "active id").
- Recompute the height list on: new/removed messages, streaming completion of the last message,
  and terminal resize.

#### 4) Flag + fallback

- `session.messageVirtualization` (default off). On any windowing failure, fall back to the
  current full `<For each={messages()}>`.

---

### Phased implementation steps

1. Extract `message-window.ts` with height estimates + `visibleRange()` + unit tests; render
   still uses full list (no behavior change).
2. Add spacer-box reservation and switch to `windowed()` behind the flag.
3. Refine height estimates from measured renderable heights post-mount; recompute on resize and
   stream-complete.
4. Re-point message navigation/active tracking at the offset list.
5. Default the flag on after large-session soak; keep fallback one release cycle.

---

### Backward compatibility

- No persisted changes; message IDs unchanged.
- With the flag off, rendering is byte-for-byte the current behavior.

---

### Risk + mitigations

- Sticky-bottom/auto-follow regressions during streaming → always pin the last message when at
  bottom; add an explicit "at bottom" guard before windowing the tail.
- Height mis-estimates cause scroll jumps → seed conservative estimates, correct from measured
  heights, and recompute on resize/stream-complete.
- Tool/diff parts with dynamic height → measure after mount; keep overscan generous.

---

### Validation plan

- Unit: `visibleRange()` binary search over synthetic height lists; `bun test` exit code.
- Manual: a session with hundreds of messages — confirm smooth scrolling, correct sticky-bottom
  follow during a streaming reply, correct "jump to message", and that mounted renderable count
  stays ~window-sized (instrument a dev counter of mounted message nodes).

---

### Rollout plan

- Land the extracted module first (no behavior change).
- Enable `session.messageVirtualization` for internal testing.
- Default on after stability; remove the full-render fallback one cycle later.

---

### Open questions

- Which scrollbox ref exposes live offset/height in the current OpenTUI version?
- Are message heights stable enough post-stream to cache, or must they be re-measured often?
- Should overscan scale with terminal height?
