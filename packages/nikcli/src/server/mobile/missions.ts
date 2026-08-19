import { Bus } from "@/bus"
import { generateFromDescription } from "@/mission/generate"
import * as MissionManager from "@/mission/manager"
import * as Engine from "@/mission/orchestrator"
import {
  generateID,
  MISSION_TEMPLATES,
  MissionDefinitionSchema,
  validateDefinition,
  type MissionDefinition,
} from "@/mission/schema"
import {
  log,
  MobileMissionFeatureMutateInput,
  MobileMissionGenerateInput,
  MobileMissionUpdateInput,
  MobileMissionWriteInput,
} from "./helpers"
import { MobileHttpError } from "./request"

const notFound = (id: string) => new MobileHttpError(`Mission "${id}" not found`, 404)

function runtimeOf(id: string) {
  return { missionID: id, ...Engine.getRuntime(id) }
}

export async function missionTemplates() {
  return { templates: MISSION_TEMPLATES }
}

export async function missionGenerate(input: typeof MobileMissionGenerateInput._output) {
  try {
    return await generateFromDescription(input.description, {
      model: input.model,
      agent: input.agent,
      sessionID: input.sessionID,
    })
  } catch (error) {
    throw new MobileHttpError(error instanceof Error ? error.message : String(error), 400)
  }
}

export async function missionExecsRecent(query: { limit?: number }) {
  const execs = await MissionManager.listRunningExecs()
  return { execs: execs.slice(0, query.limit ?? 50) }
}

export async function missionList() {
  const missions = await MissionManager.list()
  return { missions, runtimes: missions.map((mission) => runtimeOf(mission.id)) }
}

export async function missionCreate(input: typeof MobileMissionWriteInput._output) {
  // `MobileMissionWriteInput` is the definition minus the server-assigned
  // fields, but the schema's `.default()`s (`models`, `status`, per-feature
  // `dependsOn` / `status`) only apply through the full schema — the contract
  // decode does not run zod defaults, so `validateDefinition` would otherwise
  // iterate an absent `dependsOn`. Parse through the schema to normalize.
  const parsed = MissionDefinitionSchema.safeParse({ ...input, id: generateID(), createdAt: Date.now() })
  if (!parsed.success) throw new MobileHttpError("Validation failed", 400)
  const mission = parsed.data
  const error = validateDefinition(mission)
  if (error) throw new MobileHttpError(error, 400)
  const saved = await MissionManager.upsert(mission)
  void Bus.publish(Engine.MissionEvent.Upserted, { missionID: saved.id })
  return saved
}

export async function missionGet(id: string) {
  const existing = await MissionManager.get(id)
  if (!existing) throw notFound(id)
  return { mission: existing, runtime: runtimeOf(id) }
}

export async function missionUpdate(id: string, input: typeof MobileMissionUpdateInput._output) {
  if (!(await MissionManager.get(id))) throw notFound(id)
  const parsed = MissionDefinitionSchema.safeParse({ ...input, id })
  if (!parsed.success) throw new MobileHttpError("Validation failed", 400)
  const mission = parsed.data
  const error = validateDefinition(mission)
  if (error) throw new MobileHttpError(error, 400)
  const saved = await MissionManager.upsert(mission)
  void Bus.publish(Engine.MissionEvent.Upserted, { missionID: id })
  return saved
}

export async function missionDelete(id: string) {
  if (!(await MissionManager.get(id))) throw notFound(id)
  await Engine.cancel(id).catch((error) => log.warn("cancel on delete failed", { id, error }))
  const removed = await MissionManager.remove(id)
  if (!removed) throw notFound(id)
  void Bus.publish(Engine.MissionEvent.Removed, { missionID: id })
  return { success: true as const }
}

export async function missionExecs(id: string, query: { limit?: number }) {
  if (!(await MissionManager.get(id))) throw notFound(id)
  return { execs: await MissionManager.listExecs(id, query.limit ?? 50) }
}

export async function missionStart(id: string) {
  if (!(await MissionManager.get(id))) throw notFound(id)
  void Engine.start(id).catch((error) => log.error("mission start failed", { id, error }))
  return { success: true as const }
}

export async function missionPause(id: string) {
  if (!(await MissionManager.get(id))) throw notFound(id)
  await Engine.pause(id)
  return { success: true as const }
}

export async function missionCancel(id: string) {
  if (!(await MissionManager.get(id))) throw notFound(id)
  await Engine.cancel(id)
  return { success: true as const }
}

export async function missionFeatureMutate(
  id: string,
  featureID: string,
  input: typeof MobileMissionFeatureMutateInput._output,
) {
  const def = await MissionManager.get(id)
  if (!def) throw notFound(id)
  let foundFeature = false
  const milestones = def.milestones.map((milestone) => ({
    ...milestone,
    features: milestone.features.map((item) => {
      if (item.id !== featureID) return item
      foundFeature = true
      const next = { ...item }
      if (input.status !== undefined) next.status = input.status
      if (input.status === "done") next.error = undefined
      if (input.error !== undefined) next.error = input.error
      if (input.appendDependsOn && input.appendDependsOn.length > 0) {
        const known = new Set(milestone.features.map((sibling) => sibling.id))
        const extras = input.appendDependsOn.filter(
          (dep) => known.has(dep) && dep !== next.id && !next.dependsOn.includes(dep),
        )
        next.dependsOn = [...next.dependsOn, ...extras]
      }
      return next
    }),
  }))
  if (!foundFeature) throw new MobileHttpError(`Feature "${featureID}" not found`, 404)
  const updated: MissionDefinition = { ...def, milestones }
  const error = validateDefinition(updated)
  if (error) throw new MobileHttpError(error, 400)
  const saved = await MissionManager.upsert(updated)
  void Bus.publish(Engine.MissionEvent.Upserted, { missionID: saved.id })
  return saved
}
