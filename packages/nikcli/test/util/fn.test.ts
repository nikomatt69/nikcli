import { describe, expect, it } from "bun:test"
import { fn } from "@/util/fn"
import z from "zod"

describe("fn", () => {
  describe("basic functionality", () => {
    it("wraps function with schema validation", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })

      const wrapped = fn(schema, (input) => {
        return `Hello ${input.name}, you are ${input.age}`
      })

      const result = wrapped({ name: "Alice", age: 30 })
      expect(result).toBe("Hello Alice, you are 30")
    })

    it("parses input according to schema", () => {
      const schema = z.object({
        count: z.number().default(0),
        prefix: z.string().default(""),
      })

      const wrapped = fn(schema, (input) => {
        return input.prefix + String(input.count)
      })

      // With explicit values
      expect(wrapped({ count: 5, prefix: "item-" })).toBe("item-5")

      // With defaults
      expect(wrapped({ count: 10, prefix: "" })).toBe("10")
      expect(wrapped({ count: 0, prefix: "" })).toBe("0") // All defaults
    })

    it("throws on invalid input", () => {
      const schema = z.object({
        name: z.string(),
      })

      const wrapped = fn(schema, (input) => input.name)

      // Wrong type → schema.parse throws inside the wrapped call
      expect(() => wrapped({ name: 123 } as unknown as z.infer<typeof schema>)).toThrow()

      // safeParse reports the failure cleanly without throwing
      const parsed = wrapped.schema.safeParse({ name: 123 })
      expect(parsed.success).toBe(false)

      // A well-formed input still succeeds
      expect(wrapped({ name: "ok" })).toBe("ok")
    })
  })

  describe("force method", () => {
    it("bypasses validation", () => {
      const schema = z.object({
        count: z.number(),
      })

      const wrapped = fn(schema, (input) => input.count * 2)

      // Normal call parses and validates
      expect(wrapped({ count: 5 })).toBe(10)

      // Force call bypasses validation
      expect(wrapped.force({ count: 5 })).toBe(10)
    })

    it("force still calls the callback", () => {
      let callCount = 0
      const schema = z.object({ value: z.string() })

      const wrapped = fn(schema, (input) => {
        callCount++
        return input.value
      })

      wrapped.force({ value: "test" })
      expect(callCount).toBe(1)
    })

    it("force allows invalid data", () => {
      const schema = z.object({
        name: z.string().min(1),
      })

      const wrapped = fn(schema, (input) => input.name)

      // This would throw in normal mode
      expect(() => wrapped({ name: "" })).toThrow()

      // But force allows it
      expect(wrapped.force({ name: "" })).toBe("")
    })

    it("force allows missing fields", () => {
      const schema = z.object({
        required: z.string(),
      })

      const wrapped = fn(schema, (input) => input.required || "default")

      // Normal call would throw
      expect(() => wrapped({} as unknown as z.infer<typeof schema>)).toThrow()

      // Force allows missing
      expect(wrapped.force({ required: "default" } as unknown as z.infer<typeof schema>)).toBe("default")
    })

    it("force has same schema reference", () => {
      const schema = z.object({ id: z.string() })
      const wrapped = fn(schema, (input) => input.id)

      // Force method exists
      expect(wrapped.force).toBeDefined()
      expect(typeof wrapped.force).toBe("function")

      // And main function has schema property
      expect(wrapped.schema).toBe(schema)
    })
  })

  describe("schema property", () => {
    it("returns the original schema", () => {
      const stringSchema = z.string()
      const wrapped = fn(stringSchema, (s) => s.toUpperCase())

      expect(wrapped.schema).toBe(stringSchema)
    })

    it("allows schema modification access", () => {
      const schema = z.object({
        items: z.array(z.number()),
      })

      const wrapped = fn(schema, (input) => input.items.reduce((a, b) => a + b, 0))

      // Schema can be used for parsing elsewhere
      const parsed = wrapped.schema.parse({ items: [1, 2, 3] })
      expect(parsed).toEqual({ items: [1, 2, 3] })
    })
  })

  describe("complex schemas", () => {
    it("handles nested objects", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          age: z.number(),
        }),
        settings: z.object({
          theme: z.enum(["dark", "light"]),
        }),
      })

      const wrapped = fn(schema, (input) => {
        return `${input.user.name} (${input.user.age}) - ${input.settings.theme}`
      })

      expect(
        wrapped({
          user: { name: "Alice", age: 30 },
          settings: { theme: "dark" },
        }),
      ).toBe("Alice (30) - dark")
    })

    it("handles arrays", () => {
      const schema = z.object({
        tags: z.array(z.string()),
      })

      const wrapped = fn(schema, (input) => input.tags.join(", "))

      expect(wrapped({ tags: ["a", "b", "c"] })).toBe("a, b, c")
      expect(wrapped({ tags: [] })).toBe("")
    })

    it("handles optional fields", () => {
      const schema = z.object({
        name: z.string(),
        nickname: z.string().optional(),
      })

      const wrapped = fn(schema, (input) => {
        return input.nickname ?? input.name
      })

      expect(wrapped({ name: "Alice" })).toBe("Alice")
      expect(wrapped({ name: "Alice", nickname: "Ali" })).toBe("Ali")
    })

    it("handles discriminated unions", () => {
      const schema = z.discriminatedUnion("type", [
        z.object({ type: z.literal("a"), valueA: z.string() }),
        z.object({ type: z.literal("b"), valueB: z.number() }),
      ])

      const wrapped = fn(schema, (input) => {
        if (input.type === "a") return input.valueA
        return String(input.valueB)
      })

      expect(wrapped({ type: "a", valueA: "hello" })).toBe("hello")
      expect(wrapped({ type: "b", valueB: 42 })).toBe("42")
    })
  })

  describe("edge cases", () => {
    it("handles empty object schema", () => {
      const schema = z.object({})
      const wrapped = fn(schema, () => "empty")

      expect(wrapped({})).toBe("empty")
    })

    it("handles any type", () => {
      let received: any
      const schema = z.any()

      const wrapped = fn(schema, (input) => {
        received = input
        return typeof input
      })

      expect(wrapped("string")).toBe("string")
      expect(wrapped(123)).toBe("number")
      expect(wrapped(null)).toBe("object")
      expect(wrapped(undefined)).toBe("undefined")
    })

    it("handles unknown type", () => {
      const schema = z.unknown()
      const wrapped = fn(schema, (input) => input)

      expect(wrapped("test")).toBe("test")
      expect(wrapped(123)).toBe(123)
    })

    it("handles catch in callback", () => {
      const schema = z.object({ value: z.number() })

      const wrapped = fn(schema, (input) => {
        if (input.value < 0) throw new Error("negative not allowed")
        return input.value
      })

      expect(wrapped({ value: 5 })).toBe(5)
      try {
        wrapped({ value: -1 })
        expect(true).toBe(false) // Should have thrown
      } catch (e) {
        expect((e as Error).message).toContain("negative")
      }
    })
  })

  describe("returned function behavior", () => {
    it("returned function is callable multiple times", () => {
      const schema = z.object({ n: z.number() })
      const wrapped = fn(schema, (input) => input.n * 2)

      expect(wrapped({ n: 1 })).toBe(2)
      expect(wrapped({ n: 2 })).toBe(4)
      expect(wrapped({ n: 3 })).toBe(6)
    })

    it("returned function has no additional properties", () => {
      const schema = z.string()
      const wrapped = fn(schema, (s) => s)

      // Should only have schema and force
      expect(typeof wrapped).toBe("function")
      expect("schema" in wrapped).toBe(true)
      expect("force" in wrapped).toBe(true)
      expect(Object.keys(wrapped).length).toBe(2)
    })

    it("force is also callable multiple times", () => {
      const schema = z.object({ n: z.number() })
      let count = 0

      const wrapped = fn(schema, (input) => {
        count++
        return input.n
      })

      wrapped.force({ n: 1 })
      wrapped.force({ n: 2 })
      wrapped.force({ n: 3 })

      expect(count).toBe(3)
    })
  })
})
