import { describe, expect, test } from "bun:test"
import { SessionManager } from "../src/manager"

describe("SessionManager", () => {
  test("replaces named sessions and removes them", () => {
    const manager = new SessionManager()
    expect(manager.start({ name: "ui", url: "http://127.0.0.1:4096" }).name).toBe("ui")
    expect(manager.start({ name: "ui", url: "http://127.0.0.1:4097" }).url).toBe("http://127.0.0.1:4097")
    expect(manager.list()).toHaveLength(1)
    manager.remove("ui")
    expect(manager.list()).toHaveLength(0)
  })
})
