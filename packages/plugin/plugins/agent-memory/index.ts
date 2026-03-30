import type { Plugin } from "@nikcli-ai/plugin"
import { tool } from "@nikcli-ai/plugin"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"

type MemoryStore = Record<string, string>

function loadMemory(filePath: string): MemoryStore {
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as MemoryStore
  } catch {
    return {}
  }
}

function saveMemory(filePath: string, store: MemoryStore): void {
  const dir = filePath.replace(/\/[^/]+$/, "")
  mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8")
}

function formatMemoryBlock(store: MemoryStore): string {
  const entries = Object.entries(store)
  if (entries.length === 0) return ""
  const lines = entries.map(([k, v]) => `- **${k}**: ${v}`)
  return `## Agent Memory\n\n${lines.join("\n")}\n`
}

/**
 * Agent Memory
 *
 * Persistent key-value memory blocks that survive across sessions.
 * Memory is injected into the system prompt and can be edited via tools.
 *
 * Storage: .nikcli/memory.json in the project directory
 */
export const AgentMemoryPlugin: Plugin = async (input) => {
  const memoryPath = join(input.directory, ".nikcli", "memory.json")

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const store = loadMemory(memoryPath)
      const block = formatMemoryBlock(store)
      if (block) {
        output.system = [block, ...output.system]
      }
    },

    tool: {
      memory_save: tool({
        description: "Save or update a memory entry. Use this to remember important facts, decisions, or context.",
        args: {
          key: tool.schema.string().describe("Short identifier for this memory (e.g. 'project_stack', 'user_name')"),
          content: tool.schema.string().describe("What to remember"),
        },
        async execute(args) {
          const store = loadMemory(memoryPath)
          const existed = args.key in store
          store[args.key] = args.content
          saveMemory(memoryPath, store)
          return existed ? `Updated memory "${args.key}"` : `Saved memory "${args.key}"`
        },
      }),

      memory_recall: tool({
        description: "Recall a specific memory entry, or list all if no key provided.",
        args: {
          key: tool.schema.string().optional().describe("Key to recall. Omit to list all memory entries."),
        },
        async execute(args) {
          const store = loadMemory(memoryPath)
          if (!args.key) {
            const entries = Object.entries(store)
            if (entries.length === 0) return "No memories stored"
            return entries.map(([k, v]) => `${k}: ${v}`).join("\n")
          }
          const value = store[args.key]
          if (value === undefined) return `No memory found for "${args.key}"`
          return `${args.key}: ${value}`
        },
      }),

      memory_delete: tool({
        description: "Delete a memory entry by key.",
        args: {
          key: tool.schema.string().describe("Key of the memory to delete"),
        },
        async execute(args) {
          const store = loadMemory(memoryPath)
          if (!(args.key in store)) return `No memory found for "${args.key}"`
          delete store[args.key]
          saveMemory(memoryPath, store)
          return `Deleted memory "${args.key}"`
        },
      }),

      memory_list: tool({
        description: "List all stored memory keys and their contents.",
        args: {},
        async execute() {
          const store = loadMemory(memoryPath)
          const entries = Object.entries(store)
          if (entries.length === 0) return "No memories stored"
          return `Stored memories (${entries.length}):\n${entries.map(([k, v]) => `  ${k}: ${v.slice(0, 80)}${v.length > 80 ? "..." : ""}`).join("\n")}`
        },
      }),
    },
  }
}

export default { server: AgentMemoryPlugin }
