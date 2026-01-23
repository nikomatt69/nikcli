import z from "zod"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./context_related.txt"
import { Instance } from "@/project/instance"
import { assertExternalDirectory } from "./external-directory"

const parameters = z.object({
  filePath: z.string().describe("Entry file to analyze for related imports"),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum related files"),
})

export const ContextRelatedTool = Tool.define<typeof parameters, { count: number }>("context_related", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const entry = path.isAbsolute(params.filePath) ? params.filePath : path.resolve(Instance.directory, params.filePath)
    const limit = params.limit ?? 50

    await ctx.ask({
      permission: "context_related",
      patterns: [entry],
      always: ["*"],
      metadata: {
        filePath: entry,
        limit,
      },
    })

    await assertExternalDirectory(ctx, entry, { kind: "file" })

    const file = Bun.file(entry)
    if (!(await file.exists())) {
      throw new Error(`File not found: ${entry}`)
    }

    const text = await file.text().catch(() => "")
    if (!text) {
      return {
        title: path.relative(Instance.worktree, entry),
        output: "No related files found.",
        metadata: { count: 0 },
      }
    }

    const imports = collectImports(text)
    const related = await resolveImports(imports, path.dirname(entry), limit)

    if (related.length === 0) {
      return {
        title: path.relative(Instance.worktree, entry),
        output: "No related files found.",
        metadata: { count: 0 },
      }
    }

    return {
      title: path.relative(Instance.worktree, entry),
      output: related.join("\n"),
      metadata: { count: related.length },
    }
  },
})

function collectImports(text: string) {
  const results = new Set<string>()
  const patterns = [/from\s+["']([^"']+)["']/g, /require\(\s*["']([^"']+)["']\s*\)/g, /import\s+["']([^"']+)["']/g]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const item = match[1]
      if (!item) continue
      results.add(item)
    }
  }

  return Array.from(results)
}

async function resolveImports(imports: string[], base: string, limit: number) {
  const results: string[] = []
  for (const item of imports) {
    if (results.length >= limit) break
    if (!item.startsWith(".")) continue
    const full = path.resolve(base, item)
    const resolved = await resolveFile(full)
    if (!resolved) continue
    results.push(resolved)
  }
  return results
}

async function resolveFile(base: string) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.json`,
    `${base}.mts`,
    `${base}.cts`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
    path.join(base, "index.jsx"),
    path.join(base, "index.mjs"),
    path.join(base, "index.cjs"),
  ]

  for (const item of candidates) {
    if (await Bun.file(item).exists()) return item
  }
  return undefined
}
