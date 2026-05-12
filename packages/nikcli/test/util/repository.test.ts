import { afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

async function runGit(args: string[], cwd: string) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || stdout.trim()}`)
  return stdout
}

const cleanup: string[] = []

afterEach(async () => {
  const paths = cleanup.splice(0)
  await Promise.all(paths.map((item) => fs.rm(item, { recursive: true, force: true })))
  delete process.env.NIKCLI_TEST_HOME
})

describe("repository utilities", () => {
  it("normalizes GitHub shorthand and URLs to canonical clones", async () => {
    const { normalizeRepository } = await import("@/util/repository")

    expect(normalizeRepository("owner/repo")).toMatchObject({
      kind: "github",
      owner: "owner",
      repo: "repo",
      cloneUrl: "https://github.com/owner/repo.git",
    })
    expect(normalizeRepository("git@github.com:acme/widget.git")).toMatchObject({
      kind: "github",
      owner: "acme",
      repo: "widget",
      cloneUrl: "https://github.com/acme/widget.git",
    })
  })

  it("clones a local Git repository into the managed repo cache and reports overview", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-repo-home-"))
    const source = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-repo-source-"))
    cleanup.push(home, source)
    process.env.NIKCLI_TEST_HOME = home

    await runGit(["init", "-b", "main"], source)
    await fs.mkdir(path.join(source, "src"))
    await fs.writeFile(path.join(source, "README.md"), "# demo\n")
    await fs.writeFile(path.join(source, "src", "index.ts"), "export const value = 1\n")
    await runGit(["add", "-A"], source)
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], source)

    const { cloneOrUpdateRepository, repositoryOverview } = await import("@/util/repository")
    const clone = await cloneOrUpdateRepository({ repository: source })
    const overview = await repositoryOverview(clone.directory)

    expect(clone.cloned).toBe(true)
    expect(clone.directory.startsWith(path.join(home, "data", "repos"))).toBe(true)
    expect(overview.fileCount).toBe(2)
    expect(overview.sampleFiles).toContain("README.md")
    expect(overview.sampleFiles).toContain("src/index.ts")
  })
})
