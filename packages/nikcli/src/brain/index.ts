import fs from "fs/promises"
import path from "path"
import { Global } from "@nikcli-ai/util/global"
import { Log } from "@nikcli-ai/util/log"
import { Profile } from "@/profile"
import { Config } from "@/config/config"
import { Session } from "@/session"
import type { MessageV2 } from "@/session/message-v2"
import { SessionRepo } from "@/session/repo"
import { SessionPrompt } from "@/session/prompt"
import { sessionModelOwn } from "@/session/model"
import { Provider } from "@/provider/provider"
import { Flock } from "@nikcli-ai/util/flock"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

function configGet() {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    ),
  )
}

function defaultProviderModel() {
  return runPromiseWithLayer(
    Provider.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        return yield* provider.defaultModel()
      }),
    ),
  )
}

function providerGetModel(providerID: string, modelID: string) {
  return runPromiseWithLayer(
    Provider.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        return yield* provider.getModel(providerID, modelID)
      }),
    ),
  )
}

/**
 * Resolve the model that Brain should use to run the consolidation session.
 *
 * - If the user configured `experimental.brainModel` and the model is available,
 *   it is used as-is.
 * - Otherwise the pass runs on `sessionID`'s model — the one the user has
 *   selected in the session they triggered Brain from.
 * - If the configured model is unknown, missing providers/models, or the lookup
 *   throws, we silently fall back to the user's default model so the Brain pass
 *   still runs instead of failing the whole flow.
 */
export async function getBrainProviderModel(sessionID?: string): Promise<{
  providerID: string
  modelID: string
}> {
  const cfg = await getBrainConfig()
  if (cfg.model) {
    try {
      await providerGetModel(cfg.model.providerID, cfg.model.modelID)
      return cfg.model
    } catch (e) {
      Log.create({ service: "brain" }).warn("configured brainModel unavailable, falling back to default", {
        providerID: cfg.model.providerID,
        modelID: cfg.model.modelID,
        error: String(e),
      })
    }
  }
  // No explicit `brainModel`: run on the model of the session the user
  // triggered this from, rather than the global default. Same precedence the
  // mission and loop drafting calls use — a configured model is a deliberate
  // choice and still wins, everything else follows what is on screen.
  const inherited = await sessionModelOwn(sessionID).catch(() => undefined)
  if (inherited) {
    try {
      await providerGetModel(inherited.providerID, inherited.modelID)
      return inherited
    } catch {
      // the session's model is no longer usable (provider removed, key
      // revoked) — the default is a better answer than failing the pass
    }
  }
  return defaultProviderModel()
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
}

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

