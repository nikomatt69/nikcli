import { afterAll, describe, expect, it } from "bun:test"
import { Hono } from "hono"
import { limitFor, bodyLimitMiddleware } from "@/server/middleware/body-limit"

const ORIGINAL = process.env["NIKCLI_DEFAULT_BODY_MAX"]

function postWithBody(url: string, body: string, env: { [k: string]: number } = {}) {
  // Bun's `new Request(url, { body: string })` does NOT auto-set Content-Length;
  // we set it explicitly so the middleware's CL-based pre-check fires.
  const headers = new Headers({
    "Content-Type": "text/plain",
    "Content-Length": String(body.length),
  })
  if (env["NIKCLI_DEFAULT_BODY_MAX"] !== undefined) {
    process.env["NIKCLI_DEFAULT_BODY_MAX"] = String(env["NIKCLI_DEFAULT_BODY_MAX"])
  } else {
    delete process.env["NIKCLI_DEFAULT_BODY_MAX"]
  }
  return new Request(url, { method: "POST", body, headers })
}

describe("body-limit middleware", () => {
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env["NIKCLI_DEFAULT_BODY_MAX"]
    else process.env["NIKCLI_DEFAULT_BODY_MAX"] = ORIGINAL
  })

  describe("limitFor", () => {
    it("returns default (256 MB) when no env override is set", () => {
      delete process.env["NIKCLI_DEFAULT_BODY_MAX"]
      expect(limitFor("/session")).toBe(256 * 1024 * 1024)
    })

    it("honours NIKCLI_DEFAULT_BODY_MAX override at call time", () => {
      process.env["NIKCLI_DEFAULT_BODY_MAX"] = "131072" // 128 KB
      expect(limitFor("/session")).toBe(131072)
      expect(limitFor("/config/providers")).toBe(131072)
    })

    it("returns the server ceiling for real teleport upload paths", () => {
      process.env["NIKCLI_DEFAULT_BODY_MAX"] = "131072"
      expect(limitFor("/mobile/teleport/upload")).toBe(2 * 1024 * 1024 * 1024)
      expect(limitFor("/mobile/teleport/upload/abc123")).toBe(2 * 1024 * 1024 * 1024)
    })

    it("does not raise the limit for non-upload teleport or fictional /api paths", () => {
      process.env["NIKCLI_DEFAULT_BODY_MAX"] = "131072"
      expect(limitFor("/mobile/teleport")).toBe(131072)
      expect(limitFor("/api/mobile/teleport/upload")).toBe(131072)
      expect(limitFor("/session/ses_x/shell")).toBe(131072)
    })
  })

  describe("bodyLimitMiddleware (HTTP)", () => {
    const app = new Hono()
      .use(bodyLimitMiddleware)
      .post("/echo", (c) => c.text((c.req.raw as Request).headers.get("content-length") ?? "", 200))
      .post("/mobile/teleport/upload", (c) => c.text("ok", 200))
      .post("/mobile/teleport/upload/:uploadID", (c) => c.text("ok", 200))

    it("accepts a small body under the default", async () => {
      const res = await app.request(postWithBody("http://localhost/echo", "hello"))
      expect(res.status).toBe(200)
    })

    it("rejects a body over the default with 413", async () => {
      const res = await app.request(
        postWithBody("http://localhost/echo", "x".repeat(2048), { NIKCLI_DEFAULT_BODY_MAX: 1024 }),
      )
      expect(res.status).toBe(413)
    })

    it("accepts a body that exceeds the default but fits the teleport budget", async () => {
      // Default 1 KB, but teleport upload route has the server ceiling —
      // even a 100 KB body must pass.
      const res = await app.request(
        postWithBody("http://localhost/mobile/teleport/upload", "x".repeat(100 * 1024), {
          NIKCLI_DEFAULT_BODY_MAX: 1024,
        }),
      )
      expect(res.status).toBe(200)
    })

    it("skips the check when Content-Length is missing (chunked transfer)", async () => {
      // No Content-Length → middleware passes through; Bun's server-wide
      // maxRequestBodySize (configured separately) is the last line of defence.
      delete process.env["NIKCLI_DEFAULT_BODY_MAX"]
      const req = new Request("http://localhost/echo", { method: "POST", body: "anything" })
      const res = await app.request(req)
      expect(res.status).toBe(200)
    })
  })
})
