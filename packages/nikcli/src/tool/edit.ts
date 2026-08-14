import { Effect, Schema } from "effect"
import { zod } from "@nikcli-ai/util/effect-zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./edit.txt"
import { File } from "../file"
import { Bus } from "../bus"
import { FileTime } from "../file/time"
import { Filesystem } from "@nikcli-ai/util/filesystem"
import { Bom } from "../util/bom"
import { Format } from "../format"
import { Instance } from "../project/instance"
import { buildFileDiff, trimDiff } from "./file-diff"
import { assertExternalDirectory } from "./external-directory"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Log } from "@nikcli-ai/util/log"

const MAX_DIAGNOSTICS_PER_FILE = 20
const WHITESPACE_RUN_REGEX = /\s+/g
const WHITESPACE_SPLIT_REGEX = /\s+/
const REGEX_ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g
const LEADING_WHITESPACE_REGEX = /^(\s*)/
const UNESCAPE_STRING_REGEX = /\\(n|t|r|'|"|`|\\|\n|\$)/g
// Each of these maps one character to exactly one character, so normalizing preserves offsets
// into the original content and a match found in normalized text can be sliced out of the source.
const UNICODE_SINGLE_QUOTE_REGEX = /[\u2018\u2019\u201A\u201B]/g
const UNICODE_DOUBLE_QUOTE_REGEX = /[\u201C\u201D\u201E\u201F]/g
const UNICODE_DASH_REGEX = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g
const UNICODE_SPACE_REGEX = /[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g

function runLSP<A, E>(effect: Effect.Effect<A, E, LSP.Service>) {
  return runPromiseWithLayer(LSP.defaultLayer, withCurrentInstance(effect))
}

const log = Log.create({ service: "edit-tool" })

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "The absolute path to the file to modify",
  }),
  oldString: Schema.String.annotate({
    description: "Exact text to find and replace",
  }),
  newString: Schema.String.annotate({
    description: "Text to replace oldString with (must differ from oldString)",
  }),
  replaceAll: Schema.optional(Schema.Boolean).annotate({
    description:
      "Whether to replace every occurrence of oldString. When false, oldString must match exactly once. Defaults to false.",
  }),
})

export const EditTool = Tool.define("edit", {
  description: DESCRIPTION,
  parameters: zod(Parameters),
  async execute(params, ctx) {
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    if (params.oldString === params.newString) {
      throw new Error("No changes to apply: oldString and newString are identical.")
    }

    const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filePath)

    let diff = ""
    let contentOld = ""
    let contentNew = ""
    let replacements = 0
    await FileTime.withLock(filePath, async () => {
      if (params.oldString === "") {
        const replacement = Bom.split(params.newString)
        contentNew = replacement.text
        diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))
        await ctx.ask({
          permission: "edit",
          patterns: [path.relative(Instance.worktree, filePath)],
          always: ["*"],
          metadata: {
            filepath: filePath,
            diff,
            // Structured preview so the approval UI can render the change instead of a raw patch
            // string, and so the user approves what they can actually see.
            files: [
              buildFileDiff({
                file: filePath,
                before: contentOld,
                after: contentNew,
                patch: diff,
              }),
            ],
          },
        })
        await Bun.write(filePath, Bom.join(contentNew, replacement.bom))
        await Format.formatFile(filePath, replacement.bom)
        await Bus.publish(File.Event.Edited, {
          file: filePath,
        })
        contentNew = (await Bom.readFile(filePath)).text
        diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))
        await FileTime.read(ctx.sessionID, filePath)
        return
      }

      const file = Bun.file(filePath)
      const stats = await file.stat().catch(() => {})
      if (!stats) throw new Error(`File not found: ${filePath}`)
      if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)
      await FileTime.assert(ctx.sessionID, filePath)
      // opencode #39564: `Bun.file().text()` drops the BOM, so read it explicitly
      // and re-apply it below — otherwise every edit of a BOM file silently
      // corrupts its encoding.
      const original = await Bom.readFile(filePath)
      contentOld = original.text
      const applied = replaceWithCount(contentOld, params.oldString, params.newString, params.replaceAll, filePath)
      const replacement = Bom.split(applied.content)
      contentNew = replacement.text
      const writtenBom = original.bom || replacement.bom
      replacements = applied.replacements

      diff = trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      )
      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filePath)],
        always: ["*"],
        metadata: {
          filepath: filePath,
          diff,
          files: [
            buildFileDiff({
              file: filePath,
              before: contentOld,
              after: contentNew,
              patch: diff,
            }),
          ],
        },
      })

      await file.write(Bom.join(contentNew, writtenBom))
      await Format.formatFile(filePath, writtenBom)
      await Bus.publish(File.Event.Edited, {
        file: filePath,
      })
      contentNew = await file.text()
      diff = trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      )
      await FileTime.read(ctx.sessionID, filePath)
    })

    // `contentNew` was re-read after formatting, so the diff below describes
    // the file as it now exists.
    const filediff = buildFileDiff({
      file: filePath,
      before: contentOld,
      after: contentNew,
      patch: diff,
    })

    ctx.metadata({
      metadata: {
        diff,
        filediff,
        diagnostics: {},
      },
    })

    // State the blast radius: the model cannot tell a targeted fix from an accidental sweep
    // without it, and `replaceAll` edits are exactly where that goes wrong.
    let output =
      replacements === 0
        ? "Created file."
        : `Replaced ${replacements} ${replacements === 1 ? "occurrence" : "occurrences"} in ${path.relative(Instance.worktree, filePath)}.`
    const diagnostics = await runLSP(
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        yield* lsp.touchFile(filePath, true)
        return yield* lsp.diagnostics()
      }),
    ).catch((err) => {
      // LSP errors are non-fatal, log and continue
      log.debug("LSP diagnostics failed", { error: String(err), filePath })
      return {} as Record<string, LSP.Diagnostic[]>
    })
    const normalizedFilePath = Filesystem.normalizePath(filePath)
    const issues = diagnostics[normalizedFilePath] ?? []
    const errors = issues.filter((item) => item.severity === 1)
    if (errors.length > 0) {
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filePath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }

    return {
      metadata: {
        diagnostics,
        diff,
        filediff,
      },
      title: `${path.relative(Instance.worktree, filePath)}`,
      output,
    }
  },
})

