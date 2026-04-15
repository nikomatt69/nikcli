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
import { Flock } from "@/util/flock"

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
const LOCK_DURATION_MS = 60 * 60 * 1000 // 1 hour
const BRAIN_SESSION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const SESSION_REVIEW_LIMIT = 10
const SESSION_REVIEW_MAX_CHARS = 12_000
export const BRAIN_SESSION_TITLE = "Brain: Memory Consolidation"

function memoryPath(): string {
  return path.join(Instance.directory, ".github", "instructions", "memory.instruction.md")
}

function lockPath(): string {
  return path.join(Global.Path.state, LOCK_FILE)
}

export async function isMemoryEnabled(): Promise<boolean> {
  return (await getBrainConfig()).memoryEnabled
}

export async function isBrainEnabled(): Promise<boolean> {
  return (await getBrainConfig()).enabled
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
  return listProjectSessions((session) => session.time.updated > sinceMs)
}

export async function listRecentSessions(limit = SESSION_REVIEW_LIMIT): Promise<string[]> {
  const sessions = await listProjectSessions(() => true)
  return sessions.slice(-limit)
}

async function listProjectSessions(filter: (session: Session.Info) => boolean): Promise<string[]> {
  const sessions: Array<{ id: string; updated: number }> = []
  try {
    const projectDir = path.join(Global.Path.data, "storage", "session", Instance.project.id)
    const files = await fs.readdir(projectDir)
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const sessionID = file.replace(".json", "")
      try {
        const session = await Storage.read<Session.Info>(["session", Instance.project.id, sessionID])
        if (filter(session)) {
          sessions.push({ id: sessionID, updated: session.time.updated })
        }
      } catch {
        // skip invalid sessions
      }
    }
  } catch {
    // no sessions found
  }
  return sessions.toSorted((a, b) => a.updated - b.updated).map((session) => session.id)
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
    minHours: typeof experimental.brainMinHours === "number" ? experimental.brainMinHours : DEFAULTS.minHours,
    minSessions:
      typeof experimental.brainMinSessions === "number" ? experimental.brainMinSessions : DEFAULTS.minSessions,
    enabled: experimental.brain !== undefined ? experimental.brain !== false : DEFAULTS.enabled,
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
  const HOUR_MS = 60 * 60 * 1000

  export async function shouldTrigger(): Promise<boolean> {
    const cfg = await getBrainConfig()
    if (!cfg.enabled) return false
    if (!cfg.memoryEnabled) return false

    let lastAt: number
    try {
      lastAt = await readLastBrainAt()
    } catch (e) {
      log.error("readLastBrainAt failed", { error: String(e) })
      return false
    }

    const hoursSince = (Date.now() - lastAt) / HOUR_MS
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

  let pending: Promise<BrainResult> | null = null

  export async function trigger(input?: { force?: boolean }): Promise<BrainResult> {
    if (pending) return pending
    pending = runBrain(input).finally(() => {
      pending = null
    })
    return pending
  }

  async function runBrain(input?: { force?: boolean }): Promise<BrainResult> {
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

    const hoursSince = (Date.now() - lastAt) / HOUR_MS

    let lease: Flock.Lease
    try {
      lease = await Flock.acquire("brain", { staleMs: LOCK_DURATION_MS, timeoutMs: 100 })
    } catch {
      return { success: false, sessionsReviewed: 0, hoursSinceLastBrain: hoursSince, error: "lock held" }
    }

    let sessionIds = await listSessionsSince(lastAt)
    if (input?.force && sessionIds.length === 0) {
      sessionIds = await listRecentSessions()
    }

    try {
      log.info("brain triggered", { hoursSince })

      const before = await getBrainMemoryContent()
      const sessionID = await executeBrain(sessionIds)
      const after = await getBrainMemoryContent()

      if (before !== after) {
        await recordBrain()
        log.info("brain completed", { sessionsReviewed: sessionIds.length, memoryUpdated: true })
        return { success: true, sessionsReviewed: sessionIds.length, hoursSinceLastBrain: hoursSince, sessionID }
      }

      log.warn("brain did not update memory file", { sessionsReviewed: sessionIds.length })
      return {
        success: false,
        sessionsReviewed: sessionIds.length,
        hoursSinceLastBrain: hoursSince,
        sessionID,
        error: "memory file unchanged",
      }
    } catch (e) {
      log.error("brain failed", { error: String(e) })
      return { success: false, sessionsReviewed: sessionIds.length, hoursSinceLastBrain: hoursSince, error: String(e) }
    } finally {
      await lease.release()
    }
  }

  async function executeBrain(sessionIds: string[]): Promise<string> {
    if (!sessionIds.length) {
      throw new Error("No recent sessions available for Brain")
    }

    const memory = await getBrainMemoryContent()
    const memoryFile = memoryPath()
    await fs.mkdir(path.dirname(memoryFile), { recursive: true })
    const reviews = await buildSessionReviews(sessionIds)

    const prompt = buildBrainPrompt(memoryFile, reviews, memory)
    log.debug("brain prompt built", { promptLength: prompt.length, sessionCount: sessionIds.length })

    const session = await Session.create({
      title: BRAIN_SESSION_TITLE,
      permission: [
        { permission: "*", pattern: "*", action: "deny" },
        { permission: "read", pattern: "*", action: "allow" },
        { permission: "edit", pattern: "*", action: "allow" },
        { permission: "write", pattern: "*", action: "allow" },
        { permission: "glob", pattern: "*", action: "allow" },
        { permission: "grep", pattern: "*", action: "allow" },
        { permission: "list", pattern: "*", action: "allow" },
        { permission: "tree", pattern: "*", action: "allow" },
        { permission: "todowrite", pattern: "*", action: "deny" },
        { permission: "todoread", pattern: "*", action: "deny" },
        { permission: "task", pattern: "*", action: "deny" },
      ],
    })
    log.debug("brain session created", { sessionID: session.id })
    const model = await Provider.defaultModel()
    const parts = await SessionPrompt.resolvePromptParts(prompt)

    const timeout = setTimeout(() => {
      log.warn("brain session timed out, cancelling", { sessionID: session.id })
      SessionPrompt.cancel(session.id)
    }, BRAIN_SESSION_TIMEOUT_MS)

    try {
      await SessionPrompt.prompt({
        sessionID: session.id,
        model,
        parts,
      })
    } finally {
      clearTimeout(timeout)
    }

    return session.id
  }

  export function buildBrainPrompt(memoryPath: string, sessionReviews: string, currentMemory: string): string {
    return `# Brain: Memory Consolidation

You are performing a Brain pass over project memory. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.

Memory file to maintain: \`${memoryPath}\`

---

## Phase 1 — Orient

- Read the existing memory file if it exists
- Review what memories currently exist before making changes

## Phase 2 — Gather recent signal

Look for new information worth persisting from the session transcripts included below.

## Phase 3 — Consolidate

For each thing worth remembering, update the memory file at \`${memoryPath}\`.

Focus on:
- Merging new signal into existing content rather than creating duplicates
- Converting relative dates to absolute dates
- Deleting contradicted facts
- Keeping the file concise and useful for future coding sessions

## Phase 4 — Prune and index

Keep the memory file concise and well-organized. Remove stale entries, add important new ones.

Important:
- Do not create a new memory file somewhere else
- Do not ask the user questions
- Use only the provided file tools you need to inspect or update the memory file

---

Current memory content:
\`\`\`
${currentMemory || "(empty)"}
\`\`\`

Recent session transcripts:

${sessionReviews || "(none)"}
`
  }
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd() + "..."
}

