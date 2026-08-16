/**
 * Selection arithmetic for list dialogs.
 *
 * Every dialog that shows a list — the command palette, the model picker, the
 * session list, the theme list, and about forty others — moves a cursor through
 * options and has to answer the same two questions: where does the cursor land
 * after a keypress, and where does it land after the list underneath it
 * changed. That answer was inline in `dialog-select.tsx`, so it was covered by
 * no test at all: reaching it needs a mounted dialog, a rendered scrollbox and
 * a key event.
 *
 * Pulled out here it is arithmetic, and arithmetic can simply be checked. Same
 * rule as `routes/session/rows.ts` and `view.ts`: no Solid, no renderer, no
 * store — data in, data out.
 *
 * Ported from opencode's `ui/select-controller.ts`, minus its two
 * offset-windowing helpers: those serve a list that pages by offset, and ours
 * scrolls a real renderable, so they would be dead code here.
 */

/**
 * The nearest valid index in a list of `count` options.
 *
 * Also the answer to "the list changed under the cursor": a filter that shrinks
 * the options leaves `selected` past the end, and this pulls it back to the
 * last one rather than off the list. An empty list selects index 0 — there is
 * nothing to point at, and 0 is what an empty list is refilled at.
 */
export function reconcileSelection(selected: number, count: number): number {
  if (count <= 0) return 0
  return Math.max(0, Math.min(selected, count - 1))
}

/**
 * Where the cursor lands after moving by `delta`.
 *
 * `wrap` is for keyboard navigation, where running off the bottom should return
 * to the top; `clamp` is for anything driven by a position that must not
 * teleport — a mouse, or a jump to a known option.
 */
export function moveSelection(
  selected: number,
  input: { count: number; delta: number; policy: "clamp" | "wrap" },
): number {
  if (input.count <= 0) return 0
  const next = selected + input.delta
  if (input.policy === "clamp") return reconcileSelection(next, input.count)
  if (next < 0) return input.count - 1
  if (next >= input.count) return 0
  return next
}
