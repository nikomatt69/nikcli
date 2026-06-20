import { describe, expect, test } from "bun:test"
import { ACPError } from "@/acp/error"

describe("ACPError", () => {
  test("SessionNotFoundError carries sessionId and tagged kind", () => {
    const error = new ACPError.SessionNotFoundError("ses-1")
    expect(error._tag).toBe("ACPSessionNotFoundError")
    expect(error.sessionId).toBe("ses-1")
    expect(error.message).toContain("ses-1")
  })

  test("InvalidModelError carries modelId and providerId", () => {
    const error = new ACPError.InvalidModelError("m-1", "p-1")
    expect(error._tag).toBe("ACPInvalidModelError")
    expect(error.modelId).toBe("m-1")
    expect(error.providerId).toBe("p-1")
  })

  test("toRequestError converts each tagged error to a RequestError", async () => {
    const { RequestError } = await import("@agentclientprotocol/sdk")
    const re = ACPError.toRequestError(new ACPError.SessionNotFoundError("ses-x"))
    expect(re).toBeInstanceOf(RequestError)
    expect(re.code).toBe(-32602)

    const re2 = ACPError.toRequestError(new ACPError.UnsupportedOperationError("missing"))
    expect(re2.code).toBe(-32601)
  })

  test("isACPError recognises tagged ACP errors", () => {
    const ok = new ACPError.AuthRequiredError("provider-1")
    const not = new Error("nope")
    expect(ACPError.isACPError(ok)).toBe(true)
    expect(ACPError.isACPError(not)).toBe(false)
    expect(ACPError.isACPError(null)).toBe(false)
  })

  test("fromUnknownDefect wraps any value into a ServiceFailureError", () => {
    const wrapped = ACPError.fromUnknownDefect("boom", "safe message")
    expect(wrapped._tag).toBe("ACPServiceFailureError")
    expect(wrapped.safeMessage).toBe("safe message")
  })
})
