import * as path from "path"
import * as fs from "fs/promises"
import { readFileSync } from "fs"
import { Log } from "../util/log"
import { Schema } from "effect"
import { zodObject } from "@/util/effect-zod"

export namespace Patch {
  const log = Log.create({ service: "patch" })

  const PatchSchemaEffect = Schema.Struct({
    patchText: Schema.String.annotations({ description: "The full patch text that describes all changes to be made" }),
  }).annotations({ identifier: "ApplyPatchParams" })
  export const PatchSchema = zodObject(PatchSchemaEffect)

  export type PatchParams = Schema.Schema.Type<typeof PatchSchemaEffect>

  export interface ApplyPatchArgs {
    patch: string
    hunks: Hunk[]
    workdir?: string
  }

  export type Hunk =
    | { type: "add"; path: string; contents: string }
    | { type: "delete"; path: string }
    | { type: "update"; path: string; move_path?: string; chunks: UpdateFileChunk[] }

  export interface UpdateFileChunk {
    old_lines: string[]
    new_lines: string[]
    change_context?: string
    is_end_of_file?: boolean
  }

  export interface ApplyPatchAction {
    changes: Map<string, ApplyPatchFileChange>
    patch: string
    cwd: string
  }

  export type ApplyPatchFileChange =
    | { type: "add"; content: string }
    | { type: "delete"; content: string }
    | { type: "update"; unified_diff: string; move_path?: string; new_content: string }

  export interface AffectedPaths {
    added: string[]
    modified: string[]
    deleted: string[]
  }

  export enum ApplyPatchError {
    ParseError = "ParseError",
    IoError = "IoError",
    ComputeReplacements = "ComputeReplacements",
    ImplicitInvocation = "ImplicitInvocation",
  }

  export enum MaybeApplyPatch {
    Body = "Body",
    ShellParseError = "ShellParseError",
    PatchParseError = "PatchParseError",
    NotApplyPatch = "NotApplyPatch",
  }

  export enum MaybeApplyPatchVerified {
    Body = "Body",
    ShellParseError = "ShellParseError",
    CorrectnessError = "CorrectnessError",
    NotApplyPatch = "NotApplyPatch",
  }

  function parsePatchHeader(
    lines: string[],
    startIdx: number,
  ): { filePath: string; movePath?: string; nextIdx: number } | null {
    const line = lines[startIdx]

    if (line.startsWith("*** Add File:")) {
      const filePath = line.split(":", 2)[1]?.trim()
      return filePath ? { filePath, nextIdx: startIdx + 1 } : null
    }

    if (line.startsWith("*** Delete File:")) {
      const filePath = line.split(":", 2)[1]?.trim()
      return filePath ? { filePath, nextIdx: startIdx + 1 } : null
    }

    if (line.startsWith("*** Update File:")) {
      const filePath = line.split(":", 2)[1]?.trim()
      let movePath: string | undefined
      let nextIdx = startIdx + 1

      if (nextIdx < lines.length && lines[nextIdx].startsWith("*** Move to:")) {
        movePath = lines[nextIdx].split(":", 2)[1]?.trim()
        nextIdx++
      }

      return filePath ? { filePath, movePath, nextIdx } : null
    }

    return null
  }

  function parseUpdateFileChunks(lines: string[], startIdx: number): { chunks: UpdateFileChunk[]; nextIdx: number } {
    const chunks: UpdateFileChunk[] = []
    let i = startIdx

    while (i < lines.length && !lines[i].startsWith("***")) {
      if (lines[i].startsWith("@@")) {
        const contextLine = lines[i].substring(2).trim()
        i++

        const oldLines: string[] = []
        const newLines: string[] = []
        let isEndOfFile = false

        while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("***")) {
          const changeLine = lines[i]

          if (changeLine === "*** End of File") {
            isEndOfFile = true
            i++
            break
          }

          if (changeLine.startsWith(" ")) {
            const content = changeLine.substring(1)
            oldLines.push(content)
            newLines.push(content)
          } else if (changeLine.startsWith("-")) {
            oldLines.push(changeLine.substring(1))
          } else if (changeLine.startsWith("+")) {
            newLines.push(changeLine.substring(1))
          }

          i++
        }

        chunks.push({
          old_lines: oldLines,
          new_lines: newLines,
          change_context: contextLine || undefined,
          is_end_of_file: isEndOfFile || undefined,
        })
      } else {
        i++
      }
    }

