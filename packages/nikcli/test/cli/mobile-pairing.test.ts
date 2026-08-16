import { describe, expect, test } from "bun:test"
import { generateQRMatrix } from "@nikcli-ai/remote"
import { buildMobilePairingDeepLink } from "../../src/cli/cmd/mobile"
import { normalizeMobileServerUrl, renderQRRows } from "@tui/component/dialog-mobile-connect"

describe("mobile pairing", () => {
  test("builds the deep link consumed by the mobile app", () => {
    const value = buildMobilePairingDeepLink({
      serverUrl: "http://192.168.1.4:4096",
      token: "nkm_secret",
      directory: "/tmp/a project",
    })
    const url = new URL(value)

    expect(url.protocol).toBe("nikcli:")
    expect(url.hostname).toBe("connect")
    expect(url.searchParams.get("server")).toBe("http://192.168.1.4:4096")
    expect(url.searchParams.get("token")).toBe("nkm_secret")
    expect(url.searchParams.get("directory")).toBe("/tmp/a project")
  })

  test("builds a cloud link without leaking the local directory", () => {
    const value = buildMobilePairingDeepLink({
      serverUrl: "https://cloud.example.com",
      token: "nkm_cloud",
    })
    const url = new URL(value)

    expect(url.searchParams.get("server")).toBe("https://cloud.example.com")
    expect(url.searchParams.get("token")).toBe("nkm_cloud")
    expect(url.searchParams.has("directory")).toBe(false)
  })

  test("normalizes cloud server and mobile endpoint URLs", () => {
    expect(normalizeMobileServerUrl("cloud.example.com/")).toBe("https://cloud.example.com")
    expect(normalizeMobileServerUrl("https://cloud.example.com/base/mobile/teleport")).toBe(
      "https://cloud.example.com/base",
    )
    expect(normalizeMobileServerUrl("ftp://cloud.example.com")).toBeNull()
    expect(normalizeMobileServerUrl("")).toBeNull()
  })

  test("generates the QR matrix used by the TUI", async () => {
    const matrix = await generateQRMatrix(
      buildMobilePairingDeepLink({
        serverUrl: "http://192.168.1.4:4096",
        token: "nkm_secret",
        directory: "/Volumes/SSD/Projects/nikcli",
      }),
    )

    expect(matrix).not.toBeNull()
    expect(matrix?.length).toBeGreaterThan(0)
    expect(matrix?.every((row) => row.length === matrix.length)).toBe(true)
  })

  test("packs two QR module rows into one terminal row without truncation", () => {
    const matrix = [
      [true, false, true],
      [true, true, false],
    ]

    expect(renderQRRows(matrix, 0)).toEqual(["█▄▀"])
  })

  test("pads odd-height matrices with a blank half-row so the output is even", () => {
    const matrix = [
      [true, false, true],
      [true, true, false],
      [false, true, true],
    ]

    // Three module rows → two terminal rows. The bottom output row is the
    // last module row paired with a blank half-row, so the trailing column
    // is `▀` (top half of the last filled module) — not a space.
    expect(renderQRRows(matrix, 0)).toEqual(["█▄▀", " ▀▀"])
  })
})
