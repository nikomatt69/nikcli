import { Bus } from "@/bus"
import * as LoopEngine from "@/loop/engine"
import * as LoopManager from "@/loop/manager"
import { LOOP_TEMPLATES, generateID, validateDefinition, type LoopDefinition } from "@/loop/schema"
import { Routine } from "@/mobile/routine"
import { generateFromDescription } from "@/loop/generate"
import {
  log,
  MobileLoopGenerateInput,
  MobileLoopWriteInput,
  MobileRoutineCreateInput,
  MobileRoutineRunInput,
  MobileRoutineTriggerInput,
  MobileRoutineUpdateInput,
} from "./helpers"
import { MobileHttpError } from "./request"
import type { InstanceContext } from "@/effect"

const notFound = (id: string) => new MobileHttpError(`Loop "${id}" not found`, 404)
const routineNotFound = (id: string) => new MobileHttpError(`Routine "${id}" not found`, 404)

export async function loopTemplates() {
  return { templates: LOOP_TEMPLATES }
}

export function loopGenerate(input: typeof MobileLoopGenerateInput._output) {
  return generateFromDescription(input.description, {
    model: input.model,
    agent: input.agent,
    sessionID: input.sessionID,
  })
}

export async function loopRunsRecent(instance: InstanceContext, query: { limit?: number }) {
  return { runs: await LoopManager.listAllRunsAcrossLoops(instance.project.id, query.limit ?? 50) }
}

export async function loopList(instance: InstanceContext) {
  const loops = await LoopManager.list(instance.project.id)
  return { loops, runtimes: loops.map((loop) => ({ loopID: loop.id, ...LoopEngine.getRuntime(loop.id) })) }
}

export async function loopCreate(instance: InstanceContext, input: typeof MobileLoopWriteInput._output) {
  const loop: LoopDefinition = { ...input, id: generateID(), createdAt: Date.now(), enabled: input.enabled ?? true }
  const error = validateDefinition(loop)
  if (error) throw new MobileHttpError(error, 400)
  const saved = await LoopManager.upsert(instance.project.id, loop)
  await LoopEngine.sync(saved.id)
  void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: saved.id })
  return saved
}

export async function loopGet(instance: InstanceContext, id: string) {
  const existing = await LoopManager.get(instance.project.id, id)
  if (!existing) throw notFound(id)
  return { loop: existing, runtime: { loopID: id, ...LoopEngine.getRuntime(id) } }
}

export async function loopUpdate(instance: InstanceContext, id: string, input: typeof MobileLoopWriteInput._output) {
  const existing = await LoopManager.get(instance.project.id, id)
  if (!existing) throw notFound(id)
  const next: LoopDefinition = { ...input, id, createdAt: existing.createdAt }
  const error = validateDefinition(next)
  if (error) throw new MobileHttpError(error, 400)
  const saved = await LoopManager.upsert(instance.project.id, next)
  await LoopEngine.sync(id)
  void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: id })
  return saved
}

export async function loopDelete(instance: InstanceContext, id: string) {
  if (!(await LoopManager.get(instance.project.id, id))) throw notFound(id)
  await LoopEngine.cancelRun(id)
  await LoopManager.remove(instance.project.id, instance.directory, id)
  LoopEngine.disarm(id)
  void Bus.publish(LoopEngine.LoopEvent.Removed, { loopID: id })
  return { success: true as const }
}

export async function loopRuns(instance: InstanceContext, id: string, query: { limit?: number }) {
  return { runs: await LoopManager.listRuns(instance.project.id, id, query.limit ?? 50) }
}

export async function loopRun(instance: InstanceContext, id: string) {
  if (!(await LoopManager.get(instance.project.id, id))) throw notFound(id)
  void LoopEngine.runOnce(id).catch((error) => log.error("loop run failed", { id, error }))
  return { success: true as const }
}

export async function loopAbort(instance: InstanceContext, id: string) {
  if (!(await LoopManager.get(instance.project.id, id))) throw notFound(id)
  await LoopEngine.cancelRun(id)
  return { success: true as const }
}

export async function loopToggle(instance: InstanceContext, id: string, input: { enabled: boolean }) {
  const next = await LoopManager.setEnabled(instance.project.id, id, input.enabled)
  if (!next) throw notFound(id)
  await LoopEngine.sync(id)
  void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: id })
  return next
}

export async function loopPause(instance: InstanceContext, id: string) {
  if (!(await LoopManager.get(instance.project.id, id))) throw notFound(id)
  await LoopManager.setPaused(instance.project.id, id, true)
  LoopEngine.disarm(id)
  LoopEngine.setRuntimeStatus(id, "paused")
  return { success: true as const }
}

export async function loopResume(instance: InstanceContext, id: string) {
  if (!(await LoopManager.get(instance.project.id, id))) throw notFound(id)
  await LoopManager.setPaused(instance.project.id, id, false)
  LoopEngine.setRuntimeStatus(id, "idle")
  await LoopEngine.sync(id)
  return { success: true as const }
}

export function routineList(instance: InstanceContext) {
  return Routine.list(instance)
}

export function routineCreate(instance: InstanceContext, input: typeof MobileRoutineCreateInput._output) {
  return Routine.create(instance, input)
}

export async function routineGet(instance: InstanceContext, id: string) {
  const record = await Routine.get(instance, id)
  if (!record) throw routineNotFound(id)
  return record
}

export async function routineUpdate(
  instance: InstanceContext,
  id: string,
  input: typeof MobileRoutineUpdateInput._output,
) {
  if (!(await Routine.get(instance, id))) throw routineNotFound(id)
  return Routine.update(instance, id, input)
}

export async function routineDelete(instance: InstanceContext, id: string) {
  if (!(await Routine.get(instance, id))) throw routineNotFound(id)
  await Routine.remove(instance, id)
  return { success: true as const }
}

export async function routineRun(
  instance: InstanceContext,
  id: string,
  input: typeof MobileRoutineRunInput._output | void,
) {
  if (!(await Routine.get(instance, id))) throw routineNotFound(id)
  return Routine.run(instance, id, { text: input?.text })
}

export async function routinePause(instance: InstanceContext, id: string) {
  if (!(await Routine.get(instance, id))) throw routineNotFound(id)
  return Routine.pause(instance, id)
}

export async function routineResume(instance: InstanceContext, id: string) {
  if (!(await Routine.get(instance, id))) throw routineNotFound(id)
  return Routine.resume(instance, id)
}

export async function routineTrigger(
  instance: InstanceContext,
  token: string,
  input: typeof MobileRoutineTriggerInput._output | void,
  bearer: string | undefined,
) {
  const routine = await Routine.getByToken(instance, bearer || token)
  if (!routine) throw new MobileHttpError("Routine not found or API trigger disabled", 404)
  return Routine.run(instance, routine.id, { text: input?.text })
}
