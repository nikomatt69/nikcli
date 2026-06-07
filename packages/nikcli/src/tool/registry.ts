import { plugin } from "bun"
import type { ToolAttachment } from "@nikcli-ai/plugin"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { MonitorTool } from "./monitor"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Config } from "../config/config"
import path from "path"
import { existsSync } from "fs"
import { type ToolDefinition } from "@nikcli-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { RepoCloneTool } from "./repo_clone"
import { RepoOverviewTool } from "./repo_overview"
import { TreeTool } from "./tree"
import { ContextCollectTool } from "./context_collect"
import { ContextRelatedTool } from "./context_related"
import { ContextDiagnosticsTool } from "./context_diagnostics"
import { MemorySearchTool } from "./memory_search"
import { GenerateImageTool } from "./generate_image"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"
import { InstanceState, locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"
import { Context, Effect, Layer } from "effect"
import { PlanExitTool, PlanEnterTool } from "./plan"
import { ApplyPatchTool } from "./apply_patch"
import { SpeakTool } from "./speak"
import { OpenTUIVizTool } from "./opentui"
import { DelegationTool } from "./delegation"
import { AdvisorTool } from "./advisor"
import { DelegatorTool } from "./delegator"
import { ExecCodeTool } from "./exec_code"
import { SearchToolsTool } from "./search_tools"
import { CreateGoalTool, GetGoalTool, UpdateGoalTool } from "./goal"
import { TerminalControlTool } from "./terminal_control"

const _toolDir = import.meta.dir

plugin({
  name: "nikcli-plugin-resolver",
  setup(build) {
    build.onResolve({ filter: /^@nikcli-ai\/plugin/ }, (args) => {
      try {
        return { path: Bun.resolveSync(args.path, _toolDir) }
      } catch {
        return undefined
      }
    })
  },
})

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  type State = {
    custom: Tool.Info[]
  }

  export type Resolved = {
    id: string
    description: string
    parameters: z.ZodType
    execute: Tool.Def["execute"]
    executeAsync: Tool.Def["executeAsync"]
    formatValidationError: Tool.Def["formatValidationError"]
  }

  export interface Interface {
    readonly register: (tool: Tool.Info) => Effect.Effect<void, unknown>
    readonly ids: () => Effect.Effect<string[], unknown>
    readonly tools: (
      model: {
        providerID: string
        modelID: string
      },
      agent?: Agent.Info,
      options?: { slim?: boolean },
    ) => Effect.Effect<Resolved[], unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/ToolRegistry") {}

  function configGet(ctx: InstanceContext) {
    return runPromiseWithLayer(
      Config.defaultLayer,
      locallyInstance(
        ctx,
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.get()
        }),
      ),
    )
  }

  function configDirectories(ctx: InstanceContext) {
    return runPromiseWithLayer(
      Config.defaultLayer,
      locallyInstance(
        ctx,
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.directories()
        }),
      ),
    )
  }

  function truncateOutput(text: string, options: Truncate.Options = {}, agent?: Agent.Info) {
    return runPromiseWithLayer(
      Truncate.defaultLayer,
      Effect.gen(function* () {
        const truncate = yield* Truncate.Service
        return yield* truncate.output(text, options, agent)
      }),
    )
  }

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return Tool.define(id, async () => ({
      parameters: z.object(def.args),
      description: def.description,
      execute: async (args, ctx): Promise<Tool.Result<{}>> => {
        const result = await def.execute(args as any, ctx)
        if (typeof result !== "string") {
          return {
            title: result.title ?? "",
            output: result.output,
            metadata: result.metadata ?? {},
            attachments: (result.attachments as ToolAttachment[])?.map((a) => ({
              id: ctx.messageID,
              sessionID: ctx.sessionID,
              messageID: ctx.messageID,
              type: a.type,
              mime: a.mime,
              url: a.url,
              filename: a.filename,
            })),
          }
        }
        return {
          title: "",
          output: result,
          metadata: {},
        }
      },
    }))
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("ToolRegistry.state")(function* () {
          const custom = [] as Tool.Info[]
          const glob = new Bun.Glob("{tool,tools}/*.{js,ts}")
          const ctx = yield* InstanceState.context

          for (const dir of yield* Effect.promise(() => configDirectories(ctx))) {
            // The config dir may not exist yet; scanning a missing dir throws ENOENT.
            if (!existsSync(dir)) continue
            const matches = yield* Effect.promise(() =>
              Array.fromAsync(
                glob.scan({
                  cwd: dir,
                  absolute: true,
                  followSymlinks: true,
                  dot: true,
                }),
              ),
            )
            for (const match of matches) {
              const namespace = path.basename(match, path.extname(match))
              const mod = yield* Effect.promise(() => import(match))
              for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
                custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
              }
            }
          }

          const plugins = yield* Effect.provide(
            Effect.gen(function* () {
              const plugin = yield* Plugin.Service
              return yield* plugin.list()
            }),
            Plugin.defaultLayer,
          ).pipe(Effect.orDie)
          for (const plugin of plugins) {
            for (const [id, def] of Object.entries(plugin.tool ?? {})) {
              custom.push(fromPlugin(id, def))
            }
          }

          return { custom }
        }),
      )

      const register: Interface["register"] = Effect.fn("ToolRegistry.register")(function* (tool: Tool.Info) {
        const { custom } = yield* InstanceState.get(state)
        const idx = custom.findIndex((t) => t.id === tool.id)
        if (idx >= 0) {
          custom.splice(idx, 1, tool)
          return
        }
        custom.push(tool)
      })

      const all: () => Effect.Effect<Tool.Info[], unknown> = Effect.fn("ToolRegistry.all")(function* () {
        const custom = yield* InstanceState.get(state).pipe(Effect.map((x) => x.custom))
        const ctx = yield* InstanceState.context
        const config = yield* Effect.promise(() => configGet(ctx))

        return [
          InvalidTool,
          ...(["app", "cli", "desktop"].includes(Flag.NIKCLI_CLIENT) ? [QuestionTool] : []),
          BashTool,
          TerminalControlTool,
          MonitorTool,
          ReadTool,
          TreeTool,
          GlobTool,
          GrepTool,
          EditTool,
          WriteTool,
          TaskTool,
          DelegationTool,
          ContextCollectTool,
          ContextRelatedTool,
          ContextDiagnosticsTool,
          MemorySearchTool,
          GenerateImageTool,

          WebFetchTool,
          TodoWriteTool,
          TodoReadTool,
          CreateGoalTool,
          GetGoalTool,
          UpdateGoalTool,
          WebSearchTool,
          CodeSearchTool,
          RepoCloneTool,
          RepoOverviewTool,
          SkillTool,
          ApplyPatchTool,
          ...(Flag.NIKCLI_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
          ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
          ...(Flag.NIKCLI_EXPERIMENTAL_PLAN_MODE && Flag.NIKCLI_CLIENT === "cli" ? [PlanExitTool, PlanEnterTool] : []),
          SpeakTool,
          OpenTUIVizTool,
          AdvisorTool,
          DelegatorTool,
          SearchToolsTool,
          ExecCodeTool,
          ...custom,
        ]
      })

      const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
        const list = yield* all()
        return list.map((t) => t.id)
      })

      // Core tools loaded in slim mode — enough for most tasks + search_tools for discovery.
      const SLIM_TOOLS = new Set(["bash", "read", "glob", "grep", "tree", "edit", "write", "task", "search_tools"])

      const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (
        model: {
          providerID: string
          modelID: string
        },
        agent?: Agent.Info,
        options?: { slim?: boolean },
      ) {
        const tools = yield* all()
        const result = yield* Effect.promise(() =>
          Promise.all(
            tools
              .filter((t) => {
                if (options?.slim) return SLIM_TOOLS.has(t.id)

                if (t.id === "codesearch" || t.id === "websearch") {
                  return model.providerID === "nikcli" || Flag.NIKCLI_ENABLE_EXA
                }

                const usePatch =
                  model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
                if (t.id === "apply_patch") return usePatch
                if (t.id === "edit" || t.id === "write") return !usePatch

                if (t.id === "advisor") return !!agent?.advisor

                return true
              })
              .map(async (t) => {
                using _ = log.time(t.id)
                const def = await t.init({ agent })
                return {
                  id: t.id,
                  description: def.description,
                  parameters: def.parameters,
                  execute: def.execute,
                  executeAsync: def.executeAsync,
                  formatValidationError: def.formatValidationError,
                }
              }),
          ),
        )
        return result satisfies Resolved[]
      })

      return Service.of({
        register,
        ids,
        tools,
      })
    }),
  )

  export const defaultLayer = layer
}
