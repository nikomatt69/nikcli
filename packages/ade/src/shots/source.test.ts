import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createShotSource } from "./source"

/**
 * The browser path only — no host to watch a folder — which is exactly the
 * behaviour worth pinning: the tray must be empty and inert rather than broken
 * when there is nothing to watch.
 */
describe("createShotSource without a host", () => {
  test("starts empty and claims no folder", () => {
    createRoot((dispose) => {
      const source = createShotSource(false)
      expect(source.shots()).toEqual([])
      expect(source.folder()).toBeUndefined()
      dispose()
    })
  })

  /*
   * The difference the tray needs: with no host, and with a host that says
   * this machine has no screenshots folder, nothing can ever arrive — so the
   * strip says so instead of staying blank, which is what a Mac was left with.
   */
  test("says outright that there is no folder to watch", () => {
    createRoot((dispose) => {
      expect(createShotSource(false).state()).toBe("none")
      dispose()
    })
  })

  test("with a host it waits for the answer before saying anything", () => {
    createRoot((dispose) => {
      expect(createShotSource(true).state()).toBe("asking")
      dispose()
    })
  })

  test("loading an image resolves to nothing rather than throwing", async () => {
    await createRoot(async (dispose) => {
      const source = createShotSource(false)
      expect(await source.load("C:/Pictures/Screenshots/a.png")).toBeNull()
      dispose()
    })
  })

  test("dismissing something that is not there is harmless", () => {
    createRoot((dispose) => {
      const source = createShotSource(false)
      source.dismiss("C:/Pictures/Screenshots/mai-esistito.png")
      expect(source.shots()).toEqual([])
      dispose()
    })
  })

  test("removing without a host still empties the tray", async () => {
    await createRoot(async (dispose) => {
      const source = createShotSource(false)
      await source.remove("C:/Pictures/Screenshots/a.png")
      expect(source.shots()).toEqual([])
      dispose()
    })
  })
})
