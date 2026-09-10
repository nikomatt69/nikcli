import { describe, expect, it } from "bun:test"
import { ClientError } from "@nikcli-ai/sdk/httpapi"
import { StandaloneConfigError, classifyConfigFailure, readRemoteTuiConfig } from "@tui/host/standalone"

const URL = "http://localhost:4096"

function client(result: unknown) {
  return { tui: { config: async () => result } } as Parameters<typeof readRemoteTuiConfig>[0]
}

function throwing(error: unknown) {
  return {
    tui: {
      config: async () => {
        throw error
      },
    },
  } as Parameters<typeof readRemoteTuiConfig>[0]
}

describe("readRemoteTuiConfig", () => {
  it("returns a successful config unchanged", async () => {
    const config = await readRemoteTuiConfig(client({ data: { theme: "dark" }, error: undefined }), URL)
    expect(config).toEqual({ theme: "dark" } as never)
  })

  it("accepts a genuinely empty config as success", async () => {
    // The point of the change is not that `{}` is forbidden — it is that a
    // failure must not be reported as one.
    await expect(readRemoteTuiConfig(client({ data: {}, error: undefined }), URL)).resolves.toEqual({} as never)
  })

  it("rejects a 401 instead of falling back to defaults", async () => {
    const promise = readRemoteTuiConfig(client({ data: undefined, error: "nope", response: { status: 401 } }), URL)
    await expect(promise).rejects.toBeInstanceOf(StandaloneConfigError)
    await expect(promise).rejects.toMatchObject({ reason: "unauthorized", status: 401 })
  })

  it("rejects a 403 as unauthorized", async () => {
    const promise = readRemoteTuiConfig(client({ data: undefined, error: "nope", response: { status: 403 } }), URL)
    await expect(promise).rejects.toMatchObject({ reason: "unauthorized" })
  })

  it("reports an unreachable server as unavailable", async () => {
    const promise = readRemoteTuiConfig(throwing(new ClientError("Transport")), URL)
    await expect(promise).rejects.toMatchObject({ reason: "unavailable" })
  })

  it("reports an undecodable body as malformed", async () => {
    const promise = readRemoteTuiConfig(client({ data: undefined, error: new ClientError("MalformedResponse") }), URL)
    await expect(promise).rejects.toMatchObject({ reason: "malformed" })
  })

  it("names the server in the failure message", async () => {
    const promise = readRemoteTuiConfig(client({ data: undefined, error: "x", response: { status: 500 } }), URL)
    await expect(promise).rejects.toThrow(URL)
  })
})

describe("classifyConfigFailure", () => {
  it("prefers the status over the error shape for auth failures", () => {
    expect(classifyConfigFailure(new ClientError("Transport"), 401)).toBe("unauthorized")
  })

  it("treats an unexpected status as malformed, not unreachable", () => {
    expect(classifyConfigFailure(new ClientError("UnexpectedStatus"), 500)).toBe("malformed")
  })

  it("treats an unknown error with no status as unavailable", () => {
    expect(classifyConfigFailure(new Error("boom"))).toBe("unavailable")
  })
})
