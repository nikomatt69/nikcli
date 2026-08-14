import { Log } from "@nikcli-ai/util/log"
import { Database } from "@/database/database"
import { Instance } from "@/project/instance"
import { Config } from "@/config/config"
import { Skill } from "@/skill"
import { Profile } from "@/profile"
import { runPromiseWithLayer, withCurrentInstance, type InstanceContext } from "@/effect"
import { Effect } from "effect"
import { SyncEvent } from "@/sync/sync-event"
import type { SyncEventRecord } from "@/sync/index"
import { workMap } from "@/util/queue"
import {
  InstructionKey,
  INSTRUCTION_REMOVED,
  canonicalJson,
  collectSystemPaths,
  hashInstructionBody,
  parseInstructionKey,
  readFileSource,
  readUrlSource,
  type InstructionBlobBody,
  type InstructionRead,
} from "./instruction"
import { InstructionRepo } from "./instruction-repo"
import { SessionSync } from "./projectors"
import { SystemPrompt } from "./system"

const log = Log.create({ service: "instruction-sync" })

export const INSTRUCTION_EVENT_TYPE = "session.instructions.updated"
export const INSTRUCTION_EVENT_LOGGED = "session.instructions.updated.1"

export namespace InstructionSync {
  export type AssembleResult = {
    system: string[]
    skillMessages: string[]
    updates: Array<{ role: "user"; content: string }>
    delta?: Record<string, string>
    blocked: boolean
  }

  export type CommitResult = {
    delta?: Record<string, string>
    blocked: boolean
  }

  export function diff(
    stored: Record<string, string> | undefined,
    reads: InstructionRead[],
  ): {
    delta: Record<string, string>
    blobs: Array<{ hash: string; body: string }>
    blocked: boolean
    present: string[]
  } {
    const initial = stored === undefined
    const delta: Record<string, string> = {}
    const blobs: Array<{ hash: string; body: string }> = []
    const present: string[] = []
    let blocked = false
    const seen = new Set<string>()

    for (const read of reads) {
      seen.add(read.key)
      if (read.status === "unavailable") {
        if (initial) blocked = true
        continue
      }
      if (read.status === "removed") {
        if (stored && stored[read.key]) delta[read.key] = INSTRUCTION_REMOVED
        continue
      }
      const body = canonicalJson(read.body)
      const hash = hashInstructionBody(read.body)
      present.push(read.key)
      blobs.push({ hash, body })
      if (!stored || stored[read.key] !== hash) delta[read.key] = hash
    }

    if (!initial) {
      for (const key of Object.keys(stored)) {
        if (!seen.has(key)) delta[key] = INSTRUCTION_REMOVED
      }
    }

    return { delta, blobs, blocked, present }
  }

  export function commit(sessionID: string, projectID: string, reads: InstructionRead[]): CommitResult {
    SessionSync.install()
    const current = InstructionRepo.get(sessionID)
    const { delta, blobs, blocked } = diff(current ? current.data.values : undefined, reads)
    if (blocked) return { blocked: true }
    if (Object.keys(delta).length === 0) return { blocked: false }

    Database.transaction((tx) => {
      InstructionRepo.putBlobs(blobs, tx)
      SyncEvent.run(SessionSync.InstructionsUpdated, { sessionID, delta }, { projectID })
    })
    return { delta, blocked: false }
  }

  export function renderBody(key: string, body: InstructionBlobBody): string[] {
    const parsed = parseInstructionKey(key)
    switch (body.kind) {
      case "file":
        return [`Instructions from: ${parsed?.id ?? key}\n${body.text}`]
      case "url":
        return [`Instructions from: ${parsed?.id ?? key}\n${body.text}`]
      case "env":
        return body.parts
      case "profile":
        return body.parts
      case "skill":
        return [body.text]
    }
  }

