import { describe, expect, test } from "bun:test"
import { bunUtils, parseJsonl, stripAnsi } from "@/bun"

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

describe("Bun utils bindings", () => {
  test("JSONL skips a corrupt line and keeps the rest", () => {
    const values = parseJsonl('{"a":1}\nnot-json\n{"b":2}\n')
    expect(values).toEqual([{ a: 1 }, { b: 2 }])
  })

  test("stripANSI removes color codes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red")
  })

  test("cron.parse accepts nicknames and 5-field expressions", () => {
    expect(bunUtils.cron.parse("@hourly")).toBeInstanceOf(Date)
    expect(bunUtils.cron.parse("*/15 * * * *")).toBeInstanceOf(Date)
    expect(() => bunUtils.cron.parse("not a cron")).toThrow()
  })

  test("Image resizes a PNG off-thread", async () => {
    const meta = await new bunUtils.Image(PNG_1X1).metadata()
    expect(meta.width).toBe(1)
    expect(meta.height).toBe(1)
    const url = await new bunUtils.Image(PNG_1X1).resize(8, 8).jpeg({ quality: 80 }).dataurl()
    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true)
  })
})
