import { describe, expect, it } from "bun:test"
import { Installation } from "@/installation"
import { shouldNotifyUpdate } from "@/cli/upgrade"
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

describe("shouldNotifyUpdate (cross-platform update detection)", () => {
  it("returns false when current equals latest", () => {
    expect(shouldNotifyUpdate("1.137.0", "1.137.0")).toBe(false)
  })

  it("returns true when current is a lower semver than latest", () => {
    expect(shouldNotifyUpdate("1.136.9", "1.137.0")).toBe(true)
    expect(shouldNotifyUpdate("1.99.0", "2.0.0")).toBe(true)
  })

  it("returns false when current is equal or higher than latest", () => {
    expect(shouldNotifyUpdate("1.137.1", "1.137.0")).toBe(false)
    expect(shouldNotifyUpdate("2.0.0", "1.137.0")).toBe(false)
  })

  it("handles prerelease tags correctly (running a beta is older than stable)", () => {
    // Strict semver comparison: 1.137.0-beta.1 < 1.137.0 (prerelease lower
    // precedence than stable). Users running a prerelease should be
    // prompted to upgrade to the matching stable.
    expect(shouldNotifyUpdate("1.137.0-beta.1", "1.137.0")).toBe(true)
    // Inverse: latest is the older prerelease, current is stable.
    expect(shouldNotifyUpdate("1.137.0", "1.137.0-beta.1")).toBe(false)
  })

  it("treats non-semver 'local' build as older so dev builds are notified", () => {
    // Build embedded in source as "local" should always see a notification
    expect(shouldNotifyUpdate("local", "1.137.0")).toBe(true)
  })

  it("falls back to strict inequality when either side is not clean semver", () => {
    // A git short SHA is not valid semver; inequality must kick in so that
    // CI / dev builds are still surfaced to the user instead of being
    // misread (e.g. semver.coerce('abc123') would otherwise turn this
    // into the wildcard '123.0.0', which is semantically wrong).
    expect(shouldNotifyUpdate("abc123", "1.137.0")).toBe(true)
    expect(shouldNotifyUpdate("1.137.0", "1.137.0")).toBe(false)
  })
})

describe("Update dialog wiring (cross-platform)", () => {
  it("declares the update-available event with version, method and current", async () => {
    const source = await readSrc("packages/nikcli/src/installation/index.ts")
    expect(source).toContain("UpdateAvailable")
    expect(source).toContain("installation.update-available")
    expect(source).toMatch(/version:\s*z\.string\(\)/)
    expect(source).toMatch(/current:\s*z\.string\(\)\.optional\(\)/)
  })

  it("the TUI subscribes to installation.update-available and shows a confirm dialog", async () => {
    const source = await readSrc("packages/nikcli/src/cli/cmd/tui/app.tsx")
    expect(source).toContain("Installation.Event.UpdateAvailable.type")
    expect(source).toContain("DialogConfirm.show(")
    expect(source).toContain("Update Available")
  })

  it("the TUI dialog passes the detected install method to upgradeNow", async () => {
    const source = await readSrc("packages/nikcli/src/cli/cmd/tui/app.tsx")
    expect(source).toContain("upgradeNow?.(method")
  })

  it("the TUI fires the upgrade check on startup and does not silently swallow errors", async () => {
    const source = await readSrc("packages/nikcli/src/cli/cmd/tui/thread.ts")
    expect(source).toContain('client.call("checkUpgrade"')
    expect(source).toContain("upgrade check failed")
    // The upgrade-check setTimeout must NOT use `.unref()` — that would
    // let the check die if the TUI exits before the 1-second delay
    // elapses. Scope to the upgrade block so the legitimate
    // `timeout.unref?.()` inside the unrelated `withTimeout` helper
    // is not flagged.
    const upgradeBlock = source.match(/setTimeout\(\(\) => \{[\s\S]*?client\.call\("checkUpgrade"[\s\S]*?\}, 1000\)/)
    expect(upgradeBlock).not.toBeNull()
    expect(upgradeBlock?.[0]).not.toMatch(/\.unref\?\.\(\)/)
  })

  it("upgrade() publishes the event for every supported install method", async () => {
    const source = await readSrc("packages/nikcli/src/cli/upgrade.ts")
    // publish path must exist regardless of how the user invokes nikcli (TUI, CLI, ...)
    expect(source).toContain("Bus.publish(Installation.Event.UpdateAvailable")
    // it must consult semver, not string-equality
    expect(source).toContain("shouldNotifyUpdate")
  })

  it("every install method has a working upgrade command (per platform)", async () => {
    const source = await readSrc("packages/nikcli/src/installation/index.ts")

    // macOS / Linux / Windows package manager install paths all covered
    // (regex tolerates spaces around the colon since prettier normalises them)
    expect(source).toMatch(/case\s+"curl"\s*:/) // mac/linux installer
    expect(source).toMatch(/case\s+"npm"\s*:/) // all OS
    expect(source).toMatch(/case\s+"pnpm"\s*:/) // all OS
    expect(source).toMatch(/case\s+"bun"\s*:/) // all OS
    expect(source).toMatch(/case\s+"brew"\s*:/) // mac/linux
    expect(source).toMatch(/case\s+"choco"\s*:/) // windows
    expect(source).toMatch(/case\s+"scoop"\s*:/) // windows

    // Each command must actually do an install for the right package
    expect(source).toContain("npm install -g nikcli-ai@${target}")
    expect(source).toContain("pnpm install -g nikcli-ai@${target}")
    expect(source).toContain("bun install -g nikcli-ai@${target}")
    expect(source).toContain("brew upgrade ${formula}")
    expect(source).toContain("choco upgrade nikcli --version=${target}")
    expect(source).toContain("scoop install nikcli@${target}")
    expect(source).toContain("https://nikcli.store/install")
  })

  it("every install method has a working latest-version fetch (per platform)", async () => {
    const source = await readSrc("packages/nikcli/src/installation/index.ts")

    // npm/pnpm/bun share the registry endpoint. The source uses a
    // template literal so the on-disk text contains the variable
    // expansion syntax (${registry}/nikcli-ai/${channel}).
    expect(source).toMatch(/\$\{registry\}\/nikcli-ai\/\$\{channel\}/)
    // brew core formula
    expect(source).toContain("formulae.brew.sh/api/formula/nikcli.json")
    // choco
    expect(source).toContain("community.chocolatey.org")
    // scoop manifest
    expect(source).toContain("ScoopInstaller/Main")
    // github fallback for unknown / brew-tap
    expect(source).toContain("api.github.com/repos/nikomatt69/nikcli/releases/latest")
  })

  it("the default config triggers the dialog (only opt-out via autoupdate:false or env)", async () => {
    const source = await readSrc("packages/nikcli/src/cli/upgrade.ts")
    expect(source).toMatch(/config\.autoupdate\s*===\s*false/)
    expect(source).toContain("NIKCLI_DISABLE_AUTOUPDATE")
    // The check must NOT be silently disabled when config is undefined
    // (the default case is "show dialog and ask").
    expect(source).not.toMatch(/config\.autoupdate\s*===\s*undefined/)
    expect(source).not.toMatch(/config\.autoupdate\s*===\s*true/)
  })
})
