import { describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

const SCRIPT = path.resolve(import.meta.dir, "../../../../script/check-patched-deps.ts")

/**
 * A `patchedDependencies` key is an exact `name@version`. Bump the dependency
 * and bun applies nothing, in silence — the entry and the `.patch` file both
 * stay, so nothing a reviewer looks at changes. `@modelcontextprotocol/sdk`
 * went 1.25.2 -> 1.26.0 and dropped its SSE reconnect-storm fix for 25 days
 * that way; `packages/app` was separately running an unpatched `ghostty-web`.
 *
 * These fixtures reproduce both, so the check stays able to see them.
 */
type Fixture = {
  patches: Record<string, string>
  /** Lockfile resolutions: key -> `name@version`. */
  packages: Record<string, string>
  workspaces?: Record<string, { name: string; dependencies?: Record<string, string> }>
  /** Patch files to actually create; defaults to every declared one. */
  files?: string[]
}

function makeRoot(fixture: Fixture) {
  const root = mkdtempSync(path.join(tmpdir(), "nikcli-patched-deps-"))
  mkdirSync(path.join(root, "patches"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ patchedDependencies: fixture.patches }, null, 2))
  writeFileSync(
    path.join(root, "bun.lock"),
    JSON.stringify(
      {
        lockfileVersion: 1,
        workspaces: fixture.workspaces ?? {},
        packages: Object.fromEntries(Object.entries(fixture.packages).map(([key, spec]) => [key, [spec, "", {}, ""]])),
      },
      null,
      2,
    ),
  )
  for (const file of fixture.files ?? Object.values(fixture.patches)) {
    writeFileSync(path.join(root, file), "diff --git a/x b/x\n")
  }
  return root
}

async function check(fixture: Fixture) {
  const root = makeRoot(fixture)
  try {
    const proc = Bun.spawn(["bun", "run", SCRIPT, root], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    return { code: await proc.exited, output: stdout + stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("check-patched-deps", () => {
  it("passes when every patch matches an installed version", async () => {
    const { code, output } = await check({
      patches: { "left-pad@1.3.0": "patches/left-pad@1.3.0.patch" },
      packages: { "left-pad": "left-pad@1.3.0" },
    })
    expect(code).toBe(0)
    expect(output).toContain("passed")
  })

  it("fails when the patched version is not installed", async () => {
    // The @modelcontextprotocol/sdk 1.25.2 -> 1.26.0 bump, exactly.
    const { code, output } = await check({
      patches: { "left-pad@1.2.0": "patches/left-pad@1.2.0.patch" },
      packages: { "left-pad": "left-pad@1.3.0" },
    })
    expect(code).toBe(1)
    expect(output).toContain("not installed")
    expect(output).toContain("1.3.0")
  })

  it("fails when a workspace resolves to a version no patch covers", async () => {
    // packages/app on ghostty-web 0.4.0 while the patch covered only 0.3.0.
    const { code, output } = await check({
      patches: { "term@0.3.0": "patches/term@0.3.0.patch" },
      packages: { term: "term@0.4.0", "cli/term": "term@0.3.0" },
      workspaces: {
        "packages/cli": { name: "cli", dependencies: { term: "0.3.0" } },
        "packages/app": { name: "app", dependencies: { term: "0.4.0" } },
      },
    })
    expect(code).toBe(1)
    expect(output).toContain("packages/app")
    expect(output).toContain("0.4.0")
  })

  it("accepts a package patched at each version its workspaces use", async () => {
    // Two entries for one package must not accuse each other — the workspace
    // is only unprotected when its resolution matches none of them.
    const { code, output } = await check({
      patches: { "term@0.3.0": "patches/term@0.3.0.patch", "term@0.4.0": "patches/term@0.4.0.patch" },
      packages: { term: "term@0.4.0", "cli/term": "term@0.3.0" },
      workspaces: {
        "packages/cli": { name: "cli", dependencies: { term: "0.3.0" } },
        "packages/app": { name: "app", dependencies: { term: "0.4.0" } },
      },
    })
    expect(code).toBe(0)
    expect(output).toContain("passed")
  })

  it("ignores a stray copy no workspace depends on", async () => {
    // An unrelated third-party dep pinning an ancient version is not evidence
    // of anything; flagging it trains people to skip the check.
    const { code } = await check({
      patches: { "term@1.0.0": "patches/term@1.0.0.patch" },
      packages: { term: "term@1.0.0", "legacy-tool/term": "term@0.1.0" },
      workspaces: { "packages/cli": { name: "cli", dependencies: { term: "1.0.0" } } },
    })
    expect(code).toBe(0)
  })

  it("fails when a declared patch file is missing", async () => {
    const { code, output } = await check({
      patches: { "left-pad@1.3.0": "patches/left-pad@1.3.0.patch" },
      packages: { "left-pad": "left-pad@1.3.0" },
      files: [],
    })
    expect(code).toBe(1)
    expect(output).toContain("does not exist")
  })

  it("fails on a patch file nothing references", async () => {
    const { code, output } = await check({
      patches: { "left-pad@1.3.0": "patches/left-pad@1.3.0.patch" },
      packages: { "left-pad": "left-pad@1.3.0" },
      files: ["patches/left-pad@1.3.0.patch", "patches/orphan@1.0.0.patch"],
    })
    expect(code).toBe(1)
    expect(output).toContain("orphan")
  })
})
