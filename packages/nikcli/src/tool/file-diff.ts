import { createTwoFilesPatch, diffLines } from "diff"
import type { Snapshot } from "@/snapshot"

const LEADING_WHITESPACE_REGEX = /^(\s*)/

/**
 * Strips the common leading indentation shared by every content line of a unified diff, so
 * deeply nested hunks read without a wall of leading whitespace.
 */
export function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )

  if (contentLines.length === 0) return diff

  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(LEADING_WHITESPACE_REGEX)
      if (match) min = Math.min(min, match[1].length)
    }
  }
  if (min === Infinity || min === 0) return diff
  const trimmedLines = lines.map((line) => {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const prefix = line[0]
      const content = line.slice(1)
      return prefix + content.slice(min)
    }
    return line
  })

  return trimmedLines.join("\n")
}



/**
 * Shared construction of the `FileDiff` that write, edit and patch hand back to the model and the
 * TUI, so the three mutation tools cannot drift on patch text, line counts or status selection.
 */
export function buildFileDiff(input: {
  readonly file: string
  readonly before: string
  readonly after: string
  /** Pre-computed patch text, when the caller already rendered one (e.g. with normalized line endings). */
  readonly patch?: string
}): Snapshot.FileDiff {
  const result: Snapshot.FileDiff = {
    file: input.file,
    patch: input.patch ?? trimDiff(createTwoFilesPatch(input.file, input.file, input.before, input.after)),
    before: input.before,
    after: input.after,
    additions: 0,
    deletions: 0,
    status: input.before === "" && input.after !== "" ? "added" : "modified",
  }
  for (const change of diffLines(input.before, input.after)) {
    if (change.added) result.additions += change.count || 0
    if (change.removed) result.deletions += change.count || 0
  }
  return result
}

/**
 * Reads a file back after a mutation has been published.
 *
 * Formatters run as subscribers of `File.Event.Edited`, and `Bus.publish` awaits them, so by the
 * time a mutation tool reaches this point the file on disk is the *formatted* result. Reporting the
 * content the tool wrote instead would hand the model a diff that no longer matches the file, and
 * the next edit against that stale text would fail to match.
 */
export async function readAfterMutation(file: string, fallback: string): Promise<string> {
  return await Bun.file(file)
    .text()
    .catch(() => fallback)
}
