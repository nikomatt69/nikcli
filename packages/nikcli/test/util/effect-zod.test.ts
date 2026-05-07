import { describe, expect, it } from "bun:test"
import { Schema } from "effect"
import z from "zod"
import { zod, zodObject, zodOverride, ZodOverrideId } from "@/util/effect-zod"

describe("effect-zod walker", () => {
  it("primitives", () => {
    expect(zod(Schema.String).safeParse("a").success).toBe(true)
    expect(zod(Schema.String).safeParse(1).success).toBe(false)
    expect(zod(Schema.Number).safeParse(1).success).toBe(true)
    expect(zod(Schema.Boolean).safeParse(true).success).toBe(true)
    expect(zod(Schema.Null).safeParse(null).success).toBe(true)
  })

  it("literal", () => {
    expect(zod(Schema.Literal("foo")).safeParse("foo").success).toBe(true)
    expect(zod(Schema.Literal("foo")).safeParse("bar").success).toBe(false)
  })

  it("array", () => {
    const s = zod(Schema.Array(Schema.String))
    expect(s.safeParse(["a", "b"]).success).toBe(true)
    expect(s.safeParse(["a", 1]).success).toBe(false)
    expect(s.safeParse([]).success).toBe(true)
  })

  it("struct", () => {
    const s = zod(
      Schema.Struct({
        name: Schema.String,
        age: Schema.Number,
        active: Schema.Boolean,
      }),
    )
    expect(s.safeParse({ name: "x", age: 1, active: true }).success).toBe(true)
    expect(s.safeParse({ name: "x", age: 1 }).success).toBe(false)
  })

  it("optional in struct", () => {
    const s = zod(
      Schema.Struct({
        name: Schema.String,
        nickname: Schema.optional(Schema.String),
      }),
    )
    expect(s.safeParse({ name: "x" }).success).toBe(true)
    expect(s.safeParse({ name: "x", nickname: "y" }).success).toBe(true)
  })

  it("union", () => {
    const s = zod(Schema.Union(Schema.String, Schema.Number))
    expect(s.safeParse("a").success).toBe(true)
    expect(s.safeParse(1).success).toBe(true)
    expect(s.safeParse(true).success).toBe(false)
  })

  it("nullable via NullOr", () => {
    const s = zod(Schema.NullOr(Schema.String))
    expect(s.safeParse(null).success).toBe(true)
    expect(s.safeParse("x").success).toBe(true)
    expect(s.safeParse(1).success).toBe(false)
  })

  it("record", () => {
    const s = zod(Schema.Record({ key: Schema.String, value: Schema.Number }))
    expect(s.safeParse({ a: 1, b: 2 }).success).toBe(true)
    expect(s.safeParse({ a: "no" }).success).toBe(false)
  })

  it("nested struct + array", () => {
    const s = zod(
      Schema.Struct({
        items: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            value: Schema.Number,
          }),
        ),
      }),
    )
    expect(s.safeParse({ items: [{ id: "a", value: 1 }] }).success).toBe(true)
    expect(s.safeParse({ items: [{ id: "a" }] }).success).toBe(false)
  })

  it("identifier annotation maps to z.meta({ ref })", () => {
    const s = zod(
      Schema.Struct({ id: Schema.String }).annotations({ identifier: "Foo" }),
    ) as z.ZodType & { meta: () => { ref: string } | undefined }
    const meta = (s as any).meta?.()
    expect(meta?.ref).toBe("Foo")
  })

  it("description annotation maps to .describe", () => {
    const s = zod(Schema.String.annotations({ description: "user name" }))
    expect(s.description).toBe("user name")
  })

  it("zodObject returns a ZodObject for shape access", () => {
    const s = zodObject(
      Schema.Struct({
        a: Schema.String,
        b: Schema.Number,
      }),
    )
    expect(s.shape.a).toBeDefined()
    expect(s.shape.b).toBeDefined()
  })

  it("zodOverride escape hatch replaces derivation", () => {
    const original = z.string().regex(/^[A-Z]+$/)
    const s = zod(
      Schema.String.annotations({ [ZodOverrideId]: () => original }),
    )
    expect(s.safeParse("ABC").success).toBe(true)
    expect(s.safeParse("abc").success).toBe(false)
  })

  it("zodOverride helper produces the same annotation shape", () => {
    const original = z.literal("ok")
    const ann = zodOverride(() => original)
    const s = zod(Schema.String.annotations(ann))
    expect(s.safeParse("ok").success).toBe(true)
    expect(s.safeParse("nope").success).toBe(false)
  })

  it("refinement: integer", () => {
    const s = zod(Schema.Number.pipe(Schema.int()))
    expect(s.safeParse(1).success).toBe(true)
    expect(s.safeParse(1.5).success).toBe(false)
  })

  it("refinement: greater than", () => {
    const s = zod(Schema.Number.pipe(Schema.greaterThan(0)))
    expect(s.safeParse(1).success).toBe(true)
    expect(s.safeParse(0).success).toBe(false)
    expect(s.safeParse(-1).success).toBe(false)
  })

  it("refinement: pattern", () => {
    const s = zod(Schema.String.pipe(Schema.pattern(/^[A-Z]+$/)))
    expect(s.safeParse("ABC").success).toBe(true)
    expect(s.safeParse("abc").success).toBe(false)
  })

  it("refinement: minLength / maxLength", () => {
    const s = zod(Schema.String.pipe(Schema.minLength(2), Schema.maxLength(4)))
    expect(s.safeParse("a").success).toBe(false)
    expect(s.safeParse("ab").success).toBe(true)
    expect(s.safeParse("abcd").success).toBe(true)
    expect(s.safeParse("abcde").success).toBe(false)
  })

  it("Schema.optional inside Struct produces JSON-Schema-safe Zod (no z.undefined())", () => {
    const s = zod(
      Schema.Struct({
        name: Schema.String,
        nick: Schema.optional(Schema.String),
      }),
    )
    // The AI SDK / hono-openapi calls z.toJSONSchema(...). It throws if the schema contains
    // `z.undefined()` arms, so the walker must strip undefined from the union arms produced
    // by Schema.optional(X) and rely on `.optional()` on the property signature alone.
    expect(() => z.toJSONSchema(s)).not.toThrow()
    expect(s.safeParse({ name: "x" }).success).toBe(true)
    expect(s.safeParse({ name: "x", nick: "y" }).success).toBe(true)
  })

  it("Schema.optionalWith default still produces a JSON-Schema-safe Zod", () => {
    const s = zod(
      Schema.Struct({
        format: Schema.optionalWith(Schema.Literal("a", "b"), { default: () => "a" as const }),
      }),
    )
    expect(() => z.toJSONSchema(s)).not.toThrow()
  })

  it("Schema.NumberFromString emits z.coerce.number()", () => {
    const s = zod(Schema.NumberFromString)
    expect(s.safeParse("42").success).toBe(true)
    expect(s.safeParse(42).success).toBe(true)
    expect(s.safeParse("not a number").success).toBe(false)
  })

  it("zodObject preserves field types through .omit and .partial", () => {
    const s = zodObject(
      Schema.Struct({
        question: Schema.String,
        header: Schema.String,
        custom: Schema.optional(Schema.Boolean),
      }),
    )
    type Out = z.infer<typeof s>
    const _: Out = { question: "q", header: "h" }
    expect(_).toEqual({ question: "q", header: "h" })

    const omitted = s.omit({ custom: true })
    type Omitted = z.infer<typeof omitted>
    const _2: Omitted = { question: "q", header: "h" }
    expect(_2).toEqual({ question: "q", header: "h" })

    expect(omitted.safeParse({ question: "q", header: "h" }).success).toBe(true)
  })
})
