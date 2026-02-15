import { describe, expect, it, vi, beforeEach, afterEach } from "bun:test"
import { createSignal, createEffect, on, onMount, onCleanup } from "solid-js"

describe("SolidJS createEffect Optimizations", () => {
  describe("on() wrapper with defer: true", () => {
    it("does not run on initial render with defer: true", () => {
      const [count, setCount] = createSignal(0)
      let runs = 0

      createEffect(
        on(
          () => count(),
          () => {
            runs++
          },
          { defer: true },
        ),
      )

      expect(runs).toBe(0)
      setCount(1)
      expect(runs).toBe(1)
      setCount(2)
      expect(runs).toBe(2)
    })

    it("runs immediately without defer option", () => {
      const [count, setCount] = createSignal(0)
      let runs = 0

      createEffect(
        on(
          () => count(),
          () => {
            runs++
          },
        ),
      )

      expect(runs).toBe(1)
      setCount(1)
      expect(runs).toBe(2)
    })

    it("tracks multiple dependencies correctly", () => {
      const [a, setA] = createSignal(0)
      const [b, setB] = createSignal(0)
      let runs = 0

      createEffect(
        on(
          () => ({ a: a(), b: b() }),
          ({ a, b }) => {
            runs++
          },
          { defer: true },
        ),
      )

      expect(runs).toBe(0)
      setA(1)
      expect(runs).toBe(1)
      setB(1)
      expect(runs).toBe(2)
      setA(2)
      expect(runs).toBe(3)
    })
  })

  describe("on() cleanup behavior", () => {
    it("properly cleans up intervals on visibility toggle", () => {
      const [visible, setVisible] = createSignal(false)
      const intervals: ReturnType<typeof setInterval>[] = []

      createEffect(
        on(
          () => visible(),
          (isVisible) => {
            if (!isVisible) return
            const interval = setInterval(() => {}, 50)
            intervals.push(interval)
            onCleanup(() => clearInterval(interval))
          },
          { defer: true },
        ),
      )

      expect(intervals.length).toBe(0)
      setVisible(true)
      expect(intervals.length).toBe(1)
      setVisible(false)
      setVisible(true)
      expect(intervals.length).toBe(2)
    })

    it("prevents race conditions with rapid toggles", async () => {
      const [visible, setVisible] = createSignal(false)
      const intervalCount = { current: 0 }
      const cleanupCount = { current: 0 }

      createEffect(
        on(
          () => visible(),
          (isVisible) => {
            if (!isVisible) return
            intervalCount.current++
            const interval = setInterval(() => {}, 10)
            onCleanup(() => {
              cleanupCount.current++
              clearInterval(interval)
            })
          },
          { defer: true },
        ),
      )

      for (let i = 0; i < 100; i++) {
        setVisible(true)
        setVisible(false)
      }

      expect(intervalCount.current).toBe(cleanupCount.current)
    })
  })

  describe("onMount vs createEffect", () => {
    it("onMount runs only once on mount", () => {
      let runs = 0

      onMount(() => {
        runs++
      })

      expect(runs).toBe(1)
    })

    it("createEffect with signal dependency runs on signal change", () => {
      let runs = 0
      const [tick, setTick] = createSignal(0)

      createEffect(() => {
        tick()
        runs++
      })

      expect(runs).toBe(1)
      setTick(1)
      expect(runs).toBe(2)
      setTick(2)
      expect(runs).toBe(3)
    })
  })

  describe("on() with array dependency", () => {
    it("tracks array of dependencies", () => {
      const [a, setA] = createSignal(1)
      const [b, setB] = createSignal(2)
      const [c, setC] = createSignal(3)
      let runs = 0

      createEffect(
        on(
          () => [a(), b(), c()] as const,
          () => {
            runs++
          },
          { defer: true },
        ),
      )

      expect(runs).toBe(0)
      setA(10)
      expect(runs).toBe(1)
      setB(20)
      expect(runs).toBe(2)
      setC(30)
      expect(runs).toBe(3)
    })
  })

  describe("on() with object dependency", () => {
    it("tracks object properties", () => {
      const [props, setProps] = createSignal({ visible: true, disabled: false })
      let runs = 0

      createEffect(
        on(
          () => props(),
          (p) => {
            runs++
          },
          { defer: true },
        ),
      )

      expect(runs).toBe(0)
      setProps({ visible: false, disabled: true })
      expect(runs).toBe(1)
    })
  })
})

describe("Performance: on() vs bare createEffect", () => {
  it("on() with defer prevents initial unnecessary run", () => {
    const [value, setValue] = createSignal(0)
    let bareEffectRuns = 0
    let onEffectRuns = 0

    createEffect(() => {
      value()
      bareEffectRuns++
    })

    createEffect(
      on(
        () => value(),
        () => {
          onEffectRuns++
        },
        { defer: true },
      ),
    )

    expect(bareEffectRuns).toBe(1)
    expect(onEffectRuns).toBe(0)

    setValue(1)

    expect(bareEffectRuns).toBe(2)
    expect(onEffectRuns).toBe(1)
  })

  it("on() prevents tracking unintended dependencies", () => {
    const [trigger, setTrigger] = createSignal(0)
    const [unused, setUnused] = createSignal(0)
    let runs = 0

    createEffect(
      on(
        () => trigger(),
        () => {
          unused()
          runs++
        },
        { defer: true },
      ),
    )

    expect(runs).toBe(0)
    setTrigger(1)
    expect(runs).toBe(1)

    for (let i = 0; i < 100; i++) {
      setUnused(i)
    }

    expect(runs).toBe(1)
  })
})
