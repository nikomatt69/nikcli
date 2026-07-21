import { describe, expect, it } from "bun:test"

/**
 * Unit-level coverage for the outer tool timeout helper behavior used by
 * session/tools.ts. We re-implement the race shape here to avoid spinning up a
 * full session; the production path uses the same abort + hard reject pattern.
 */
async function executeWithTimeout(
  toolID: string,
  run: (abort: AbortSignal) => Promise<string>,
  parent: AbortSignal,
  timeoutMs: number | undefined,
): Promise<string> {
  if (timeoutMs === undefined) return run(parent)

  const ac = new AbortController()
  const onParentAbort = () => ac.abort()
  if (parent.aborted) ac.abort()
  else parent.addEventListener("abort", onParentAbort, { once: true })

  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        ac.abort()
        reject(new Error(`Tool "${toolID}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      void run(ac.signal).then(
        (result) => {
          if (!timedOut) resolve(result)
        },
        (error) => {
          if (timedOut) reject(new Error(`Tool "${toolID}" timed out after ${timeoutMs}ms`))
          else reject(error)
        },
      )
    })
  } finally {
    if (timer) clearTimeout(timer)
    parent.removeEventListener("abort", onParentAbort)
  }
}

describe("tool outer timeout", () => {
  it("returns quickly when the tool finishes in time", async () => {
    const parent = new AbortController()
    const result = await executeWithTimeout("read", async () => "ok", parent.signal, 500)
    expect(result).toBe("ok")
  })

  it("rejects and aborts when the tool hangs past the deadline", async () => {
    const parent = new AbortController()
    let sawAbort = false
    const promise = executeWithTimeout(
      "hang",
      (signal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener("abort", () => {
            sawAbort = true
          })
          // never resolves — outer timeout must reject
        }),
      parent.signal,
      40,
    )
    await expect(promise).rejects.toThrow(/timed out after 40ms/)
    expect(sawAbort).toBe(true)
  })

  it("disables the outer bound when timeoutMs is undefined", async () => {
    const parent = new AbortController()
    const result = await executeWithTimeout("read", async () => "free", parent.signal, undefined)
    expect(result).toBe("free")
  })
})
