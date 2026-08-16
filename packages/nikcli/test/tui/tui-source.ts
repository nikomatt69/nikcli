import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * One place that knows where the TUI source lives.
 *
 * Seven tests in this directory assert against the source *text* rather than by
 * mounting components — mounting drags in the whole TUI, which is the trade each
 * of them documents. Every one of them spelled `../../src/cli/cmd/tui/…` itself,
 * which would have made the tree move (`specs/tui-package.md` §4) a seven-file
 * edit with one silent failure mode: `Bun.Glob.scan` over a cwd that no longer
 * exists yields nothing, so an asserted-absence test passes *vacuously*. A
 * missing file read fails loudly; a missing directory scan does not.
 *
 * The move happened, and this was the one line it cost here. The existence check
 * below turns the silent case into an import-time error.
 *
 * `URL.pathname` is `/C:/…` on Windows — the leading slash makes the path
 * unopenable. `fileURLToPath` yields a native path on every platform.
 */

/** `packages/nikcli/src/`. */
export const SRC = fileURLToPath(new URL("../../src/", import.meta.url))

/** The TUI tree. Update this one line when the tree moves. */
export const TUI_SRC = fileURLToPath(new URL("../../../tui/src/", import.meta.url))

if (!existsSync(TUI_SRC)) {
  throw new Error(
    `TUI source root not found at ${TUI_SRC}. If the tree moved, update TUI_SRC in test/tui/tui-source.ts — ` +
      `source-reading tests silently stop asserting anything when it is wrong.`,
  )
}

/** Read a file under `packages/nikcli/src/`. */
export async function source(file: string) {
  return await Bun.file(SRC + file).text()
}

/** Read a file under the TUI tree. */
export async function tuiSource(file: string) {
  return await Bun.file(TUI_SRC + file).text()
}

/** Strip comments: they explain the trap by name, so assertions must see code only. */
export function stripComments(text: string) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}
