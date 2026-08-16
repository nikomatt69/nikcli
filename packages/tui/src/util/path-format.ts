/**
 * How a file path is spelled on screen.
 *
 * There were two of these, and they disagreed. `permission.tsx` resolved
 * against the cwd and fell back to `~/…` for anything outside it;
 * `tool-view.tsx` resolved against the cwd and returned the raw input
 * otherwise. So the same file read as `~/Projects/app/main.ts` in the
 * permission prompt and `../../Projects/app/main.ts` in the tool row directly
 * below it — two spellings of one path, a few lines apart.
 *
 * One function now, and it is the stricter of the two: it keeps the `~`
 * abbreviation, and it handles Windows paths, which neither copy did.
 *
 * Ported from opencode's `util/path-format.ts`. Dependency-free on purpose —
 * no Solid, no renderer, no `process.cwd()` reached for from the inside. The
 * base and home are passed in, which is what makes it testable and what stops
 * a third copy from appearing the next time a component needs a path.
 */
import path from "path"

/** `\\server\share` or `C:\…` — the two shapes a Windows path can take. */
function windowsPath(input: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(input) || input.startsWith("\\\\")
}

/**
 * `/Users/me/src/app` → `~/src/app`, when it really is under `home`.
 *
 * The relative path is what decides, not a prefix test: `/Users/median` starts
 * with `/Users/me` as a string but is not inside it, and a prefix check would
 * abbreviate it to `~dian`.
 */
export function abbreviateHome(input: string, home: string): string {
  if (!home) return input
  const paths = windowsPath(home) ? path.win32 : path.posix
  const relative = paths.relative(home, input)
  if (!relative) return "~"
  if (relative === ".." || relative.startsWith(".." + paths.sep) || paths.isAbsolute(relative)) return input
  return "~/" + relative.split(paths.sep).join("/")
}

/**
 * The display spelling of `input`, relative to `base`.
 *
 * Inside `base` it is relative (`src/app/main.ts`), and `base` itself is `.`.
 * Outside it, `home` is abbreviated to `~/…` when given, and otherwise the
 * path stays absolute — a path the reader cannot locate is worse than a long
 * one.
 */
export function formatPath(
  input: string | undefined,
  options: { base: string; home?: string; forwardSlashes?: boolean },
): string {
  if (!input) return ""
  const windows = windowsPath(options.base)
  // A Windows path against a posix base cannot be resolved sensibly; show it.
  if (!windows && windowsPath(input)) {
    return options.forwardSlashes ? input.replaceAll("\\", "/") : input
  }

  const paths = windows ? path.win32 : path.posix
  const absolute = paths.isAbsolute(input) ? input : paths.resolve(options.base, input)
  const relative = paths.relative(options.base, absolute)
  const formatted = !relative
    ? "."
    : relative !== ".." && !relative.startsWith(".." + paths.sep) && !paths.isAbsolute(relative)
      ? relative
      : options.home
        ? abbreviateHome(absolute, options.home)
        : absolute
  return options.forwardSlashes ? formatted.replaceAll("\\", "/") : formatted
}
