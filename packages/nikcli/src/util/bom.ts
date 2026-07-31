/**
 * UTF-8 BOM handling shared by the mutation tools (write, edit, apply_patch)
 * and the formatter runtime.
 *
 * Ported from opencode #39564 (`feat(core): add V2 formatter runtime`):
 * - `split`/`join`/`has` keep BOM state explicit instead of relying on
 *   TextDecoder defaults, which silently drop the BOM.
 * - `readFile` decodes with `ignoreBOM` so callers get the raw text plus the
 *   BOM flag, and can re-apply it on write.
 * - `syncFile` restores a desired BOM state after a formatter rewrote the
 *   file (formatters routinely strip or add the BOM), without touching the
 *   file when the state already matches.
 */

const code = 0xfeff
const value = String.fromCharCode(code)

/** Namespace export so `import { Bom } from "../util/bom"` reads like the PR's `@opencode-ai/util/bom`. */
export const Bom = {
  split,
  join,
  has,
  readFile,
  syncFile,
}

export function split(text: string) {
  const stripped = text.replace(/^\uFEFF+/, "")
  return { bom: stripped.length !== text.length, text: stripped }
}

export function join(text: string, bom: boolean) {
  const stripped = split(text).text
  return bom ? value + stripped : stripped
}

export function has(content: Uint8Array) {
  return content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
}

/** Reads a file as `{ text, bom }` with the BOM stripped from `text`. */
export async function readFile(filepath: string) {
  const content = await Bun.file(filepath).arrayBuffer()
  return split(decode(content))
}

/**
 * Ensures `filepath` carries exactly the given BOM state. Returns the
 * BOM-stripped text and leaves the file untouched when it already matches.
 */
export async function syncFile(filepath: string, bom: boolean) {
  const content = await Bun.file(filepath).arrayBuffer()
  const decoded = decode(content)
  const current = split(decoded)
  const canonical = join(current.text, bom)
  if (decoded === canonical) return current.text
  await Bun.write(filepath, canonical)
  return current.text
}

function decode(content: ArrayBuffer) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(content)
}