export type BrainConfig = {
  minHours: number
  minSessions: number
  enabled: boolean
  memoryEnabled: boolean
  model?: { providerID: string; modelID: string }
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
import { BRAIN_SESSION_TITLE } from "@nikcli-ai/util/brain-constants"
import type { InstanceContext } from "@/effect"

function memoryPath(instance: InstanceContext): string {
  return path.join(instance.directory, ".github", "instructions", "memory.instruction.md")
}

/**
 * The user-facing half of a Brain pass: `.nikcli/habits.md`.
 *
 * `memory.instruction.md` remembers the *project* — architecture, decisions,
 * gotchas. This file remembers the *person* — the workflow they keep repeating,
 * the tools they reach for, the corrections they keep having to make. Splitting
 * them keeps either file from turning into a dumping ground, and lets the user
 * switch the learned half off (`/profile`) without losing project memory.
 */
function habitsPath(instance: InstanceContext): string {
  // Same root the system prompt reads from, so a Brain pass never writes a file
  // the next session cannot find.
  return Profile.habitsFile(Profile.projectRoot({ directory: instance.directory, worktree: instance.worktree }))
}

const HABITS_HEADER = [
  "# User habits",
  "",
  "Maintained automatically by nikcli's Brain pass from past sessions in this project.",
  "Every session's agents read this file. Edit or delete anything that is wrong —",
  "or turn the whole thing off with `/profile`.",
  "",
].join("\n")

export async function getHabitsContent(instance: InstanceContext): Promise<string> {
  return fs.readFile(habitsPath(instance), "utf8").catch(() => "")
}

/**
 * Create the habits file if it is missing so the Brain session has something to
 * read and can reach it with the edit tool alone — asking a model to create a
 * file in a directory that may not exist yet is the step that fails.
 */
async function ensureHabitsFile(instance: InstanceContext): Promise<void> {
  const target = habitsPath(instance)
  if (await Bun.file(target).exists()) return
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, HABITS_HEADER, "utf8")
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

export async function listSessionsSince(instance: InstanceContext, sinceMs: number): Promise<string[]> {
  return listProjectSessions(instance, (session) => session.time.updated > sinceMs)
}

export async function listRecentSessions(instance: InstanceContext, limit = SESSION_REVIEW_LIMIT): Promise<string[]> {
  const sessions = await listProjectSessions(instance, () => true)
  return sessions.slice(-limit)
}

async function listProjectSessions(
  instance: InstanceContext,
  filter: (session: Session.Info) => boolean,
): Promise<string[]> {
  return SessionRepo.getByProject(instance.project.id)
    .filter(filter)
    .toSorted((a, b) => a.time.updated - b.time.updated)
    .map((session) => session.id)
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

export async function getBrainMemoryContent(instance: InstanceContext): Promise<string> {
  const memPath = memoryPath(instance)
  try {
    return await fs.readFile(memPath, "utf8")
  } catch {
    return ""
  }
}

export async function updateMemory(instance: InstanceContext, content: string): Promise<void> {
  const memPath = memoryPath(instance)
  const dir = path.dirname(memPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(memPath, content, "utf8")
}

export async function getBrainConfig(): Promise<BrainConfig> {
  const config = await configGet()
  const experimental = config.experimental ?? {}
  const model = parseBrainModel(experimental.brainModel)
  return {
    minHours: typeof experimental.brainMinHours === "number" ? experimental.brainMinHours : DEFAULTS.minHours,
    minSessions:
      typeof experimental.brainMinSessions === "number" ? experimental.brainMinSessions : DEFAULTS.minSessions,
    enabled: experimental.brain !== undefined ? experimental.brain !== false : DEFAULTS.enabled,
    memoryEnabled: experimental.memory !== undefined ? experimental.memory !== false : DEFAULTS.memoryEnabled,
    model,
  }
}

function parseBrainModel(value: unknown): { providerID: string; modelID: string } | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined
  const trimmed = value.trim()
  const slash = trimmed.indexOf("/")
  if (slash <= 0 || slash === trimmed.length - 1) {
    Log.create({ service: "brain" }).warn("ignoring malformed brainModel config", { value: trimmed })
    return undefined
  }
  return {
    providerID: trimmed.slice(0, slash),
    modelID: trimmed.slice(slash + 1),
  }
}

export async function getSessionsCountSince(instance: InstanceContext, sinceMs: number): Promise<number> {
  const sessions = await listSessionsSince(instance, sinceMs)
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

  export async function shouldTrigger(instance: InstanceContext): Promise<boolean> {
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

    const hoursSince = (Date.now() - lastAt) / HOUR_MS
    if (hoursSince < cfg.minHours) return false

    const sinceScanMs = Date.now() - lastSessionScanAt
    if (sinceScanMs < SCAN_THROTTLE_MS) {
      log.debug("scan throttled", { sinceMs: Math.round(sinceScanMs / 1000) })
      return false
    }
    lastSessionScanAt = Date.now()

    const sessionIds = await listSessionsSince(instance, lastAt)

    if (sessionIds.length < cfg.minSessions) {
      log.debug("insufficient sessions", {
        have: sessionIds.length,
        need: cfg.minSessions,
      })
      return false
    }

    return true
  }

  let pending: Promise<BrainResult> | null = null

  export async function trigger(
    instance: InstanceContext,
    input?: { force?: boolean; sessionID?: string },
  ): Promise<BrainResult> {
    const existing = pending
    if (existing) return existing
    const task = runBrain(instance, input).finally(() => {
      if (pending === task) pending = null
    })
    pending = task
    return task
  }

  async function runBrain(
    instance: InstanceContext,
    input?: { force?: boolean; sessionID?: string },
  ): Promise<BrainResult> {
    const log = Log.create({ service: "brain" })

    if (!(await isBrainEnabled())) {
      return {
        success: false,
        sessionsReviewed: 0,
        hoursSinceLastBrain: 0,
        error: "brain disabled",
      }
    }

    if (!(await isMemoryEnabled())) {
      return {
        success: false,
        sessionsReviewed: 0,
        hoursSinceLastBrain: 0,
        error: "memory disabled",
      }
    }

    let lastAt: number
    try {
      lastAt = await readLastBrainAt()
    } catch (e) {
      return {
        success: false,
        sessionsReviewed: 0,
        hoursSinceLastBrain: 0,
        error: String(e),
      }
    }

    const hoursSince = (Date.now() - lastAt) / HOUR_MS

    let lease: Flock.Lease
    try {
      lease = await Flock.acquire("brain", {
        staleMs: LOCK_DURATION_MS,
        timeoutMs: 100,
      })
    } catch {
      return {
        success: false,
        sessionsReviewed: 0,
        hoursSinceLastBrain: hoursSince,
        error: "lock held",
      }
    }

    let sessionIds = await listSessionsSince(instance, lastAt)
    if (input?.force && sessionIds.length === 0) {
      sessionIds = await listRecentSessions(instance)
    }

    try {
      log.info("brain triggered", { hoursSince })

      const before = await getBrainMemoryContent(instance)
      const habitsBefore = await getHabitsContent(instance)
      const sessionID = await executeBrain(instance, sessionIds, input?.sessionID)
      const after = await getBrainMemoryContent(instance)
      const habitsAfter = await getHabitsContent(instance)

      // Either output counts: a pass that only learned something about how the
      // user works did its job even if project memory was already current.
      if (before !== after || habitsBefore !== habitsAfter) {
        await recordBrain()
        log.info("brain completed", {
          sessionsReviewed: sessionIds.length,
          memoryUpdated: true,
        })
        return {
          success: true,
          sessionsReviewed: sessionIds.length,
          hoursSinceLastBrain: hoursSince,
          sessionID,
        }
      }

      log.warn("brain did not update memory file", {
        sessionsReviewed: sessionIds.length,
      })
      return {
        success: false,
        sessionsReviewed: sessionIds.length,
        hoursSinceLastBrain: hoursSince,
        sessionID,
        error: "memory file unchanged",
      }
    } catch (e) {
      log.error("brain failed", { error: String(e) })
      return {
        success: false,
        sessionsReviewed: sessionIds.length,
        hoursSinceLastBrain: hoursSince,
        error: String(e),
      }
    } finally {
      const released = await lease.release().catch((err) => {
        log.warn("failed to release brain lock", { error: String(err) })
        return false
      })
      if (released) log.debug("brain lock released")
    }
  }

  async function executeBrain(
    instance: InstanceContext,
    sessionIds: string[],
    callerSessionID?: string,
  ): Promise<string> {
    try {
      if (!sessionIds.length) {
        throw new Error("No recent sessions available for Brain")
      }

      const memory = await getBrainMemoryContent(instance)
      const memoryFile = memoryPath(instance)
      await fs.mkdir(path.dirname(memoryFile), { recursive: true })
      await ensureHabitsFile(instance).catch((e) => log.warn("could not seed habits file", { error: String(e) }))
      const habits = await getHabitsContent(instance)
      const reviews = await buildSessionReviews(sessionIds)

      const prompt = buildBrainPrompt(memoryFile, reviews, memory, {
        path: habitsPath(instance),
        content: habits,
      })
      log.info("brain prompt built", {
        promptLength: prompt.length,
        sessionCount: sessionIds.length,
      })

      try {
        const session = await runSession(
          Effect.gen(function* () {
            const sessionService = yield* Session.Service
            return yield* sessionService.create({
              title: BRAIN_SESSION_TITLE,
              permission: [
                { permission: "*", pattern: "*", action: "deny" },
                { permission: "read", pattern: "*", action: "allow" },
                { permission: "edit", pattern: "*", action: "allow" },
                { permission: "glob", pattern: "*", action: "allow" },
                { permission: "grep", pattern: "*", action: "allow" },
                { permission: "list", pattern: "*", action: "allow" },
                { permission: "tree", pattern: "*", action: "allow" },
                { permission: "todowrite", pattern: "*", action: "deny" },
                { permission: "todoread", pattern: "*", action: "deny" },
                { permission: "task", pattern: "*", action: "deny" },
              ],
            })
          }),
        )
        log.info("brain session created", { sessionID: session.id })
        const model = await getBrainProviderModel(callerSessionID)
        log.info("brain model selected", {
          providerID: model.providerID,
          modelID: model.modelID,
        })
        const parts = await runSessionPrompt(
          Effect.gen(function* () {
            const sessionPrompt = yield* SessionPrompt.Service
            return yield* sessionPrompt.resolvePromptParts(prompt)
          }),
        )

        const timeout = setTimeout(() => {
          log.warn("brain session timed out, cancelling", {
            sessionID: session.id,
          })
          void runSessionPrompt(
            Effect.gen(function* () {
              const sessionPrompt = yield* SessionPrompt.Service
              yield* sessionPrompt.cancel(session.id)
            }),
          )
        }, BRAIN_SESSION_TIMEOUT_MS)

        try {
          await runSessionPrompt(
            Effect.gen(function* () {
              const sessionPrompt = yield* SessionPrompt.Service
              return yield* sessionPrompt.prompt({
                sessionID: session.id,
                model,
                parts,
              })
            }),
          )
        } finally {
          clearTimeout(timeout)
        }

        return session.id
      } catch (sessionError) {
        log.warn("could not run brain session", {
          error: String(sessionError),
        })
        return "brain-session-not-created"
      }
    } catch (e) {
      log.error("brain execution failed", { error: String(e) })
      throw e
    }
  }

  export function buildBrainPrompt(
    memoryPath: string,
    sessionReviews: string,
    currentMemory: string,
    habits?: { path: string; content: string },
  ): string {
    return `# Brain: Memory Consolidation

You are performing a Brain pass over ${habits ? "two memories" : "project memory"}. Synthesize what you've learned recently into durable, well-organized notes so that future sessions can orient quickly.

${
  habits
    ? `Files to maintain:
- Project memory: \`${memoryPath}\` — what is true about this codebase.
- User habits: \`${habits.path}\` — how the person working on it works.

Keep them strictly separate. A fact about the code never belongs in the user file, and a preference of the user's never belongs in project memory.`
    : `Memory file to maintain: \`${memoryPath}\``
}

---

## Phase 1 — Orient

- Read the existing files if they exist
- Review what is already recorded before making changes

## Phase 2 — Gather recent signal

Look for new information worth persisting from the session transcripts included below.

## Phase 3 — Consolidate project memory

For each thing worth remembering about the codebase, update \`${memoryPath}\`.

Focus on:
- Merging new signal into existing content rather than creating duplicates
- Converting relative dates to absolute dates
- Deleting contradicted facts
- Keeping the file concise and useful for future coding sessions
${
  habits
    ? `
## Phase 3b — Consolidate user habits

Update \`${habits.path}\` with what the transcripts reveal about **how this user works**. This file is read by every agent in every future session, so only durable, repeated signal belongs in it.

Record things like:
- Tools, commands and workflows they consistently use or consistently reject ("runs typecheck through the monitor tool", "never wants npm")
- Corrections they have had to give more than once — write the rule, not the incident
- How they like work delivered: answer length, how much explanation, commit and PR habits, when they want to be asked versus told
- Recurring conventions in how they name, structure and review code

Rules for this file:
- One short, imperative line per habit, grouped under \`##\` headings; no narrative
- Only patterns seen more than once, or stated outright by the user — a single occurrence is not a habit
- Never record secrets, credentials, file contents, or anything about a specific bug or task
- Never record personal data beyond how they want to be worked with
- Remove a habit the moment the transcripts contradict it, and prefer rewriting an existing line over adding a near-duplicate
- If the recent transcripts reveal no durable habit, leave the file untouched — an empty pass is a correct outcome
`
    : ""
}
## Phase 4 — Prune and index

Keep ${habits ? "both files" : "the memory file"} concise and well-organized. Remove stale entries, add important new ones.

Important:
- Do not create ${habits ? "these files" : "a new memory file"} somewhere else
- Do not ask the user questions
- Use only the provided file tools you need to inspect or update ${habits ? "these files" : "the memory file"}

---

Current project memory:
\`\`\`
${currentMemory || "(empty)"}
\`\`\`
${
  habits
    ? `
Current user habits:
\`\`\`
${habits.content || "(empty)"}
\`\`\`
`
    : ""
}
Recent session transcripts:

${sessionReviews || "(none)"}
`
  }
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd() + "..."
}

type SessionReviewMessage = MessageV2.WithParts

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
        const [session, messages] = await runSession(
          Effect.gen(function* () {
            const sessionService = yield* Session.Service
            return yield* Effect.all([sessionService.get(sessionID), sessionService.messages({ sessionID, limit: 40 })])
          }),
        )
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
