import { $, semver } from "bun"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const nikcliPkgPath = path.resolve(import.meta.dir, "../../nikcli/package.json")
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  NIKCLI_CHANNEL: process.env["NIKCLI_CHANNEL"],
  NIKCLI_BUMP: process.env["NIKCLI_BUMP"],
  NIKCLI_VERSION: process.env["NIKCLI_VERSION"],
}
const CHANNEL = await (async () => {
  if (env.NIKCLI_CHANNEL) return env.NIKCLI_CHANNEL
  if (env.NIKCLI_BUMP) return "latest"
  if (env.NIKCLI_VERSION && !env.NIKCLI_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.NIKCLI_VERSION) return env.NIKCLI_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = await fetch("https://registry.npmjs.org/nikcli-ai/latest")
    .then(async (res) => {
      if (res.status === 404) {
        const pkg = await Bun.file(nikcliPkgPath).json()
        return { version: pkg.version }
      }
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.NIKCLI_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
}
console.log(`nikcli script`, JSON.stringify(Script, null, 2))

/**
 * bun 1.4.0's `--compile` writes a darwin Mach-O whose ad-hoc signature no longer
 * matches the executable segment, so the kernel SIGKILLs the binary the moment it
 * is exec'd ("killed: 9", exit 137) — even for a one-line program. Re-signing
 * ad-hoc after the compile repairs it. `codesign -v` still reports "invalid
 * signature" on a bun binary either way: the payload bun appends past __LINKEDIT
 * is not covered by the CodeDirectory, and that part is benign. Drop this once
 * upstream fixes the signer.
 */
export async function signDarwinBinary(file: string) {
  // macOS hosts have codesign in the base system.
  if (process.platform === "darwin") {
    await $`codesign --force --sign - ${file}`.quiet()
    return
  }
  // Releases cross-compile darwin from ubuntu, where codesign does not exist, so
  // fall back to whichever ad-hoc Mach-O signer the runner has.
  const signers = [
    ["rcodesign", "sign", file],
    ["ldid", "-S", file],
  ] as const
  for (const [tool, ...args] of signers) {
    if (!Bun.which(tool)) continue
    await $`${tool} ${args}`.quiet()
    return
  }
  throw new Error(
    `cannot ad-hoc sign ${file}: no codesign, rcodesign or ldid on PATH. ` +
      `bun ${Bun.version} emits darwin binaries that macOS kills on exec unless they are re-signed.`,
  )
}
