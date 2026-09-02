import { spawn } from "child_process"
import path from "path"
import { quote } from "shell-quote"
import z from "zod"
import { ulid } from "ulid"
import { Effect } from "effect"
import { $ } from "bun"
import { Identifier } from "@nikcli-ai/util/id"
import { Agent } from "../agent/agent"
import { Bus } from "../bus"
import { Command } from "../command"
import { ConfigMarkdown } from "../config/markdown"
import { EventError } from "./event-error"
import { MessageV2 } from "./message-v2"
import { Plugin } from "../plugin"
import { Provider } from "../provider/provider"
import { Session } from "."
import { SessionGoal } from "./goal"
import { SessionRevert } from "./revert"
import { Shell } from "@/shell/shell"
import { PromptParts } from "./prompt-parts"
import type { SessionPrompt } from "./prompt"
import { defer } from "@nikcli-ai/util/defer"
import type { InstanceContext } from "@/effect"
import { setOptional } from "@/util/optional-key"

/**
 * `shell` and `command` live in their own module because they are the
 * two entry points that fan out from a user-typed prompt into a model
 * turn: `shell` runs an external process and persists a synthetic
 * assistant tool part; `command` resolves a slash command, expands its
 * template, and feeds the result into the same `prompt` loop. They share
 * the same lifecycle (admission via `PromptState`, model + agent lookups,
 * message persistence) so they share this dependency bundle.
 */
export namespace PromptCommands {
  export interface Deps {
    commandGet(name: string): Promise<Command.Info | undefined>
    agentGet(name: string): Promise<Agent.Info | undefined>
    agentRequired(name: string): Promise<Agent.Info>
    agentList(): Promise<Agent.Info[]>
    defaultAgent(): Promise<string>
    lastModel(sessionID: string): Promise<{ providerID: string; modelID: string }>
    /**
     * Resolve the model that a worker should use when the worker session has
     * no messages yet. Falls back through `parentSessionID` (caller session)
     * before the global default, so a mission launched from session S picks
     * up S's model instead of openrouter.
     */
    inheritedModel(sessionID: string, parentSessionID?: string): Promise<{ providerID: string; modelID: string }>
    providerGetModel(providerID: string, modelID: string): Promise<Provider.Model>
    sessionGet(sessionID: string): Promise<Session.Info>
    sessionUpdate(
      sessionID: string,
      editor: (session: Session.Info) => void,
      options?: { touch?: boolean },
    ): Promise<unknown>
    sessionUpdateMessage(message: MessageV2.Info): Promise<unknown>
    sessionUpdatePart(part: MessageV2.Part): Promise<unknown>
    currentContext(): InstanceContext
    runRevert<A, E>(effect: Effect.Effect<A, E, SessionRevert.Service>): Promise<A>
    runGoal<A, E>(effect: Effect.Effect<A, E, SessionGoal.Service>): Promise<A>
    runPlugin<A, E>(effect: Effect.Effect<A, E, Plugin.Service>): Promise<A>
    prompt(input: SessionPrompt.PromptInput): Promise<MessageV2.WithParts>
  }

