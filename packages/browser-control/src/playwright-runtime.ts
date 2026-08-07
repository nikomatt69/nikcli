/**
 * Loading Playwright at runtime instead of bundling it.
 *
 * `bun build --compile` inlines every module it can resolve statically, and
 * freezes `__dirname` to the **build machine's** absolute path while doing it.
 * Playwright resolves its own installation relative to that `__dirname` —
 * `playwright/lib/util.js` runs
 * `path.dirname(require.resolve("playwright-core/package.json"))` at module top
 * level — so a bundled Playwright looks for itself at a path that only ever
 * existed on the CI runner:
 *
 *     ResolveMessage: Cannot find module
 *     '/home/runner/work/nikcli/nikcli/node_modules/.bun/playwright-core@1.61.0/…/package.json'
 *     from '/$bunfs/root/src/index.js'
 *
 * The web preview therefore worked from source and failed in every released
 * build. Compiled binaries run the daemon in-process (`resolveDaemonLaunch` →
 * `{ mode: "inprocess" }`), which puts that import inside `/$bunfs`, where no
 * `node_modules` exists.
 *
 * The fix is to keep the specifier **out of the bundler's reach**. `import(x)`
 * with a non-literal `x` is invisible to static analysis, so Bun leaves it to
 * be resolved at runtime — against a real directory, with a real `__dirname`,
 * where Playwright can find itself. Verified from inside `/$bunfs/root`: the
 * import resolves, Chromium launches, and screenshots come back.
 *
 * The inverse of the old comment in `manager.ts`, which kept the specifier
 * literal precisely so the bundler *would* inline it. That was the bug.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { BrowserType } from "playwright"

/** Point this at a `playwright` package (or its entry file) to override discovery. */
const ENV_OVERRIDE = "NIKCLI_PLAYWRIGHT_PATH"

/**
 * Directories to resolve `playwright` from, most specific first.
 *
 * `process.execPath` matters as much as `cwd`: an `npm i -g nikcli-ai` install
 * puts the binary inside its own package directory, with `node_modules`
 * alongside it, and that is where Playwright lives for most users. Resolving
 * only from `cwd` would find it during development and nowhere else.
 */
function ancestors(start: string, depth = 6): string[] {
  const out: string[] = []
  let dir = start
  for (let i = 0; i < depth; i++) {
    out.push(dir)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return out
}

function resolutionRoots(): string[] {
  const roots: string[] = []
  const override = process.env[ENV_OVERRIDE]
  if (override) roots.push(override, dirname(override))

  roots.push(...ancestors(process.cwd()))
  // Walk up from the executable too: `npm i -g nikcli-ai` puts the binary in
  // its own package directory, next to the node_modules that holds Playwright.
  // Resolving only from cwd would find it in development and nowhere else.
  roots.push(...ancestors(dirname(process.execPath)))
  roots.push(join(homedir(), ".cache", "nikcli", "browser"))

  return [...new Set(roots)].filter((root) => root.length > 0 && existsSync(root))
}

/**
 * Last resort: find Playwright inside a Bun install store.
 *
 * `Bun.resolveSync` answers the question "what would an import from *here*
 * resolve to", which depends on a `node_modules/playwright` entry existing at
 * or above that directory. In a workspace monorepo Playwright belongs to one
 * package, so it resolves from `packages/browser-control` and from nowhere
 * else — including the repo root, which is where a process usually starts.
 * The store layout (`node_modules/.bun/playwright@<version>/node_modules/…`)
 * is reachable from any ancestor, so glob for it before giving up.
 */
function findInBunStore(roots: ReadonlyArray<string>): string | null {
  for (const root of roots) {
    const store = join(root, "node_modules", ".bun")
    if (!existsSync(store)) continue
    const matches: string[] = []
    try {
      for (const match of new Bun.Glob("playwright@*/node_modules/playwright/index.mjs").scanSync({
        cwd: store,
        absolute: true,
      })) {
        matches.push(match)
      }
    } catch {
      continue
    }
    if (matches.length > 0) return matches.sort().at(-1)!
  }
  return null
}

/**
 * Resolve the `playwright` entry point on disk, or `null` if this machine has
 * no copy of it. Never throws: the caller turns "not found" into an actionable
 * message, and a missing browser must not look like a crash.
 */
export function findPlaywrightEntry(): string | null {
  const override = process.env[ENV_OVERRIDE]
  // An override pointing straight at a file is used as-is.
  if (override && existsSync(override) && /\.(m?js|cjs)$/.test(override)) return override

  const roots = resolutionRoots()
  for (const root of roots) {
    try {
      return Bun.resolveSync("playwright", root)
    } catch {
      // Not resolvable from this root; try the next.
    }
  }
  return findInBunStore(roots)
}

export class PlaywrightUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `Playwright is not available to this nikcli build: ${detail}\n` +
        `The browser needs it on disk — install it next to nikcli (\`bun add playwright\`) ` +
        `or set ${ENV_OVERRIDE} to an existing installation.`,
    )
    this.name = "PlaywrightUnavailableError"
  }
}

let cached: Promise<BrowserType> | null = null

/**
 * The Chromium launcher, loaded once per process.
 *
 * Playwright reaches us through two hops of CJS/ESM interop
 * (`playwright/index.mjs` re-exports `playwright-core/index.js`, which is
 * `module.exports = require("./lib/coreBundle").inprocess.playwright`), and
 * which hop carries the named export depends on how the module was loaded.
 * Take the launcher from whichever shape actually has it, and say so plainly
 * when none of them does.
 */
export function resolveChromium(): Promise<BrowserType> {
  if (!cached) {
    cached = load().catch((error) => {
      // A failed load must not be cached, or a machine that gains Playwright
      // later would keep reporting the old failure for the life of the daemon.
      cached = null
      throw error
    })
  }
  return cached
}

async function load(): Promise<BrowserType> {
  const entry = findPlaywrightEntry()
  if (!entry) throw new PlaywrightUnavailableError("no installation found on this machine")

  // The specifier is a variable on purpose — see the file header.
  const mod = (await import(entry).catch((error) => {
    throw new PlaywrightUnavailableError(`importing ${entry} failed: ${(error as Error).message}`)
  })) as Record<string, any>

  const chromium = mod.chromium ?? mod.default?.chromium ?? mod.default?.default?.chromium
  if (typeof chromium?.launch !== "function") {
    throw new PlaywrightUnavailableError(
      `${entry} exports no Chromium launcher (exports: ${Object.keys(mod).join(", ") || "none"})`,
    )
  }
  return chromium as BrowserType
}