  function parseBody(raw: string): InstructionBlobBody | undefined {
    try {
      const parsed = JSON.parse(raw) as InstructionBlobBody
      if (!parsed || typeof parsed !== "object" || !("kind" in parsed)) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  function renderKeys(order: string[], values: Record<string, string>, blobs: Record<string, string>) {
    const system: string[] = []
    const skillBlocks: string[] = []
    for (const key of order) {
      const hash = values[key]
      if (!hash) continue
      const raw = blobs[hash]
      if (!raw) {
        log.warn("instruction blob missing", { key, hash })
        continue
      }
      const body = parseBody(raw)
      if (!body) {
        log.warn("instruction blob malformed", { key, hash })
        continue
      }
      const parts = renderBody(key, body)
      if (body.kind === "skill") skillBlocks.push(...parts)
      else system.push(...parts)
    }
    return {
      system,
      skillMessages: skillBlocks.length > 0 ? [SystemPrompt.skillsMessage(skillBlocks)] : [],
    }
  }

  function renderUpdate(delta: Record<string, string>, blobs: Record<string, string>): string {
    const lines: string[] = ["The following instruction sources changed:"]
    const bodies: string[] = []
    for (const [key, value] of Object.entries(delta)) {
      if (value === INSTRUCTION_REMOVED) {
        lines.push(`- ${key}: removed`)
        continue
      }
      lines.push(`- ${key}: updated`)
      const raw = blobs[value]
      const body = raw ? parseBody(raw) : undefined
      if (!body) continue
      const rendered = renderBody(key, body)
      if (rendered.length === 0) continue
      bodies.push(`## ${key}\n${rendered.join("\n\n")}`)
    }
    if (bodies.length > 0) {
      lines.push("")
      lines.push(...bodies)
    }
    return lines.join("\n")
  }

  export function render(sessionID: string, projectID?: string): Omit<AssembleResult, "delta" | "blocked"> {
    const state = InstructionRepo.get(sessionID)
    if (!state) return { system: [], skillMessages: [], updates: [] }

    const hashes = [
      ...Object.values(state.data.epoch_values),
      ...Object.values(state.data.values),
    ]
    const blobs = InstructionRepo.getBlobs([...new Set(hashes)])
    const prefix = renderKeys(state.data.epoch_order, state.data.epoch_values, blobs)

    const events = SyncEvent.history(sessionID, projectID).filter(
      (event) =>
        (event.type === INSTRUCTION_EVENT_LOGGED || event.type.startsWith(`${INSTRUCTION_EVENT_TYPE}.`)) &&
        event.seq > state.epochSeq,
    )
    const updates: Array<{ role: "user"; content: string }> = []
    for (const event of events) {
      const data = event.data as { delta?: Record<string, string> } | null
      if (!data?.delta || Object.keys(data.delta).length === 0) continue
      const needed = Object.values(data.delta).filter((value) => value !== INSTRUCTION_REMOVED)
      const extra = InstructionRepo.getBlobs(needed)
      updates.push({ role: "user", content: renderUpdate(data.delta, { ...blobs, ...extra }) })
    }

    return {
      system: prefix.system,
      skillMessages: prefix.skillMessages,
      updates,
    }
  }

  export function renderLive(reads: InstructionRead[]): Omit<AssembleResult, "delta" | "blocked"> {
    const system: string[] = []
    const skillBlocks: string[] = []
    for (const read of reads) {
      if (read.status !== "value") continue
      const parts = renderBody(read.key, read.body)
      if (read.body.kind === "skill") skillBlocks.push(...parts)
      else system.push(...parts)
    }
    return {
      system,
      skillMessages: skillBlocks.length > 0 ? [SystemPrompt.skillsMessage(skillBlocks)] : [],
      updates: [],
    }
  }

  export async function collectReads(input: {
    ctx: InstanceContext
    config: Config.Info
    disabled: string[]
    envParts: string[]
    profileParts: string[]
    skills: InstructionRead[]
  }): Promise<InstructionRead[]> {
    const { paths, urls } = await collectSystemPaths(input.ctx, input.config, { disabledPaths: input.disabled })
    const disabled = new Set(input.disabled)
    const enabledUrls = urls.filter((url) => !disabled.has(url))
    const [files, fetched] = await Promise.all([
      workMap(10, [...paths], (filepath) => readFileSource(filepath)),
      workMap(10, enabledUrls, (url) => readUrlSource(url)),
    ])

    const reads: InstructionRead[] = [...files, ...fetched]
    if (input.envParts.length > 0) {
      reads.push({ key: InstructionKey.env, status: "value", body: { kind: "env", parts: input.envParts } })
    }
    if (input.profileParts.length > 0) {
      reads.push({
        key: InstructionKey.profile,
        status: "value",
        body: { kind: "profile", parts: input.profileParts },
      })
    }
    reads.push(...input.skills)
    return reads
  }

  async function skillReads(names: string[]): Promise<InstructionRead[]> {
    const unique = [...new Set(names)]
    if (unique.length === 0) return []
    return workMap(8, unique, async (name) => {
      const key = InstructionKey.skill(name)
      try {
        const loaded = await runPromiseWithLayer(
          Skill.defaultLayer,
          withCurrentInstance(
            Effect.gen(function* () {
              const skill = yield* Skill.Service
              return yield* skill.load(name)
            }),
          ),
        )
        if (!loaded) return { key, status: "removed" } satisfies InstructionRead
        return {
          key,
          status: "value",
          body: { kind: "skill", name, text: SystemPrompt.skillBlock(loaded) },
        } satisfies InstructionRead
      } catch (error) {
        log.warn("failed to load skill for instruction sync", { name, error })
        return { key, status: "removed" } satisfies InstructionRead
      }
    })
  }

  export async function assemble(input: {
    sessionID: string
    projectID: string
    skills: string[]
    disabled: string[]
  }): Promise<AssembleResult> {
    const ctx: InstanceContext = {
      directory: Instance.directory,
      worktree: Instance.worktree,
      project: Instance.project,
    }
    const config = await runPromiseWithLayer(
      Config.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const service = yield* Config.Service
          return yield* service.get()
        }),
      ),
    )
    const [envParts, profileParts, skills] = await Promise.all([
      runPromiseWithLayer(
        SystemPrompt.defaultLayer,
        withCurrentInstance(
          Effect.gen(function* () {
            const systemPrompt = yield* SystemPrompt.Service
            return yield* systemPrompt.environment()
          }),
        ),
      ).catch((error) => {
        log.warn("environment read unavailable", { error })
        return undefined
      }),
      runPromiseWithLayer(
        Profile.defaultLayer,
        withCurrentInstance(
          Effect.gen(function* () {
            const profile = yield* Profile.Service
            return yield* profile.reminder(Profile.projectRoot(ctx))
          }),
        ),
      ).catch((error) => {
        log.warn("profile read unavailable", { error })
        return undefined
      }),
      skillReads(input.skills),
    ])

