import { describe, expect, it } from "bun:test"
import { ensureOnboarded } from "@tui/util/onboarding"

const user = { id: "u_1", email: "a@b.c" } as never

function harness(users: (typeof user | null)[]) {
  const calls = { onboarding: 0, failed: [] as number[] }
  const queue = [...users]
  return {
    calls,
    input: {
      runOnboarding: async () => {
        calls.onboarding++
      },
      currentUser: async () => queue.shift() ?? null,
      onAttemptFailed: (attempt: number) => calls.failed.push(attempt),
    },
  }
}

describe("ensureOnboarded", () => {
  it("completes on the first run when an account appears", async () => {
    const h = harness([user])
    const outcome = await ensureOnboarded(h.input)
    expect(outcome).toEqual({ status: "complete", user })
    expect(h.calls.onboarding).toBe(1)
    expect(h.calls.failed).toEqual([])
  })

  it("reopens the wizard when it closed without an account", async () => {
    // Dismissing onboarding is not a way to skip it.
    const h = harness([null, user])
    const outcome = await ensureOnboarded(h.input)
    expect(outcome.status).toBe("complete")
    expect(h.calls.onboarding).toBe(2)
    expect(h.calls.failed).toEqual([1])
  })

  it("stops after the attempt budget instead of looping forever", async () => {
    // The bug this replaces: an unbounded loop awaited inside onMount parked
    // the whole startup continuation with nothing on screen to explain it.
    const h = harness([null, null, null, null, null])
    const outcome = await ensureOnboarded(h.input)
    expect(outcome).toEqual({ status: "incomplete", attempts: 3 })
    expect(h.calls.onboarding).toBe(3)
    expect(h.calls.failed).toEqual([1, 2, 3])
  })

  it("honours a custom budget", async () => {
    const h = harness([null, null, null])
    const outcome = await ensureOnboarded({ ...h.input, maxAttempts: 1 })
    expect(outcome).toEqual({ status: "incomplete", attempts: 1 })
    expect(h.calls.onboarding).toBe(1)
  })

  it("still runs the wizard once with a budget of one", async () => {
    const h = harness([user])
    const outcome = await ensureOnboarded({ ...h.input, maxAttempts: 1 })
    expect(outcome.status).toBe("complete")
    expect(h.calls.onboarding).toBe(1)
  })

  it("never reports complete without a user", async () => {
    const h = harness([null, null, null])
    const outcome = await ensureOnboarded(h.input)
    // An incomplete outcome carries no user, so a caller cannot read one off it
    // and mark the session signed in.
    expect(outcome.status).toBe("incomplete")
    expect("user" in outcome).toBe(false)
  })

  it("checks the server rather than trusting the dialog's resolution", async () => {
    // `DialogOnboarding.run` resolves the same way whether the wizard finished
    // or was dismissed, so the account check is the only real evidence.
    const h = harness([null, null, user])
    const outcome = await ensureOnboarded(h.input)
    expect(outcome.status).toBe("complete")
    expect(h.calls.onboarding).toBe(3)
  })

  it("rejects a nonsense budget", async () => {
    const h = harness([user])
    await expect(ensureOnboarded({ ...h.input, maxAttempts: 0 })).rejects.toThrow(RangeError)
    await expect(ensureOnboarded({ ...h.input, maxAttempts: 1.5 })).rejects.toThrow(RangeError)
    expect(h.calls.onboarding).toBe(0)
  })
})
