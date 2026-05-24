import path from "path"
import os from "os"
import { Effect, Layer, Context } from "effect"
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

export async function collectSystemPaths(ctx: InstanceContext, config: Config.Info): Promise<{
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

    const state = new Map<string, Set<string>>()

    const createService = () => {
      const svc: Interface = {
        clear: (messageID) =>
          Effect.sync(() => {
            state.delete(messageID)
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
            const [fileContents, urlContents] = yield* Effect.all(
              [
                Effect.tryPromise(() => readInstructionContents(paths)),
                Effect.tryPromise(() => fetchInstructionUrls(urls)),
              ],
              { concurrency: 2 },
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
            const msgPaths = extractReadPaths(messages)
            const loaded = state.get(messageID) ?? new Set()
            const pending: { filepath: string; content: string }[] = []

            for (const p of msgPaths) {
              if (loaded.has(p)) continue
              loaded.add(p)
              const content = yield* Effect.tryPromise(() =>
                Bun.file(p).text().catch(() => ""),
              )
              if (content) {
                pending.push({ filepath: p, content })
              }
            }

            state.set(messageID, loaded)
            return pending
          }),
      }
      return svc
    }

    return Service.of(createService())
  }),
)
