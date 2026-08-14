import { describe, expect, it } from "bun:test"
import { createHash } from "crypto"
import { Flag } from "@nikcli-ai/util/flag"
import { ToolRegistry } from "@/tool/registry"

/**
 * Plugin / custom-tool autoload security (PR-6.1).
 *
 * Full ToolRegistry init is too heavy for a subprocess round-trip in the
 * default unit timeout; the gate helpers below are the security decision
 * surface and are covered directly.
 */
describe("ToolRegistry custom tool autoload security", () => {
  it("sha256 pin digest matches node crypto", () => {
    const payload = "nikcli-tool-pin"
    const expected = createHash("sha256").update(payload).digest("hex")
    const hasher = new Bun.CryptoHasher("sha256")
    hasher.update(payload)
    expect(hasher.digest("hex")).toBe(expected)
  })

  it("defaults NIKCLI_ALLOW_PLUGIN_AUTOLOAD to off", () => {
    const previous = process.env.NIKCLI_ALLOW_PLUGIN_AUTOLOAD
    delete process.env.NIKCLI_ALLOW_PLUGIN_AUTOLOAD
    try {
      expect(Flag.NIKCLI_ALLOW_PLUGIN_AUTOLOAD).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.NIKCLI_ALLOW_PLUGIN_AUTOLOAD
      else process.env.NIKCLI_ALLOW_PLUGIN_AUTOLOAD = previous
    }
  })

  it("shouldScanCustomTools is false when flag off and allowlist empty", () => {
    expect(ToolRegistry.shouldScanCustomTools({ allowAutoloadFlag: false, allowlist: [] })).toBe(false)
  })

  it("shouldScanCustomTools is true when flag on or allowlist set", () => {
    expect(ToolRegistry.shouldScanCustomTools({ allowAutoloadFlag: true, allowlist: [] })).toBe(true)
    expect(ToolRegistry.shouldScanCustomTools({ allowAutoloadFlag: false, allowlist: ["escape.ts"] })).toBe(true)
  })

  it("isCustomToolAllowed matches basename, stem, or absolute path", () => {
    const file = "/tmp/config/tool/escape.ts"
    expect(ToolRegistry.isCustomToolAllowed(file, ["escape.ts"])).toBe(true)
    expect(ToolRegistry.isCustomToolAllowed(file, ["escape"])).toBe(true)
    expect(ToolRegistry.isCustomToolAllowed(file, [file])).toBe(true)
    expect(ToolRegistry.isCustomToolAllowed(file, ["other.ts"])).toBe(false)
  })
})
