import { randomBytes } from "crypto"
import { adjectives, animals, colors, uniqueNamesGenerator } from "unique-names-generator"
import z from "zod"
import { Instance } from "@/project/instance"
import { Scheduler } from "@/scheduler"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import { Provider } from "@/provider/provider"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"

function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
  return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
}

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function defaultProviderModel() {
  return runProvider(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* provider.defaultModel()
    }),
  )
}

function storageRead<T>(key: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.read<T>(key)
    }),
  )
}

function storageWrite<T>(key: string[], content: T) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.write(key, content)
    }),
  )
}

function storageUpdate<T>(key: string[], fn: (draft: T) => void) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.update(key, fn)
    }),
  )
}

function storageRemove(key: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.remove(key)
    }),
  )
}

function storageList(prefix: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.list(prefix)
    }),
  )
}

export namespace Routine {
  const log = Log.create({ service: "routine" })

  // ── Zod schemas ────────────────────────────────────────────────────────────

  export const TriggerSchedule = z
    .object({
      type: z.literal("schedule"),
      cron: z.string(),
      enabled: z.boolean(),
    })
    .meta({ ref: "RoutineTriggerSchedule" })

  export const TriggerApi = z
    .object({
      type: z.literal("api"),
      token: z.string(),
      enabled: z.boolean(),
    })
    .meta({ ref: "RoutineTriggerApi" })

  export const Trigger = z.discriminatedUnion("type", [TriggerSchedule, TriggerApi]).meta({ ref: "RoutineTrigger" })

  export const Record = z
    .object({
      id: z.string(),
      name: z.string(),
      prompt: z.string(),
      triggers: z.array(Trigger),
      model: z
        .object({
          providerID: z.string(),
          modelID: z.string(),
        })
        .optional(),
      paused: z.boolean(),
      projectID: z.string(),
      directory: z.string(),
      createdAt: z.number(),
      updatedAt: z.number(),
      lastRunAt: z.number().optional(),
      lastSessionID: z.string().optional(),
    })
    .meta({ ref: "Routine" })

  export const CreateInput = z
    .object({
      name: z.string().trim().min(1),
      prompt: z.string().trim().min(1),
      triggers: z.array(Trigger).optional(),
      model: z
        .object({
          providerID: z.string(),
          modelID: z.string(),
        })
        .optional(),
    })
    .meta({ ref: "RoutineCreateInput" })

  export const UpdateInput = CreateInput.partial()
    .extend({ paused: z.boolean().optional() })
    .meta({ ref: "RoutineUpdateInput" })

  // ── Types ──────────────────────────────────────────────────────────────────

  export type TriggerSchedule = z.infer<typeof TriggerSchedule>
  export type TriggerApi = z.infer<typeof TriggerApi>
  export type Trigger = z.infer<typeof Trigger>
  export type Record = z.infer<typeof Record>
  export type CreateInput = z.infer<typeof CreateInput>
  export type UpdateInput = z.infer<typeof UpdateInput>

  // ── Storage key ───────────────────────────────────────────────────────────

  function key(id: string) {
    return ["routine", Instance.project.id, id]
  }

  function generateID() {
    return uniqueNamesGenerator({ dictionaries: [adjectives, colors, animals], separator: "-", length: 3 })
  }

  function generateApiToken() {
    return `nkr_${randomBytes(32).toString("hex")}`
  }

  // ── Cron interval parser ───────────────────────────────────────────────────

  export const SUPPORTED_CRON_HELP = "Supported schedules: @hourly, @daily, @weekly, */N minutes, or 0 */N * * * hours."

  export function parseCronInterval(cron: string): number | null {
    const trimmed = cron.trim()

    if (trimmed === "@hourly") return 60 * 60 * 1000
    if (trimmed === "@daily") return 24 * 60 * 60 * 1000
    if (trimmed === "@weekly") return 7 * 24 * 60 * 60 * 1000

    // */N (minutes) — e.g. "*/15"
    const everyNMinutes = trimmed.match(/^\*\/(\d+)$/)
    if (everyNMinutes) {
      const n = Number.parseInt(everyNMinutes[1], 10)
      if (n > 0) return n * 60 * 1000
    }

    // 0 */N * * * (hours) — e.g. "0 */2 * * *"
    const everyNHours = trimmed.match(/^0 \*\/(\d+) \* \* \*$/)
    if (everyNHours) {
      const n = Number.parseInt(everyNHours[1], 10)
      if (n > 0) return n * 60 * 60 * 1000
    }

    return null
  }

  function validateTriggers(triggers: Trigger[]) {
    for (const trigger of triggers) {
      if (trigger.type === "schedule" && trigger.enabled && !parseCronInterval(trigger.cron)) {
        throw new Error(`Unsupported cron pattern "${trigger.cron}". ${SUPPORTED_CRON_HELP}`)
      }
    }
  }

  // ── Scheduler helpers ──────────────────────────────────────────────────────

  function schedulerID(id: string) {
    return `routine-${id}`
  }

  function unregisterScheduler(id: string) {
    Scheduler.unregister(schedulerID(id), "instance")
  }

