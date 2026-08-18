import z from "zod"
import { Bus } from "@/bus"
import { generateFromDescription } from "@/mission/generate"
import * as MissionManager from "@/mission/manager"
import * as Engine from "@/mission/orchestrator"
import { generateID, MISSION_TEMPLATES, validateDefinition, type MissionDefinition } from "@/mission/schema"
import {
  log,
  MobileMissionFeatureMutateInput,
  MobileMissionGenerateInput,
  MobileMissionUpdateInput,
  MobileMissionWriteInput,
} from "./helpers"
import { body, isResponse, json, query } from "./request"

const match = (path: string, pattern: RegExp) => path.match(pattern)?.slice(1).map(decodeURIComponent)
const Limit = z.object({ limit: z.coerce.number().int().positive().max(200).optional() })
const found = (id: string) => json({ error: `Mission "${id}" not found` }, 404)

function runtimeOf(id: string) {
  return { missionID: id, ...Engine.getRuntime(id) }
}

export async function handleMissionsRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  if (!path.startsWith("/mobile/missions")) return

  if (path === "/mobile/missions/templates" && request.method === "GET") {
    return json({ templates: MISSION_TEMPLATES })
  }
  if (path === "/mobile/missions/generate" && request.method === "POST") {
    const input = await body(request, MobileMissionGenerateInput)
    if (isResponse(input)) return input
    try {
      return json(
        await generateFromDescription(input.description, {
          model: input.model,
          agent: input.agent,
          sessionID: input.sessionID,
        }),
      )
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
  }
  if (path === "/mobile/missions/execs/recent" && request.method === "GET") {
    const input = query(request, Limit)
    if (isResponse(input)) return input
    const execs = await MissionManager.listRunningExecs()
    return json({ execs: execs.slice(0, input.limit ?? 50) })
  }
  if (path === "/mobile/missions" && request.method === "GET") {
    const missions = await MissionManager.list()
    return json({ missions, runtimes: missions.map((mission) => runtimeOf(mission.id)) })
  }
  if (path === "/mobile/missions" && request.method === "POST") {
    const input = await body(request, MobileMissionWriteInput)
    if (isResponse(input)) return input
    const mission: MissionDefinition = {
      ...input,
      id: generateID(),
      createdAt: Date.now(),
      status: "ready",
      models: input.models ?? {},
    }
    const error = validateDefinition(mission)
    if (error) return json({ error }, 400)
    const saved = await MissionManager.upsert(mission)
    void Bus.publish(Engine.MissionEvent.Upserted, { missionID: saved.id })
    return json(saved)
  }

  const feature = match(path, /^\/mobile\/missions\/([^/]+)\/feature\/([^/]+)$/)
  if (feature && request.method === "POST") {
    const [id, featureID] = feature
    const def = await MissionManager.get(id)
    if (!def) return found(id)
    const input = await body(request, MobileMissionFeatureMutateInput)
    if (isResponse(input)) return input
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
    if (!foundFeature) return json({ error: `Feature "${featureID}" not found` }, 404)
    const updated: MissionDefinition = { ...def, milestones }
    const error = validateDefinition(updated)
    if (error) return json({ error }, 400)
    const saved = await MissionManager.upsert(updated)
    void Bus.publish(Engine.MissionEvent.Upserted, { missionID: saved.id })
    return json(saved)
  }

  const action = match(path, /^\/mobile\/missions\/([^/]+)\/(execs|start|pause|cancel)$/)
  if (action) {
    const [id, kind] = action
    if (!(await MissionManager.get(id))) return found(id)
    if (kind === "execs" && request.method === "GET") {
      const input = query(request, Limit)
      if (isResponse(input)) return input
      return json({ execs: await MissionManager.listExecs(id, input.limit ?? 50) })
    }
    if (request.method !== "POST") return
    if (kind === "start") {
      void Engine.start(id).catch((error) => log.error("mission start failed", { id, error }))
      return json({ success: true })
    }
    if (kind === "pause") {
      await Engine.pause(id)
      return json({ success: true })
    }
    await Engine.cancel(id)
    return json({ success: true })
  }

  const detail = match(path, /^\/mobile\/missions\/([^/]+)$/)
  if (!detail) return
  const id = detail[0]
  const existing = await MissionManager.get(id)
  if (!existing) return found(id)
  if (request.method === "GET") return json({ mission: existing, runtime: runtimeOf(id) })
  if (request.method === "PATCH" || request.method === "PUT") {
    const input = await body(request, MobileMissionUpdateInput)
    if (isResponse(input)) return input
    const next = { ...input, id }
    const error = validateDefinition(next)
    if (error) return json({ error }, 400)
    const saved = await MissionManager.upsert(next)
    void Bus.publish(Engine.MissionEvent.Upserted, { missionID: id })
    return json(saved)
  }
  if (request.method === "DELETE") {
    await Engine.cancel(id).catch((error) => log.warn("cancel on delete failed", { id, error }))
    const removed = await MissionManager.remove(id)
    if (!removed) return found(id)
    void Bus.publish(Engine.MissionEvent.Removed, { missionID: id })
    return json({ success: true })
  }
}
