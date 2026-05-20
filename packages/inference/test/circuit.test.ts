import { describe, expect, it } from "bun:test"
import { CircuitBreaker } from "../src/health/circuit"

describe("CircuitBreaker", () => {
  it("starts closed", () => {
    const b = new CircuitBreaker("p")
    expect(b.state()).toBe("closed")
    expect(b.allow()).toBe(true)
  })

  it("opens after N consecutive failures", () => {
    const b = new CircuitBreaker("p", { failureThreshold: 3, resetAfterMs: 1000, halfOpenProbes: 1 })
    b.recordFailure()
    b.recordFailure()
    expect(b.state()).toBe("closed")
    b.recordFailure()
    expect(b.state()).toBe("open")
    expect(b.allow()).toBe(false)
  })

  it("resets failure count on success", () => {
    const b = new CircuitBreaker("p", { failureThreshold: 3, resetAfterMs: 1000, halfOpenProbes: 1 })
    b.recordFailure()
    b.recordFailure()
    b.recordSuccess()
    b.recordFailure()
    expect(b.state()).toBe("closed")
  })

  it("transitions to half_open after reset window", async () => {
    const b = new CircuitBreaker("p", { failureThreshold: 1, resetAfterMs: 30, halfOpenProbes: 1 })
    b.recordFailure()
    expect(b.state()).toBe("open")
    await new Promise((r) => setTimeout(r, 50))
    expect(b.state()).toBe("half_open")
    expect(b.allow()).toBe(true)
    // only one probe
    expect(b.allow()).toBe(false)
  })

  it("closes after successful probe", async () => {
    const b = new CircuitBreaker("p", { failureThreshold: 1, resetAfterMs: 20, halfOpenProbes: 1 })
    b.recordFailure()
    await new Promise((r) => setTimeout(r, 30))
    b.allow()
    b.recordSuccess()
    expect(b.state()).toBe("closed")
    expect(b.allow()).toBe(true)
  })

  it("reopens on probe failure", async () => {
    const b = new CircuitBreaker("p", { failureThreshold: 1, resetAfterMs: 20, halfOpenProbes: 1 })
    b.recordFailure()
    await new Promise((r) => setTimeout(r, 30))
    b.allow()
    b.recordFailure()
    expect(b.state()).toBe("open")
  })
})
