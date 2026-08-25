import { Effect, Schema } from "effect"
import { zod } from "@nikcli-ai/util/effect-zod"
import * as path from "path"
import { createTwoFilesPatch } from "diff"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import DESCRIPTION from "./multiedit.txt"
import { File } from "../file"
import { Bus } from "../bus"
import { FileTime } from "../file/time"
import { Filesystem } from "@nikcli-ai/util/filesystem"
import { Bom } from "../util/bom"
import { Format } from "../format"
import { buildFileDiff, trimDiff } from "./file-diff"
import { assertExternalDirectory } from "./external-directory"
import { replaceWithCount } from "./edit"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Log } from "@nikcli-ai/util/log"

const MAX_DIAGNOSTICS_PER_FILE = 20

const log = Log.create({ service: "multiedit-tool" })

function runLSP<A, E>(effect: Effect.Effect<A, E, LSP.Service>) {
  return runPromiseWithLayer(LSP.defaultLayer, withCurrentInstance(effect))
}

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file to modify" }),
  edits: Schema.Array(
    Schema.Struct({
      oldString: Schema.String.annotate({ description: "The text to replace" }),
      newString: Schema.String.annotate({
        description: "The text to replace it with (must be different from oldString)",
      }),
      replaceAll: Schema.optional(Schema.Boolean).annotate({
        description: "Replace all occurrences of oldString (default false)",
      }),
    }),
  ).annotate({ description: "Array of edit operations to perform sequentially on the file" }),
})

export const MultiEditTool = Tool.define("multiedit", {
  description: DESCRIPTION,
  parameters: zod(Parameters),
  async execute(params, ctx) {
    if (!params.filePath) throw new Error("filePath is required")
    if (params.edits.length === 0) throw new Error("No edits to apply: edits is empty.")
    for (const edit of params.edits) {
      if (edit.oldString === edit.newString) {
        throw new Error("No changes to apply: oldString and newString are identical.")
      }
    }

    const filePath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.join(ctx.instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filePath)

    // An empty first `oldString` is the "create" spelling, same as `edit`: the file need not
    // exist yet, so it is neither stat'd nor time-checked.
    const created = params.edits[0]!.oldString === ""

    let diff = ""
    let contentOld = ""
    let contentNew = ""
    let replacements = 0
    await FileTime.withLock(filePath, async () => {
      let originalBom = false
      if (!created) {
        const stats = await Bun.file(filePath)
          .stat()
          .catch(() => {})
        if (!stats) throw new Error(`File not found: ${filePath}`)
        if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)
        await FileTime.assert(ctx.sessionID, filePath)
        // opencode #39564: `Bun.file().text()` drops the BOM, so read it explicitly
        // and re-apply it below — otherwise every edit of a BOM file silently
        // corrupts its encoding.
        const original = await Bom.readFile(filePath)
        contentOld = original.text
        originalBom = original.bom
      }

      // Every edit resolves against an in-memory copy and the result is written once. That is
      // what makes the batch atomic — an `oldString` that does not match throws before anything
      // touches disk — and it is why a batch can no longer defeat itself: writing between edits
      // ran the formatter, so edit N+1 was matched against reformatted text the model never saw.
      let content = contentOld
      for (const edit of params.edits) {
        if (edit.oldString === "") {
          content = edit.newString
          continue
        }
        const applied = replaceWithCount(content, edit.oldString, edit.newString, edit.replaceAll, filePath)
        content = applied.content
        replacements += applied.replacements
      }

      const replacement = Bom.split(content)
      contentNew = replacement.text
      const writtenBom = originalBom || replacement.bom

      diff = trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      )
      // One prompt for the whole batch: the user approves the file as it will end up, not N
      // intermediate states they cannot evaluate separately.
      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(ctx.instance.worktree, filePath)],
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

      await Bun.write(filePath, Bom.join(contentNew, writtenBom))
      await Format.formatFile(filePath, writtenBom)
      await Bus.publish(File.Event.Edited, {
        file: filePath,
      })
      contentNew = (await Bom.readFile(filePath)).text
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

    const relative = path.relative(ctx.instance.worktree, filePath)
    const summary =
      replacements === 0
        ? "Created file."
        : `Replaced ${replacements} ${replacements === 1 ? "occurrence" : "occurrences"} in ${relative} across ${params.edits.length} ${params.edits.length === 1 ? "edit" : "edits"}.`
    let output = created && replacements > 0 ? `Created file. ${summary}` : summary

    const diagnostics = await runLSP(
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        yield* lsp.touchFile(filePath, true)
        return yield* lsp.diagnostics()
      }),
    ).catch((err): Record<string, LSP.Diagnostic[]> => {
      // LSP errors are non-fatal, log and continue
      log.debug("LSP diagnostics failed", { error: String(err), filePath })
      return {}
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
      title: relative,
      output,
    }
  },
})