    const reads = await collectReads({
      ctx,
      config,
      disabled: input.disabled,
      envParts: envParts ?? [],
      profileParts: profileParts ?? [],
      skills,
    })
    if (envParts === undefined) reads.unshift({ key: InstructionKey.env, status: "unavailable" })
    if (profileParts === undefined) reads.push({ key: InstructionKey.profile, status: "unavailable" })

    const committed = commit(input.sessionID, input.projectID, reads)
    if (committed.blocked) return { ...renderLive(reads), delta: undefined, blocked: true }
    return { ...render(input.sessionID, input.projectID), delta: committed.delta, blocked: false }
  }

  export function clear(sessionID: string) {
    InstructionRepo.removeSession(sessionID)
  }

  export function inherit(parentID: string, childID: string) {
    InstructionRepo.inherit(parentID, childID)
  }

  export function advanceEpoch(sessionID: string, projectID: string) {
    const seq = InstructionRepo.latestAggregateSeq(projectID, sessionID)
    InstructionRepo.advanceEpoch(sessionID, seq)
  }

  export function hydrate(delta: Record<string, string>): Record<string, string> {
    const hashes = Object.values(delta).filter((value) => value !== INSTRUCTION_REMOVED)
    return InstructionRepo.getBlobs(hashes)
  }

  export function ingest(blobs: Record<string, string>) {
    const rows: Array<{ hash: string; body: string }> = []
    for (const [hash, body] of Object.entries(blobs)) {
      let parsed: InstructionBlobBody
      try {
        parsed = JSON.parse(body) as InstructionBlobBody
      } catch {
        throw new Error(`instruction blob ${hash} is not JSON`)
      }
      const actual = hashInstructionBody(parsed)
      if (actual !== hash) throw new Error(`instruction blob hash mismatch: claimed ${hash}, actual ${actual}`)
      rows.push({ hash, body: canonicalJson(parsed) })
    }
    InstructionRepo.putBlobs(rows)
  }

  export function isEventType(type: string) {
    return type === INSTRUCTION_EVENT_TYPE || type.startsWith(`${INSTRUCTION_EVENT_TYPE}.`)
  }

  export function attachBlobs(record: SyncEventRecord): SyncEventRecord {
    if (!isEventType(record.type)) return record
    const delta = (record.data as { delta?: Record<string, string> } | null)?.delta
    if (!delta) return record
    return { ...record, blobs: hydrate(delta) }
  }

  export function takeBlobs(record: SyncEventRecord): SyncEventRecord {
    if (record.blobs && Object.keys(record.blobs).length > 0) ingest(record.blobs)
    if (!record.blobs) return record
    const next = { ...record }
    delete next.blobs
    return next
  }
}
