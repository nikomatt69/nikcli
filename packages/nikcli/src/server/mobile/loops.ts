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

export async function loopRunsRecent(query: { limit?: number }) {
  return { runs: await LoopManager.listAllRunsAcrossLoops(query.limit ?? 50) }
}

export async function loopList() {
  const loops = await LoopManager.list()
  return { loops, runtimes: loops.map((loop) => ({ loopID: loop.id, ...LoopEngine.getRuntime(loop.id) })) }
}

export async function loopCreate(input: typeof MobileLoopWriteInput._output) {
  const loop: LoopDefinition = { ...input, id: generateID(), createdAt: Date.now(), enabled: input.enabled ?? true }
  const error = validateDefinition(loop)
  if (error) throw new MobileHttpError(error, 400)
  const saved = await LoopManager.upsert(loop)
  await LoopEngine.sync(saved.id)
  void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: saved.id })
  return saved
}

export async function loopGet(id: string) {
  const existing = await LoopManager.get(id)
  if (!existing) throw notFound(id)
  return { loop: existing, runtime: { loopID: id, ...LoopEngine.getRuntime(id) } }
}

export async function loopUpdate(id: string, input: typeof MobileLoopWriteInput._output) {
  const existing = await LoopManager.get(id)
  if (!existing) throw notFound(id)
  const next: LoopDefinition = { ...input, id, createdAt: existing.createdAt }
  const error = validateDefinition(next)
  if (error) throw new MobileHttpError(error, 400)
  const saved = await LoopManager.upsert(next)
  await LoopEngine.sync(id)
  void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: id })
  return saved
}

export async function loopDelete(id: string) {
  if (!(await LoopManager.get(id))) throw notFound(id)
  await LoopEngine.cancelRun(id)
  await LoopManager.remove(id)
  LoopEngine.disarm(id)
  void Bus.publish(LoopEngine.LoopEvent.Removed, { loopID: id })
  return { success: true as const }
}

export async function loopRuns(id: string, query: { limit?: number }) {
  return { runs: await LoopManager.listRuns(id, query.limit ?? 50) }
}

export async function loopRun(id: string) {
  if (!(await LoopManager.get(id))) throw notFound(id)
  void LoopEngine.runOnce(id).catch((error) => log.error("loop run failed", { id, error }))
  return { success: true as const }
}

export async function loopAbort(id: string) {
  if (!(await LoopManager.get(id))) throw notFound(id)
  await LoopEngine.cancelRun(id)
  return { success: true as const }
}

export async function loopToggle(id: string, input: { enabled: boolean }) {
  const next = await LoopManager.setEnabled(id, input.enabled)
  if (!next) throw notFound(id)
  await LoopEngine.sync(id)
  void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: id })
  return next
}

export async function loopPause(id: string) {
  if (!(await LoopManager.get(id))) throw notFound(id)
  await LoopManager.setPaused(id, true)
  LoopEngine.disarm(id)
  LoopEngine.setRuntimeStatus(id, "paused")
  return { success: true as const }
}

export async function loopResume(id: string) {
  if (!(await LoopManager.get(id))) throw notFound(id)
  await LoopManager.setPaused(id, false)
  LoopEngine.setRuntimeStatus(id, "idle")
  await LoopEngine.sync(id)
  return { success: true as const }
}

export function routineList() {
  return Routine.list()
}

export function routineCreate(input: typeof MobileRoutineCreateInput._output) {
  return Routine.create(input)
}

export async function routineGet(id: string) {
  const record = await Routine.get(id)
  if (!record) throw routineNotFound(id)
  return record
}

export async function routineUpdate(id: string, input: typeof MobileRoutineUpdateInput._output) {
  if (!(await Routine.get(id))) throw routineNotFound(id)
  return Routine.update(id, input)
}

export async function routineDelete(id: string) {
  if (!(await Routine.get(id))) throw routineNotFound(id)
  await Routine.remove(id)
  return { success: true as const }
}

export async function routineRun(id: string, input: typeof MobileRoutineRunInput._output | void) {
  if (!(await Routine.get(id))) throw routineNotFound(id)
  return Routine.run(id, { text: input?.text })
}

export async function routinePause(id: string) {
  if (!(await Routine.get(id))) throw routineNotFound(id)
  return Routine.pause(id)
}

export async function routineResume(id: string) {
  if (!(await Routine.get(id))) throw routineNotFound(id)
  return Routine.resume(id)
}

export async function routineTrigger(
  token: string,
  input: typeof MobileRoutineTriggerInput._output | void,
  bearer: string | undefined,
) {
  const routine = await Routine.getByToken(bearer || token)
  if (!routine) throw new MobileHttpError("Routine not found or API trigger disabled", 404)
  return Routine.run(routine.id, { text: input?.text })
}
