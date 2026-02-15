import { QuestionTool } from "./question"
import { BashTool } from "./bash"
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
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolDefinition } from "@nikcli-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { TreeTool } from "./tree"
import { DocsAddTool } from "./docs_add"
import { DocsSearchTool } from "./docs_search"
import { DocsLoadTool } from "./docs_load"
import { DocsUnloadTool } from "./docs_unload"
import { DocsContextTool } from "./docs_context"
import { DocsRequestTool } from "./docs_request"
import { DocsGapReportTool } from "./docs_gap_report"
import { SmartDocsTool } from "./smart_docs"
import { ContextCollectTool } from "./context_collect"
import { ContextSearchTool } from "./context_search"
import { ContextRelatedTool } from "./context_related"
import { ContextDiagnosticsTool } from "./context_diagnostics"
import { MemorySearchTool } from "./memory_search"
import { RagIndexTool } from "./rag_index"
import { RagSearchTool } from "./rag_search"
import { RagStatusTool } from "./rag_status"
import { RagResetTool } from "./rag_reset"
import { GenerateImageTool } from "./generate_image"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"
import { PlanExitTool, PlanEnterTool } from "./plan"
import { ApplyPatchTool } from "./apply_patch"
import { UseConnectorTool } from "./use-connector"
import { SpeakTool } from "./speak"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  export const state = Instance.state(async () => {
    const custom = [] as Tool.Info[]
    const glob = new Bun.Glob("{tool,tools}/*.{js,ts}")

    for (const dir of await Config.directories()) {
      for await (const match of glob.scan({
        cwd: dir,
        absolute: true,
        followSymlinks: true,
        dot: true,
      })) {
        const namespace = path.basename(match, path.extname(match))
        const mod = await import(match)
        for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
          custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
        }
      }
    }

    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async (initCtx) => ({
        parameters: z.object(def.args),
        description: def.description,
        execute: async (args, ctx) => {
          const result = await def.execute(args as any, ctx)
          const out = await Truncate.output(result, {}, initCtx?.agent)
          return {
            title: "",
            output: out.truncated ? out.content : result,
            metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
          }
        },
      }),
    }
  }

  export async function register(tool: Tool.Info) {
    const { custom } = await state()
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    const config = await Config.get()

    return [
      InvalidTool,
      ...(["app", "cli", "desktop"].includes(Flag.NIKCLI_CLIENT) ? [QuestionTool] : []),
      BashTool,
      ReadTool,
      TreeTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      TaskTool,
      DocsAddTool,
      DocsSearchTool,
      DocsLoadTool,
      DocsUnloadTool,
      DocsContextTool,
      DocsRequestTool,
      DocsGapReportTool,
      SmartDocsTool,
      ContextCollectTool,
      ContextSearchTool,
      ContextRelatedTool,
      ContextDiagnosticsTool,
      MemorySearchTool,
      RagIndexTool,
      RagSearchTool,
      RagStatusTool,
      RagResetTool,
      GenerateImageTool,
      WebFetchTool,
      TodoWriteTool,
      TodoReadTool,
      WebSearchTool,
      CodeSearchTool,
      SkillTool,
      ApplyPatchTool,
      ...(Flag.NIKCLI_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      ...(Flag.NIKCLI_EXPERIMENTAL_PLAN_MODE && Flag.NIKCLI_CLIENT === "cli" ? [PlanExitTool, PlanEnterTool] : []),
      UseConnectorTool,
      SpeakTool,
      ...custom,
    ]
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  export async function tools(
    model: {
      providerID: string
      modelID: string
    },
    agent?: Agent.Info,
  ) {
    const tools = await all()
    const result = await Promise.all(
      tools
        .filter((t) => {
          if (t.id === "codesearch" || t.id === "websearch") {
            return model.providerID === "nikcli" || Flag.NIKCLI_ENABLE_EXA
          }

          const usePatch =
            model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
          if (t.id === "apply_patch") return usePatch
          if (t.id === "edit" || t.id === "write") return !usePatch

          return true
        })
        .map(async (t) => {
          using _ = log.time(t.id)
          return {
            id: t.id,
            ...(await t.init({ agent })),
          }
        }),
    )
    return result
  }
}