// Re-exported so existing importers of `trimDiff` from this module keep working.
export { trimDiff }

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3

function levenshtein(a: string, b: string): number {
  if (a === "" || b === "") {
    return Math.max(a.length, b.length)
  }
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

export function normalizeUnicode(text: string): string {
  return text
    .replace(UNICODE_SINGLE_QUOTE_REGEX, "'")
    .replace(UNICODE_DOUBLE_QUOTE_REGEX, '"')
    .replace(UNICODE_DASH_REGEX, "-")
    .replace(UNICODE_SPACE_REGEX, " ")
}

/**
 * Matches text that differs from the file only by typographic Unicode variants — models routinely
 * echo curly quotes, en/em dashes, or non-breaking spaces where the source has ASCII, and vice
 * versa. Normalization is character-for-character, so offsets found in the normalized content index
 * the original content directly and the yielded search string is the untouched source substring.
 */
export const UnicodeNormalizedReplacer: Replacer = function* (content, find) {
  if (find === "") return
  const normalizedFind = normalizeUnicode(find)
  const normalizedContent = normalizeUnicode(content)
  // Nothing was normalizable on either side, so SimpleReplacer already covered this case.
  if (normalizedFind === find && normalizedContent === content) return

  let offset = 0
  while ((offset = normalizedContent.indexOf(normalizedFind, offset)) !== -1) {
    yield content.slice(offset, offset + normalizedFind.length)
    offset += normalizedFind.length
  }
}

export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim()
      const searchTrimmed = searchLines[j].trim()

      if (originalTrimmed !== searchTrimmed) {
        matches = false
        break
      }
    }

    if (matches) {
      let matchStartIndex = 0
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1
      }

      let matchEndIndex = matchStartIndex
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length
        if (k < searchLines.length - 1) {
          matchEndIndex += 1
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex)
    }
  }
}

