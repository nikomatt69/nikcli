import { describe, expect, test } from "bun:test"
import type { ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal, For } from "solid-js"

/**
 * Guards the scroll behaviour `component/dialog-support.tsx` relies on.
 *
 * That dialog used to follow its transcript with two effects that called
 * `scrollTo(scrollHeight)` on every message and on every token inside the last
 * one. They followed the tail, but unconditionally: scrolling up to re-read
 * something while the assistant was still streaming put the view back at the
 * bottom a few milliseconds later. They are gone, replaced by OpenTUI's
 * `stickyScroll` — so what is asserted here is the part of that swap that has
 * to keep holding: it follows appended content, it lets go the moment the
 * reader scrolls away, and it picks the tail back up when they return to it.
 */
describe("sticky scrollbox", () => {
  const VIEWPORT = 6

  async function mount() {
    const [count, setCount] = createSignal(3)
    let scroll!: ScrollBoxRenderable
    const { renderOnce } = await testRender(
      () => (
        <box width={30} height={VIEWPORT}>
          <scrollbox
            ref={(r: ScrollBoxRenderable) => (scroll = r)}
            height={VIEWPORT}
            stickyScroll={true}
            stickyStart="bottom"
          >
            <For each={Array.from({ length: count() }, (_, i) => i)}>{(i) => <text>row {i}</text>}</For>
          </scrollbox>
        </box>
      ),
      { width: 30, height: VIEWPORT },
    )
    // Two frames: the first lays the content out, the second applies the
    // scroll position that layout produced.
    const settle = async () => {
      await renderOnce()
      await renderOnce()
    }
    await settle()
    return { scroll: () => scroll, setCount, settle }
  }

  const atBottom = (s: ScrollBoxRenderable) => s.scrollTop >= s.scrollHeight - s.viewport.height

  test("follows content appended below the fold", async () => {
    const { scroll, setCount, settle } = await mount()
    expect(scroll().scrollTop).toBe(0)

    setCount(40)
    await settle()

    expect(scroll().scrollHeight).toBeGreaterThan(VIEWPORT)
    expect(atBottom(scroll())).toBe(true)
  })

  test("lets go once the reader scrolls away, and picks the tail back up", async () => {
    const { scroll, setCount, settle } = await mount()
    setCount(40)
    await settle()
    expect(atBottom(scroll())).toBe(true)

    scroll().scrollTo(0)
    await settle()
    const parked = scroll().scrollTop

    setCount(60)
    await settle()
    // The old effects would have yanked this back to the bottom.
    expect(scroll().scrollTop).toBe(parked)
    expect(atBottom(scroll())).toBe(false)

    scroll().scrollTo(scroll().scrollHeight)
    await settle()
    setCount(80)
    await settle()
    expect(atBottom(scroll())).toBe(true)
  })
})
