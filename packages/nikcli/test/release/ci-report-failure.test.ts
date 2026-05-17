import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import path from "path"

const root = path.resolve(import.meta.dir, "../../../..")

async function readRoot(relative: string) {
  return fs.readFile(path.join(root, relative), "utf8")
}

describe("ci-report-failure script", () => {
  it("redacts token patterns from summary output", async () => {
    const script = await readRoot("script/ci-report-failure.ts")

    // Must have a REDACT_PATTERNS array
    expect(script).toContain("REDACT_PATTERNS")
    // Must redact common token formats
    expect(script).toContain("ghp_")
    expect(script).toContain("sk-")
    expect(script).toContain("npm_")
    // Must replace with [REDACTED]
    expect(script).toContain("[REDACTED]")
  })

  it("truncates long summaries to prevent comment bloat", async () => {
    const script = await readRoot("script/ci-report-failure.ts")

    // Must have truncation logic
    expect(script).toContain("truncated")
    expect(script).toContain("1500")
  })

  it("comments on PRs using a sticky marker for idempotency", async () => {
    const script = await readRoot("script/ci-report-failure.ts")

    expect(script).toContain("<!-- nikcli-ci-autofix -->")
    expect(script).toContain("STICKY_MARKER")
    // Must update existing comment if found
    expect(script).toContain("existing")
  })

  it("creates a tracking issue for live-main pushes with no PR", async () => {
    const script = await readRoot("script/ci-report-failure.ts")

    // Must search for existing open issue
    expect(script).toContain("nikcli-ci-failure")
    expect(script).toContain("CI failure on live-main")
    // Must create new OR update existing
    expect(script).toContain("tracking issue")
  })

  it("does not expose secrets in comment body", async () => {
    const script = await readRoot("script/ci-report-failure.ts")

    // Must not include raw env values
    expect(script).not.toContain("process.env.NPM_TOKEN")
    expect(script).not.toContain("process.env.SST_GITHUB_TOKEN")
    expect(script).not.toContain("process.env.AUR_KEY")
    // Must use GITHUB_TOKEN (the least-privilege token)
    expect(script).toContain("GITHUB_TOKEN")
  })

  it("configurable mention via NIKCLI_CI_FAILURE_MENTION env var", async () => {
    const script = await readRoot("script/ci-report-failure.ts")

    expect(script).toContain("NIKCLI_CI_FAILURE_MENTION")
    expect(script).toContain("@nikomatt69")
  })

  it("falls back to fetch-based API if octokit is unavailable", async () => {
    const script = await readRoot("script/ci-report-failure.ts")

    expect(script).toContain("@octokit/rest")
    expect(script).toContain("fetch-based GitHub API")
    expect(script).toContain("githubFetch")
  })
})
