import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Storage } from "@/storage/storage"
import { SessionPrompt } from "@/session/prompt"
import { Provider } from "@/provider/provider"

export type BrainConfig = {
  minHours: number
  minSessions: number
  enabled: boolean
  memoryEnabled: boolean
}

const DEFAULTS: BrainConfig = {
  minHours: 24,
  minSessions: 5,
  enabled: true,
  memoryEnabled: true,
}

const LOCK_FILE = ".brain-lock"

function memoryPath(): string {
  return path.join(Instance.directory, ".github", "instructions", "memory.instruction.md")
}

function lockPath(): string {
  return path.join(Global.Path.state, LOCK_FILE)
}

export async function isMemoryEnabled(): Promise<boolean> {
  const config = await Config.get()
  return config.experimental?.memory !== false
}

export async function isBrainEnabled(): Promise<boolean> {
  const config = await Config.get()
  if (config.experimental?.dream === false) return false
  if (config.experimental?.dream === true) return true
  return DEFAULTS.enabled
}

export async function readLastBrainAt(): Promise<number> {
  try {
    const s = await fs.stat(lockPath())
    return s.mtimeMs
  } catch {
    return 0
  }
}

export async function listSessionsSince(sinceMs: number): Promise<string[]> {
  const sessions: string[] = []
  try {
    const projectDir = path.join(Global.Path.data, "storage", "session", Instance.project.id)
    const files = await fs.readdir(projectDir)
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const sessionID = file.replace(".json", "")
      try {
        const session = await Storage.read<Session.Info>(["session", Instance.project.id, sessionID])
        if (session.time.updated > sinceMs) {
          sessions.push(sessionID)
        }
      } catch {
        // skip invalid sessions
      }
    }
  } catch {
    // no sessions found
  }
  return sessions
}

export async function tryAcquireBrainLock(): Promise<number | null> {
  const lock = lockPath()
  try {
    const s = await fs.stat(lock)
    if (Date.now() - s.mtimeMs < 60 * 60 * 1000) {
      return null
    }
    await fs.writeFile(lock, String(process.pid))
    const verify = await fs.readFile(lock, "utf8")
    if (parseInt(verify.trim(), 10) !== process.pid) return null
    return s.mtimeMs
  } catch {
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.writeFile(lock, String(process.pid))
    return 0
  }
}

export async function rollbackBrainLock(priorMtime: number): Promise<void> {
  const lock = lockPath()
  try {
    if (priorMtime === 0) {
      await fs.unlink(lock)
      return
    }
    const t = priorMtime / 1000
    await fs.utimes(lock, t, t)
  } catch {
    // ignore rollback errors
  }
}

export async function recordBrain(): Promise<void> {
  const lock = lockPath()
  try {
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.writeFile(lock, String(process.pid))
  } catch {
    // ignore errors
  }
}

export async function getBrainMemoryContent(): Promise<string> {
  const memPath = memoryPath()
  try {
    return await fs.readFile(memPath, "utf8")
  } catch {
    return ""
  }
}

