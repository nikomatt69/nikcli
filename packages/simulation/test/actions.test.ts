import { expect, test } from "bun:test"
import { matches } from "../src/frontend/actions"

test("screen matching is literal and case-sensitive", () => {
  const harness = { screen: () => "nikcli [ready].*" }
  expect(matches(harness, "nikcli")).toBe(true)
  expect(matches(harness, "[ready].*")).toBe(true)
  expect(matches(harness, "nikcli.*ready")).toBe(false)
  expect(matches(harness, "NikCLI")).toBe(false)
})