  export const ShellInput = z.object({
    sessionID: Identifier.schema("session"),
    agent: z.string(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    command: z.string(),
  })
  export type ShellInput = z.infer<typeof ShellInput>

  /**
   * Run a shell command inside the session: persist a synthetic user prompt,
   * a running tool part, spawn the platform shell, stream stdout/stderr into
   * the part metadata, and finalize the part on completion. Mirrors the
   * legacy `SessionPrompt.shell` behavior byte-for-byte — only the module
   * boundary changed.
   */
  export async function shell(
    deps: Deps,
    raw: ShellInput,
    state: {
      start(sessionID: string): AbortController | undefined
      finish(sessionID: string, controller: AbortController): Promise<void>
    },
  ): Promise<{ info: MessageV2.Assistant; parts: MessageV2.Part[] }> {
    const input = ShellInput.parse(raw)
    const controller = state.start(input.sessionID)
    if (!controller) {
      throw new Session.BusyError({
        sessionID: input.sessionID,
        message: "Session is busy",
      })
    }
    const abort = controller.signal
    await using _ = defer(() => state.finish(input.sessionID, controller))
    const ctx = deps.currentContext()

    const session = await deps.sessionGet(input.sessionID)
    if (session.revert) {
      void deps.runRevert(
        Effect.gen(function* () {
          const revert = yield* SessionRevert.Service
          yield* revert.cleanup(session)
        }),
      )
    }
    const agent = await deps.agentRequired(input.agent)
    const model = input.model ?? agent.model ?? (await deps.lastModel(input.sessionID))
    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      role: "user",
      agent: input.agent,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
    }
    await deps.sessionUpdateMessage(userMsg)
    const userPart: MessageV2.Part = {
      type: "text",
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: input.sessionID,
      text: "The following tool was executed by the user",
      synthetic: true,
    }
    await deps.sessionUpdatePart(userPart)

    const msg: MessageV2.Assistant = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      parentID: userMsg.id,
      mode: input.agent,
      agent: input.agent,
      cost: 0,
      path: {
        cwd: ctx.directory,
        root: ctx.worktree,
      },
      time: {
        created: Date.now(),
      },
      role: "assistant",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.modelID,
      providerID: model.providerID,
    }
    await deps.sessionUpdateMessage(msg)
    const part: MessageV2.Part = {
      type: "tool",
      id: Identifier.ascending("part"),
      messageID: msg.id,
      sessionID: input.sessionID,
      tool: "bash",
      callID: ulid(),
      state: {
        status: "running",
        time: {
          start: Date.now(),
        },
        input: {
          command: input.command,
        },
      },
    }
    await deps.sessionUpdatePart(part)
    const shellPath = Shell.preferred()
    const shellName = (
      process.platform === "win32" ? path.win32.basename(shellPath, ".exe") : path.basename(shellPath)
    ).toLowerCase()

    const invocations: Record<string, { args: string[] }> = {
      nu: {
        args: ["-c", input.command],
      },
      fish: {
        args: ["-c", input.command],
      },
      zsh: {
        args: [
          "-c",
          "-l",
          `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${quote([input.command])}
          `,
        ],
      },
      bash: {
        args: [
          "-c",
          "-l",
          `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${quote([input.command])}
          `,
        ],
      },
      cmd: {
        args: ["/c", input.command],
      },
      powershell: {
        args: ["-NoProfile", "-Command", input.command],
      },
      pwsh: {
        args: ["-NoProfile", "-Command", input.command],
      },
      "": {
        args: ["-c", `${input.command}`],
      },
    }

    const matchingInvocation = invocations[shellName] ?? invocations[""]
    const args = matchingInvocation?.args

