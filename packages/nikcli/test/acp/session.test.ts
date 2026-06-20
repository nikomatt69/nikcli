import { describe, expect, test } from "bun:test"
import { ACPSession, Store, SessionNotFound } from "@/acp/session"

describe("acp/session Store", () => {
  test("create/get/list/remove round-trip", () => {
    const store = new Store()
    const info = store.create({ id: "ses-1", cwd: "/work", mcpServers: [] })
    expect(info.id).toBe("ses-1")
    expect(store.tryGet("ses-1")?.cwd).toBe("/work")
    expect(store.get("ses-1").id).toBe("ses-1")
    expect(store.list()).toHaveLength(1)
    expect(store.remove("ses-1")).toBeDefined()
    expect(store.tryGet("ses-1")).toBeUndefined()
  })

  test("setModel / setVariant / setMode update the snapshot", () => {
    const store = new Store()
    store.create({ id: "ses-2", cwd: "/w", mcpServers: [] })
    store.setModel("ses-2", { providerID: "p", modelID: "m" })
    store.setVariant("ses-2", "high")
    store.setMode("ses-2", "build")
    const got = store.get("ses-2")
    expect(got.model).toEqual({ providerID: "p", modelID: "m" })
    expect(got.variant).toBe("high")
    expect(got.modeId).toBe("build")
  })

  test("remove is idempotent and returns undefined for missing id", () => {
    const store = new Store()
    expect(store.remove("missing")).toBeUndefined()
  })

  test("get throws SessionNotFound for missing sessions", () => {
    const store = new Store()
    expect(() => store.get("missing")).toThrow(SessionNotFound)
  })

  test("recordPartMetadata stores keyed entries that can be retrieved", () => {
    const store = new Store()
    store.create({ id: "ses-3", cwd: "/w", mcpServers: [] })
    store.recordPartMetadata({
      sessionId: "ses-3",
      messageId: "msg-1",
      partId: "part-1",
      partType: "tool",
      role: "assistant",
      toolCallId: "call-1",
    })
    expect(
      store.tryGetPartMetadata({
        sessionId: "ses-3",
        messageId: "msg-1",
        partId: "part-1",
      }),
    ).toMatchObject({ toolCallId: "call-1" })
  })

  test("ACPSessionManager alias still works", () => {
    expect(ACPSession.Store).toBe(Store)
    expect(new ACPSession.Store()).toBeInstanceOf(Store)
  })
})
