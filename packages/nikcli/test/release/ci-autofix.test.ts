import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import path from "path"

const root = path.resolve(import.meta.dir, "../../../..")

async function readRoot(relative: string) {
  return fs.readFile(path.join(root, relative), "utf8")
}

describe("ci-autofix script", () => {
  it("skips commits with [nikcli autofix] prefix", async () => {
    const script = await readRoot("script/ci-autofix.ts")

    // The SKIP_PATTERNS array must include [nikcli autofix]
    expect(script).toContain("[nikcli autofix]")
    expect(script).toContain("SKIP_PATTERNS")
  })

  it("skips release and generated commits to prevent loops", async () => {
    const script = await readRoot("script/ci-autofix.ts")

    expect(script).toContain("/^release: v/")
    expect(script).toContain("/^chore: generate/")
  })

  it("skips bot actor commits", async () => {
    const script = await readRoot("script/ci-autofix.ts")

    expect(script).toContain('"github-actions[bot]"')
    expect(script).toContain('"nikcli-ci[bot]"')
  })

  it("rejects fork PRs", async () => {
    const script = await readRoot("script/ci-autofix.ts")

    expect(script).toContain("GITHUB_EVENT_PULL_REQUEST_HEAD_REPO_FULL_NAME")
    expect(script).toContain("PR_HEAD_REPO")
    // Must check that PR head repo equals the canonical repository
    expect(script).toContain("!== REPO")
  })

  it("requires MINIMAX_API_KEY to attempt autofix", async () => {
    const script = await readRoot("script/ci-autofix.ts")

    expect(script).toContain("MINIMAX_API_KEY")
    expect(script).toContain("Missing MINIMAX_API_KEY")
  })

  it("does not push when there are no file changes", async () => {
    const script = await readRoot("script/ci-autofix.ts")

    // Must check git status before pushing (the script uses ["git", "status", "--porcelain"] as array args)
    expect(script).toContain("--porcelain")
    expect(script).toContain("No file changes detected")
  })

  it("only pushes after re-validation succeeds", async () => {
    const script = await readRoot("script/ci-autofix.ts")

    // Must have a distinct re-validation step
    expect(script).toContain("revalidateExit")
    // Exit 78 signals autofix attempted but still failing
    expect(script).toContain("process.exit(78)")
    // Exit 0 signals nothing to push or success
    expect(script).toContain("process.exit(0)")
  })

  it("uses nikcli run headlessly with model configuration", async () => {
    const script = await readRoot("script/ci-autofix.ts")

    expect(script).toContain("nikcli")
    expect(script).toContain("run")
    expect(script).toContain("--command")
    expect(script).toContain("--model")
    expect(script).toContain("NIKCLI_AUTOFIX_MODEL")
    // Default fallback model must be MiniMax, not a costly provider
    expect(script).toContain("minimax-coding-plan/MiniMax-M3")
  })
})
