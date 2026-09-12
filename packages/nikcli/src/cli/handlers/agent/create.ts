import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Global } from "@nikcli-ai/util/global"
import { Provider } from "@/provider/provider"
import path from "path"
import fs from "fs/promises"
import matter from "gray-matter"
import { withInstanceAsync } from "@/effect"
import { log, AgentModeSchema, AVAILABLE_TOOLS, agentGenerate } from "./shared"
import type { AgentMode } from "./shared"

export default Runtime.handler(Commands.commands["agent"].commands["create"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    path: Option.getOrUndefined(input["path"]),
    description: Option.getOrUndefined(input["description"]),
    mode: Option.getOrUndefined(input["mode"]),
    tools: Option.getOrUndefined(input["tools"]),
    model: Option.getOrUndefined(input["model"]),
  }
  await withInstanceAsync({ directory: process.cwd() }, async (instance) => {
    const cliPath = args.path
    const cliDescription = args.description
    const cliMode = args.mode as AgentMode | undefined
    const cliTools = args.tools

    const isFullyNonInteractive = Boolean(cliPath && cliDescription && cliMode && cliTools !== undefined)

    if (!isFullyNonInteractive) {
      UI.empty()
      prompts.intro("Create agent")
    }

    const project = instance.project
    log.debug("Creating agent", {
      projectWorktree: instance.worktree,
      isInteractive: !isFullyNonInteractive,
    })

    let targetPath: string
    if (cliPath) {
      targetPath = path.join(cliPath, "agent")
    } else {
      let scope: "global" | "project" = "global"
      if (project.vcs === "git") {
        const scopeResult = await prompts.select({
          message: "Location",
          options: [
            {
              label: "Current project",
              value: "project" as const,
              hint: instance.worktree,
            },
            {
              label: "Global",
              value: "global" as const,
              hint: Global.Path.config,
            },
          ],
        })
        if (prompts.isCancel(scopeResult)) {
          prompts.outro("Done")
          return
        }
        scope = scopeResult
      }
      targetPath = path.join(scope === "global" ? Global.Path.config : path.join(instance.worktree, ".nikcli"), "agent")
    }

    let description: string
    if (cliDescription) {
      description = cliDescription
    } else {
      const query = await prompts.text({
        message: "Description",
        placeholder: "What should this agent do?",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(query)) {
        prompts.outro("Done")
        return
      }
      description = query
    }

    const spinner = prompts.spinner()
    spinner.start("Generating agent configuration...")

    const model = args.model ? Provider.parseModel(args.model) : undefined

    const generated = await agentGenerate({ description, model }).catch((error) => {
      spinner.stop(`LLM failed to generate agent: ${error.message}`, 1)
      if (isFullyNonInteractive) {
        process.exit(1)
      }
      throw new UI.CancelledError()
    })

    spinner.stop(`Agent ${generated.identifier} generated`)
    log.info("Agent generated", { identifier: generated.identifier })

    let selectedTools: string[]
    if (cliTools !== undefined) {
      selectedTools = cliTools ? cliTools.split(",").map((t: string) => t.trim()) : [...AVAILABLE_TOOLS]
    } else {
      const result = await prompts.multiselect({
        message: "Select tools to enable (Space to toggle)",
        options: AVAILABLE_TOOLS.map((tool) => ({
          label: tool,
          value: tool,
        })),
        initialValues: [...AVAILABLE_TOOLS],
      })
      if (prompts.isCancel(result)) {
        prompts.outro("Done")
        return
      }
      selectedTools = result
    }

    let mode: AgentMode
    if (cliMode) {
      const parsed = AgentModeSchema.safeParse(cliMode)
      if (!parsed.success) {
        log.error("Invalid agent mode", { mode: cliMode })
        throw new UI.CancelledError()
      }
      mode = parsed.data
    } else {
      const modeResult = await prompts.select({
        message: "Agent mode",
        options: [
          {
            label: "All",
            value: "all" as const,
            hint: "Can function in both primary and subagent roles",
          },
          {
            label: "Primary",
            value: "primary" as const,
            hint: "Acts as a primary/main agent",
          },
          {
            label: "Subagent",
            value: "subagent" as const,
            hint: "Can be used as a subagent by other agents",
          },
        ],
        initialValue: "all" as const,
      })
      if (prompts.isCancel(modeResult)) {
        prompts.outro("Done")
        return
      }
      mode = modeResult
    }

    const tools: Record<string, boolean> = {}
    for (const tool of AVAILABLE_TOOLS) {
      if (!selectedTools.includes(tool)) {
        tools[tool] = false
      }
    }

    const frontmatter: {
      description: string
      mode: AgentMode
      tools?: Record<string, boolean>
    } = {
      description: generated.whenToUse,
      mode,
    }
    if (Object.keys(tools).length > 0) {
      frontmatter.tools = tools
    }

    const content = matter.stringify(generated.systemPrompt, frontmatter)
    const filePath = path.join(targetPath, `${generated.identifier}.md`)

    await fs.mkdir(targetPath, { recursive: true })

    const file = Bun.file(filePath)
    if (await file.exists()) {
      if (isFullyNonInteractive) {
        console.error(`Error: Agent file already exists: ${filePath}`)
        process.exit(1)
      }
      prompts.log.error(`Agent file already exists: ${filePath}`)
      throw new UI.CancelledError()
    }

    await Bun.write(filePath, content)

    if (isFullyNonInteractive) {
      console.log(filePath)
    } else {
      prompts.log.success(`Agent created: ${filePath}`)
      prompts.outro("Done")
    }
  })
})
