import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Wave 3 D1 migration: tools in src/tool/ that need the instance path must
 * resolve it through `InstanceState` instead of reading `Instance.*` directly.
 * This static check pins that decision so future regressions fail loudly.
 *
 * Scoped to a known allowlist of migrated files (see misty-moon plan D1).
 *
 * `AppRuntime` used to be required here too, because the migration originally
 * spelled the read `AppRuntime.runPromise(withCurrentInstance(InstanceState.context))`
 * — a fiber on a `ManagedRuntime` whose entire job was to read three getters
 * out of the ambient scope and hand them straight back. These tools now call
 * `InstanceState.ambient()` synchronously. That is the same property D1 was
 * after; requiring `AppRuntime` pinned the mechanism instead of the property,
 * so only the property is required now.
 */
const MIGRATED_TOOLS = [
  "src/tool/context_collect.ts",
  "src/tool/context_diagnostics.ts",
  "src/tool/context_related.ts",
] as const

const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /from\s+["']@\/project\/instance["']/,
    reason: "imports the legacy Instance module; use InstanceState via AppRuntime instead",
  },
  {
    pattern: /\bInstance\.directory\b/,
    reason: "reads Instance.directory directly; use instancePaths() from InstanceState",
  },
  {
    pattern: /\bInstance\.worktree\b/,
    reason: "reads Instance.worktree directly; use instancePaths() from InstanceState",
  },
]

const REQUIRED_MARKERS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /InstanceState/,
    reason: "should read context via InstanceState (not legacy Instance)",
  },
]

describe("InstanceState migration (D1) for context_* tools", () => {
  for (const relPath of MIGRATED_TOOLS) {
    describe(relPath, () => {
      const abs = join(import.meta.dir, "..", "..", relPath)
      const source = readFileSync(abs, "utf8")

      it("does not import or read legacy Instance.* directly", () => {
        for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
          expect(source.match(pattern), `${relPath}: ${reason}`).toBeNull()
        }
      })

      it("reads the instance through InstanceState", () => {
        for (const { pattern, reason } of REQUIRED_MARKERS) {
          expect(source.match(pattern), `${relPath}: ${reason}`).not.toBeNull()
        }
      })
    })
  }
})
