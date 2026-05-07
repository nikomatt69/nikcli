import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Config } from "../config/config"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_ULTRAREVIEW from "./template/ultrareview.txt"
import { MCP } from "../mcp"
import { Connectors } from "../connectors"
import { Skill } from "../skill"
import { InstanceState, locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"
import { Context, Effect, Layer } from "effect"

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

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined, unknown>
    readonly list: () => Effect.Effect<Info[], unknown>
  }

  export class Service extends Context.Tag("@nikcli/Command")<Service, Interface>() {}

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

  export const layer = Layer.scoped(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<Record<string, Info>>((ctx) =>
        Effect.gen(function* () {
          const cfg = yield* Effect.promise(() => configGet(ctx))
          const skills = yield* Effect.promise(() =>
            runPromiseWithLayer(
              Skill.defaultLayer,
              locallyInstance(
                ctx,
                Effect.gen(function* () {
                  const skill = yield* Skill.Service
                  return yield* skill.all()
                }),
              ),
            ),
          )

          const result: Record<string, Info> = {
            [Default.INIT]: {
              name: Default.INIT,
              description: "create/update AGENTS.md",
              get template() {
                return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
              },
              hints: hints(PROMPT_INITIALIZE),
            },
            [Default.REVIEW]: {
              name: Default.REVIEW,
              description: "review changes [commit|branch|pr], defaults to uncommitted",
              get template() {
                return PROMPT_REVIEW.replace("${path}", ctx.worktree)
              },
              subtask: true,
              hints: hints(PROMPT_REVIEW),
            },
            [Default.ULTRAREVIEW]: {
              name: Default.ULTRAREVIEW,
              description: "deep multi-agent review via parallel monitor jobs [commit|branch|pr]",
              get template() {
                return PROMPT_ULTRAREVIEW.replace("${path}", ctx.worktree)
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
          const mcpPrompts = yield* Effect.promise(() =>
            runPromiseWithLayer(
              MCP.defaultLayer,
              locallyInstance(
                ctx,
                Effect.gen(function* () {
                  const mcp = yield* MCP.Service
                  return yield* mcp.prompts()
                }),
              ),
            ),
          )
          for (const [name, prompt] of Object.entries(mcpPrompts)) {
            result[name] = {
              name,
              mcp: true,
              description: prompt.description,
              get template() {
                return new Promise<string>(async (resolve, reject) => {
                  const args = prompt.arguments
                    ? Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {}
                  const template = await runPromiseWithLayer(
                    MCP.defaultLayer,
                    locallyInstance(
                      ctx,
                      Effect.gen(function* () {
                        const mcp = yield* MCP.Service
                        return yield* mcp.getPrompt(prompt.client, prompt.name, args)
                      }),
                    ),
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

          for (const [name, prompt] of Object.entries(yield* Effect.promise(() => Connectors.prompts()))) {
            const operationName = `${prompt.type}_${name.split("_").slice(2).join("_")}`
            result[name] = {
              name,
              description: prompt.description,
              get template() {
                const argsEntries = prompt.arguments ? prompt.arguments.map((arg, i) => `${arg.name}: \$${i + 1}`) : []
                const argsExample = prompt.arguments
                  ? JSON.stringify(
                      Object.fromEntries(prompt.arguments.map((arg, i) => [arg.name, `$${i + 1}`])),
                      null,
                      2,
                    )
                  : "{}"
                return `Use the use_connector tool:
- connector: ${prompt.client}
- operation: ${operationName}
- args: ${argsExample}${argsEntries.length > 0 ? `\n\nReplace the placeholder values ($$) with actual values:\n${argsEntries.join("\n")}` : ""}`
              },
              hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
            }
          }

          for (const skill of skills) {
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
        }).pipe(Effect.orDie),
      )

      const get: Interface["get"] = Effect.fn("Command.get")(function* (name: string) {
        return (yield* InstanceState.get(state))[name]
      })

      const list: Interface["list"] = Effect.fn("Command.list")(function* () {
        return Object.values(yield* InstanceState.get(state))
      })

      return Service.of({
        get,
        list,
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Layer.suspend(() => Skill.defaultLayer)))
}
