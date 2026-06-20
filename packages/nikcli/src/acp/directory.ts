import { Log } from "@/util/log"
import { Provider } from "@/provider/provider"
import { Agent as AgentModule } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { withInstance } from "@/effect"
import { Effect } from "effect"

/**
 * Directory snapshot service.
 *
 * Mirrors opencode's `ACPDirectory` module: each call to `get` returns
 * a snapshot of the providers, modes, commands, and default model for
 * the given working directory. The snapshot is cached per-directory so
 * the protocol-level `NewSessionResponse` and `LoadSessionResponse`
 * payloads can be assembled cheaply.
 *
 * The snapshot also carries the variants per model so the `effort`
 * selector can be rendered alongside the model selector in clients.
 */

const log = Log.create({ service: "acp-directory" })

export type ModelOption = {
  readonly providerID: string
  readonly providerName: string
  readonly modelID: string
  readonly modelName: string
}

export type ModeOption = {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export type ModelVariants = NonNullable<Provider.Model["variants"]>

export type DefaultModel = {
  readonly providerID: string
  readonly modelID: string
}

export type Snapshot = {
  readonly directory: string
  readonly providers: Record<string, Provider.Info>
  readonly modelOptions: ReadonlyArray<ModelOption>
  readonly variantsByModel: Readonly<Record<string, ModelVariants>>
  readonly availableModes: ReadonlyArray<ModeOption>
  readonly defaultModeID: string
  readonly availableCommands: ReadonlyArray<Command.Info>
  readonly defaultModel?: DefaultModel
}

export type SnapshotInput = {
  readonly directory: string
  readonly providers: Record<string, Provider.Info>
  readonly modes: ReadonlyArray<ModeOption>
  readonly defaultModeID: string
  readonly commands: ReadonlyArray<Command.Info>
  readonly defaultModel?: DefaultModel
}

export const modelKey = (model: { providerID: string; modelID: string }) => `${model.providerID}/${model.modelID}`

/**
 * Compute the variant map for a provider/model. Used by the `effort`
 * selector so a client can switch variant on the fly.
 */
export function variants(
  snapshot: Snapshot,
  model: { providerID: string; modelID: string },
): ModelVariants | undefined {
  return snapshot.variantsByModel[modelKey(model)]
}

/**
 * Pure builder that turns raw provider / agent / command metadata into a
 * `Snapshot`. Kept pure so tests can construct snapshots without spinning
 * up the service layer.
 */
export function build(input: SnapshotInput): Snapshot {
  const modelOptions: ModelOption[] = []
  const variantsByModel: Record<string, ModelVariants> = {}

  for (const provider of Object.values(input.providers)) {
    for (const model of Object.values(provider.models)) {
      modelOptions.push({
        providerID: provider.id,
        providerName: provider.name,
        modelID: model.id,
        modelName: model.name,
      })
      if (model.variants) {
        variantsByModel[modelKey({ providerID: provider.id, modelID: model.id })] = model.variants
      }
    }
  }

  // Sort so the dropdown order matches what nikcli's own UI shows.
  modelOptions.sort((a, b) => {
    const name = a.providerName.localeCompare(b.providerName)
    if (name !== 0) return name
    return a.modelName.localeCompare(b.modelName)
  })

  const modeIds = new Set(input.modes.map((m) => m.id))
  const defaultModeID = modeIds.has(input.defaultModeID)
    ? input.defaultModeID
    : (input.modes[0]?.id ?? input.defaultModeID)

  return {
    directory: input.directory,
    providers: input.providers,
    modelOptions,
    variantsByModel,
    availableModes: input.modes,
    defaultModeID,
    availableCommands: [...input.commands].toSorted((a, b) => a.name.localeCompare(b.name)),
    ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
  }
}

/**
 * Pull the live provider / agent / command / config state for
 * `directory` and assemble a `Snapshot`. Uses `withInstance` so the
 * Effect services run inside the directory's instance scope and read
 * the right config.
 */
export async function loadSnapshot(directory: string): Promise<Snapshot> {
  const providersRecord = await withInstance(
    { directory },
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* provider.list()
    }).pipe(Effect.provide(Provider.defaultLayer)),
  )
  const agents = await withInstance(
    { directory },
    Effect.gen(function* () {
      const agent = yield* AgentModule.Service
      return yield* agent.list()
    }).pipe(Effect.provide(AgentModule.defaultLayer)),
  )
  const defaultAgent = await withInstance(
    { directory },
    Effect.gen(function* () {
      const agent = yield* AgentModule.Service
      return yield* agent.defaultAgent()
    }).pipe(Effect.provide(AgentModule.defaultLayer)),
  ).catch(() => "build")
  const commands = await withInstance(
    { directory },
    Effect.gen(function* () {
      const command = yield* Command.Service
      return yield* command.list()
    }).pipe(Effect.provide(Command.defaultLayer)),
  )

  let configuredModel: DefaultModel | undefined
  try {
    const configInfo = await withInstance(
      { directory },
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }).pipe(Effect.provide(Config.defaultLayer)),
    )
    const configured = (configInfo as { model?: unknown }).model
    if (typeof configured === "string") {
      const parsed = Provider.parseModel(configured)
      if (providersRecord[parsed.providerID]?.models[parsed.modelID]) {
        configuredModel = {
          providerID: parsed.providerID,
          modelID: parsed.modelID,
        }
      }
    }
  } catch (error) {
    log.debug("failed to load configured default model", { error })
  }

  const modes: ModeOption[] = agents
    .filter((agent) => agent.mode !== "subagent" && agent.hidden !== true)
    .map((agent) => ({
      id: agent.name,
      name: agent.name,
      ...(agent.description ? { description: agent.description } : {}),
    }))

  return build({
    directory,
    providers: providersRecord,
    modes,
    defaultModeID: defaultAgent,
    commands,
    ...(configuredModel ? { defaultModel: configuredModel } : {}),
  })
}

export * as ACPDirectory from "./directory"
