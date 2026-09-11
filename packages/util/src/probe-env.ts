import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import { spawnSync } from "node:child_process"

/**
 * The environment block every EOT-01 measurement carries.
 *
 * A number without the machine, runtime and revision that produced it cannot be
 * compared to another number, and comparing is the whole point of a baseline.
 * Both probes emit this same shape so their output can be diffed directly
 * rather than eyeballed — which is why it lives here instead of being written
 * twice, once per probe, and drifting.
 *
 * `dirty` matters as much as `commit`: a measurement taken over uncommitted
 * edits is not attributable to the revision it claims.
 */
export type ProbeEnvironment = {
  readonly spec: string
  readonly revision: { readonly commit: string; readonly dirty: boolean; readonly dirtyCount: number }
  readonly bun: string
  readonly versions: Record<string, string>
  readonly os: {
    readonly platform: string
    readonly arch: string
    readonly cpus: number
    readonly totalmem: number
    readonly loadavg1: number
  }
}

function git(repoRoot: string, args: string[]): string | undefined {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" })
  if (result.status !== 0) return undefined
  return result.stdout.trim()
}

function readJson(file: string): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return {}
  }
}

export function probeEnvironment(input: { spec: string; repoRoot: string }): ProbeEnvironment {
  const status = git(input.repoRoot, ["status", "--porcelain"]) ?? ""
  const tuiPkg = readJson(path.join(input.repoRoot, "packages/tui/package.json"))
  const rootPkg = readJson(path.join(input.repoRoot, "package.json"))
  return {
    spec: input.spec,
    revision: {
      commit: git(input.repoRoot, ["rev-parse", "HEAD"]) ?? "unknown",
      dirty: status.length > 0,
      dirtyCount: status.split("\n").filter(Boolean).length,
    },
    bun: typeof Bun === "undefined" ? "unknown" : Bun.version,
    versions: {
      effect: tuiPkg.dependencies?.effect ?? "unknown",
      opentuiCore: tuiPkg.dependencies?.["@opentui/core"] ?? "unknown",
      opentuiSolid: tuiPkg.dependencies?.["@opentui/solid"] ?? "unknown",
      solid: rootPkg.workspaces?.catalog?.["solid-js"] ?? "unknown",
    },
    os: {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalmem: os.totalmem(),
      // Load at measurement time: the single most common reason two runs of the
      // same probe on the same machine disagree.
      loadavg1: os.loadavg()[0],
    },
  }
}

/** One-line human summary for a probe's console output. */
export function formatProbeEnvironment(env: ProbeEnvironment): string {
  const rev = `${env.revision.commit.slice(0, 9)}${env.revision.dirty ? `+${env.revision.dirtyCount} dirty` : ""}`
  return `${env.spec} · ${rev} · bun ${env.bun} · ${env.os.platform}/${env.os.arch} · ${env.os.cpus} cpu · load ${env.os.loadavg1.toFixed(2)}`
}