export async function updateMemory(content: string): Promise<void> {
  const memPath = memoryPath()
  const dir = path.dirname(memPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(memPath, content, "utf8")
}

export async function getBrainConfig(): Promise<BrainConfig> {
  const config = await Config.get()
  const experimental = config.experimental ?? {}
  return {
    minHours: typeof experimental.dreamMinHours === "number" ? experimental.dreamMinHours : DEFAULTS.minHours,
    minSessions:
      typeof experimental.dreamMinSessions === "number" ? experimental.dreamMinSessions : DEFAULTS.minSessions,
    enabled: experimental.dream !== undefined ? experimental.dream !== false : DEFAULTS.enabled,
    memoryEnabled: experimental.memory !== undefined ? experimental.memory !== false : DEFAULTS.memoryEnabled,
  }
}

export async function getSessionsCountSince(sinceMs: number): Promise<number> {
  const sessions = await listSessionsSince(sinceMs)
  return sessions.length
}

export type BrainResult = {
  success: boolean
  sessionsReviewed: number
  hoursSinceLastBrain: number
  error?: string
  sessionID?: string
}

export namespace Brain {
  const log = Log.create({ service: "brain" })

  let lastSessionScanAt = 0

  const SCAN_THROTTLE_MS = 10 * 60 * 1000

  export async function shouldTrigger(): Promise<boolean> {
    if (!(await isBrainEnabled())) return false
    if (!(await isMemoryEnabled())) return false

    const cfg = await getBrainConfig()

    let lastAt: number
    try {
      lastAt = await readLastBrainAt()
    } catch (e) {
      log.error("readLastBrainAt failed", { error: String(e) })
      return false
    }

    const hoursSince = (Date.now() - lastAt) / 3_600_000
    if (hoursSince < cfg.minHours) return false

    const sinceScanMs = Date.now() - lastSessionScanAt
    if (sinceScanMs < SCAN_THROTTLE_MS) {
      log.debug("scan throttled", { sinceMs: Math.round(sinceScanMs / 1000) })
      return false
    }
    lastSessionScanAt = Date.now()

    const sessionIds = await listSessionsSince(lastAt)

    if (sessionIds.length < cfg.minSessions) {
      log.debug("insufficient sessions", { have: sessionIds.length, need: cfg.minSessions })
      return false
    }

    return true
  }

  export async function trigger(): Promise<BrainResult> {
    const log = Log.create({ service: "brain" })

    if (!(await isBrainEnabled())) {
      return { success: false, sessionsReviewed: 0, hoursSinceLastBrain: 0, error: "brain disabled" }
    }

    if (!(await isMemoryEnabled())) {
      return { success: false, sessionsReviewed: 0, hoursSinceLastBrain: 0, error: "memory disabled" }
    }

    let lastAt: number
    try {
      lastAt = await readLastBrainAt()
    } catch (e) {
      return { success: false, sessionsReviewed: 0, hoursSinceLastBrain: 0, error: String(e) }
    }

    const hoursSince = (Date.now() - lastAt) / 3_600_000

    let priorMtime: number | null
    try {
      priorMtime = await tryAcquireBrainLock()
    } catch (e) {
      return { success: false, sessionsReviewed: 0, hoursSinceLastBrain: hoursSince, error: String(e) }
    }

    if (priorMtime === null) {
      return { success: false, sessionsReviewed: 0, hoursSinceLastBrain: hoursSince, error: "lock held" }
    }

    log.info("brain triggered", { hoursSince, priorMtime })

    const sessionIds = await listSessionsSince(lastAt)

    try {
      const sessionID = await executeBrain(sessionIds)
      await recordBrain()
      log.info("brain completed", { sessionsReviewed: sessionIds.length })
      return { success: true, sessionsReviewed: sessionIds.length, hoursSinceLastBrain: hoursSince, sessionID }
    } catch (e) {
      log.error("brain failed", { error: String(e) })
      await rollbackBrainLock(priorMtime)
      return { success: false, sessionsReviewed: sessionIds.length, hoursSinceLastBrain: hoursSince, error: String(e) }
    }
  }

  async function executeBrain(sessionIds: string[]): Promise<string> {
    try {
      const memory = await getBrainMemoryContent()
      const memoryDir = path.join(Instance.directory, ".github", "instructions")
      await fs.mkdir(memoryDir, { recursive: true })

      const prompt = buildBrainPrompt(memoryDir, sessionIds, memory)
      log.info("brain prompt built", { promptLength: prompt.length, sessionCount: sessionIds.length })

      try {
        const session = await Session.create({
          title: "Brain: Memory Consolidation",
          permission: [
            { permission: "todowrite", pattern: "*", action: "deny" },
            { permission: "todoread", pattern: "*", action: "deny" },
            { permission: "task", pattern: "*", action: "deny" },
          ],
        })
        log.info("brain session created", { sessionID: session.id })
        const model = await Provider.defaultModel()
        const parts = await SessionPrompt.resolvePromptParts(prompt)
        SessionPrompt.prompt({
          sessionID: session.id,
          model,
          parts,
        }).catch((err) => {
          log.error("brain prompt execution failed", { sessionID: session.id, error: String(err) })
        })
        return session.id
      } catch (sessionError) {
        log.warn("could not create brain session, logging prompt instead", { error: String(sessionError) })
        log.info("Brain prompt:", { prompt })
        return "brain-session-not-created"
      }
    } catch (e) {
      log.error("brain execution failed", { error: String(e) })
      throw e
    }
  }

  export function buildBrainPrompt(memoryPath: string, sessionIds: string[], currentMemory: string): string {
    return `# Brain: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.

Memory directory: \`${memoryPath}\`

---

## Phase 1 — Orient

- Check if \`.github/instructions/memory.instruction.md\` exists and read it
- Review what memories currently exist

## Phase 2 — Gather recent signal

Look for new information worth persisting:
1. Current memory content that may need updating
2. Any contradictions between what you know and what's in the codebase

## Phase 3 — Consolidate

For each thing worth remembering, update the memory file at \`.github/instructions/memory.instruction.md\`.

Focus on:
- Merging new signal into existing content rather than creating duplicates
- Converting relative dates to absolute dates
- Deleting contradicted facts

## Phase 4 — Prune and index

Keep the memory file concise and well-organized. Remove stale entries, add important new ones.

---

Current memory content:
\`\`\`
${currentMemory || "(empty)"}
\`\`\`

Sessions to review: ${sessionIds.length > 0 ? sessionIds.join(", ") : "none"}
`
  }
}
