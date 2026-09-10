import { describe, expect, test } from "bun:test"
import { Log } from "@nikcli-ai/util/log"

/**
 * The escape hatch and the write path of the redaction contract
 * ([specs/v2/logging-redaction-contract.md](../../../../specs/v2/logging-redaction-contract.md)).
 *
 * `test/util/redact.test.ts` covers the redaction functions themselves. What
 * is covered here is the half only `Log` can answer: that a write actually
 * goes through them, that `NIKCLI_LOG_REDACT=0` turns that off per write
 * rather than per process, and that error messages stay masked either way.
 *
 * `Log.init` is never called in the unit suite, so the default writer is
 * `process.stderr.write` and patching it captures the formatted line.
 */

let counter = 0

function capture(fn: (logger: Log.Logger) => void): string {
  // `create` caches by service name; a fresh name per call keeps tags clean.
  const logger = Log.create({ service: `redaction-test-${counter++}` })
  const chunks: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: unknown) => {
    chunks.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    fn(logger)
  } finally {
    process.stderr.write = original
  }
  return chunks.join("")
}

function withFlag<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.NIKCLI_LOG_REDACT
  if (value === undefined) delete process.env.NIKCLI_LOG_REDACT
  else process.env.NIKCLI_LOG_REDACT = value
  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env.NIKCLI_LOG_REDACT
    else process.env.NIKCLI_LOG_REDACT = previous
  }
}

describe("Log redaction", () => {
  test("masks a token-shaped substring in a nested extra", () => {
    const line = withFlag(undefined, () =>
      capture((log) => log.info("provider call", { request: { key: "sk-abcdefghijklmnopqrstuvwxyz012345" } })),
    )
    expect(line).toContain("[REDACTED]")
    expect(line).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345")
  })

  test("masks a flat string extra whose key names a credential", () => {
    // Scalars are appended without JSON quoting, so they used to bypass
    // redaction while the same pair nested one level deep was masked.
    const line = withFlag(undefined, () => capture((log) => log.info("oauth callback", { state: "9f3c-not-a-guess" })))
    expect(line).toContain("state=[REDACTED]")
    expect(line).not.toContain("9f3c-not-a-guess")
  })

  test("masks query credentials in a flat URL extra", () => {
    const line = withFlag(undefined, () =>
      capture((log) => log.info("opening browser", { url: "https://example.test/authorize?code=abc123&scope=all" })),
    )
    expect(line).toContain("code=[REDACTED]")
    expect(line).toContain("scope=all")
    expect(line).not.toContain("abc123")
  })

  test("leaves a non-credential scalar alone", () => {
    const line = withFlag(undefined, () => capture((log) => log.warn("ripgrep failed", { exitCode: 2 })))
    expect(line).toContain("exitCode=2")
  })

  test("NIKCLI_LOG_REDACT=0 writes the raw value", () => {
    const line = withFlag("0", () =>
      capture((log) => log.info("provider call", { request: { key: "sk-abcdefghijklmnopqrstuvwxyz012345" } })),
    )
    expect(line).toContain("sk-abcdefghijklmnopqrstuvwxyz012345")
    expect(line).not.toContain("[REDACTED]")
  })

  test("the flag is consulted per write, not per process", () => {
    const logger = Log.create({ service: `redaction-test-per-write-${counter++}` })
    const chunks: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      withFlag("0", () => logger.info("first", { state: "raw-first" }))
      withFlag(undefined, () => logger.info("second", { state: "raw-second" }))
    } finally {
      process.stderr.write = original
    }
    expect(chunks[0]).toContain("raw-first")
    expect(chunks[1]).toContain("state=[REDACTED]")
    expect(chunks[1]).not.toContain("raw-second")
  })

  test("error messages stay masked even with the escape hatch on", () => {
    // `formatError` is not routed through the flag: an error chain carrying an
    // OAuth callback URL is the case the escape hatch was least meant for.
    const line = withFlag("0", () =>
      capture((log) => log.error("request failed", { err: new Error("GET /cb?token=leaked-value failed") })),
    )
    expect(line).toContain("token=[REDACTED]")
    expect(line).not.toContain("leaked-value")
  })
})
