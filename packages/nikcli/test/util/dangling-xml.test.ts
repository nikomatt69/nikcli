import { describe, expect, it } from "bun:test"
import { stripDanglingXmlArtifacts } from "@/util/dangling-xml"

describe("stripDanglingXmlArtifacts (opencode #27984)", () => {
  it("strips trailing closing tag", () => {
    expect(stripDanglingXmlArtifacts("Hello there.</parameter>")).toBe("Hello there.")
  })
  it("strips trailing self-closing tag", () => {
    expect(stripDanglingXmlArtifacts("All done <parameter/>")).toBe("All done")
  })
  it("strips trailing function close", () => {
    expect(stripDanglingXmlArtifacts("text</function>")).toBe("text")
  })
  it("strips trailing ETX (U+2420) artifact", () => {
    expect(stripDanglingXmlArtifacts("answer\u2420")).toBe("answer")
  })
  it("preserves mid-text XML", () => {
    expect(stripDanglingXmlArtifacts("a <b> tag </b> here")).toBe("a <b> tag </b> here")
  })
  it("preserves clean text", () => {
    expect(stripDanglingXmlArtifacts("just words")).toBe("just words")
  })
  it("preserves closing tag mid-text without trailing occurrence", () => {
    expect(stripDanglingXmlArtifacts("</function> real text")).toBe("</function> real text")
  })
  it("strips trailing newline that is part of the artifact", () => {
    // The artifact absorbs its surrounding whitespace; text whitespace BEFORE
    // the artifact (e.g. mid-text newlines) is preserved.
    expect(stripDanglingXmlArtifacts("done\n</parameter>\n")).toBe("done")
  })
  it("strips trailing ETX without consuming preceding newline", () => {
    expect(stripDanglingXmlArtifacts("done\n\u2420")).toBe("done\n")
  })
})