  function registerScheduler(routine: Record) {
    const scheduleTrigger = routine.triggers.find((t): t is TriggerSchedule => t.type === "schedule" && t.enabled)
    if (!scheduleTrigger || routine.paused) {
      unregisterScheduler(routine.id)
      return
    }

    const intervalMs = parseCronInterval(scheduleTrigger.cron)
    if (!intervalMs) {
      unregisterScheduler(routine.id)
      log.warn("unrecognized cron pattern, skipping scheduler registration", {
        id: routine.id,
        cron: scheduleTrigger.cron,
      })
      return
    }

    log.info("registering scheduler", { id: routine.id, cron: scheduleTrigger.cron, intervalMs })

    Scheduler.register({
      id: schedulerID(routine.id),
      interval: intervalMs,
      scope: "instance",
      skipInitialRun: true,
      run: async () => {
        await withInstanceAsync({ directory: routine.directory }, () => run(routine.id))
      },
    })
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  export async function list(): Promise<Record[]> {
    const keys = await storageList(["routine", Instance.project.id])
    const records = await Promise.all(keys.map((k) => storageRead<Record>(k).catch(() => null)))
    return records.filter((r): r is Record => r !== null).sort((a, b) => b.createdAt - a.createdAt)
  }

  export async function get(id: string): Promise<Record> {
    return storageRead<Record>(key(id))
  }

  export async function getByToken(token: string): Promise<Record | null> {
    const all = await list()
    return (
      all.find((r) => r.triggers.some((t): t is TriggerApi => t.type === "api" && t.enabled && t.token === token)) ??
      null
    )
  }

  export async function create(input: CreateInput): Promise<Record> {
    const id = generateID()
    const now = Date.now()

    // Auto-inject an API trigger token if none supplied
    const triggers: Trigger[] = input.triggers ?? []
    validateTriggers(triggers)
    const hasApiTrigger = triggers.some((t) => t.type === "api")
    if (!hasApiTrigger) {
      triggers.push({ type: "api", token: generateApiToken(), enabled: false })
    }

    // Capture the default model if not explicitly provided
    let model: Record["model"] = input.model
    if (!model) {
      model = await defaultProviderModel()
    }

    const record: Record = {
      id,
      name: input.name,
      prompt: input.prompt,
      triggers,
      model,
      paused: false,
      projectID: Instance.project.id,
      directory: Instance.directory,
      createdAt: now,
      updatedAt: now,
    }

    await storageWrite(key(id), record)
    log.info("created", { id, name: record.name })
    registerScheduler(record)
    return record
  }

  export async function update(id: string, input: UpdateInput): Promise<Record> {
    if (input.triggers) validateTriggers(input.triggers)
    const record = await storageUpdate<Record>(key(id), (draft) => {
      if (input.name !== undefined) draft.name = input.name
      if (input.prompt !== undefined) draft.prompt = input.prompt
      if (input.triggers !== undefined) draft.triggers = input.triggers
      if (input.paused !== undefined) draft.paused = input.paused
      if (input.model !== undefined) draft.model = input.model
      draft.updatedAt = Date.now()
    })
    registerScheduler(record)
    return record
  }

  export async function remove(id: string): Promise<void> {
    unregisterScheduler(id)
    await storageRemove(key(id))
    log.info("removed", { id })
  }

  export async function pause(id: string): Promise<Record> {
    return update(id, { paused: true })
  }

  export async function resume(id: string): Promise<Record> {
    return update(id, { paused: false })
  }

  // ── Run ────────────────────────────────────────────────────────────────────

  export async function run(
    id: string,
    input?: { text?: string; model?: { providerID: string; modelID: string } },
  ): Promise<Session.Info> {
    const routine = await get(id)
    log.info("running", { id, name: routine.name, model: input?.model ?? routine.model })

    const session = await runSession(
      Effect.gen(function* () {
        const sessionService = yield* Session.Service
        return yield* sessionService.create({ title: `Routine: ${routine.name}` })
      }),
    )
    const text = input?.text?.trim()
    const prompt = text ? `${routine.prompt}\n\nRun context:\n${text}` : routine.prompt

    // Resolve the model to use: input > routine record > global default
    const modelToUse = input?.model ?? routine.model ?? (await defaultProviderModel())

    // Fire-and-forget the prompt — the route caller can track via the session ID
    void runSessionPrompt(
      Effect.gen(function* () {
        const sessionPrompt = yield* SessionPrompt.Service
        return yield* sessionPrompt.prompt({
          sessionID: session.id,
          parts: [{ type: "text", text: prompt }],
          model: modelToUse,
        })
      }),
    )

    await storageUpdate<Record>(key(id), (draft) => {
      draft.lastRunAt = Date.now()
      draft.lastSessionID = session.id
      draft.updatedAt = Date.now()
    })

    return session
  }

  // ── Bootstrap: re-register all active schedules on startup ─────────────────

  export async function restoreSchedulers(): Promise<void> {
    try {
      const records = await list()
      for (const record of records) {
        registerScheduler(record)
      }
      log.info("restored schedulers", { count: records.length })
    } catch (error) {
      log.error("failed to restore schedulers", { error })
    }
  }
}
