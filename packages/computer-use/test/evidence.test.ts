import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { installWorkspaceSkill, parseBundleOptions, renderAgentBundleOutput } from "../src/cli"
import { createEvidenceBundle, renderPullRequestMarkdown, type EvidenceBundleOptions } from "../src/evidence"

describe("PR evidence", () => {
  test("renders inline preview and MP4 link", () => {
    const markdown = renderPullRequestMarkdown({
      result: "passed",
      title: "Settings opened",
      summary: "Click on settings opened the panel.",
      linkBase: "artifacts/computer",
      hasVideo: true,
      hasPreview: true,
    })
    expect(markdown).toContain("✅ Computer verification passed.")
    expect(markdown).toContain("![Settings opened](artifacts/computer/preview.gif)")
    expect(markdown).toContain("[Full MP4 recording](artifacts/computer/demo.mp4)")
  })

  test("requires explicit verification result", () => {
    expect(() => parseBundleOptions(["--screenshot", "x.png", "--out", "artifacts"])).toThrow(
      "bundle requires --result",
    )
  })

  test("rejects combined atMarker + atMs", async () => {
    await expect(
      parseBundleOptions([
        "--recording",
        "/tmp/empty.json",
        "--out",
        "/tmp/out",
        "--result",
        "passed",
        "--at-marker",
        "x",
        "--at-ms",
        "10",
      ]),
    ).rejects.toThrow("atMarker or atMs, not both")
  })
})

describe("evidence bundle", () => {
  let root = ""
  let screenshot = ""
  let recording = ""

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "computer-use-evidence-"))
    // 1x1 transparent PNG (8 bytes IDAT + the rest of a valid PNG file)
    screenshot = join(root, "screenshot.png")
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49,
      0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    await writeFile(screenshot, png)
    // Empty recording (no samples) — just enough to test the path that
    // takes screenshotPath without falling back to recording-derived video.
    recording = join(root, "recording.json")
    await writeFile(
      recording,
      JSON.stringify({
        version: 1,
        startedAt: 0,
        duration: 0,
        mode: "sandbox",
        screen: { width: 10, height: 10 },
        samples: [],
        markers: [],
      }),
    )
  })

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  test("creates a screenshot-only bundle (no video when recording has no samples)", async () => {
    const options: EvidenceBundleOptions = {
      screenshotPath: screenshot,
      outputDirectory: join(root, "out-screenshot"),
      result: "passed",
      title: "Screenshot only",
      summary: "Just a screenshot.",
    }
    const bundle = await createEvidenceBundle(options)
    expect(bundle.screenshot).toBe(join(root, "out-screenshot/screenshot.png"))
    expect(bundle.video).toBeUndefined()
    expect(bundle.preview).toBeUndefined()
    const manifest = JSON.parse(await readFile(bundle.manifest, "utf8"))
    expect(manifest.version).toBe(1)
    expect(manifest.result).toBe("passed")
    expect(manifest.artifacts.length).toBe(2) // screenshot + pr.md
  })

  test("installs the bundled skill idempotently for workspace discovery", async () => {
    const first = await installWorkspaceSkill(root)
    const second = await installWorkspaceSkill(root)
    expect(first.installed).toBe(true)
    expect(second.installed).toBe(false)
    expect((await lstat(first.target)).isSymbolicLink()).toBe(true)
    expect(await realpath(first.target)).toBe(await realpath(first.source))
    expect(await readFile(join(first.target, "SKILL.md"), "utf8")).toContain("name: computer-use")
  })

  test("renderAgentBundleOutput embeds the inline preview line", async () => {
    const bundle = await createEvidenceBundle({
      screenshotPath: screenshot,
      outputDirectory: join(root, "out-bundle-output"),
      result: "passed",
      title: "Rendered",
      summary: "x",
    })
    const prMarkdown = await readFile(bundle.prMarkdown, "utf8")
    const out = renderAgentBundleOutput(bundle, prMarkdown)
    expect(out).toContain("Computer evidence created.")
    expect(out).toContain("PR Markdown:")
    expect(out).toContain("Inline preview")
  })
})
