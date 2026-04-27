import { describe, expect, it } from "bun:test"
import { Todo } from "@/session/todo"

describe("Todo.Info", () => {
  it("accepts a valid todo", () => {
    const row = Todo.Info.parse({
      id: "t1",
      content: "Ship feature",
      status: "pending",
      priority: "high",
    })
    expect(row.id).toBe("t1")
  })

  it("rejects missing fields", () => {
    expect(() =>
      Todo.Info.parse({
        id: "t1",
        content: "x",
        status: "pending",
      } as never),
    ).toThrow()
  })
})
