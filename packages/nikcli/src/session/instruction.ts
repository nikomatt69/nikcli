import path from "path"
import os from "os"
import { createHash } from "crypto"
import { Effect, Layer, Context } from "effect"
import { Config } from "@/config/config"
import { InstanceState, type InstanceContext } from "@/effect"
import { Flag } from "@nikcli-ai/util/flag"
import { Filesystem } from "@nikcli-ai/util/filesystem"
import { workMap } from "@/util/queue"
import { Global } from "@nikcli-ai/util/global"
import type { MessageV2 } from "./message-v2"

export const INSTRUCTION_HASH_RE = /^[0-9a-f]{64}$/
export const INSTRUCTION_REMOVED = "removed" as const

export type InstructionKind = "file" | "url" | "env" | "profile" | "skill"

export type InstructionBlobBody =
  | { kind: "file"; text: string }
  | { kind: "url"; text: string }
  | { kind: "env"; parts: string[] }
  | { kind: "profile"; parts: string[] }
  | { kind: "skill"; name: string; text: string }

export type InstructionRead =
  | { key: string; status: "value"; body: InstructionBlobBody }
  | { key: string; status: "removed" }
  | { key: string; status: "unavailable" }

export const InstructionKey = {
  file: (filepath: string) => `file:${path.resolve(filepath)}`,
  url: (url: string) => `url:${url}`,
  env: "env",
  profile: "profile",
  skill: (name: string) => `skill:${name}`,
} as const

