import { describe, expect, it } from "bun:test"
import {
  formatMessageLineForTimeline,
  truncateOneLine,
  lastUserMessageLine,
} from "@/cli/cmd/tui/util/timeline-style-text"
import { recordBenchmark, compareBenchmarkRuns } from "../../benchmarks/runner"

describe("formatMessageLineForTimeline", () => {
  it("returns text unchanged if single line", () => {
    expect(formatMessageLineForTimeline("hello world")).toBe("hello world")
  })

  it("replaces newlines with spaces", () => {
    expect(formatMessageLineForTimeline("line1\nline2")).toBe("line1 line2")
  })

  it("replaces multiple newlines", () => {
    expect(formatMessageLineForTimeline("a\nb\nc")).toBe("a b c")
  })

  it("trims leading and trailing whitespace", () => {
    expect(formatMessageLineForTimeline("  hello  ")).toBe("hello")
  })

  it("handles empty string", () => {
    expect(formatMessageLineForTimeline("")).toBe("")
  })

  it("handles string with only newlines", () => {
    expect(formatMessageLineForTimeline("\n\n\n")).toBe("")
  })

  it("handles CR+LF newlines", () => {
    const result = formatMessageLineForTimeline("line1\r\nline2")
    expect(result).not.toContain("\n")
  })
})

describe("truncateOneLine", () => {
  it("returns empty string if maxChars < 1", () => {
    expect(truncateOneLine("hello", 0)).toBe("")
    expect(truncateOneLine("hello", -1)).toBe("")
  })

  it("returns text unchanged if within maxChars", () => {
    expect(truncateOneLine("hello", 10)).toBe("hello")
    expect(truncateOneLine("hello", 5)).toBe("hello")
  })

  it("truncates and appends ellipsis if over limit", () => {
    const result = truncateOneLine("hello world", 8)
    expect(result.length).toBe(8)
    expect(result.endsWith("…")).toBe(true)
  })

  it("truncates to exactly maxChars characters", () => {
    const result = truncateOneLine("abcdefghij", 5)
    expect(result.length).toBe(5)
  })

  it("handles maxChars of 1", () => {
    const result = truncateOneLine("hello", 1)
    expect(result).toBe("…")
    expect(result.length).toBe(1)
  })

  it("preserves exact text at boundary", () => {
    expect(truncateOneLine("hello", 5)).toBe("hello")
  })
})

describe("lastUserMessageLine", () => {
  it("returns undefined if no messages exist for session", () => {
    const result = lastUserMessageLine({}, {}, "session-1")
    expect(result).toBeUndefined()
  })

  it("returns undefined if only assistant messages exist", () => {
    const messages: any[] = [{ id: "m1", role: "assistant" }]
    const parts: any[] = [
      { id: "p1", messageId: "m1", type: "text", text: "response", synthetic: false, ignored: false },
    ]
    const result = lastUserMessageLine({ "session-1": messages }, { m1: parts }, "session-1")
    expect(result).toBeUndefined()
  })

  it("returns last user message text", () => {
    const messages: any[] = [
      { id: "m1", role: "user" },
      { id: "m2", role: "assistant" },
    ]
    const parts: any = {
      m1: [{ id: "p1", type: "text", text: "hello world", synthetic: false, ignored: false }],
      m2: [{ id: "p2", type: "text", text: "response", synthetic: false, ignored: false }],
    }
    const result = lastUserMessageLine({ s1: messages }, parts, "s1")
    expect(result).toBe("hello world")
  })

  it("skips synthetic parts", () => {
    const messages: any[] = [{ id: "m1", role: "user" }]
    const parts: any = {
      m1: [
        { id: "p1", type: "text", text: "synthetic text", synthetic: true, ignored: false },
        { id: "p2", type: "text", text: "real text", synthetic: false, ignored: false },
      ],
    }
    const result = lastUserMessageLine({ s1: messages }, parts, "s1")
    expect(result).toBe("real text")
  })

  it("skips ignored parts", () => {
    const messages: any[] = [{ id: "m1", role: "user" }]
    const parts: any = {
      m1: [
        { id: "p1", type: "text", text: "ignored text", synthetic: false, ignored: true },
        { id: "p2", type: "text", text: "visible text", synthetic: false, ignored: false },
      ],
    }
    const result = lastUserMessageLine({ s1: messages }, parts, "s1")
    expect(result).toBe("visible text")
  })

  describe("benchmark", () => {
    it("formatMessageLineForTimeline throughput", () => {
      const inputs = ["hello", "line1\nline2\nline3", "  trimmed  ", "a\nb\nc\nd\ne"]
      let i = 0
      recordBenchmark({
        suite: "tui-timeline",
        module: "formatMessageLineForTimeline",
        scenario: "throughput",
        iterations: 500_000,
        value: formatMessageLineForTimeline(inputs[i++ % inputs.length]!) as unknown as number,
        unit: "ms",
      })
    })

    it("truncateOneLine throughput", () => {
      recordBenchmark({
        suite: "tui-timeline",
        module: "truncateOneLine",
        scenario: "throughput",
        iterations: 500_000,
        value: truncateOneLine("this is a somewhat longer test string for truncation", 20) as unknown as number,
        unit: "ms",
      })
    })
  })
})
