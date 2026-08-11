import { preserveTestEnv } from "../helpers/env"
import { afterEach, describe, expect, it } from "bun:test"

preserveTestEnv(["DO_NOT_TRACK", "NIKCLI_DISABLE_ANALYTICS"])

const { AnalyticsShare } = await import("@/analytics/share")

function clearEnv() {
  delete process.env.DO_NOT_TRACK
  delete process.env.NIKCLI_DISABLE_ANALYTICS
}

afterEach(clearEnv)

/**
 * The gate that decides whether anyone's usage leaves their machine. It is on by
 * default, which puts the whole weight on the ways to turn it off working.
 */
describe("AnalyticsShare.enabled", () => {
  it("is on when nothing has been configured", () => {
    clearEnv()
    expect(AnalyticsShare.enabled(undefined)).toBe(true)
  })

  it("is off when the config says so", () => {
    clearEnv()
    expect(AnalyticsShare.enabled(false)).toBe(false)
  })

  it("honours DO_NOT_TRACK over the config", () => {
    clearEnv()
    process.env.DO_NOT_TRACK = "1"
    // Even an explicit opt-in loses: the machine already said not to.
    expect(AnalyticsShare.enabled(true)).toBe(false)
    expect(AnalyticsShare.enabled(undefined)).toBe(false)
  })

  it("honours the nikcli-specific opt-out", () => {
    clearEnv()
    process.env.NIKCLI_DISABLE_ANALYTICS = "1"
    expect(AnalyticsShare.enabled(undefined)).toBe(false)
  })

  it("treats an unset-looking value as not opting out", () => {
    // An empty or falsey variable is how a shell leaves a variable it never set,
    // and must not read as consent to disable — or as consent to enable.
    for (const value of ["", "0", "false", "FALSE"]) {
      clearEnv()
      process.env.DO_NOT_TRACK = value
      expect(AnalyticsShare.enabled(undefined)).toBe(true)
      expect(AnalyticsShare.enabled(false)).toBe(false)
    }
  })

  it("accepts any other truthy string as an opt-out", () => {
    for (const value of ["1", "true", "yes"]) {
      clearEnv()
      process.env.DO_NOT_TRACK = value
      expect(AnalyticsShare.enabled(undefined)).toBe(false)
    }
  })
})
