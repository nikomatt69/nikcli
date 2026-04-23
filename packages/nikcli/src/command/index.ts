import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_ULTRAREVIEW from "./template/ultrareview.txt"
import { MCP } from "../mcp"
import { Connectors } from "../connectors"
import { Skill } from "../skill"

export namespace Command {
  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: Identifier.schema("session"),
        arguments: z.string(),
        messageID: Identifier.schema("message"),
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      mcp: z.boolean().optional(),
      skill: z.boolean().optional(),
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string): string[] {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
    ULTRAREVIEW: "ultrareview",
  } as const

  function skillTemplate(skill: Skill.Info) {
    return [
      `Use the skill tool to load the \"${skill.name}\" skill first.`,
      `After loading it, follow that skill for the rest of this session unless the user says otherwise.`,
      "Apply the skill to the user request below when one is provided.",
      "If no additional request is provided, briefly confirm that the skill is active and explain what it helps with.",
      "",
      "$ARGUMENTS",
    ].join("\n")
  }

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const result: Record<string, Info> = {
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        get template() {
          return PROMPT_REVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      },
      [Default.ULTRAREVIEW]: {
        name: Default.ULTRAREVIEW,
        description: "deep multi-agent review via parallel monitor jobs [commit|branch|pr]",
        get template() {
          return PROMPT_ULTRAREVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_ULTRAREVIEW),
      },
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }
    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      result[name] = {
        name,
        mcp: true,
        description: prompt.description,
        get template() {
          return new Promise<string>(async (resolve, reject) => {
            const template = await MCP.getPrompt(
              prompt.client,
              prompt.name,
              prompt.arguments
                ? Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                : {},
            ).catch(reject)
            resolve(
              template?.messages
                .map((message) => (message.content.type === "text" ? message.content.text : ""))
                .join("\n") || "",
            )
          })
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    for (const [name, prompt] of Object.entries(await Connectors.prompts())) {
      const operationName = `${prompt.type}_${name.split("_").slice(2).join("_")}`
      result[name] = {
        name,
        description: prompt.description,
        get template() {
          const argsEntries = prompt.arguments ? prompt.arguments.map((arg, i) => `${arg.name}: \$${i + 1}`) : []
          const argsExample = prompt.arguments
            ? JSON.stringify(Object.fromEntries(prompt.arguments.map((arg, i) => [arg.name, `$${i + 1}`])), null, 2)
            : "{}"
          return `Use the use_connector tool:
- connector: ${prompt.client}
- operation: ${operationName}
- args: ${argsExample}${argsEntries.length > 0 ? `\n\nReplace the placeholder values ($$) with actual values:\n${argsEntries.join("\n")}` : ""}`
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    for (const skill of await Skill.all()) {
      const name = Skill.commandName(skill.name)
      if (result[name]) continue
      const template = skillTemplate(skill)
      result[name] = {
        name,
        description: skill.description,
        skill: true,
        get template() {
          return template
        },
        hints: hints(template),
      }
    }

    return result
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }
}
