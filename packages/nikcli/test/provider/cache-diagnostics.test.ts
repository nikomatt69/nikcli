import { describe, expect, it } from "bun:test"
import { CacheDiagnostics } from "@/provider/cache-diagnostics"

const system = (text: string) => ({ role: "system" as const, content: text })
const user = (text: string) => ({ role: "user" as const, content: [{ type: "text", text }] })
const assistant = (text: string) => ({ role: "assistant" as const, content: [{ type: "text", text }] })

function request(overrides: Partial<CacheDiagnostics.RequestLike> = {}): CacheDiagnostics.RequestLike {
  return {
    prompt: [system("you are nikcli"), user("hello")],
    tools: [{ name: "read" }, { name: "grep" }],
    settings: { model: "claude-opus-5", temperature: 0 },
    ...overrides,
  }
}

describe("CacheDiagnostics.compare", () => {
  it("reports the first request as initial", () => {
    const tracker = new CacheDiagnostics.Tracker()
    expect(tracker.record("ses_1", request()).comparison).toEqual({ status: "initial" })
  })

  it("reports an unchanged request as stable", () => {
    const tracker = new CacheDiagnostics.Tracker()
    tracker.record("ses_1", request())
    expect(tracker.record("ses_1", request()).comparison).toEqual({ status: "stable", messages: 1 })
  })

  it("treats a growing conversation tail as append-only", () => {
    const tracker = new CacheDiagnostics.Tracker()
    tracker.record("ses_1", request())
    const { comparison } = tracker.record(
      "ses_1",
      request({ prompt: [system("you are nikcli"), user("hello"), assistant("hi"), user("again")] }),
    )
    expect(comparison).toEqual({ status: "append-only", previousMessages: 1, currentMessages: 3 })
  })

  it("names the tool that changed", () => {
    const tracker = new CacheDiagnostics.Tracker()
    tracker.record("ses_1", request())
    const { comparison } = tracker.record("ses_1", request({ tools: [{ name: "read" }, { name: "glob" }] }))
    expect(comparison).toEqual({ status: "changed", component: "tools", index: 1, label: "glob" })
  })

  it("prefers the earliest divergent component", () => {
    const tracker = new CacheDiagnostics.Tracker()
    tracker.record("ses_1", request())
    // Both the system part and the tail moved; only the system part matters,
    // because everything after the first break is re-read anyway.
    const { comparison } = tracker.record(
      "ses_1",
      request({ prompt: [system("you are something else"), user("different")] }),
    )
    expect(comparison).toEqual({ status: "changed", component: "system", index: 0, label: "system[0]" })
  })

  it("reports settings ahead of everything else", () => {
    const tracker = new CacheDiagnostics.Tracker()
    tracker.record("ses_1", request())
    const { comparison } = tracker.record(
      "ses_1",
      request({ settings: { model: "claude-opus-5", temperature: 1 }, tools: [{ name: "read" }] }),
    )
    expect(comparison).toEqual({ status: "changed", component: "settings", index: 0, label: "model settings" })
  })

  it("flags a truncated history as a prefix break, not an append", () => {
    const tracker = new CacheDiagnostics.Tracker()
    tracker.record("ses_1", request({ prompt: [system("s"), user("a"), assistant("b"), user("c")] }))
    // Compaction dropping the middle of the conversation invalidates the cache
    // from the first dropped turn onward — the case worth catching.
    const { comparison } = tracker.record("ses_1", request({ prompt: [system("s"), user("a")] }))
    // The label falls back to the previous snapshot, so it names the turn that
    // was dropped rather than an anonymous index.
    expect(comparison).toEqual({ status: "changed", component: "messages", index: 1, label: "assistant[1]" })
  })

  it("keeps sessions independent", () => {
    const tracker = new CacheDiagnostics.Tracker()
    tracker.record("ses_1", request())
    expect(tracker.record("ses_2", request()).comparison).toEqual({ status: "initial" })
    expect(tracker.record("ses_1", request()).comparison).toEqual({ status: "stable", messages: 1 })
  })

  it("never retains prompt content, only hashes", () => {
    const snapshot = CacheDiagnostics.snapshot(request({ prompt: [system("secret system"), user("secret user")] }))
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain("secret")
    expect(snapshot.system).toHaveLength(1)
    expect(snapshot.messages).toHaveLength(1)
  })
})
