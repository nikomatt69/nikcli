import { describe, expect, it } from "bun:test"
import { Effect, Exit } from "effect"
import { asHttpBody, badRequest, conflict, notFound } from "@/server/httpapi/errors"

describe("httpapi/errors", () => {
  it("notFound produces a 404 marker with the given message", async () => {
    const program = notFound("session not found").pipe(Effect.flip)
    const exit = await Effect.runPromiseExit(program)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const body = asHttpBody(exit.value)
      expect(body).toEqual({
        status: 404,
        body: { name: "NotFound", data: { message: "session not found" } },
      })
    }
  })

  it("badRequest produces a 400 marker with the given name and data", async () => {
    const program = badRequest("ProviderModelNotFoundError", {
      providerID: "anthropic",
      modelID: "claude-3",
    }).pipe(Effect.flip)
    const exit = await Effect.runPromiseExit(program)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const body = asHttpBody(exit.value)
      expect(body).toEqual({
        status: 400,
        body: {
          name: "ProviderModelNotFoundError",
          data: { providerID: "anthropic", modelID: "claude-3" },
        },
      })
    }
  })

  it("conflict produces a 409 marker", async () => {
    const program = conflict("SessionBusyError", {
      sessionID: "ses_1",
      message: "Session is busy",
    }).pipe(Effect.flip)
    const exit = await Effect.runPromiseExit(program)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const body = asHttpBody(exit.value)
      expect(body?.status).toBe(409)
      expect(body?.body.name).toBe("SessionBusyError")
    }
  })

  it("asHttpBody returns null for non-marker values", () => {
    expect(asHttpBody(null)).toBeNull()
    expect(asHttpBody(undefined)).toBeNull()
    expect(asHttpBody("string")).toBeNull()
    expect(asHttpBody({})).toBeNull()
    expect(asHttpBody({ __http: {} })).toBeNull()
  })
})
