import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import { Runtime } from "@/util/runtime"
import { throttleTrailing } from "@/util/throttle"
import { Shell } from "@/shell/shell"
import { spawn, type ChildProcess } from "child_process"
import { createWriteStream, type WriteStream } from "fs"
import fs from "fs/promises"
import path from "path"
import { ulid } from "ulid"
import z from "zod"
import { Effect, Schema } from "effect"
import { type DeepMutable, zod, zodObject } from "@/util/effect-zod"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

const OUTPUT_EVENT_MAX_BYTES = 32 * 1024
const OUTPUT_TAIL_MAX_BYTES = 64 * 1024
const OUTPUT_FLUSH_MS = 150
// The output delta streams to the UI every flush (above), but persisting the
// record (disk write + tool-part sync) only needs to keep up coarsely — coalesce
// it so a chatty process doesn't write to disk ~7×/s per monitor.
const RECORD_PERSIST_THROTTLE_MS = 1000
const PART_SYNC_RETRY_MS = 100
const PART_SYNC_RETRY_MAX = 30
const PREVIEW_MAX_CHARS = 220
const PREVIEW_MAX_LINES = 3
const DEFAULT_LOG_LINES = 200

const log = Log.create({ service: "monitor" })

function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
}

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
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

function storageList(prefix: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.list(prefix)
    }),
  )
}

export namespace Monitor {
  const StatusSchema = Schema.Literals(["running", "complete", "error", "timeout", "cancelled"])
  export const Status = zod(StatusSchema)
  export type Status = Schema.Schema.Type<typeof StatusSchema>

