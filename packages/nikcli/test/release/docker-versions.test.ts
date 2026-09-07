import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const SCRIPT = path.resolve(import.meta.dir, "../../../../script/check-docker-versions.ts")

async function check(source: string, filename = "Dockerfile.serve") {
  const root = mkdtempSync(path.join(tmpdir(), "nikcli-docker-versions-"))
  try {
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ packageManager: "bun@1.4.2" }))
    writeFileSync(path.join(root, filename), source)
    for (const args of [
      ["init", "--quiet"],
      ["add", filename],
    ]) {
      const git = Bun.spawnSync(["git", ...args], { cwd: root })
      if (git.exitCode !== 0) throw new Error(git.stderr.toString())
    }
    const proc = Bun.spawn([process.execPath, "run", SCRIPT, root], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, output: stdout + stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("Docker release versions", () => {
  it.each(["FROM oven/bun:1.4", "FROM oven/bun:1.4.0-debian", "ARG BUN_VERSION=1.4.0"])(
    "rejects a runtime that drifts from packageManager: %s",
    async (source) => {
      const result = await check(source)
      expect(result.code).toBe(1)
      expect(result.output).toContain("differs from packageManager bun@1.4.2")
    },
  )

  it.each(["", "-debian", "-alpine"])("accepts the pinned Bun image variant %s", async (variant) => {
    const result = await check(`FROM oven/bun:1.4.2${variant}\nARG BUN_VERSION=1.4.2\n`)
    expect(result.code).toBe(0)
  })

  it("rejects the Railway override that reintroduced Effect beta.83 after E6", async () => {
    const result = await check(
      'RUN cd /app && bun install --os="*" --cpu="*" @opentui/solid@0.4.5 @effect/platform-bun@4.0.0-beta.83\n',
    )
    expect(result.code).toBe(1)
    expect(result.output).toContain("@effect/platform-bun@4.0.0-beta.83 overrides workspace Effect dependencies")
  })

  it.each(["effect@4.0.0-rc.112", "@effect/platform-node@4.0.0-rc.112", "effect"])(
    "rejects positional %s even when it is current or unversioned",
    async (spec) => {
      const result = await check(`RUN bun add \\\n        "${spec}"\n`)
      expect(result.code).toBe(1)
      expect(result.output).toContain(`${spec} overrides workspace Effect dependencies`)
    },
  )

  it("keeps multi-platform installation and separate browser provisioning valid", async () => {
    const result = await check(`
# Historical failure: bun install @effect/platform-bun@4.0.0-beta.83
RUN cd /app && bun install --os="*" --cpu="*"
RUN bunx --bun playwright@1.61.0 install --with-deps chromium
RUN NIKCLI_VERSION="$(bun -e 'console.log(require("./package.json").version)')" \\
    bun run script/build.ts --single --skip-install
`)
    expect(result.code).toBe(0)
  })

  it("still rejects a literal application version", async () => {
    const result = await check("ENV NIKCLI_VERSION=1.216.0\n")
    expect(result.code).toBe(1)
    expect(result.output).toContain("Dockerfile.serve:1: NIKCLI_VERSION pinned to a literal")
  })

  it("still checks compose files", async () => {
    const result = await check("environment:\n  - NIKCLI_VERSION=1.216.0\n", "docker-compose.yml")
    expect(result.code).toBe(1)
    expect(result.output).toContain("NIKCLI_VERSION pinned to a literal")
  })
})