    return { chunks, nextIdx: i }
  }

  function parseAddFileContent(lines: string[], startIdx: number): { content: string; nextIdx: number } {
    let content = ""
    let i = startIdx

    while (i < lines.length && !lines[i].startsWith("***")) {
      if (lines[i].startsWith("+")) {
        content += lines[i].substring(1) + "\n"
      }
      i++
    }

    if (content.endsWith("\n")) {
      content = content.slice(0, -1)
    }

    return { content, nextIdx: i }
  }

  function stripHeredoc(input: string): string {
    const heredocMatch = input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/)
    if (heredocMatch) {
      return heredocMatch[2]
    }
    return input
  }

  export function parsePatch(patchText: string): { hunks: Hunk[] } {
    const cleaned = stripHeredoc(patchText.trim())
    const lines = cleaned.split("\n")
    const hunks: Hunk[] = []
    let i = 0

    const beginMarker = "*** Begin Patch"
    const endMarker = "*** End Patch"

    const beginIdx = lines.findIndex((line) => line.trim() === beginMarker)
    const endIdx = lines.findIndex((line) => line.trim() === endMarker)

    if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
      throw new Error("Invalid patch format: missing Begin/End markers")
    }

    i = beginIdx + 1

    while (i < endIdx) {
      const header = parsePatchHeader(lines, i)
      if (!header) {
        i++
        continue
      }

      if (lines[i].startsWith("*** Add File:")) {
        const { content, nextIdx } = parseAddFileContent(lines, header.nextIdx)
        hunks.push({
          type: "add",
          path: header.filePath,
          contents: content,
        })
        i = nextIdx
      } else if (lines[i].startsWith("*** Delete File:")) {
        hunks.push({
          type: "delete",
          path: header.filePath,
        })
        i = header.nextIdx
      } else if (lines[i].startsWith("*** Update File:")) {
        const { chunks, nextIdx } = parseUpdateFileChunks(lines, header.nextIdx)
        hunks.push({
          type: "update",
          path: header.filePath,
          move_path: header.movePath,
          chunks,
        })
        i = nextIdx
      } else {
        i++
      }
    }

    return { hunks }
  }

  export function maybeParseApplyPatch(
    argv: string[],
  ):
    | { type: MaybeApplyPatch.Body; args: ApplyPatchArgs }
    | { type: MaybeApplyPatch.PatchParseError; error: Error }
    | { type: MaybeApplyPatch.NotApplyPatch } {
    const APPLY_PATCH_COMMANDS = ["apply_patch", "applypatch"]

    if (argv.length === 2 && APPLY_PATCH_COMMANDS.includes(argv[0])) {
      try {
        const { hunks } = parsePatch(argv[1])
        return {
          type: MaybeApplyPatch.Body,
          args: {
            patch: argv[1],
            hunks,
          },
        }
      } catch (error) {
        return {
          type: MaybeApplyPatch.PatchParseError,
          error: error as Error,
        }
      }
    }

    if (argv.length === 3 && argv[0] === "bash" && argv[1] === "-lc") {
      const script = argv[2]
      const heredocMatch = script.match(/apply_patch\s*<<['"](\w+)['"]\s*\n([\s\S]*?)\n\1/)

      if (heredocMatch) {
        const patchContent = heredocMatch[2]
        try {
          const { hunks } = parsePatch(patchContent)
          return {
            type: MaybeApplyPatch.Body,
            args: {
              patch: patchContent,
              hunks,
            },
          }
        } catch (error) {
          return {
            type: MaybeApplyPatch.PatchParseError,
            error: error as Error,
          }
        }
      }
    }

    return { type: MaybeApplyPatch.NotApplyPatch }
  }

  interface ApplyPatchFileUpdate {
    unified_diff: string
    content: string
  }

  export function deriveNewContentsFromChunks(filePath: string, chunks: UpdateFileChunk[]): ApplyPatchFileUpdate {
    let originalContent: string
    try {
      originalContent = readFileSync(filePath, "utf-8")
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`)
    }

    let originalLines = originalContent.split("\n")

    if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
      originalLines.pop()
    }

    const replacements = computeReplacements(originalLines, filePath, chunks)
    let newLines = applyReplacements(originalLines, replacements)

    if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
      newLines.push("")
    }

    const newContent = newLines.join("\n")
    const unifiedDiff = generateUnifiedDiff(originalContent, newContent)

    return {
      unified_diff: unifiedDiff,
      content: newContent,
    }
  }

  function computeReplacements(
    originalLines: string[],
    filePath: string,
    chunks: UpdateFileChunk[],
  ): Array<[number, number, string[]]> {
    const replacements: Array<[number, number, string[]]> = []
    let lineIndex = 0

    for (const chunk of chunks) {
      if (chunk.change_context) {
        const contextIdx = seekSequence(originalLines, [chunk.change_context], lineIndex)
        if (contextIdx === -1) {
          throw new Error(`Failed to find context '${chunk.change_context}' in ${filePath}`)
        }
        lineIndex = contextIdx + 1
      }

      if (chunk.old_lines.length === 0) {
        const insertionIdx =
          originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
            ? originalLines.length - 1
            : originalLines.length
        replacements.push([insertionIdx, 0, chunk.new_lines])
        continue
      }

      let pattern = chunk.old_lines
      let newSlice = chunk.new_lines
      let found = seekSequence(originalLines, pattern, lineIndex, chunk.is_end_of_file)

      if (found === -1 && pattern.length > 0 && pattern[pattern.length - 1] === "") {
        pattern = pattern.slice(0, -1)
        if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
          newSlice = newSlice.slice(0, -1)
        }
        found = seekSequence(originalLines, pattern, lineIndex, chunk.is_end_of_file)
      }

      if (found !== -1) {
        replacements.push([found, pattern.length, newSlice])
        lineIndex = found + pattern.length
      } else {
        throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.old_lines.join("\n")}`)
      }
    }

    replacements.sort((a, b) => a[0] - b[0])

    return replacements
  }

  function applyReplacements(lines: string[], replacements: Array<[number, number, string[]]>): string[] {
    const result = [...lines]

    for (let i = replacements.length - 1; i >= 0; i--) {
      const [startIdx, oldLen, newSegment] = replacements[i]

      result.splice(startIdx, oldLen)

      for (let j = 0; j < newSegment.length; j++) {
        result.splice(startIdx + j, 0, newSegment[j])
      }
    }

    return result
  }

  function normalizeUnicode(str: string): string {
    return str
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\u00A0/g, " ")
  }

  type Comparator = (a: string, b: string) => boolean

  function tryMatch(lines: string[], pattern: string[], startIndex: number, compare: Comparator, eof: boolean): number {
    if (eof) {
      const fromEnd = lines.length - pattern.length
      if (fromEnd >= startIndex) {
        let matches = true
        for (let j = 0; j < pattern.length; j++) {
          if (!compare(lines[fromEnd + j], pattern[j])) {
            matches = false
            break
          }
        }
        if (matches) return fromEnd
      }
    }

    for (let i = startIndex; i <= lines.length - pattern.length; i++) {
      let matches = true
      for (let j = 0; j < pattern.length; j++) {
        if (!compare(lines[i + j], pattern[j])) {
          matches = false
          break
        }
      }
      if (matches) return i
    }

    return -1
  }

  function seekSequence(lines: string[], pattern: string[], startIndex: number, eof = false): number {
    if (pattern.length === 0) return -1

    const exact = tryMatch(lines, pattern, startIndex, (a, b) => a === b, eof)
    if (exact !== -1) return exact

    const rstrip = tryMatch(lines, pattern, startIndex, (a, b) => a.trimEnd() === b.trimEnd(), eof)
    if (rstrip !== -1) return rstrip

    const trim = tryMatch(lines, pattern, startIndex, (a, b) => a.trim() === b.trim(), eof)
    if (trim !== -1) return trim

    const normalized = tryMatch(
      lines,
      pattern,
      startIndex,
      (a, b) => normalizeUnicode(a.trim()) === normalizeUnicode(b.trim()),
      eof,
    )
    return normalized
  }

  function generateUnifiedDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split("\n")
    const newLines = newContent.split("\n")

    let diff = "@@ -1 +1 @@\n"

    const maxLen = Math.max(oldLines.length, newLines.length)
    let hasChanges = false

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i] || ""
      const newLine = newLines[i] || ""

      if (oldLine !== newLine) {
        if (oldLine) diff += `-${oldLine}\n`
        if (newLine) diff += `+${newLine}\n`
        hasChanges = true
      } else if (oldLine) {
        diff += ` ${oldLine}\n`
      }
    }

    return hasChanges ? diff : ""
  }

  export async function applyHunksToFiles(hunks: Hunk[]): Promise<AffectedPaths> {
    if (hunks.length === 0) {
      throw new Error("No files were modified.")
    }

    const added: string[] = []
    const modified: string[] = []
    const deleted: string[] = []

    for (const hunk of hunks) {
      switch (hunk.type) {
        case "add":
          const addDir = path.dirname(hunk.path)
          if (addDir !== "." && addDir !== "/") {
            await fs.mkdir(addDir, { recursive: true })
          }

          await fs.writeFile(hunk.path, hunk.contents, "utf-8")
          added.push(hunk.path)
          log.info(`Added file: ${hunk.path}`)
          break

        case "delete":
          await fs.unlink(hunk.path)
          deleted.push(hunk.path)
          log.info(`Deleted file: ${hunk.path}`)
          break

        case "update":
          const fileUpdate = deriveNewContentsFromChunks(hunk.path, hunk.chunks)

          if (hunk.move_path) {
            const moveDir = path.dirname(hunk.move_path)
            if (moveDir !== "." && moveDir !== "/") {
              await fs.mkdir(moveDir, { recursive: true })
            }

            await fs.writeFile(hunk.move_path, fileUpdate.content, "utf-8")
            await fs.unlink(hunk.path)
            modified.push(hunk.move_path)
            log.info(`Moved file: ${hunk.path} -> ${hunk.move_path}`)
          } else {
            await fs.writeFile(hunk.path, fileUpdate.content, "utf-8")
            modified.push(hunk.path)
            log.info(`Updated file: ${hunk.path}`)
          }
          break
      }
    }

    return { added, modified, deleted }
  }

  export async function applyPatch(patchText: string): Promise<AffectedPaths> {
    const { hunks } = parsePatch(patchText)
    return applyHunksToFiles(hunks)
  }

  export async function maybeParseApplyPatchVerified(
    argv: string[],
    cwd: string,
  ): Promise<
    | { type: MaybeApplyPatchVerified.Body; action: ApplyPatchAction }
    | { type: MaybeApplyPatchVerified.CorrectnessError; error: Error }
    | { type: MaybeApplyPatchVerified.NotApplyPatch }
  > {
    if (argv.length === 1) {
      try {
        parsePatch(argv[0])
        return {
          type: MaybeApplyPatchVerified.CorrectnessError,
          error: new Error(ApplyPatchError.ImplicitInvocation),
        }
      } catch {
      }
    }

    const result = maybeParseApplyPatch(argv)

    switch (result.type) {
      case MaybeApplyPatch.Body:
        const { args } = result
        const effectiveCwd = args.workdir ? path.resolve(cwd, args.workdir) : cwd
        const changes = new Map<string, ApplyPatchFileChange>()

        for (const hunk of args.hunks) {
          const resolvedPath = path.resolve(
            effectiveCwd,
            hunk.type === "update" && hunk.move_path ? hunk.move_path : hunk.path,
          )

          switch (hunk.type) {
            case "add":
              changes.set(resolvedPath, {
                type: "add",
                content: hunk.contents,
              })
              break

            case "delete":
              const deletePath = path.resolve(effectiveCwd, hunk.path)
              try {
                const content = await fs.readFile(deletePath, "utf-8")
                changes.set(resolvedPath, {
                  type: "delete",
                  content,
                })
              } catch (error) {
                return {
                  type: MaybeApplyPatchVerified.CorrectnessError,
                  error: new Error(`Failed to read file for deletion: ${deletePath}`),
                }
              }
              break

            case "update":
              const updatePath = path.resolve(effectiveCwd, hunk.path)
              try {
                const fileUpdate = deriveNewContentsFromChunks(updatePath, hunk.chunks)
                changes.set(resolvedPath, {
                  type: "update",
                  unified_diff: fileUpdate.unified_diff,
                  move_path: hunk.move_path ? path.resolve(effectiveCwd, hunk.move_path) : undefined,
                  new_content: fileUpdate.content,
                })
              } catch (error) {
                return {
                  type: MaybeApplyPatchVerified.CorrectnessError,
                  error: error as Error,
                }
              }
              break
          }
        }

        return {
          type: MaybeApplyPatchVerified.Body,
          action: {
            changes,
            patch: args.patch,
            cwd: effectiveCwd,
          },
        }

      case MaybeApplyPatch.PatchParseError:
        return {
          type: MaybeApplyPatchVerified.CorrectnessError,
          error: result.error,
        }

      case MaybeApplyPatch.NotApplyPatch:
        return { type: MaybeApplyPatchVerified.NotApplyPatch }
    }
  }
}
