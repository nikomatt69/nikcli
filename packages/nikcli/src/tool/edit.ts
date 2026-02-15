import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./edit.txt"
import { File } from "../file"
import { Bus } from "../bus"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectory } from "./external-directory"

const MAX_DIAGNOSTICS_PER_FILE = 20
const WHITESPACE_RUN_REGEX = /\s+/g
const WHITESPACE_SPLIT_REGEX = /\s+/
const REGEX_ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g
const LEADING_WHITESPACE_REGEX = /^(\s*)/
const UNESCAPE_STRING_REGEX = /\\(n|t|r|'|"|`|\\|\n|\$)/g

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

export const EditTool = Tool.define("edit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().describe("The text to replace"),
    newString: z.string().describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
  }),
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
    await FileTime.withLock(filePath, async () => {
      if (params.oldString === "") {
        contentNew = params.newString
        diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))
        await ctx.ask({
          permission: "edit",
          patterns: [path.relative(Instance.worktree, filePath)],
          always: ["*"],
          metadata: {
            filepath: filePath,
            diff,
          },
        })
        await Bun.write(filePath, params.newString)
        await Bus.publish(File.Event.Edited, {
          file: filePath,
        })
        FileTime.read(ctx.sessionID, filePath)
        return
      }

      const file = Bun.file(filePath)
      const stats = await file.stat().catch(() => {})
      if (!stats) throw new Error(`File ${filePath} not found`)
      if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)
      await FileTime.assert(ctx.sessionID, filePath)
      contentOld = await file.text()
      contentNew = replace(contentOld, params.oldString, params.newString, params.replaceAll)

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
        },
      })

      await file.write(contentNew)
      await Bus.publish(File.Event.Edited, {
        file: filePath,
      })
      contentNew = await file.text()
      diff = trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      )
      FileTime.read(ctx.sessionID, filePath)
    })

    const filediff: Snapshot.FileDiff = {
      file: filePath,
      before: contentOld,
      after: contentNew,
      additions: 0,
      deletions: 0,
    }
    for (const change of diffLines(contentOld, contentNew)) {
      if (change.added) filediff.additions += change.count || 0
      if (change.removed) filediff.deletions += change.count || 0
    }

    ctx.metadata({
      metadata: {
        diff,
        filediff,
        diagnostics: {},
      },
    })

    let output = "Edit applied successfully."
    await LSP.touchFile(filePath, true)
    const diagnostics = await LSP.diagnostics()
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

export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  let notFound = true

  for (const replacer of [
    SimpleReplacer,
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
      notFound = false
      if (replaceAll) {
        return content.replaceAll(search, newString)
      }
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue
      return content.substring(0, index) + newString + content.substring(index + search.length)
    }
  }

  if (notFound) {
    throw new Error(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
    )
  }
  throw new Error("Found multiple matches for oldString. Provide more surrounding context to make the match unique.")
}
