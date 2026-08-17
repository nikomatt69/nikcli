/// <reference types="@types/bun" />

import { describe, expect, test } from "bun:test"
import { hasMathDelimiters, splitMathBlocks } from "./math-blocks"
import { normalizeWallpaper } from "./wallpaper"

describe("splitMathBlocks", () => {
  test("skips parsing when the source has no dollar signs", () => {
    expect(hasMathDelimiters("plain markdown")).toBe(false)
    expect(splitMathBlocks("plain markdown")).toEqual([{ type: "markdown", content: "plain markdown" }])
  })

  test("splits inline and display math from surrounding markdown", () => {
    expect(splitMathBlocks("Energy $E=mc^2$ and\n$$\\int x$$ done")).toEqual([
      { type: "markdown", content: "Energy " },
      { type: "math", content: "E=mc^2", display: false },
      { type: "markdown", content: " and\n" },
      { type: "math", content: "\\int x", display: true },
      { type: "markdown", content: " done" },
    ])
  })

  test("keeps unterminated tails as markdown", () => {
    expect(splitMathBlocks("start $partial")).toEqual([{ type: "markdown", content: "start $partial" }])
  })
})

describe("normalizeWallpaper", () => {
  test("returns defaults for missing or invalid values", () => {
    expect(normalizeWallpaper(undefined)).toEqual({ uri: null, opacity: 0.22, enabled: false })
    expect(normalizeWallpaper({ uri: 12, opacity: "high", enabled: "yes" })).toEqual({
      uri: null,
      opacity: 0.22,
      enabled: false,
    })
  })

  test("clamps opacity and keeps a file URI", () => {
    expect(normalizeWallpaper({ uri: "file:///wall.jpg", opacity: 0.9, enabled: true })).toEqual({
      uri: "file:///wall.jpg",
      opacity: 0.6,
      enabled: true,
    })
    expect(normalizeWallpaper({ uri: "file:///wall.jpg", opacity: 0.01, enabled: true })).toEqual({
      uri: "file:///wall.jpg",
      opacity: 0.08,
      enabled: true,
    })
  })
})
