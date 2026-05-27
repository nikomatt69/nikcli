import path from "path"
import os from "os"
import { Effect, Layer, Context, Schema } from "effect"
import { Config } from "@/config/config"
import { InstanceState, type InstanceContext } from "@/effect"
import { Flag } from "@/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import type { MessageV2 } from "./message-v2"

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
): Promise<{
  paths: Set<string>
  urls: string[]
}> {
  const paths = new Set<string>()
  const urls: string[] = []

  if (!Flag.NIKCLI_DISABLE_PROJECT_CONFIG) {
    for (const file of LOCAL_RULE_FILES) {
      const matches = await Filesystem.findUp(file, ctx.directory, ctx.worktree)
      if (matches.length > 0) {
        matches.forEach((p) => paths.add(p))
        break
      }
    }
  }

  for (const file of globalRuleFiles()) {
    if (await Bun.file(file).exists()) {
      paths.add(file)
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
      matches.forEach((p) => paths.add(p))
    }
  }

  return { paths, urls }
}

export async function readInstructionContents(paths: Set<string>): Promise<string[]> {
  return await Promise.all(
    Array.from(paths).map((p) =>
      Bun.file(p)
        .text()
        .catch(() => "")
        .then((x) => (x ? "Instructions from: " + p + "\n" + x : "")),
    ),
  ).then((r) => r.filter(Boolean))
}

export async function fetchInstructionUrls(urls: string[]): Promise<string[]> {
  return await Promise.all(
    urls.map((url) =>
      fetch(url, { signal: AbortSignal.timeout(5000) })
        .then((res) => (res.ok ? res.text() : ""))
        .catch(() => "")
        .then((x) => (x ? "Instructions from: " + url + "\n" + x : "")),
    ),
  ).then((r) => r.filter(Boolean))
}

export class InstructionError extends Schema.TaggedErrorClass<InstructionError>()("InstructionError", {
  cause: Schema.Unknown,
}) {}

export interface Interface {
  readonly clear: (messageID: string) => Effect.Effect<void>
  readonly systemPaths: () => Effect.Effect<{ paths: Set<string>; urls: string[] }, InstructionError>
  readonly system: () => Effect.Effect<string[], InstructionError>
  readonly find: (dir: string) => Effect.Effect<string | undefined, InstructionError>
  readonly resolve: (
    messages: MessageV2.WithParts[],
    filepath: string,
    messageID: string,
  ) => Effect.Effect<{ filepath: string; content: string }[], InstructionError>
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
            const cfg = yield* configSvc.get().pipe(Effect.mapError((e) => new InstructionError({ cause: e })))
            const result = yield* Effect.tryPromise({ try: () => collectSystemPaths(ctx, cfg), catch: (e) => new InstructionError({ cause: e }) })
            return result
          }),

        system: () =>
          Effect.gen(function* () {
            const { paths, urls } = yield* svc.systemPaths()
            // Increase concurrency: 8 for files, 4 for URLs (from opencode pattern)
            const [fileContents, urlContents] = yield* Effect.all(
              [
                Effect.tryPromise({ try: () => readInstructionContents(paths), catch: (e) => new InstructionError({ cause: e }) }),
                Effect.tryPromise({ try: () => fetchInstructionUrls(urls), catch: (e) => new InstructionError({ cause: e }) }),
              ],
              { concurrency: 8 },
            )
            return [...fileContents, ...urlContents]
          }),

        find: (dir) =>
          Effect.gen(function* () {
            for (const file of LOCAL_RULE_FILES) {
              const p = path.join(dir, file)
              const exists = yield* Effect.tryPromise({ try: () => Bun.file(p).exists(), catch: (e) => new InstructionError({ cause: e }) })
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
              const content = yield* Effect.tryPromise({ try: () =>
                Bun.file(p)
                  .text()
                  .catch(() => ""), catch: (e) => new InstructionError({ cause: e }) })
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
              const content = yield* Effect.tryPromise({ try: () =>
                Bun.file(found)
                  .text()
                  .catch(() => ""), catch: (e) => new InstructionError({ cause: e }) })
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
