import { describe, expect, it } from "bun:test"
import { MobileAuth } from "@/mobile/auth"

/**
 * Per-device capabilities, EOT-19 requirement 9.
 *
 * The bridge advertises what a paired device may reach, and a device without a
 * capability cannot use the operation it guards. The failure has to be visible:
 * a silent no-op shows the phone a button that does nothing, and the user
 * concludes the host is broken rather than that the device is not allowed.
 */
describe("MobileAuth capabilities", () => {
  it("gives a paired phone the full operator set", () => {
    expect(MobileAuth.can("mobile", "pty")).toBe(true)
    expect(MobileAuth.can("mobile", "teleport")).toBe(true)
    expect(MobileAuth.can("mobile", "git")).toBe(true)
  })

  it("keeps a sync transport out of operator surfaces", () => {
    // `cli-sync` moves journal rows. It has no business opening a pty or
    // reading a working tree.
    expect(MobileAuth.can("cli-sync", "read")).toBe(true)
    expect(MobileAuth.can("cli-sync", "pty")).toBe(false)
    expect(MobileAuth.can("cli-sync", "teleport")).toBe(false)
    expect(MobileAuth.can("cli-sync", "git")).toBe(false)
  })

  it("gives the desktop UI everything except device-local surfaces", () => {
    expect(MobileAuth.can("studio", "write")).toBe(true)
    expect(MobileAuth.can("studio", "git")).toBe(true)
    expect(MobileAuth.can("studio", "pty")).toBe(false)
  })

  it("grants nothing to a scope this build does not recognise", () => {
    // A token whose scope is unknown came from a newer or a forged issuer, and
    // guessing generously is the wrong direction to guess.
    expect(MobileAuth.capabilities("wormhole")).toEqual([])
    expect(MobileAuth.can("wormhole", "read")).toBe(false)
  })

  it("advertises the set the handshake will send", () => {
    expect([...MobileAuth.capabilities("mobile")].sort()).toEqual(["git", "pty", "read", "teleport", "write"])
  })
})