type SessionReviewMessage = Awaited<ReturnType<typeof Session.messages>>[number]

function formatReviewPart(part: SessionReviewMessage["parts"][number]) {
  switch (part.type) {
    case "text":
      return part.synthetic ? "" : part.text.trim()
    case "reasoning":
      return part.text.trim() ? `Thinking: ${truncate(part.text.trim(), 600)}` : ""
    case "tool":
      return `Tool ${part.tool}: ${part.state.status}`
    case "file":
      return part.filename ? `File: ${part.filename}` : "File attached"
    case "agent":
      return `Agent: ${part.name}`
    case "subtask":
      return part.description ? `Subtask: ${part.description}` : "Subtask started"
    case "compaction":
      return part.auto ? "Compaction applied automatically" : "Compaction applied"
    default:
      return ""
  }
}

function formatReviewMessage(message: SessionReviewMessage) {
  const heading = message.info.role === "user" ? "### User" : `### Assistant (${message.info.agent})`
  const content = message.parts.map(formatReviewPart).filter(Boolean).join("\n\n")
  if (!content) return ""
  return `${heading}\n\n${content}`
}

async function buildSessionReviews(sessionIds: string[]) {
  const selected = sessionIds.slice(-SESSION_REVIEW_LIMIT)
  const reviews = await Promise.all(
    selected.map(async (sessionID) => {
      try {
        const [session, messages] = await Promise.all([
          Session.get(sessionID),
          Session.messages({ sessionID, limit: 40 }),
        ])
        const sections = messages.map(formatReviewMessage).filter(Boolean)
        const review = [
          `## ${session.title}`,
          `Session ID: ${session.id}`,
          `Updated: ${new Date(session.time.updated).toISOString()}`,
          sections.join("\n\n"),
        ]
          .filter(Boolean)
          .join("\n\n")
        return truncate(review, SESSION_REVIEW_MAX_CHARS)
      } catch (error) {
        Log.create({ service: "brain" }).warn("failed to build session review", { sessionID, error: String(error) })
        return ""
      }
    }),
  )

  return reviews.filter(Boolean).join("\n\n---\n\n")
}