  const RecordSchema = Schema.Struct({
    id: Schema.String,
    sessionID: Schema.String,
    messageID: Schema.String.pipe(Schema.check(Schema.isStartsWith("msg"))),
    callID: Schema.String,
    partID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isStartsWith("prt")))),
    title: Schema.String,
    command: Schema.String,
    cwd: Schema.String,
    agent: Schema.String,
    wake: Schema.Boolean,
    timeoutMs: Schema.optional(Schema.Number),
    status: StatusSchema,
    pid: Schema.optional(Schema.Number),
    exitCode: Schema.optional(Schema.Number),
    signal: Schema.optional(Schema.String),
    logPath: Schema.String,
    commandPath: Schema.String,
    pidPath: Schema.String,
    exitCodePath: Schema.String,
    preview: Schema.String.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(""))),
    bytes: Schema.Number.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(0))),
    time: Schema.Struct({
      created: Schema.Number,
      updated: Schema.Number,
      completed: Schema.optional(Schema.Number),
    }),
  })
  export const Record = zodObject(RecordSchema)
  export type Record = DeepMutable<Schema.Schema.Type<typeof RecordSchema>>

  const LogSnapshotSchema = Schema.Struct({
    record: RecordSchema,
    output: Schema.String,
    truncated: Schema.Boolean,
  })
  export const LogSnapshot = zodObject(LogSnapshotSchema)
  export type LogSnapshot = Schema.Schema.Type<typeof LogSnapshotSchema>

  export const Event = {
    Created: BusEvent.define(
      "monitor.created",
      z.object({
        sessionID: z.string(),
        record: Record,
      }),
    ),
    Updated: BusEvent.define(
      "monitor.updated",
      z.object({
        sessionID: z.string(),
        record: Record,
      }),
    ),
    Output: BusEvent.define(
      "monitor.output",
      z.object({
        sessionID: z.string(),
        monitorID: z.string(),
        delta: z.string(),
        preview: z.string(),
        bytes: z.number(),
        status: Status,
      }),
    ),
    Completed: BusEvent.define(
      "monitor.completed",
      z.object({
        sessionID: z.string(),
        monitorID: z.string(),
        title: z.string(),
        status: Status,
        exitCode: z.number().nullable(),
        logPath: z.string(),
        wake: z.boolean(),
      }),
    ),
  }

  type ActiveRuntime = {
    record: Record
    process: ChildProcess
    logStream: WriteStream
    pendingDelta: string
    outputTail: string
    flushTimer?: NodeJS.Timeout
    timeoutTimer?: NodeJS.Timeout
    requestedFinalization?: {
      status: Exclude<Status, "running">
      error?: string
    }
    exited: boolean
    finalizing?: boolean
    persistThrottle: ReturnType<typeof throttleTrailing>
  }

  const state = Instance.state(
    () => new Map<string, ActiveRuntime>(),
    async (current) => {
      await Promise.all(
        Array.from(current.values()).map(async (runtime) => {
          clearRuntimeTimers(runtime)
          runtime.requestedFinalization = { status: "cancelled", error: "Nikcli shut down" }
          try {
            await Shell.killTree(runtime.process, { exited: () => runtime.exited })
          } catch {}
          try {
            runtime.logStream.end()
          } catch {}
        }),
      )
      current.clear()
    },
  )

  function key(id: string) {
    return id
  }

  function recordKey(sessionID: string, monitorID: string) {
    return ["monitor", sessionID, monitorID]
  }

  function monitorDir(sessionID: string, monitorID: string) {
    return path.join(Global.Path.data, "monitors", sessionID, monitorID)
  }

  function buildPreview(text: string) {
    const cleaned = text
      .split("\n")
      .map((line) => stripAnsi(line).trim())
      .filter(Boolean)
    if (cleaned.length === 0) return ""
    const preview = cleaned.slice(-PREVIEW_MAX_LINES).join(" ")
    return preview.length > PREVIEW_MAX_CHARS ? preview.slice(0, PREVIEW_MAX_CHARS - 3).trimEnd() + "..." : preview
  }

  function stripAnsi(value: string) {
    return value.replace(/\u001b\[[0-9;]*m/g, "")
  }

  function appendTail(current: string, chunk: string) {
    const next = current + chunk
    if (Buffer.byteLength(next) <= OUTPUT_TAIL_MAX_BYTES) return next
    const buffer = Buffer.from(next)
    return buffer.subarray(buffer.length - OUTPUT_TAIL_MAX_BYTES).toString("utf8")
  }

  async function ensureMonitorDir(sessionID: string, monitorID: string) {
    const dir = monitorDir(sessionID, monitorID)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  async function persist(record: Record) {
    await storageWrite(recordKey(record.sessionID, record.id), record)
  }

  async function resolveToolPart(record: Record): Promise<MessageV2.ToolPart | undefined> {
    const parts = await MessageV2.parts(record.messageID)
    const byID = record.partID ? parts.find((part) => part.id === record.partID) : undefined
    if (byID?.type === "tool") return byID

    const match = parts.find(
      (part): part is MessageV2.ToolPart => part.type === "tool" && part.callID === record.callID,
    )
    if (match && record.partID !== match.id) {
      record.partID = match.id
      record.time.updated = Date.now()
      await persist(record)
    }
    return match
  }

  function toolMetadata(record: Record) {
    return {
      monitorId: record.id,
      sessionId: record.sessionID,
      title: record.title,
      command: record.command,
      cwd: record.cwd,
      logPath: record.logPath,
      status: record.status,
      wake: record.wake,
      startedAt: record.time.created,
      completedAt: record.time.completed,
      exitCode: record.exitCode,
      recentOutput: record.preview,
      bytes: record.bytes,
    }
  }

  async function syncToolPart(record: Record, attempt: number = 0): Promise<void> {
    const part = await resolveToolPart(record)
    if (!part || part.state.status !== "completed") {
      if (attempt < PART_SYNC_RETRY_MAX) {
        setTimeout(() => {
          void syncToolPart(record, attempt + 1)
        }, PART_SYNC_RETRY_MS)
      }
      return
    }

    const currentMetadata = part.state.metadata ?? {}
    const nextMetadata = {
      ...currentMetadata,
      ...toolMetadata(record),
    }
    if (Bun.deepEquals(currentMetadata, nextMetadata)) return
    const nextPart: MessageV2.ToolPart = {
      ...part,
      state: {
        ...part.state,
        metadata: nextMetadata,
      },
    }

    await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.updatePart(nextPart)
      }),
    )
  }

  async function publishUpdated(record: Record) {
    await persist(record)
    void syncToolPart(record)
    Bus.publish(Event.Updated, { sessionID: record.sessionID, record })
  }

  function flushRuntime(runtime: ActiveRuntime) {
    runtime.flushTimer = undefined
    const delta = runtime.pendingDelta
    runtime.pendingDelta = ""
    runtime.record.time.updated = Date.now()
    runtime.record.preview = buildPreview(runtime.outputTail)

    // Stream the output delta immediately so the UI stays live...
    if (delta) {
      let payload = delta
      if (Buffer.byteLength(payload) > OUTPUT_EVENT_MAX_BYTES) {
        const buffer = Buffer.from(payload)
        payload = buffer.subarray(buffer.length - OUTPUT_EVENT_MAX_BYTES).toString("utf8")
      }
      Bus.publish(Event.Output, {
        sessionID: runtime.record.sessionID,
        monitorID: runtime.record.id,
        delta: payload,
        preview: runtime.record.preview,
        bytes: runtime.record.bytes ?? 0,
        status: runtime.record.status,
      })
    }

    // ...but coalesce the heavier record persist (disk write + tool-part sync).
    runtime.persistThrottle.call()
  }

  function scheduleFlush(runtime: ActiveRuntime) {
    if (runtime.flushTimer) return
    runtime.flushTimer = setTimeout(() => {
      try {
        flushRuntime(runtime)
      } catch (error) {
        log.error("failed to flush monitor output", { error: String(error), monitorID: runtime.record.id })
      }
    }, OUTPUT_FLUSH_MS)
  }

  function clearRuntimeTimers(runtime: ActiveRuntime) {
    if (runtime.flushTimer) clearTimeout(runtime.flushTimer)
    if (runtime.timeoutTimer) clearTimeout(runtime.timeoutTimer)
    runtime.flushTimer = undefined
    runtime.timeoutTimer = undefined
    runtime.persistThrottle.cancel()
  }

  async function finalize(
    runtime: ActiveRuntime,
    status: Exclude<Status, "running">,
    exitCode?: number | null,
    signal?: NodeJS.Signals | null,
  ) {
    if (runtime.finalizing) return
    if (runtime.exited && runtime.record.status !== "running") return
    runtime.finalizing = true
    runtime.exited = true
    clearRuntimeTimers(runtime)

    if (runtime.pendingDelta) {
      flushRuntime(runtime)
    }

    const finalStatus = runtime.requestedFinalization?.status ?? status
    runtime.record.status = finalStatus
    runtime.record.exitCode = typeof exitCode === "number" ? exitCode : undefined
    runtime.record.signal = signal ?? undefined
    runtime.record.time.completed = Date.now()
    runtime.record.time.updated = runtime.record.time.completed
    runtime.record.preview = buildPreview(runtime.outputTail)

    try {
      await fs.writeFile(runtime.record.exitCodePath, runtime.record.exitCode?.toString() ?? "", "utf8")
    } catch (error) {
      log.error("failed to persist monitor exit code", { error: String(error), monitorID: runtime.record.id })
    }

    await new Promise<void>((resolve) => {
      runtime.logStream.end(() => resolve())
    }).catch(() => {})

    // Drop any pending throttled persist; this explicit call writes the
    // authoritative final record.
    runtime.persistThrottle.cancel()
    await publishUpdated(runtime.record)

    state().delete(key(runtime.record.id))

    Bus.publish(Event.Completed, {
      sessionID: runtime.record.sessionID,
      monitorID: runtime.record.id,
      title: runtime.record.title,
      status: runtime.record.status,
      exitCode: runtime.record.exitCode ?? null,
      logPath: runtime.record.logPath,
      wake: runtime.record.wake,
    })

    if (runtime.record.wake && runtime.record.status !== "cancelled") {
      void wake(runtime.record)
    }
  }

  function startTimeout(runtime: ActiveRuntime) {
    if (!runtime.record.timeoutMs) return
    runtime.timeoutTimer = setTimeout(() => {
      runtime.requestedFinalization = { status: "timeout", error: "Timed out" }
      void Shell.killTree(runtime.process, { exited: () => runtime.exited }).catch((error) => {
        log.error("failed to timeout monitor", { error: String(error), monitorID: runtime.record.id })
      })
    }, runtime.record.timeoutMs)
  }

  function attach(runtime: ActiveRuntime) {
    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString()
      if (!text) return
      runtime.record.bytes = (runtime.record.bytes ?? 0) + Buffer.byteLength(text)
      runtime.outputTail = appendTail(runtime.outputTail, text)
      runtime.pendingDelta += text
      runtime.logStream.write(text)
      scheduleFlush(runtime)
    }

    runtime.process.stdout?.on("data", handleChunk)
    runtime.process.stderr?.on("data", handleChunk)
    runtime.process.once("error", (error) => {
      const text = `\n[monitor error] ${error instanceof Error ? error.message : String(error)}\n`
      runtime.pendingDelta += text
      runtime.outputTail = appendTail(runtime.outputTail, text)
      runtime.logStream.write(text)
      scheduleFlush(runtime)
      void finalize(runtime, "error", 1, null)
    })
    runtime.process.once("exit", (exitCode, signal) => {
      const status =
        runtime.requestedFinalization?.status ??
        (exitCode === 0 && !signal ? "complete" : (runtime.requestedFinalization?.status ?? "error"))
      void finalize(runtime, status, exitCode, signal)
    })

    startTimeout(runtime)
  }

  async function wake(record: Record) {
    try {
      const snapshot = await readLog(record.sessionID, record.id, 80)
      const output = snapshot.output.trim()
      const lines = [
        `Monitor "${record.title}" finished.`,
        `Command: ${record.command}`,
        `Working directory: ${record.cwd}`,
        `Status: ${record.status}`,
        `Exit code: ${record.exitCode ?? "N/A"}`,
      ]
      if (output) {
        lines.push("Recent output:")
        lines.push(output)
      }
      lines.push("Continue from this event without polling. Read the full log only if you need more detail.")

      await runSessionPrompt(
        Effect.gen(function* () {
          const sessionPrompt = yield* SessionPrompt.Service
          return yield* sessionPrompt.prompt({
            sessionID: record.sessionID,
            // Preserve the agent that started the monitor so a completion wake
            // doesn't silently switch the session to the default agent.
            ...(record.agent ? { agent: record.agent } : {}),
            parts: [
              {
                type: "text",
                text: lines.join("\n\n"),
              },
            ],
          })
        }),
      )
    } catch (error) {
      log.error("failed to wake monitor session", { error: String(error), monitorID: record.id })
    }
  }

  async function tailFile(filePath: string, lines: number): Promise<{ output: string; truncated: boolean }> {
    const handle = await fs.open(filePath, "r").catch(() => undefined)
    if (!handle) return { output: "", truncated: false }
    try {
      const stat = await handle.stat()
      if (stat.size === 0) return { output: "", truncated: false }
      const start = Math.max(0, stat.size - OUTPUT_TAIL_MAX_BYTES)
      const size = stat.size - start
      const buffer = Buffer.alloc(size)
      await handle.read(buffer, 0, size, start)
      const all = buffer.toString("utf8")
      const list = all.split("\n")
      const normalized = list.at(-1) === "" ? list.slice(0, -1) : list
      const slice = normalized.slice(-lines)
      return {
        output: slice.join("\n"),
        truncated: normalized.length > slice.length || start > 0,
      }
    } finally {
      await handle.close().catch(() => {})
    }
  }

  async function load(sessionID: string, monitorID: string): Promise<Record> {
    const active = state().get(key(monitorID))
    if (active && active.record.sessionID === sessionID) return active.record
    return storageRead<Record>(recordKey(sessionID, monitorID))
  }

  export async function start(input: {
    sessionID: string
    messageID: string
    callID: string
    title: string
    command: string
    cwd: string
    agent: string
    wake?: boolean
    timeoutMs?: number
  }): Promise<Record> {
    const id = `mon_${ulid().toLowerCase()}`
    const dir = await ensureMonitorDir(input.sessionID, id)
    const logPath = path.join(dir, "output.log")
    const commandPath = path.join(dir, "command")
    const pidPath = path.join(dir, "pid")
    const exitCodePath = path.join(dir, "exitcode")
    await fs.writeFile(commandPath, input.command, "utf8")
    await fs.writeFile(logPath, "", "utf8")

    // Reuse the Bun runtime instead of spawning a separate Node one when the
    // monitored command is a JS runner (`node`/`npm`/`npx`) and Bun is present.
    const command = Runtime.preferBun(input.command)
    const proc = spawn(command, {
      shell: Shell.acceptable(),
      cwd: input.cwd,
      env: {
        ...process.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    if (!proc.pid) {
      throw new Error("Failed to start monitor process")
    }

    await fs.writeFile(pidPath, String(proc.pid), "utf8")

    const record: Record = {
      id,
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      title: input.title,
      command: input.command,
      cwd: input.cwd,
      agent: input.agent,
      wake: input.wake !== false,
      timeoutMs: input.timeoutMs,
      status: "running",
      pid: proc.pid,
      logPath,
      commandPath,
      pidPath,
      exitCodePath,
      preview: "",
      bytes: 0,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }

    const runtime: ActiveRuntime = {
      record,
      process: proc,
      logStream: createWriteStream(logPath, { flags: "a" }),
      pendingDelta: "",
      outputTail: "",
      exited: false,
      persistThrottle: throttleTrailing(() => {
        void publishUpdated(record).catch((error) => {
          log.error("failed to persist monitor record", { error: String(error), monitorID: record.id })
        })
      }, RECORD_PERSIST_THROTTLE_MS),
    }

    state().set(key(record.id), runtime)
    await persist(record)
    void syncToolPart(record)
    Bus.publish(Event.Created, { sessionID: record.sessionID, record })
    attach(runtime)
    return record
  }

  export async function get(sessionID: string, monitorID: string): Promise<Record> {
    return load(sessionID, monitorID)
  }

  export async function readLog(
    sessionID: string,
    monitorID: string,
    lines: number = DEFAULT_LOG_LINES,
  ): Promise<LogSnapshot> {
    const record = await load(sessionID, monitorID)
    const snapshot = await tailFile(record.logPath, lines)
    return {
      record,
      output: snapshot.output,
      truncated: snapshot.truncated,
    }
  }

  export async function cancel(sessionID: string, monitorID: string): Promise<Record> {
    const active = state().get(key(monitorID))
    if (active && active.record.sessionID === sessionID) {
      clearRuntimeTimers(active)
      active.requestedFinalization = { status: "cancelled", error: "Cancelled" }
      active.record.status = "cancelled"
      active.record.time.updated = Date.now()
      await publishUpdated(active.record)
      await Shell.killTree(active.process, { exited: () => active.exited }).catch(() => {})
      return active.record
    }

    const record = await load(sessionID, monitorID)
    if (record.status !== "running") return record
    if (record.pid) {
      try {
        if (process.platform === "win32") {
          process.kill(record.pid, "SIGTERM")
        } else {
          process.kill(-record.pid, "SIGTERM")
        }
      } catch {
        try {
          process.kill(record.pid, "SIGTERM")
        } catch {}
      }
    }
    record.status = "cancelled"
    record.time.completed = Date.now()
    record.time.updated = record.time.completed
    await fs.writeFile(record.exitCodePath, "", "utf8").catch(() => {})
    await publishUpdated(record)
    Bus.publish(Event.Completed, {
      sessionID: record.sessionID,
      monitorID: record.id,
      title: record.title,
      status: record.status,
      exitCode: record.exitCode ?? null,
      logPath: record.logPath,
      wake: false,
    })
    return record
  }

  export async function cancelAll(sessionID: string): Promise<void> {
    const activeMonitors = Array.from(state().values()).filter((runtime) => runtime.record.sessionID === sessionID)
    await Promise.all(activeMonitors.map((runtime) => cancel(sessionID, runtime.record.id)))
  }

  /** Whether a process is still alive. EPERM means it exists but we can't signal it. */
  function pidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException)?.code === "EPERM"
    }
  }

  /**
   * Mark monitors left "running" by a previous (crashed) process as errored.
   * The in-memory `ActiveRuntime` map does not survive a restart, so a record
   * persisted as "running" whose process is gone would otherwise stay "running"
   * forever. We key off the persisted `pid`: a record not owned by this process
   * (absent from `state()`) whose pid is no longer alive is finalized. Records
   * whose pid is still alive are left untouched so a concurrent nikcli process
   * keeps ownership of its monitors.
   */
  export async function reconcile(): Promise<void> {
    const keys = await storageList(["monitor"]).catch(() => [])
    for (const itemKey of keys) {
      const record = await storageRead<Record>(itemKey).catch(() => undefined)
      if (!record || record.status !== "running") continue
      if (state().get(key(record.id))) continue
      if (record.pid && pidAlive(record.pid)) continue

      record.status = "error"
      record.time.completed = Date.now()
      record.time.updated = record.time.completed
      await persist(record).catch((error) => {
        log.error("failed to reconcile monitor", { error: String(error), monitorID: record.id })
      })
      void syncToolPart(record)
      Bus.publish(Event.Completed, {
        sessionID: record.sessionID,
        monitorID: record.id,
        title: record.title,
        status: record.status,
        exitCode: record.exitCode ?? null,
        logPath: record.logPath,
        wake: false,
      })
    }
  }
}