export function parseInstructionKey(key: string): { kind: InstructionKind; id: string } | undefined {
  if (key === "env") return { kind: "env", id: "" }
  if (key === "profile") return { kind: "profile", id: "" }
  if (key.startsWith("file:")) return { kind: "file", id: key.slice(5) }
  if (key.startsWith("url:")) return { kind: "url", id: key.slice(4) }
  if (key.startsWith("skill:")) return { kind: "skill", id: key.slice(6) }
  return undefined
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`
}

export function hashInstructionBody(body: InstructionBlobBody): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex")
}

export async function readFileSource(filepath: string): Promise<InstructionRead> {
  const key = InstructionKey.file(filepath)
  try {
    const file = Bun.file(filepath)
    if (!(await file.exists())) return { key, status: "removed" }
    const text = await file.text()
    if (!text) return { key, status: "removed" }
    return { key, status: "value", body: { kind: "file", text } }
  } catch {
    return { key, status: "unavailable" }
  }
}

export async function readUrlSource(
  url: string,
  fetchImpl: (input: string, init?: { signal?: AbortSignal }) => Promise<Response> = fetch,
): Promise<InstructionRead> {
  const key = InstructionKey.url(url)
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) })
    if (res.status === 404) return { key, status: "removed" }
    if (!res.ok) return { key, status: "unavailable" }
    const text = await res.text()
    if (!text) return { key, status: "removed" }
    return { key, status: "value", body: { kind: "url", text } }
  } catch {
    return { key, status: "unavailable" }
  }
}

const LOCAL_RULE_FILES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md", ".github/instructions/memory.instruction.md"]

function globalRuleFiles() {
  const files: string[] = [path.join(Global.Path.config, "AGENTS.md")]
  if (!Flag.NIKCLI_DISABLE_CLAUDE_CODE_PROMPT) {
    files.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }
  if (Flag.NIKCLI_CONFIG_DIR) {
    files.push(path.join(Flag.NIKCLI_CONFIG_DIR, "AGENTS.md"))
  }
  return files
}

function extractReadPaths(messages: MessageV2.WithParts[]) {
  const paths = new Set<string>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool === "read" && part.state.status === "completed") {
        if (part.state.time.compacted) continue
        const loaded = (part.state as any).metadata?.loaded
        if (!loaded || !Array.isArray(loaded)) continue
        for (const p of loaded) {
          if (typeof p === "string") paths.add(p)
        }
      }
    }
  }
  return paths
}

async function resolveRelativeInstruction(instruction: string, ctx: InstanceContext): Promise<string[]> {
  if (!Flag.NIKCLI_DISABLE_PROJECT_CONFIG) {
    return Filesystem.findUp(instruction, ctx.directory, ctx.worktree).catch(() => [])
  }
  if (!Flag.NIKCLI_CONFIG_DIR) {
    return []
  }
  return Filesystem.findUp(instruction, Flag.NIKCLI_CONFIG_DIR, Flag.NIKCLI_CONFIG_DIR).catch(() => [])
}

export async function collectSystemPaths(
  ctx: InstanceContext,
  config: Config.Info,
  options?: { disabledPaths?: string[] },
): Promise<{
  paths: Set<string>
  urls: string[]
}> {
  const paths = new Set<string>()
  const urls: string[] = []
  const disabled = new Set(options?.disabledPaths ?? [])

  if (!Flag.NIKCLI_DISABLE_PROJECT_CONFIG) {
    for (const file of LOCAL_RULE_FILES) {
      const matches = await Filesystem.findUp(file, ctx.directory, ctx.worktree).catch(() => [])
      if (matches.length > 0) {
        matches.forEach((p) => {
          if (!disabled.has(p)) paths.add(p)
        })
        break
      }
    }
  }

  for (const file of globalRuleFiles()) {
    if (await Bun.file(file).exists()) {
      if (!disabled.has(file)) paths.add(file)
    }
  }

  if (config.instructions) {
    for (let instruction of config.instructions) {
      if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
        urls.push(instruction)
        continue
      }
      if (instruction.startsWith("~/")) {
        instruction = path.join(os.homedir(), instruction.slice(2))
      }
      let matches: string[] = []
      if (path.isAbsolute(instruction)) {
        matches = await Array.fromAsync(
          new Bun.Glob(path.basename(instruction)).scan({
            cwd: path.dirname(instruction),
            absolute: true,
            onlyFiles: true,
          }),
        ).catch(() => [])
      } else {
        matches = await resolveRelativeInstruction(instruction, ctx)
      }
      matches.forEach((p) => {
        if (!disabled.has(p)) paths.add(p)
      })
    }
  }

  return { paths, urls }
}

export async function readInstructionContents(paths: Set<string>): Promise<string[]> {
  // Bounded fan-out: instruction globs can match many files; don't open them all at once.
  const results = await workMap(10, Array.from(paths), (p) =>
    Bun.file(p)
      .text()
      .catch(() => "")
      .then((x) => (x ? "Instructions from: " + p + "\n" + x : "")),
  )
  return results.filter(Boolean)
}

export async function fetchInstructionUrls(urls: string[]): Promise<string[]> {
  const results = await workMap(10, urls, (url) =>
    fetch(url, { signal: AbortSignal.timeout(5000) })
      .then((res) => (res.ok ? res.text() : ""))
      .catch(() => "")
      .then((x) => (x ? "Instructions from: " + url + "\n" + x : "")),
  )
  return results.filter(Boolean)
}

export interface Interface {
  readonly clear: (messageID: string) => Effect.Effect<void>
  readonly systemPaths: () => Effect.Effect<{ paths: Set<string>; urls: string[] }, unknown>
  readonly system: () => Effect.Effect<string[], unknown>
  readonly find: (dir: string) => Effect.Effect<string | undefined, unknown>
  readonly resolve: (
    messages: MessageV2.WithParts[],
    filepath: string,
    messageID: string,
  ) => Effect.Effect<{ filepath: string; content: string }[], unknown>
}

export class Service extends Context.Service<Service, Interface>()("Instruction.Service") {}

export const layer: Layer.Layer<Service, never, Config.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const configSvc = yield* Config.Service

    // Track which instruction files have already been attached for a given assistant message
    const claims = new Map<string, Set<string>>()

    const createService = () => {
      const svc: Interface = {
        clear: (messageID) =>
          Effect.sync(() => {
            claims.delete(messageID)
          }),

        systemPaths: () =>
          Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const cfg = yield* configSvc.get()
            const result = yield* Effect.tryPromise(() => collectSystemPaths(ctx, cfg))
            return result
          }),

        system: () =>
          Effect.gen(function* () {
            const { paths, urls } = yield* svc.systemPaths()
            // Increase concurrency: 8 for files, 4 for URLs (from opencode pattern)
            const [fileContents, urlContents] = yield* Effect.all(
              [
                Effect.tryPromise(() => readInstructionContents(paths)),
                Effect.tryPromise(() => fetchInstructionUrls(urls)),
              ],
              { concurrency: 8 },
            )
            return [...fileContents, ...urlContents]
          }),

        find: (dir) =>
          Effect.gen(function* () {
            for (const file of LOCAL_RULE_FILES) {
              const p = path.join(dir, file)
              const exists = yield* Effect.tryPromise(() => Bun.file(p).exists())
              if (exists) return p
            }
            return undefined
          }),

        resolve: (messages, filepath, messageID) =>
          Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const msgPaths = extractReadPaths(messages)
            const sysPaths = yield* svc.systemPaths()
            const root = path.resolve(ctx.directory)
            const results: { filepath: string; content: string }[] = []

            // Get or create claims set for this messageID
            let messageClaims = claims.get(messageID)
            if (!messageClaims) {
              messageClaims = new Set()
              claims.set(messageID, messageClaims)
            }

            // First, process paths from messages (from read tool metadata)
            for (const p of msgPaths) {
              if (messageClaims.has(p)) continue
              messageClaims.add(p)
              const content = yield* Effect.tryPromise(() =>
                Bun.file(p)
                  .text()
                  .catch(() => ""),
              )
              if (content) {
                results.push({ filepath: p, content: `Instructions from: ${p}\n${content}` })
              }
            }

            // Walk upward from the file being read and attach nearby instruction files (opencode pattern)
            const target = path.resolve(filepath)
            let current = path.dirname(target)

            while (current.startsWith(root) && current !== root) {
              const found = yield* svc.find(current)
              if (!found || found === target || sysPaths.paths.has(found) || messageClaims.has(found)) {
                current = path.dirname(current)
                continue
              }

              messageClaims.add(found)
              const content = yield* Effect.tryPromise(() =>
                Bun.file(found)
                  .text()
                  .catch(() => ""),
              )
              if (content) {
                results.push({ filepath: found, content: `Instructions from: ${found}\n${content}` })
              }

              current = path.dirname(current)
            }

            return results
          }),
      }
      return svc
    }

    return Service.of(createService())
  }),
)