    const proc = spawn(shellPath, args, {
      windowsHide: true,
      cwd: ctx.directory,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TERM: "dumb",
      },
    })

    let output = ""

    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        void deps.sessionUpdatePart(part)
      }
    })

    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        void deps.sessionUpdatePart(part)
      }
    })

    let aborted = false
    let exited = false

    let killPromise: Promise<void> | undefined
    const kill = () => {
      killPromise ??= Shell.killTree(proc, { exited: () => exited })
      return killPromise
    }

    if (abort.aborted) {
      aborted = true
      await kill()
    }

    const abortHandler = () => {
      aborted = true
      void kill()
    }

    abort.addEventListener("abort", abortHandler, { once: true })

    await new Promise<void>((resolve) => {
      proc.on("close", () => {
        exited = true
        abort.removeEventListener("abort", abortHandler)
        resolve()
      })
    })

    if (aborted) {
      output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
    }
    msg.time.completed = Date.now()
    await deps.sessionUpdateMessage(msg)
    if (part.state.status === "running") {
      part.state = {
        status: "completed",
        time: {
          ...part.state.time,
          end: Date.now(),
        },
        input: part.state.input,
        title: "",
        metadata: {
          output,
          description: "",
        },
        output,
      }
      await deps.sessionUpdatePart(part)
    }
    return { info: msg, parts: [part] }
  }

  export const CommandInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    delivery: z.enum(["steer", "queue"]).optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    command: z.string(),
    arguments: z.string(),
    variant: z.string().optional(),
    parts: z.array(PromptParts.InputPart).optional(),
    /**
     * Caller session id, when the prompt is being fired on behalf of another
     * session (mission worker, loop worker, background run, brain pass, …).
     * Used as a fallback when `sessionID` itself has no last-model: a freshly
     * spawned worker session has no messages yet, but the caller does.
     */
    parentSessionID: Identifier.schema("session").optional(),
  })
  export type CommandInput = z.infer<typeof CommandInput>

  const bashRegex = /!`([^`]+)`/g
  const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
  const placeholderRegex = /\$(\d+)/g
  const quoteTrimRegex = /^["']|["']$/g

  /**
   * Resolve a slash command: parse arguments, expand `$N` placeholders,
   * inline any `!<shell>` snippets, pick the model, then call the model
   * loop with the resulting message parts.
   */
  export async function command(deps: Deps, payload: CommandInput): Promise<MessageV2.WithParts> {
    const input = CommandInput.parse(payload)
    const command = await deps.commandGet(input.command)
    if (!command) throw new Error(`Command "${input.command}" not found`)
    const agentName = command.agent ?? input.agent ?? (await deps.defaultAgent())
    const parsedGoal = input.command === Command.Default.GOAL ? SessionGoal.parseArguments(input.arguments) : undefined
    const commandArguments = parsedGoal?.type === "objective" ? parsedGoal.objective : input.arguments

    const raw = commandArguments.match(argsRegex) ?? []
    const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

    let templateCommand = await command.template
    if (parsedGoal?.type === "objective" && parsedGoal.tokenBudget !== undefined) {
      templateCommand = templateCommand.replace(
        "$ARGUMENTS",
        `$ARGUMENTS\n\nToken Budget: ${parsedGoal.tokenBudget} tokens`,
      )
    }

    const placeholders = templateCommand.match(placeholderRegex) ?? []
    let last = 0
    for (const item of placeholders) {
      const value = Number(item.slice(1))
      if (value > last) last = value
    }

    const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
      const position = Number(index)
      const argIndex = position - 1
      if (argIndex >= args.length) return ""
      if (position === last) return args.slice(argIndex).join(" ")
      return args[argIndex]
    })
    const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
    let template = withArgs.replaceAll("$ARGUMENTS", commandArguments)

    if (placeholders.length === 0 && !usesArgumentsPlaceholder && commandArguments.trim()) {
      template = template + "\n\n" + commandArguments
    }

    const shellMatches = ConfigMarkdown.shell(template)
    if (shellMatches.length > 0) {
      const results = await Promise.all(
        shellMatches.map(async ([, cmd]) => {
          try {
            return await $`${{ raw: cmd }}`.quiet().nothrow().text()
          } catch (error) {
            return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
          }
        }),
      )
      let index = 0
      template = template.replace(bashRegex, () => results[index++])
    }
    template = template.trim()

    const taskModel = await (async () => {
      if (command.model) {
        return Provider.parseModel(command.model)
      }
      if (command.agent) {
        const cmdAgent = await deps.agentGet(command.agent)
        if (cmdAgent?.model) {
          return cmdAgent.model
        }
      }
      if (input.model) return Provider.parseModel(input.model)
      return await deps.inheritedModel(input.sessionID, input.parentSessionID)
    })()

    try {
      await deps.providerGetModel(taskModel.providerID, taskModel.modelID)
    } catch (e) {
      if (e instanceof Provider.ModelNotFoundError) {
        const { providerID, modelID, suggestions } = e
        const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
        Bus.publish(Session.Event.Error, {
          sessionID: input.sessionID,
          error: EventError.unknown(`Model not found: ${providerID}/${modelID}.${hint}`),
        })
      }
      throw e
    }
    const agent = await deps.agentGet(agentName)
    if (!agent) {
      const available = await deps.agentList().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const agentNotFoundMsg = `Agent not found: "${agentName}".${hint}`
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: EventError.unknown(agentNotFoundMsg),
      })
      throw new Agent.NotFoundError({ name: agentName })
    }

    const isSubtask = (agent.mode === "subagent" && command.subtask !== false) || command.subtask === true
    const userAgent = isSubtask ? (input.agent ?? (await deps.defaultAgent())) : agentName
    const userModel = isSubtask
      ? input.model
        ? Provider.parseModel(input.model)
        : await deps.inheritedModel(input.sessionID, input.parentSessionID)
      : taskModel

    if (parsedGoal?.type === "subcommand") {
      const commandResult = await deps.runGoal(
        Effect.gen(function* () {
          const goal = yield* SessionGoal.Service
          if (parsedGoal.command === "pause") {
            const paused = yield* goal.pause(input.sessionID)
            return {
              text: paused ? `Goal paused: ${paused.objective}` : "No active goal to pause.",
              activeCommand: undefined,
            }
          }
          if (parsedGoal.command === "resume") {
            const resumed = yield* goal.resume(input.sessionID)
            return {
              text: resumed ? `Goal resumed: ${resumed.objective}` : "No paused goal to resume.",
              activeCommand: resumed ? "goal" : undefined,
            }
          }
          if (parsedGoal.command === "clear") {
            const existing = yield* goal.get(input.sessionID)
            yield* goal.clear(input.sessionID)
            return {
              text: existing ? `Goal cleared: ${existing.objective}` : "No active goal to clear.",
              activeCommand: undefined,
            }
          }
          const existing = yield* goal.get(input.sessionID)
          if (!existing) {
            return {
              text: "No active goal is set for this session.",
              activeCommand: undefined,
            }
          }
          const budget =
            existing.tokenBudget === undefined
              ? `Tokens: ${existing.tokensUsed}`
              : `Tokens: ${existing.tokensUsed} / ${existing.tokenBudget}`
          return {
            text: [
              `Objective: ${existing.objective}`,
              `Status: ${existing.status}`,
              budget,
              `Iterations: ${existing.iterationCount} / ${SessionGoal.MAX_ITERATIONS}`,
              `Time used: ${SessionGoal.formatDuration(existing.timeUsedSeconds)}`,
            ].join("\n"),
            activeCommand: existing.status === "active" || existing.status === "budget_limited" ? "goal" : undefined,
          }
        }),
      )
      await deps.sessionUpdate(input.sessionID, (draft) => {
        setOptional(draft, "activeCommand", commandResult.activeCommand)
      })
      const result = (await deps.prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        delivery: input.delivery,
        model: userModel,
        agent: userAgent,
        parts: [{ type: "text", text: commandResult.text }],
        variant: input.variant,
        noReply: true,
        ...(input.parentSessionID ? { parentSessionID: input.parentSessionID } : undefined),
      })) as MessageV2.WithParts
      Bus.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: commandArguments,
        messageID: result.info.id,
      })
      return result
    }

    if (parsedGoal?.type === "objective") {
      if (!parsedGoal.objective) throw new Error("You must provide a goal condition")
      await deps.runGoal(
        Effect.gen(function* () {
          const goal = yield* SessionGoal.Service
          yield* goal.set(input.sessionID, parsedGoal.objective, parsedGoal.tokenBudget)
        }),
      )
      await deps.sessionUpdate(input.sessionID, (draft) => {
        draft.activeCommand = "goal"
      })
    }

    const templateParts = await PromptParts.resolve(deps.currentContext(), template)
    const parts = isSubtask
      ? [
          {
            type: "subtask" as const,
            agent: agent.name,
            description: command.description ?? "",
            command: input.command,
            model: {
              providerID: taskModel.providerID,
              modelID: taskModel.modelID,
            },
            prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
          },
        ]
      : command.skill
        ? [
            {
              type: "text" as const,
              text: `/${command.name}`,
              synthetic: false,
            },
            ...templateParts.map((p) => (p.type === "text" ? { ...p, synthetic: true } : p)),
            ...(input.parts ?? []),
          ]
        : [...templateParts, ...(input.parts ?? [])]

    await deps.runPlugin(
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        yield* plugin.trigger(
          "command.execute.before",
          {
            command: input.command,
            sessionID: input.sessionID,
            arguments: commandArguments,
          },
          { parts },
        )
      }),
    )

    const result = (await deps.prompt({
      sessionID: input.sessionID,
      messageID: input.messageID,
      delivery: input.delivery,
      model: userModel,
      agent: userAgent,
      parts,
      variant: input.variant,
      ...(input.parentSessionID ? { parentSessionID: input.parentSessionID } : undefined),
    })) as MessageV2.WithParts

    Bus.publish(Command.Event.Executed, {
      name: input.command,
      sessionID: input.sessionID,
      arguments: commandArguments,
      messageID: result.info.id,
    })

    return result
  }
}
