import path from "path"
import { readdir, stat } from "fs/promises"
import { Tool } from "./tool"
import DESCRIPTION from "./tree.txt"
import { Instance } from "@/project/instance"
import { assertExternalDirectory } from "./external-directory"
import { IGNORE_PATTERNS } from "./ls"
import { Schema } from "effect"
import { zodObject } from "@/util/effect-zod"

type TreeNode = {
  name: string
  path: string
  isDirectory: boolean
  size: number
  depth: number
  children?: TreeNode[]
}

type TreeStats = {
  files: number
  directories: number
  size: number
  maxDepth: number
}

const TREE_CHARS = {
  branch: "├── ",
  last: "└── ",
  pipe: "│   ",
  space: "    ",
}

const ParametersSchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  maxDepth: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))),
  showHidden: Schema.optional(Schema.Boolean),
  showSize: Schema.optional(Schema.Boolean),
  showFullPath: Schema.optional(Schema.Boolean),
  ignorePatterns: Schema.optional(Schema.Array(Schema.String)),
  onlyDirectories: Schema.optional(Schema.Boolean),
  sortBy: Schema.optional(Schema.Literal("name", "size", "type")),
})
const parameters = zodObject(ParametersSchema)

export const TreeTool = Tool.define<typeof parameters, { stats: TreeStats }>("tree", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const base = params.path ? path.resolve(Instance.directory, params.path) : Instance.directory
    const maxDepth = params.maxDepth ?? 5
    const showHidden = params.showHidden ?? false
    const showSize = params.showSize ?? true
    const showFullPath = params.showFullPath ?? false
    await assertExternalDirectory(ctx, base, { kind: "directory" })

    await ctx.ask({
      permission: "tree",
      patterns: [base],
      always: ["*"],
      metadata: {
        path: base,
        maxDepth,
      },
    })

    const result = await buildTree({
      root: base,
      depth: 0,
      maxDepth,
      params: {
        showHidden,
        showSize,
        showFullPath,
        ignorePatterns: params.ignorePatterns ?? [],
        onlyDirectories: params.onlyDirectories ?? false,
        sortBy: params.sortBy ?? "name",
      },
    })

    const formatted = formatTree(result.node, "", true, showSize)
    const label = showFullPath ? base : path.relative(Instance.directory, base) || "."
    const summary = `${result.stats.directories} directories, ${result.stats.files} files, ${formatSize(result.stats.size)}`
    const output = [label, formatted, "", summary].filter(Boolean).join("\n")

    return {
      title: path.relative(Instance.worktree, base),
      output,
      metadata: {
        stats: result.stats,
      },
    }
  },
})

async function buildTree(input: {
  root: string
  depth: number
  maxDepth: number
  params: {
    showHidden: boolean
    showSize: boolean
    showFullPath: boolean
    ignorePatterns: string[]
    onlyDirectories: boolean
    sortBy: "name" | "size" | "type"
  }
}): Promise<{ node: TreeNode; stats: TreeStats }> {
  const info = await stat(input.root)
  const node: TreeNode = {
    name: path.basename(input.root),
    path: input.root,
    isDirectory: info.isDirectory(),
    size: info.size,
    depth: input.depth,
  }

  const baseStats: TreeStats = {
    files: node.isDirectory ? 0 : 1,
    directories: node.isDirectory ? 1 : 0,
    size: node.size,
    maxDepth: input.depth,
  }

  if (!node.isDirectory) return { node, stats: baseStats }
  if (input.depth >= input.maxDepth) return { node, stats: baseStats }

  const entries = await readdir(input.root)
  const filtered = entries.filter((entry) => {
    if (!input.params.showHidden && entry.startsWith(".")) return false
    const full = path.join(input.root, entry)
    const rel = path.relative(Instance.directory, full)
    return !shouldIgnore(rel, input.params.ignorePatterns)
  })

  const children = await Promise.all(
    filtered.map(async (entry) => {
      const full = path.join(input.root, entry)
      try {
        return await buildTree({
          root: full,
          depth: input.depth + 1,
          maxDepth: input.maxDepth,
          params: input.params,
        })
      } catch {
        return null
      }
    }),
  )

  const nodes = children.filter((item): item is { node: TreeNode; stats: TreeStats } => Boolean(item))
  const listed = input.params.onlyDirectories ? nodes.filter((item) => item.node.isDirectory) : nodes
  const sorted = sortNodes(listed, input.params.sortBy)
  const stats = sorted.reduce((acc, item) => {
    return {
      files: acc.files + item.stats.files,
      directories: acc.directories + item.stats.directories,
      size: acc.size + item.stats.size,
      maxDepth: Math.max(acc.maxDepth, item.stats.maxDepth),
    }
  }, baseStats)

  return {
    node: {
      ...node,
      children: sorted.map((item) => item.node),
    },
    stats,
  }
}

function sortNodes(items: Array<{ node: TreeNode; stats: TreeStats }>, sortBy: "name" | "size" | "type") {
  const sorted = [...items].sort((a, b) => {
    if (a.node.isDirectory !== b.node.isDirectory) return a.node.isDirectory ? -1 : 1
    if (sortBy === "size") return b.node.size - a.node.size
    if (sortBy === "type") return path.extname(a.node.name).localeCompare(path.extname(b.node.name))
    return a.node.name.localeCompare(b.node.name)
  })
  return sorted
}

function formatTree(node: TreeNode, prefix: string, isLast: boolean, showSize: boolean): string {
  const lines: string[] = []
  if (node.depth > 0) {
    const connector = isLast ? TREE_CHARS.last : TREE_CHARS.branch
    const sizeInfo = showSize && !node.isDirectory ? ` ${formatSize(node.size)}` : ""
    lines.push(`${prefix}${connector}${node.name}${sizeInfo}`)
  }

  if (!node.children) return lines.join("\n")
  const childPrefix = node.depth > 0 ? prefix + (isLast ? TREE_CHARS.space : TREE_CHARS.pipe) : ""
  const rendered = node.children.map((child, index) => {
    const lastChild = index === node.children!.length - 1
    return formatTree(child, childPrefix, lastChild, showSize)
  })
  return [...lines, ...rendered].filter(Boolean).join("\n")
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const base = 1024
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.floor(Math.log(bytes) / Math.log(base))
  const value = bytes / base ** index
  return `${value.toFixed(1)} ${units[index]}`
}

function shouldIgnore(relPath: string, extra: string[]): boolean {
  const all = [...IGNORE_PATTERNS, ...extra]
  const lower = relPath.toLowerCase()
  return all.some((pattern) => {
    if (pattern.endsWith("/")) return lower.includes(pattern.toLowerCase())
    if (pattern.includes("*")) {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"))
      return regex.test(lower)
    }
    return lower.includes(pattern.toLowerCase())
  })
}
