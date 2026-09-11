import type { TuiConfig } from "@nikcli-ai/sdk/httpapi"
import { MacOSScrollAccel, type ScrollAcceleration, type ScrollBoxRenderable } from "@opentui/core"
import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"

export type { ScrollAcceleration }

export class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

export function getScrollAcceleration(tuiConfig?: TuiConfig): ScrollAcceleration {
  if (tuiConfig?.scroll_acceleration?.enabled) {
    return new MacOSScrollAccel()
  }
  if (tuiConfig?.scroll_speed !== undefined) {
    return new CustomSpeedScroll(tuiConfig.scroll_speed)
  }

  return new CustomSpeedScroll(3)
}

/**
 * Memoized OpenTUI scroll acceleration from `config.tui`.
 *
 * Call this once per component that owns a `<scrollbox>` — constructing a new
 * `MacOSScrollAccel` on every render would reset the burst window.
 *
 * Do not set `focused={true}` on a ScrollBox that shares the keyboard with an
 * input or a custom list cursor. OpenTUI delivers global `useKeyboard`
 * handlers first, but Home/End/Page keys still reach a focused ScrollBox when
 * the handler does not `preventDefault`. List dialogs should keep the child in
 * view with `scrollChildIntoView` instead.
 */
export function useScrollAcceleration() {
  const sync = useSync()
  return createMemo(() => getScrollAcceleration(sync.data.config.tui))
}

/**
 * Keep a child inside a ScrollBox using OpenTUI's own viewport math.
 *
 * Manual `child.y - scroll.y` is wrong on ScrollBox: `y` is the box origin in
 * terminal coordinates, not the scroll offset. `scrollChildIntoView` compares
 * the descendant against `viewport` and only moves when the child is clipped.
 * Centering subtracts `viewport.y` for the same reason — both `child.y` and
 * the viewport origin are terminal coordinates.
 */
export function scrollChildIntoView(
  scroll: ScrollBoxRenderable | undefined,
  childId: string | undefined,
  options?: { center?: boolean },
) {
  if (!scroll || scroll.isDestroyed || !childId) return
  if (options?.center) {
    const child = scroll.getRenderable(childId)
    if (!child) return
    const viewportHeight = scroll.viewport.height
    const centerOffset = Math.floor(viewportHeight / 2)
    scroll.scrollBy(child.y - scroll.viewport.y - centerOffset)
    return
  }
  scroll.scrollChildIntoView(childId)
}
