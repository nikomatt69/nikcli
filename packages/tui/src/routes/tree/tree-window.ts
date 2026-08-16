/**
 * Window math for the session tree.
 *
 * Every tree row is exactly one terminal line, so the mounted slice is just
 * `[start, start + height)`. Mounting the whole tree instead is what made the
 * panel stall on a project with hundreds of roots: a few thousand renderables
 * that every sync event re-reconciles.
 */

export type WindowInput = {
  /** Window start from the previous frame — kept when it still holds the selection. */
  previous: number
  /** Index of the selected row. */
  selected: number
  /** Total number of rows. */
  count: number
  /** Rows that fit on screen. */
  height: number
}

/** Start index of the mounted slice: the selection stays visible, the window stays in range. */
export function windowStartFor(input: WindowInput): number {
  const height = Math.max(1, Math.floor(input.height))
  const max = Math.max(0, input.count - height)
  let start = Math.min(Math.max(0, input.previous), max)
  if (input.selected < start) start = input.selected
  else if (input.selected >= start + height) start = input.selected - height + 1
  return Math.max(0, Math.min(start, max))
}

/** Start index after scrolling by `delta` rows, without moving past either end. */
export function scrollWindowStart(input: { start: number; delta: number; count: number; height: number }): number {
  const height = Math.max(1, Math.floor(input.height))
  const max = Math.max(0, input.count - height)
  return Math.max(0, Math.min(input.start + input.delta, max))
}

/** Selection dragged back onto the mounted slice after a scroll. */
export function clampSelectionToWindow(input: { selected: number; start: number; height: number }): number {
  const height = Math.max(1, Math.floor(input.height))
  return Math.max(input.start, Math.min(input.selected, input.start + height - 1))
}
