import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./rag_index.txt"
import { Rag } from "@/rag"
import { Instance } from "@/project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"

const parameters = z.object({
  paths: z.array(z.string()).optional().describe("Files or directories to index"),
  chunkLines: z.number().int().min(20).max(500).optional().describe("Lines per chunk"),
  maxFiles: z.number().int().min(1).max(2000).optional().describe("Maximum files to index"),
  maxChunks: z.number().int().min(1).max(20000).optional().describe("Maximum chunks to store"),
  maxFileBytes: z.number().int().min(1).optional().describe("Maximum file size in bytes"),
  model: z.string().optional().describe("Embedding model (default: all-minilm for Ollama)"),
  provider: z.string().optional().describe("Embedding provider (default: ollama)"),
})

export const RagIndexTool = Tool.define("rag_index", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const base = Instance.worktree === "/" ? Instance.directory : Instance.worktree
    const root = path.join(base, ".nikcli")

    await ctx.ask({
      permission: "rag_index",
      patterns: [root],
      always: ["*"],
      metadata: {
        root,
        paths: params.paths,
        chunkLines: params.chunkLines,
        maxFiles: params.maxFiles,
        maxChunks: params.maxChunks,
        maxFileBytes: params.maxFileBytes,
        model: params.model,
      },
    })

    await assertExternalDirectory(ctx, root, { kind: "directory" })

    const result = await Rag.index({
      paths: params.paths,
      chunkLines: params.chunkLines,
      maxFiles: params.maxFiles,
      maxChunks: params.maxChunks,
      maxFileBytes: params.maxFileBytes,
      model: params.model,
      provider: params.provider,
    })

    const output = [
      `Index path: ${result.path}`,
      `Model: ${result.model}`,
      `Files: ${result.files}`,
      `Chunks: ${result.chunks}`,
      `Indexed chunks: ${result.indexed}`,
      `Skipped files: ${result.skipped}`,
      `Kept files: ${result.kept}`,
    ].join("\n")

    return {
      title: "RAG index",
      output,
      metadata: {
        path: result.path,
        files: result.files,
        chunks: result.chunks,
        model: result.model,
        indexed: result.indexed,
        skipped: result.skipped,
        kept: result.kept,
      },
    }
  },
})
