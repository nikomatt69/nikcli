import { describe, expect, test } from "bun:test"
import { hasMathDelimiter, splitMathSegments, type MathSegment } from "../src/index"

function math(segments: MathSegment[]) {
  return segments.filter((segment) => segment.type === "math")
}

function rebuild(input: string, segments: MathSegment[]): string {
  return segments.map((segment) => (segment.type === "text" ? segment.value : segment.raw)).join("")
}

describe("hasMathDelimiter", () => {
  test("accepts every opener", () => {
    expect(hasMathDelimiter("a $x$ b")).toBe(true)
    expect(hasMathDelimiter(String.raw`a \(x\) b`)).toBe(true)
    expect(hasMathDelimiter(String.raw`a \[x\] b`)).toBe(true)
    expect(hasMathDelimiter(String.raw`\begin{align}x\end{align}`)).toBe(true)
  })

  test("rejects prose without delimiters", () => {
    expect(hasMathDelimiter("just a normal sentence")).toBe(false)
    expect(hasMathDelimiter("")).toBe(false)
  })
})

describe("splitMathSegments", () => {
  test("returns the input untouched when there is no math", () => {
    expect(splitMathSegments("hello world")).toEqual([{ type: "text", value: "hello world" }])
    expect(splitMathSegments("")).toEqual([])
  })

  test("segments are lossless", () => {
    const input = String.raw`Given $a^2+b^2=c^2$, we get $$\frac{1}{2}$$ and \(x\) too.`
    const segments = splitMathSegments(input)
    expect(rebuild(input, segments)).toBe(input)
  })

  test("extracts inline dollar math", () => {
    const segments = splitMathSegments("The value $x^2 + 1$ is positive.")
    expect(math(segments)).toEqual([{ type: "math", value: "x^2 + 1", raw: "$x^2 + 1$", display: false }])
  })

  test("extracts display math in all three forms", () => {
    const dollars = math(splitMathSegments(String.raw`before $$\frac{a}{b}$$ after`))
    expect(dollars).toHaveLength(1)
    expect(dollars[0]).toMatchObject({ value: String.raw`\frac{a}{b}`, display: true })

    const brackets = math(splitMathSegments(String.raw`before \[\frac{a}{b}\] after`))
    expect(brackets).toHaveLength(1)
    expect(brackets[0]).toMatchObject({ value: String.raw`\frac{a}{b}`, display: true })

    const parens = math(splitMathSegments(String.raw`before \(\frac{a}{b}\) after`))
    expect(parens).toHaveLength(1)
    expect(parens[0]).toMatchObject({ value: String.raw`\frac{a}{b}`, display: false })
  })

  test("keeps a bare environment as its own display block", () => {
    const source = String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`
    const found = math(splitMathSegments(`text ${source} text`))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ value: source, display: true })
  })

  test("unwraps environments the layout engine does not model", () => {
    const found = math(splitMathSegments(String.raw`\begin{equation}E = mc^2\end{equation}`))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ value: "E = mc^2", display: true })
  })

  test("handles starred environments", () => {
    const found = math(splitMathSegments(String.raw`\begin{align*}x &= 1\end{align*}`))
    expect(found).toHaveLength(1)
    expect(found[0]!.display).toBe(true)
  })

  test("finds several formulas in one message", () => {
    const found = math(splitMathSegments("$a$ and $b$ and $$c$$"))
    expect(found.map((segment) => segment.value)).toEqual(["a", "b", "c"])
  })
})

describe("splitMathSegments false positives", () => {
  test("leaves currency alone", () => {
    expect(math(splitMathSegments("It costs $5 to $10 per seat."))).toEqual([])
    expect(math(splitMathSegments("Save $100 now, $200 later."))).toEqual([])
  })

  test("leaves shell variables alone", () => {
    expect(math(splitMathSegments("Set $PATH and $HOME before running."))).toEqual([])
  })

  test("rejects a body that is only a number", () => {
    expect(math(splitMathSegments("between $1,000$ and beyond"))).toEqual([])
  })

  test("rejects whitespace just inside the delimiters", () => {
    expect(math(splitMathSegments("a $ x $ b"))).toEqual([])
  })

  test("does not span a blank line", () => {
    expect(math(splitMathSegments("$a\n\nb$"))).toEqual([])
  })

  test("rejects an inline span that does not parse strictly", () => {
    expect(math(splitMathSegments(String.raw`use $\notacommand{x}$ here`))).toEqual([])
  })

  test("still renders an unknown command inside unambiguous delimiters", () => {
    const found = math(splitMathSegments(String.raw`\(\notacommand{x}\)`))
    expect(found).toHaveLength(1)
  })

  test("honours maxLength", () => {
    const long = `$${"x".repeat(50)}$`
    expect(math(splitMathSegments(long, { maxLength: 10 }))).toEqual([])
    expect(math(splitMathSegments(long, { maxLength: 100 }))).toHaveLength(1)
  })

  test("inline and display can be disabled independently", () => {
    expect(math(splitMathSegments("$x$ and $$y$$", { inline: false }))).toHaveLength(1)
    expect(math(splitMathSegments("$x$ and $$y$$", { display: false }))).toHaveLength(1)
  })
})

describe("splitMathSegments code masking", () => {
  test("ignores fenced code blocks", () => {
    const input = ["before", "```sh", "echo $HOME $PATH", "cost=$5$", "```", "after"].join("\n")
    expect(math(splitMathSegments(input))).toEqual([])
  })

  test("ignores tilde fences", () => {
    const input = ["~~~", "$x^2$", "~~~"].join("\n")
    expect(math(splitMathSegments(input))).toEqual([])
  })

  test("ignores inline code spans", () => {
    expect(math(splitMathSegments("run `echo $x^2$` now"))).toEqual([])
  })

  test("still finds math outside the fence", () => {
    const input = ["$x^2$", "```", "$y^2$", "```", "$z^2$"].join("\n")
    expect(math(splitMathSegments(input)).map((segment) => segment.value)).toEqual(["x^2", "z^2"])
  })

  test("an unterminated fence masks the rest of the message", () => {
    const input = ["$a$", "```", "$b$"].join("\n")
    expect(math(splitMathSegments(input)).map((segment) => segment.value)).toEqual(["a"])
  })

  test("a lone backtick does not swallow the line", () => {
    expect(math(splitMathSegments("it's `odd $x^2$"))).toHaveLength(1)
  })
})
