import { afterEach, describe, expect, it } from "bun:test"
import { recordUsage, validateKey } from "../src/middleware/ratelimit"
import { resetEnvForTests } from "../src/config/env"

const originalFetch = globalThis.fetch

describe("dashboard API key auth", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.INFERENCE_DASHBOARD_URL
    delete process.env.GATEWAY_SHARED_SECRET
    resetEnvForTests()
  })

  it("validates dashboard-generated nik_live keys through the dashboard endpoint", async () => {
    process.env.INFERENCE_DASHBOARD_URL = "https://dashboard.example"
    process.env.GATEWAY_SHARED_SECRET = "gateway-secret"
    resetEnvForTests()

    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe("https://dashboard.example/api/validate")
      expect(init?.method).toBe("POST")
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer gateway-secret")
      expect(JSON.parse(String(init?.body))).toEqual({ key: "nik_live_customer_key" })
      return Response.json({ valid: true, tier: "pro", userId: "user_1", keyId: "key_1" })
    }

    const key = await validateKey("Bearer nik_live_customer_key")

    expect(key).toEqual({
      key: "nik_live_customer_key",
      keyId: "key_1",
      userId: "user_1",
      tier: "pro",
      source: "dashboard",
    })
  })

  it("rejects dashboard validation failures instead of falling back to demo keys", async () => {
    process.env.INFERENCE_DASHBOARD_URL = "https://dashboard.example"
    process.env.GATEWAY_SHARED_SECRET = "gateway-secret"
    resetEnvForTests()

    globalThis.fetch = async () => Response.json({ valid: false })

    await expect(validateKey("Bearer nik-free")).resolves.toBeNull()
  })

  it("records dashboard usage events through the shared-secret ingest endpoint", async () => {
    process.env.INFERENCE_DASHBOARD_URL = "https://dashboard.example/"
    process.env.GATEWAY_SHARED_SECRET = "gateway-secret"
    resetEnvForTests()

    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe("https://dashboard.example/api/usage/ingest")
      expect(init?.method).toBe("POST")
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer gateway-secret")
      expect(JSON.parse(String(init?.body))).toMatchObject({
        keyId: "key_1",
        userId: "user_1",
        model: "k2",
        resolvedModel: "kimi-k2.6",
        promptTokens: 10,
        completionTokens: 5,
      })
      return Response.json({ ok: true })
    }

    const ok = await recordUsage({
      keyId: "key_1",
      userId: "user_1",
      model: "k2",
      resolvedModel: "kimi-k2.6",
      provider: "local",
      upstreamModel: "kimi-k2.6",
      promptTokens: 10,
      completionTokens: 5,
      billedUsd: 0.001,
      upstreamUsd: 0.0008,
      savedUsd: 0,
      cache: "miss",
      rid: "rid_1",
    })

    expect(ok).toBe(true)
  })
})