export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines.length < 3) {
    return
  }

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length

  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue
    }

    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j })
        break
      }
    }
  }

  if (candidates.length === 0) {
    return
  }

  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += (1 - distance / maxLen) / linesToCheck

        if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
          break
        }
      }
    } else {
      similarity = 1.0
    }

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      let matchStartIndex = 0
      for (let k = 0; k < startLine; k++) {
        matchStartIndex += originalLines[k].length + 1
      }
      let matchEndIndex = matchStartIndex
      for (let k = startLine; k <= endLine; k++) {
        matchEndIndex += originalLines[k].length
        if (k < endLine) {
          matchEndIndex += 1
        }
      }
      yield content.substring(matchStartIndex, matchEndIndex)
    }
    return
  }

  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1

  for (const candidate of candidates) {
    const { startLine, endLine } = candidate
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += 1 - distance / maxLen
      }
      similarity /= linesToCheck
    } else {
      similarity = 1.0
    }

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }

  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch
    let matchStartIndex = 0
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1
    }
    let matchEndIndex = matchStartIndex
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length
      if (k < endLine) {
        matchEndIndex += 1
      }
    }
    yield content.substring(matchStartIndex, matchEndIndex)
  }
}

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(WHITESPACE_RUN_REGEX, " ").trim()
  const normalizedFind = normalizeWhitespace(find)
  const trimmedFind = find.trim()
  const words = trimmedFind ? trimmedFind.split(WHITESPACE_SPLIT_REGEX) : []
  let wordsRegex: RegExp | undefined
  if (words.length > 0) {
    const pattern = words.map((word) => word.replace(REGEX_ESCAPE_REGEX, "\\$&")).join("\\s+")
    try {
      wordsRegex = new RegExp(pattern)
    } catch {
      wordsRegex = undefined
    }
  }

  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
    } else {
      const normalizedLine = normalizeWhitespace(line)
      if (normalizedLine.includes(normalizedFind)) {
        if (wordsRegex) {
          const match = line.match(wordsRegex)
          if (match) yield match[0]
        }
      }
    }
  }

  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (normalizeWhitespace(block.join("\n")) === normalizedFind) {
        yield block.join("\n")
      }
    }
  }
}

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split("\n")
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    if (nonEmptyLines.length === 0) return text

    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(LEADING_WHITESPACE_REGEX)
        return match ? match[1].length : 0
      }),
    )

    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n")
  }

  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (str: string): string => {
    return str.replace(UNESCAPE_STRING_REGEX, (match, capturedChar) => {
      switch (capturedChar) {
        case "n":
          return "\n"
        case "t":
          return "\t"
        case "r":
          return "\r"
        case "'":
          return "'"
        case '"':
          return '"'
        case "`":
          return "`"
        case "\\":
          return "\\"
        case "\n":
          return "\n"
        case "$":
          return "$"
        default:
          return match
      }
    })
  }

  const unescapedFind = unescapeString(find)

  if (content.includes(unescapedFind)) {
    yield unescapedFind
  }

  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    const unescapedBlock = unescapeString(block)

    if (unescapedBlock === unescapedFind) {
      yield block
    }
  }
}

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  let startIndex = 0

  while (true) {
    const index = content.indexOf(find, startIndex)
    if (index === -1) break

    yield find
    startIndex = index + find.length
  }
}

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim()

  if (trimmedFind === find) {
    return
  }

  if (content.includes(trimmedFind)) {
    yield trimmedFind
  }

  const lines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")

    if (block.trim() === trimmedFind) {
      yield block
    }
  }
}

export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n")
  if (findLines.length < 3) {
    return
  }

  if (findLines[findLines.length - 1] === "") {
    findLines.pop()
  }

  const contentLines = content.split("\n")

  const firstLine = findLines[0].trim()
  const lastLine = findLines[findLines.length - 1].trim()

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue

    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastLine) {
        const blockLines = contentLines.slice(i, j + 1)
        const block = blockLines.join("\n")

        if (blockLines.length === findLines.length) {
          let matchingLines = 0
          let totalNonEmptyLines = 0

          for (let k = 1; k < blockLines.length - 1; k++) {
            const blockLine = blockLines[k].trim()
            const findLine = findLines[k].trim()

            if (blockLine.length > 0 || findLine.length > 0) {
              totalNonEmptyLines++
              if (blockLine === findLine) {
                matchingLines++
              }
            }
          }

          if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
            yield block
            break
          }
        }
        break
      }
    }
  }
}

function countOccurrences(content: string, search: string): number {
  if (search === "") return 0
  let count = 0
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    count++
    offset += search.length
  }
  return count
}

export type ReplaceResult = {
  readonly content: string
  /** How many occurrences were actually replaced. */
  readonly replacements: number
}

/**
 * Applies an edit and reports how much it changed.
 *
 * The count matters to the model: "replaced 1 occurrence" versus "replaced 14" is the difference
 * between a targeted fix and an accidental sweep, and it cannot tell them apart from a success
 * message alone. Failures carry the same principle — an ambiguous match reports *how many* places
 * matched, so the model knows how much more context to add rather than guessing.
 */
export function replaceWithCount(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
  filePath?: string,
): ReplaceResult {
  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  const target = filePath ? ` in ${filePath}` : ""
  let ambiguousMatches = 0

  for (const replacer of [
    SimpleReplacer,
    UnicodeNormalizedReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      if (replaceAll) {
        return {
          content: content.replaceAll(search, newString),
          replacements: countOccurrences(content, search),
        }
      }
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) {
        // Remember the widest ambiguity seen so the error can quantify it.
        ambiguousMatches = Math.max(ambiguousMatches, countOccurrences(content, search))
        continue
      }
      return {
        content: content.substring(0, index) + newString + content.substring(index + search.length),
        replacements: 1,
      }
    }
  }

  if (ambiguousMatches === 0) {
    throw new Error(
      `Could not find oldString${target}. It must match exactly, including whitespace, indentation, and line endings.`,
    )
  }
  throw new Error(
    `Found ${ambiguousMatches} matches for oldString${target}. Provide more surrounding context to make the match unique, or pass replaceAll: true to replace all ${ambiguousMatches}.`,
  )
}

/** Back-compatible wrapper for callers that only need the resulting content. */
export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  return replaceWithCount(content, oldString, newString, replaceAll).content
}
