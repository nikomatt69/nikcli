import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { buildFileDiff, readAfterMutation, trimDiff } from "./file-diff"
import { assertExternalDirectory } from "./external-directory"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

/**
 * Opencode #20217: preserve CRLF line endings and BOM on Windows writes.
 * The user-supplied `content` string is checked for a BOM and the dominant line
 * ending; both are restored after the diff/patch pipeline normalizes to LF.
 */
export function preserveOriginalShape(original: string, written: string): string {
  if (!original) return written
  const hasCRLF = original.includes("\r\n")
  const hasLF = original.includes("\n") && !hasCRLF
  let result = written
  if (hasCRLF) result = result.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n")
  else if (hasLF) result = result.replaceAll("\r\n", "\n")
  if (original.charCodeAt(0) === 0xfeff && result.charCodeAt(0) !== 0xfeff) {
    result = "\ufeff" + result
  }
  return result
}

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_PROJECT_DIAGNOSTICS_FILES = 5

function runLSP<A, E>(effect: Effect.Effect<A, E, LSP.Service>) {
  return runPromiseWithLayer(LSP.defaultLayer, withCurrentInstance(effect))
}

// Opencode #29943: filePath is declared FIRST so local models that emit fields in
// declaration order produce filePath before content. Otherwise large writes can
// exhaust the token budget on content and never emit filePath → schema error.
const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "The absolute path to the file to write (must be absolute, not relative)",
  }),
  content: Schema.String.annotate({
    description: "The content to write to the file",
  }),
})

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: zod(Parameters),
  async execute(params, ctx) {
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filepath)

    const file = Bun.file(filepath)
    const exists = await file.exists()
    const contentOld = exists ? await file.text() : ""
    if (exists) await FileTime.assert(ctx.sessionID, filepath)

    const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filepath)],
      always: ["*"],
      metadata: {
        filepath,
        diff,
        // Structured preview of the pending change, so the approval UI shows what will happen.
        files: [buildFileDiff({ file: filepath, before: contentOld, after: params.content, patch: diff })],
      },
    })

    const written = preserveOriginalShape(contentOld, params.content)
    await Bun.write(filepath, written)
    await Bus.publish(File.Event.Edited, {
      file: filepath,
    })
    await FileTime.read(ctx.sessionID, filepath)

    // Formatters run as subscribers of the event above and `Bus.publish` awaits them, so the file
    // on disk can already differ from what we wrote. Report the file as it now exists.
    const contentNew = await readAfterMutation(filepath, written)
    const filediff = buildFileDiff({ file: filepath, before: contentOld, after: contentNew })

    let output = "Wrote file successfully."
    const diagnostics = await runLSP(
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        yield* lsp.touchFile(filepath, true)
        return yield* lsp.diagnostics()
      }),
    )
    const normalizedFilepath = Filesystem.normalizePath(filepath)
    let projectDiagnosticsCount = 0
    for (const [file, issues] of Object.entries(diagnostics)) {
      const errors = issues.filter((item) => item.severity === 1)
      if (errors.length === 0) continue
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      if (file === normalizedFilepath) {
        output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filepath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
        continue
      }
      if (projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
      projectDiagnosticsCount++
      output += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }

    return {
      title: path.relative(Instance.worktree, filepath),
      metadata: {
        diagnostics,
        filepath,
        exists: exists,
        diff: filediff.patch,
        filediff,
      },
      output,
    }
  },
})
