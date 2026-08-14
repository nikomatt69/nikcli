import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"
import { Instance } from "../project/instance"
import { Patch } from "../patch"
import { createTwoFilesPatch, diffLines } from "diff"
import { assertExternalDirectory } from "./external-directory"
import { buildFileDiff, readAfterMutation, trimDiff } from "./file-diff"
import { Bom } from "../util/bom"
import { Format } from "../format"
import { LSP } from "../lsp"
import { Filesystem } from "@nikcli-ai/util/filesystem"
import DESCRIPTION from "./apply_patch.txt"
import { File } from "../file"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

function runLSP<A, E>(effect: Effect.Effect<A, E, LSP.Service>) {
  return runPromiseWithLayer(LSP.defaultLayer, withCurrentInstance(effect))
}

const PatchParams = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
})

export const ApplyPatchTool = Tool.define("apply_patch", {
  description: DESCRIPTION,
  parameters: PatchParams,
  async execute(params, ctx) {
    if (!params.patchText) {
      throw new Error("patchText is required")
    }

    // Parse the patch to get hunks
    let hunks: Patch.Hunk[]
    try {
      const parseResult = Patch.parsePatch(params.patchText)
      hunks = parseResult.hunks
    } catch (error) {
      throw new Error(`apply_patch verification failed: ${error}`)
    }

    if (hunks.length === 0) {
      const normalized = params.patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
      if (normalized === "*** Begin Patch\n*** End Patch") {
        throw new Error("patch rejected: empty patch")
      }
      throw new Error("apply_patch verification failed: no hunks found")
    }

    // Validate file paths and check permissions
    const fileChanges: Array<{
      filePath: string
      oldContent: string
      newContent: string
      type: "add" | "update" | "delete" | "move"
      movePath?: string
      diff: string
      additions: number
      deletions: number
      oldBom?: boolean
    }> = []

    let totalDiff = ""

    for (const hunk of hunks) {
      const filePath = path.resolve(Instance.directory, hunk.path)
      await assertExternalDirectory(ctx, filePath)

      switch (hunk.type) {
        case "add": {
          const oldContent = ""
          // opencode #39564: added content is normalized to BOM-free text so
          // the before/after sides of every diff are BOM-consistent.
          const newContent = Bom.split(
            hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`,
          ).text
          const diff = trimDiff(createTwoFilesPatch(filePath, filePath, oldContent, newContent))

          let additions = 0
          let deletions = 0
          for (const change of diffLines(oldContent, newContent)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }

          fileChanges.push({
            filePath,
            oldContent,
            newContent,
            type: "add",
            diff,
            additions,
            deletions,
          })

          totalDiff += diff + "\n"
          break
        }

        case "update": {
          // Check if file exists for update
          const stats = await fs.stat(filePath).catch(() => null)
          if (!stats || stats.isDirectory()) {
            throw new Error(`apply_patch verification failed: Failed to read file to update: ${filePath}`)
          }

          // opencode #39564: read the BOM explicitly and re-apply it on write,
          // so patching a BOM file (and the formatter that runs afterwards)
          // cannot corrupt its encoding.
          const original = await Bom.readFile(filePath)
          const oldContent = original.text
          let newContent = oldContent

          // Apply the update chunks to get new content
          try {
            const fileUpdate = Patch.deriveNewContentsFromChunks(filePath, hunk.chunks, original.text)
            newContent = fileUpdate.content
          } catch (error) {
            throw new Error(`apply_patch verification failed: ${error}`)
          }

          const diff = trimDiff(createTwoFilesPatch(filePath, filePath, oldContent, newContent))

          let additions = 0
          let deletions = 0
          for (const change of diffLines(oldContent, newContent)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }

          const movePath = hunk.move_path ? path.resolve(Instance.directory, hunk.move_path) : undefined
          await assertExternalDirectory(ctx, movePath)

          fileChanges.push({
            filePath,
            oldContent,
            newContent,
            type: hunk.move_path ? "move" : "update",
            movePath,
            diff,
            additions,
            deletions,
            oldBom: original.bom,
          })

          totalDiff += diff + "\n"
          break
        }

        case "delete": {
          const contentToDelete = (await Bom.readFile(filePath)).text
          const deleteDiff = trimDiff(createTwoFilesPatch(filePath, filePath, contentToDelete, ""))

          const deletions = contentToDelete.split("\n").length

          fileChanges.push({
            filePath,
            oldContent: contentToDelete,
            newContent: "",
            type: "delete",
            diff: deleteDiff,
            additions: 0,
            deletions,
          })

          totalDiff += deleteDiff + "\n"
          break
        }
      }
    }

    // Check permissions if needed — include move destinations so renames cannot
    // write outside authorized paths without an explicit allow.
    const permissionPatterns = [
      ...new Set(
        fileChanges.flatMap((c) => {
          const paths = [c.filePath]
          if (c.movePath) paths.push(c.movePath)
          return paths.map((p) => path.relative(Instance.worktree, p))
        }),
      ),
    ]
    await ctx.ask({
      permission: "edit",
      patterns: permissionPatterns,
      always: ["*"],
      metadata: {
        diff: totalDiff,
        // One structured preview per hunk, so a multi-file patch is reviewable file by file.
        files: fileChanges.map((change) =>
          buildFileDiff({
            file: change.movePath ?? change.filePath,
            before: change.oldContent,
            after: change.newContent,
            patch: change.diff,
          }),
        ),
      },
    })

    // Apply the changes
    const changedFiles: string[] = []

    for (const change of fileChanges) {
      const edited = change.type === "delete" ? undefined : (change.movePath ?? change.filePath)
      switch (change.type) {
        case "add":
          // Create parent directories (recursive: true is safe on existing/root dirs)
          await fs.mkdir(path.dirname(change.filePath), { recursive: true })
          await fs.writeFile(change.filePath, change.newContent, "utf-8")
          changedFiles.push(change.filePath)
          break

        case "update":
          // Re-apply the original BOM the patch pipeline normalized away
          // (opencode #39564).
          await fs.writeFile(change.filePath, Bom.join(change.newContent, change.oldBom ?? false), "utf-8")
          changedFiles.push(change.filePath)
          break

        case "move":
          if (change.movePath) {
            // Create parent directories (recursive: true is safe on existing/root dirs)
            await fs.mkdir(path.dirname(change.movePath), { recursive: true })
            await fs.writeFile(change.movePath, Bom.join(change.newContent, change.oldBom ?? false), "utf-8")
            await fs.unlink(change.filePath)
            changedFiles.push(change.movePath)
          }
          break

        case "delete":
          await fs.unlink(change.filePath)
          changedFiles.push(change.filePath)
          break
      }

      if (edited) {
        await Format.formatFile(edited, change.oldBom ?? false)
        await Bus.publish(File.Event.Edited, {
          file: edited,
        })
        // Re-read the formatted file and restate the hunk's diff from the final
        // result, otherwise the model's next edit against the text we reported
        // here will fail to match the file.
        const formatted = await readAfterMutation(edited, change.newContent)
        if (formatted !== change.newContent) {
          change.newContent = formatted
          const restated = buildFileDiff({
            file: edited,
            before: change.oldContent,
            after: formatted,
          })
          change.diff = restated.patch
          change.additions = restated.additions
          change.deletions = restated.deletions
        }
      }
    }

    // `totalDiff` was assembled from the pre-format hunks; restate it from the final contents.
    totalDiff = fileChanges.map((change) => change.diff).join("\n") + (fileChanges.length > 0 ? "\n" : "")

    // Publish file change events
    for (const filePath of changedFiles) {
      await Bus.publish(FileWatcher.Event.Updated, {
        file: filePath,
        event: "change",
      })
    }

    // Notify LSP of file changes and collect diagnostics
    const diagnostics = await runLSP(
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        for (const change of fileChanges) {
          if (change.type === "delete") continue
          const target = change.movePath ?? change.filePath
          yield* lsp.touchFile(target, true)
        }
        return yield* lsp.diagnostics()
      }),
    )

    // Generate output summary
    const summaryLines = fileChanges.map((change) => {
      if (change.type === "add") {
        return `A ${path.relative(Instance.worktree, change.filePath)}`
      }
      if (change.type === "delete") {
        return `D ${path.relative(Instance.worktree, change.filePath)}`
      }
      const target = change.movePath ?? change.filePath
      return `M ${path.relative(Instance.worktree, target)}`
    })
    let output = `Success. Updated the following files:\n${summaryLines.join("\n")}`

    // Report LSP errors for changed files
    const MAX_DIAGNOSTICS_PER_FILE = 20
    for (const change of fileChanges) {
      if (change.type === "delete") continue
      const target = change.movePath ?? change.filePath
      const normalized = Filesystem.normalizePath(target)
      const issues = diagnostics[normalized] ?? []
      const errors = issues.filter((item) => item.severity === 1)
      if (errors.length > 0) {
        const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
        const suffix =
          errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
        output += `\n\nLSP errors detected in ${path.relative(Instance.worktree, target)}, please fix:\n<diagnostics file="${target}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
      }
    }

    // Build per-file metadata for UI rendering
    const files = await Promise.all(
      fileChanges.map(async (change) => {
        const targetPath = change.movePath ?? change.filePath

        return {
          filePath: change.filePath,
          relativePath: path.relative(Instance.worktree, targetPath),
          type: change.type,
          diff: change.diff,
          before: change.oldContent,
          after: change.newContent,
          additions: change.additions,
          deletions: change.deletions,
          movePath: change.movePath,
        }
      }),
    )

    return {
      title: output,
      metadata: {
        diff: totalDiff,
        files,
        diagnostics,
      },
      output,
    }
  },
})
