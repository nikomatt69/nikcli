import z from "zod"
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
import { body, isResponse, json, query } from "./request"

const match = (path: string, pattern: RegExp) => path.match(pattern)?.slice(1).map(decodeURIComponent)
const Limit = z.object({ limit: z.coerce.number().int().positive().max(200).optional() })
const found = (id: string) => json({ error: `Loop "${id}" not found` }, 404)
const routineFound = (id: string) => json({ error: `Routine "${id}" not found` }, 404)

export async function handleLoopsRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  if (!path.startsWith("/mobile/loops") && !path.startsWith("/mobile/routines")) return
  if (path === "/mobile/loops/templates" && request.method === "GET") return json({ templates: LOOP_TEMPLATES })
  if (path === "/mobile/loops/generate" && request.method === "POST") {
    const input = await body(request, MobileLoopGenerateInput)
    if (isResponse(input)) return input
    return json(await generateFromDescription(input.description, { model: input.model, agent: input.agent }))
  }
  if (path === "/mobile/loops/runs/recent" && request.method === "GET") {
    const input = query(request, Limit)
    if (isResponse(input)) return input
    return json({ runs: await LoopManager.listAllRunsAcrossLoops(input.limit ?? 50) })
  }
  if (path === "/mobile/loops" && request.method === "GET") {
    const loops = await LoopManager.list()
    return json({ loops, runtimes: loops.map((loop) => ({ loopID: loop.id, ...LoopEngine.getRuntime(loop.id) })) })
  }
  if (path === "/mobile/loops" && request.method === "POST") {
    const input = await body(request, MobileLoopWriteInput)
    if (isResponse(input)) return input
    const loop: LoopDefinition = { ...input, id: generateID(), createdAt: Date.now(), enabled: input.enabled ?? true }
    const error = validateDefinition(loop)
    if (error) return json({ error }, 400)
    const saved = await LoopManager.upsert(loop)
    await LoopEngine.sync(saved.id)
    void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: saved.id })
    return json(saved)
  }
  const action = match(path, /^\/mobile\/loops\/([^/]+)\/(runs|run|abort|toggle|pause|resume)$/)
  if (action) {
    const [id, kind] = action
    if (kind === "runs" && request.method === "GET") {
      const input = query(request, Limit)
      if (isResponse(input)) return input
      return json({ runs: await LoopManager.listRuns(id, input.limit ?? 50) })
    }
    if (request.method !== "POST") return
    if (kind === "toggle") {
      const input = await body(request, z.object({ enabled: z.boolean() }))
      if (isResponse(input)) return input
      const next = await LoopManager.setEnabled(id, input.enabled)
      if (!next) return found(id)
      await LoopEngine.sync(id)
      void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: id })
      return json(next)
    }
    if (!(await LoopManager.get(id))) return found(id)
    if (kind === "run") {
      void LoopEngine.runOnce(id).catch((error) => log.error("loop run failed", { id, error }))
    } else if (kind === "abort") await LoopEngine.cancelRun(id)
    else if (kind === "pause") {
      await LoopManager.setPaused(id, true)
      LoopEngine.disarm(id)
      LoopEngine.setRuntimeStatus(id, "paused")
    } else if (kind === "resume") {
      await LoopManager.setPaused(id, false)
      LoopEngine.setRuntimeStatus(id, "idle")
      await LoopEngine.sync(id)
    } else return
    return json({ success: true })
  }
  const detail = match(path, /^\/mobile\/loops\/([^/]+)$/)
  if (detail) {
    const id = detail[0]
    const existing = await LoopManager.get(id)
    if (!existing) return found(id)
    if (request.method === "GET") return json({ loop: existing, runtime: { loopID: id, ...LoopEngine.getRuntime(id) } })
    if (request.method === "PATCH") {
      const input = await body(request, MobileLoopWriteInput)
      if (isResponse(input)) return input
      const next: LoopDefinition = { ...input, id, createdAt: existing.createdAt }
      const error = validateDefinition(next)
      if (error) return json({ error }, 400)
      const saved = await LoopManager.upsert(next)
      await LoopEngine.sync(id)
      void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: id })
      return json(saved)
    }
    if (request.method === "DELETE") {
      await LoopEngine.cancelRun(id)
      await LoopManager.remove(id)
      LoopEngine.disarm(id)
      void Bus.publish(LoopEngine.LoopEvent.Removed, { loopID: id })
      return json({ success: true })
    }
  }
  if (path === "/mobile/routines" && request.method === "GET") return json(await Routine.list())
  if (path === "/mobile/routines" && request.method === "POST") {
    const input = await body(request, MobileRoutineCreateInput)
    return isResponse(input) ? input : json(await Routine.create(input))
  }
  const trigger = match(path, /^\/mobile\/routines\/trigger\/([^/]+)$/)
  if (trigger && request.method === "POST") {
    const input = await body(request, MobileRoutineTriggerInput.optional())
    if (isResponse(input)) return input
    const bearer = request.headers
      .get("authorization")
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim()
    const routine = await Routine.getByToken(bearer || trigger[0])
    if (!routine) return json({ error: "Routine not found or API trigger disabled" }, 404)
    return json(await Routine.run(routine.id, { text: input?.text }))
  }
  const routineAction = match(path, /^\/mobile\/routines\/([^/]+)\/(run|pause|resume)$/)
  if (routineAction && request.method === "POST") {
    const [id, kind] = routineAction
    if (!(await Routine.get(id))) return routineFound(id)
    if (kind === "pause") return json(await Routine.pause(id))
    if (kind === "resume") return json(await Routine.resume(id))
    const input = await body(request, MobileRoutineRunInput.optional())
    return isResponse(input) ? input : json(await Routine.run(id, { text: input?.text }))
  }
  const routine = match(path, /^\/mobile\/routines\/([^/]+)$/)
  if (routine) {
    const id = routine[0]
    if (request.method === "GET") {
      const record = await Routine.get(id)
      if (!record) return routineFound(id)
      return json(record)
    }
    if (request.method === "PATCH") {
      if (!(await Routine.get(id))) return routineFound(id)
      const input = await body(request, MobileRoutineUpdateInput)
      return isResponse(input) ? input : json(await Routine.update(id, input))
    }
    if (request.method === "DELETE") {
      if (!(await Routine.get(id))) return routineFound(id)
      await Routine.remove(id)
      return json({ success: true })
    }
  }
}
