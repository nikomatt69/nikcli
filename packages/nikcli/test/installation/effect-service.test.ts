import { describe, expect, it } from "bun:test"
import { Installation } from "@/installation"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"

const root = path.resolve(import.meta.dir, "../../../..")

async function readSrc(relative: string) {
  return fs.readFile(path.join(root, relative), "utf8")
}

function runInstallation<A, E>(effect: Effect.Effect<A, E, Installation.Service>) {
  return runPromiseWithLayer(Installation.defaultLayer, effect)
}

describe("Installation.Service", () => {
  it("provides the installation operations through the Effect service boundary", async () => {
    const operations = await runInstallation(
      Effect.gen(function* () {
        const installation = yield* Installation.Service
        return {
          info: typeof installation.info,
          latest: typeof installation.latest,
          method: typeof installation.method,
          upgrade: typeof installation.upgrade,
        }
      }),
    )

    expect(operations).toEqual({
      info: "function",
      latest: "function",
      method: "function",
      upgrade: "function",
    })
  })
})

describe("Homebrew installation support", () => {
  it("includes brew in the supported installation methods", () => {
    const methods: Installation.Method[] = ["curl", "npm", "yarn", "pnpm", "bun", "brew", "scoop", "choco", "unknown"]
    expect(methods).toContain("brew")
  })

  it("detects brew installations via both tap and core formulas", async () => {
    const source = await readSrc("packages/nikcli/src/installation/index.ts")

    // Must check for the tap formula first
    expect(source).toContain("nikomatt69/tap/nikcli")

    // Must also check core formula as fallback
    expect(source).toContain("brew list --formula nikcli")

    // Must have upgrade support for brew
    expect(source).toContain("brew upgrade")

    // Must disable auto-update during brew upgrade
    expect(source).toContain("HOMEBREW_NO_AUTO_UPDATE")
  })

  it("resolves latest version for brew via GitHub releases as fallback for tap formula", async () => {
    const source = await readSrc("packages/nikcli/src/installation/index.ts")

    // The tap formula should fall back to GitHub releases for version checking
    expect(source).toContain("api.github.com/repos/nikomatt69/nikcli/releases/latest")

    // Must handle brew.sh API for core formula
    expect(source).toContain("formulae.brew.sh")
  })

  it("includes brew in the upgrade command choices", async () => {
    const upgradeSource = await readSrc("packages/nikcli/src/cli/cmd/upgrade.ts")
    expect(upgradeSource).toContain('"brew"')

    const uninstallSource = await readSrc("packages/nikcli/src/cli/cmd/uninstall.ts")
    expect(uninstallSource).toContain("brew uninstall")
  })
})
