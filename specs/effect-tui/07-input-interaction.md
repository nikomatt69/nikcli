# EOT-07: Input and Interaction Architecture

Status: proposed. Tier: 2. Phase: P3. Dependencies: EOT-03, EOT-05.
Owner: TUI prompt/dialog/keymap maintainers. [Roadmap](../ROADMAP.md).

## Problem and Evidence

Evidence B11, B18: prompt/session routes contain substantial coordination, while dialog Ctrl+C behavior inspects component
source text and a DOM-style active element. OpenTUI has its own focus and input system. Consistency requires explicit
interaction ownership, not more scattered keyboard handlers or browser assumptions.

## Scope and Non-Goals

Unify key routing, focus restoration, prompt command state, paste handling, and responsive terminal layouts. Preserve the
current visual language, shortcuts, draft persistence, i18n, and permission checks. No new theme redesign, command syntax,
automatic user-action submission, or silent changes to destructive-command confirmation policy.

## Design and Requirements

1. Represent focus/interaction roles explicitly: editable prompt, modal form, selection list, transcript, and plugin
   surface. Register/unregister them with the existing dialog/keymap context under a Solid owner. Query OpenTUI's real
   focused renderable or the registered role, never `String(component)` or browser `document.activeElement`.
2. Route input by precedence: active modal, focused editable surface, registered route/plugin context, application fallback.
   One handled event is consumed once with the renderer's supported propagation API. Specify press/repeat/release policy;
   normalize binding aliases without treating Kitty raw bytes and decoded text as equivalent.
3. Escape closes only the top dismissible layer and restores the last valid focus target. Ctrl+C preserves the established
   edit/cancel/interrupt policy, documented by characterization tests before refactoring. An input event cannot both close
   a dialog and cancel a session through an unconsumed application listener.
4. Extract pure prompt state transitions from rendering: draft, completion request, command selection, submission state,
   queued input, attachment status, and validation errors. Keep `component/prompt/index.tsx` as composition while moving
   coherent controllers, not splitting files solely by line count. Use Solid signals/stores and narrow memos for view state.
5. Async autocomplete and file/model search use EOT-03 generation/cancellation and EOT-05 query coordination. Selection
   survives result refresh by stable identity. Closing autocomplete prevents late results from stealing focus.
6. Treat paste as text, not repeated command keystrokes. Bound decode/parse work for large paste, preserve Unicode and
   bracketed-paste semantics, and display existing large-input affordances without accidentally submitting. Preserve drafts
   and attachments across failed submission, workspace changes according to current policy, and dialog interruption.
7. Command availability is derived from capabilities and connection/readiness state. Disabled commands explain why; a
   missing host capability is not a successful no-op. Plugin key collisions use deterministic priority and a visible
   diagnostic rather than timing-dependent registration order.
8. Keep layouts usable at 80x24; controls below the fold must scroll into view. Narrower terminals degrade with a clear
   size hint without crashing. Keyboard-only navigation, theme contrast, reduced animation where configured, CJK/emoji
   widths, and complete translated labels are acceptance surfaces, not visual polish deferred indefinitely.

## Interaction Matrix

| Scenario                                     | Required invariant                                                   |
| -------------------------------------------- | -------------------------------------------------------------------- |
| Nested dialogs and Escape                    | Top layer only; focus returns to surviving previous owner            |
| Ctrl+C in editor versus non-editable modal   | Matches documented current policy; exactly one action                |
| Permission/question prompt during streaming  | Reachable and individually actionable even with grouped/virtual rows |
| Search resolves after close or newer query   | No focus/state takeover                                              |
| 100 KB multiline paste with escape-like text | Content retained, zero unintended commands/submissions               |
| Plugin shortcut collision/unload             | Deterministic winner; unloaded handler never receives input          |
| Resize while selecting or editing            | Draft and selection retained; confirm/cancel controls reachable      |
| Legacy terminal versus Kitty protocol        | Equivalent supported shortcuts without requiring key-release events  |

## Failure and Cancellation

Submission failure keeps the draft and displays the real error; don't mark a command complete before acknowledgement.
Cancel pending selection/search work at owner cleanup. Route render errors to existing boundaries without leaving an
invisible focus trap. Missing terminal capabilities require a documented fallback; never catch them into silent command
success. Permission denial must remain visible and may not be bypassed by alternate shortcuts or plugin command paths.

## Acceptance and Verification

- Use real OpenTUI keyboard events in component tests and actual PTY input for propagation/focus behavior. Pure controller
  tests cover transitions; source text scans and snapshots alone do not prove event consumption.
- Verify every interaction-matrix row, including an event that would trigger two handlers without consumption.
- After 100 open/close cycles, registered handlers return to baseline and focus points to a live renderable.
- Extend `packages/nikcli/test/tui/select-controller.test.ts`, `packages/nikcli/test/tui/plugin-keymap.test.ts`,
  `packages/nikcli/test/tui/prompt-session-context.test.ts`, `packages/nikcli/test/tui/i18n-parity.test.ts`, and
  `packages/nikcli/test/tui/dialog-lifecycle.test.ts`.
- From `packages/nikcli`: `bun test test/tui/select-controller.test.ts test/tui/plugin-keymap.test.ts test/tui/prompt-session-context.test.ts test/tui/i18n-parity.test.ts`.
  Add focus/propagation behavioral cases in the existing component/PTY harness and run `bun run smoke:tui`.
- Meet EOT-01's key-to-paint budget under simultaneous streaming/search and large paste. No dropped Unicode content or
  delayed permission interaction is acceptable as a performance trade-off.

## Migration and Rollback

Characterize current key behavior first, then replace dialog role detection, extract one prompt controller, and integrate
route/plugin input ownership. Keep public shortcuts stable; any intended behavioral change needs a separate user-facing
decision. Roll back controller wiring behind the same context, retaining collision diagnostics, draft safety, and tests.
