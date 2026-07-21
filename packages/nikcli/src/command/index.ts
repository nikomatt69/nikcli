import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Config } from "../config/config"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_ULTRAREVIEW from "./template/ultrareview.txt"
import PROMPT_GOAL from "./template/goal.txt"
import { MCP } from "../mcp"
import { Connectors } from "../connectors"
import { Skill } from "../skill"
import { InstanceState, locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"
import { Context, Effect, Layer, Schema } from "effect"

export namespace Command {
  export const Event = {
    Executed: BusEvent.schema(
      "command.executed",
      Schema.Struct({
        name: Schema.String,
        sessionID: Identifier.schemaEffect("session"),
        arguments: Schema.String,
        messageID: Identifier.schemaEffect("message"),
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
      aliases: z.array(z.string()).optional(),
    })
    .meta({
      ref: "Command",
    })

  export type Info = Omit<z.infer<typeof Info>, "template"> & {
    template: Promise<string> | string
  }

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
    GOAL: "goal",
  } as const

  function skillTemplate(skill: Skill.Info) {
    return [
      `Use the skill tool to load the "${skill.name}" skill first.`,
      `After loading it, follow that skill for the rest of this session unless the user says otherwise.`,
      "Apply the skill to the user request below when one is provided.",
      "If no additional request is provided, briefly confirm that the skill is active and explain what it helps with.",
      "",
      "$ARGUMENTS",
    ].join("\n")
  }

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined, never>
    readonly list: () => Effect.Effect<Info[], never>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/Command") {}

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

  export const layer = Layer.effect(
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
            [Default.GOAL]: {
              name: Default.GOAL,
              description: "work autonomously until a verifiable goal condition is met",
              get template() {
                return PROMPT_GOAL
              },
              hints: hints(PROMPT_GOAL),
            },
          }

          for (const [name, command] of Object.entries(cfg.command ?? {})) {
            // Full override: user supplies a complete template.
            if (command.template !== undefined) {
              const template = command.template
              result[name] = {
                name,
                agent: command.agent,
                model: command.model,
                description: command.description,
                get template() {
                  return template
                },
                subtask: command.subtask,
                hints: hints(template),
                aliases: command.aliases,
              }
              continue
            }
            // Partial override (opencode #38071): user supplies one of
            // agent/model/description/subtask without restating the
            // template. Inherit from the built-in if present, otherwise
            // drop the entry entirely (no orphan commands).
            const existing = result[name]
            if (existing === undefined || typeof (existing as { template?: unknown }).template !== "string") {
              continue
            }
            result[name] = {
              name,
              agent: command.agent ?? (existing as { agent?: string }).agent,
              model: command.model ?? (existing as { model?: string }).model,
              description: command.description ?? (existing as { description?: string }).description,
              get template() {
                return (existing as { template: string }).template
              },
              subtask: command.subtask ?? (existing as { subtask?: boolean }).subtask,
              hints: (existing as { hints?: unknown }).hints as never,
              aliases: command.aliases ?? (existing as { aliases?: string[] }).aliases,
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
                    ? Object.fromEntries(
                        prompt.arguments?.map((argument: { name: string }, i: number) => [argument.name, `$${i + 1}`]),
                      )
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
                      .map((message: { content: { type: string; text?: string } }) =>
                        message.content.type === "text" ? message.content.text : "",
                      )
                      .join("\n") || "",
                  )
                })
              },
              hints: prompt.arguments?.map((_: unknown, i: number) => `$${i + 1}`) ?? [],
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
              hints: prompt.arguments?.map((_: unknown, i: number) => `$${i + 1}`) ?? [],
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
