import { describe, expect, it } from "bun:test"
import { Rpc } from "@tui/util/rpc"

/**
 * What survives a worker hop.
 *
 * The upgrade runs in the worker and can fail with `Installation.UpgradeFailedError`, whose
 * `message` is empty — the reason is in `stderr`. The RPC layer used to forward only name,
 * message and stack, so the terminal received a plain `Error` with nothing in it and every failed
 * update was reported as "Update failed". An `instanceof` check against the original class cannot
 * help: the class does not cross the boundary either.
 */
function fakeWorker() {
  const target = {
    postMessage(_data: string) {},
    onmessage: null as ((ev: MessageEvent<string>) => unknown) | null,
  }
  return {
    target,
    /** Answer the request that was just made, the way `Rpc.listen` would. */
    reply(frame: Record<string, unknown>) {
      target.onmessage?.({ data: JSON.stringify({ id: 0, ...frame }) } as MessageEvent<string>)
    },
  }
}

describe("worker rpc errors", () => {
  it("carries a tagged error's own fields, not just its message", async () => {
    const worker = fakeWorker()
    const client = Rpc.client<{ upgradeNow: (input: unknown) => Promise<void> }>(worker.target)

    const pending = client.call("upgradeNow", {})
    worker.reply({
      type: "rpc.error",
      error: { name: "UpgradeFailedError", message: "", data: { stderr: "brew: no such keg" } },
    })

    const error = await pending.then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe("UpgradeFailedError")
    // The reason the toast shows.
    expect((error as { stderr?: string }).stderr).toBe("brew: no such keg")
  })

  it("still resolves an error frame with no extra fields", async () => {
    const worker = fakeWorker()
    const client = Rpc.client<{ anything: (input: unknown) => Promise<void> }>(worker.target)

    const pending = client.call("anything", {})
    worker.reply({ type: "rpc.error", error: { name: "Error", message: "plain failure" } })

    const error = await pending.then(
      () => undefined,
      (e: unknown) => e,
    )
    expect((error as Error).message).toBe("plain failure")
  })
})
