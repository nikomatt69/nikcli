import path from "path"
import fs from "fs/promises"
import { Context, Effect, Layer, Schema } from "effect"
import { Global } from "@nikcli-ai/util/global"
import { Log } from "@nikcli-ai/util/log"
import { zodObject, type DeepMutable } from "@nikcli-ai/util/effect-zod"
import { AccountRepo } from "@/account/repo"

/**
 * Per-user personalization ("who am I, how do I work") that every agent sees as
 * a small standing block in the system prompt.
 *
 * This is deliberately *not* config: `nikcli.json` is project-mergeable and
 * shared through a repo, while a profile belongs to the human sitting at the
 * terminal and follows them across every project on the machine. It is keyed by
 * the signed-in account so two people on the same box (or one person with a
 * work and a personal account) never inherit each other's preferences.
 *
 * Storage: `<config>/profile/<accountID>.json`, falling back to `local.json`
 * when nobody is signed in. Signing in adopts the anonymous profile once, so
 * personalization done before login is not lost.
 */
export namespace Profile {
  const log = Log.create({ service: "profile" })

  /** Filename used while no account is active. */
  const LOCAL_KEY = "local"

  export const VERSION = 1

  const VerbositySchema = Schema.Literals(["concise", "balanced", "detailed"])
  export type Verbosity = Schema.Schema.Type<typeof VerbositySchema>

  export const InfoSchema = Schema.Struct({
    version: Schema.Number,
    /** Account this profile belongs to, or `"local"` when signed out. */
    key: Schema.String,
    /** How the user wants to be addressed. */
    name: Schema.optional(Schema.String),
    /** Job title / seniority — "senior backend engineer", "design engineer". */
    role: Schema.optional(Schema.String),
    /** Free-form self description. The one field worth filling in first. */
    about: Schema.optional(Schema.String),
    /** Languages, frameworks and runtimes the user works in. */
    stack: Schema.optional(Schema.Array(Schema.String)),
    /** Areas the user already knows well — the agent can skip the basics. */
    expertise: Schema.optional(Schema.Array(Schema.String)),
    /** Areas the user is learning — the agent should explain more here. */
    learning: Schema.optional(Schema.Array(Schema.String)),
    /** Skill names the agent should reach for first (see `Skill.Service`). */
    skills: Schema.optional(Schema.Array(Schema.String)),
    tools: Schema.optional(
      Schema.Struct({
        /** Tool ids to prefer when several would work. */
        preferred: Schema.optional(Schema.Array(Schema.String)),
        /** Tool ids the user would rather the agent did not reach for. */
        avoid: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
    /** Standing rules — "always bun, never npm", "no comments unless asked". */
    conventions: Schema.optional(Schema.Array(Schema.String)),
    communication: Schema.optional(
      Schema.Struct({
        verbosity: Schema.optional(VerbositySchema),
        /** Natural language for prose replies. Overrides locale detection. */
        language: Schema.optional(Schema.String),
        /** Whether the user wants the reasoning behind a change spelled out. */
        explain: Schema.optional(Schema.Boolean),
      }),
    ),
    /** Escape hatch: raw text appended verbatim to the reminder. */
    custom: Schema.optional(Schema.String),
    /**
     * Whether the habits nikcli learned on its own (see {@link habitsFile}) are
     * shown to agents. Absent means enabled — opting out is the deliberate act.
     */
    habits: Schema.optional(Schema.Boolean),
    updatedAt: Schema.Number,
  }).annotate({ identifier: "Profile" })

  export const Info = zodObject(InfoSchema)
  export type Info = DeepMutable<Schema.Schema.Type<typeof InfoSchema>>

  /** The editable half of {@link Info} — everything except bookkeeping fields. */
  export type Input = Partial<Omit<Info, "version" | "key" | "updatedAt">>

  export class IOError extends Schema.TaggedErrorClass<IOError>()("ProfileIOError", {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }) {}

  export interface Interface {
    /** The active profile, or `undefined` when the user has not set one up. */
    readonly get: () => Effect.Effect<Info | undefined, IOError>
    /** Merge `input` into the stored profile and persist it. */
    readonly patch: (input: Input) => Effect.Effect<Info, IOError>
    /** Replace the stored profile wholesale. */
    readonly save: (input: Input) => Effect.Effect<Info, IOError>
    /** Delete the profile for the active key. */
    readonly clear: () => Effect.Effect<boolean, IOError>
    /** Raw contents of the learned-habits file for a project, or `""`. */
    readonly habits: (worktree: string) => Effect.Effect<string>
    /** Delete the learned-habits file for a project. */
    readonly clearHabits: (worktree: string) => Effect.Effect<boolean>
    /**
     * The `<user_profile>` (declared) and `<user_habits>` (learned) blocks for
     * the system prompt, or `[]` when there is nothing worth telling the model.
     * Never fails — a broken profile file must not take a session down.
     */
    readonly reminder: (worktree?: string) => Effect.Effect<string[]>
  }

  export class Service extends Context.Service<Service, Interface>()("Profile.Service") {}

  // ==========================================================================
  // Storage
  // ==========================================================================

  export function directory() {
    return path.join(Global.Path.config, "profile")
  }

  /**
   * Which profile file is live right now. Reading the account DB can fail on a
   * fresh machine (no DB yet) — that is a signed-out user, not an error.
   */
  export function activeKey(): string {
    try {
      return AccountRepo.active()?.id ?? LOCAL_KEY
    } catch {
      return LOCAL_KEY
    }
  }

  function file(key: string) {
    return path.join(directory(), `${key}.json`)
  }

  /**
   * Short-lived read cache. `reminder()` runs on every turn of every session
   * (and every subagent), so the uncached path would be one stat + one read per
   * turn. Writes invalidate it directly; the TTL only covers the case where a
   * separate process (a remote server, the desktop app) edited the file.
   */
  const cache = new Map<string, { value: Info | undefined; at: number }>()
  const CACHE_TTL = 5_000

  function invalidate(key: string) {
    cache.delete(key)
  }

  async function readFile(key: string): Promise<Info | undefined> {
    const raw = await Bun.file(file(key))
      .json()
      .catch(() => undefined)
    if (raw === undefined) return undefined
    const parsed = Info.safeParse(raw)
    if (!parsed.success) {
      log.warn("ignoring malformed profile", { key, issue: parsed.error.issues[0]?.message })
      return undefined
    }
    return parsed.data as Info
  }

  async function readImpl(): Promise<Info | undefined> {
    const key = activeKey()
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value

    let value = await readFile(key)
    // Adoption: personalization done before signing in belongs to the person
    // who then signs in — there is no one else it could belong to.
    if (!value && key !== LOCAL_KEY) {
      const anonymous = await readFile(LOCAL_KEY)
      if (anonymous) {
        value = { ...anonymous, key }
        await writeImpl(value).catch((cause) => log.warn("failed to adopt local profile", { key, cause }))
      }
    }
    cache.set(key, { value, at: Date.now() })
    return value
  }

  async function writeImpl(info: Info): Promise<Info> {
    await fs.mkdir(directory(), { recursive: true })
    await Bun.write(file(info.key), JSON.stringify(info, null, 2))
    cache.set(info.key, { value: info, at: Date.now() })
    return info
  }

  /** Drop empty strings and empty arrays so the rendered block stays tight. */
  function prune(input: Input): Input {
    const out: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(input)) {
      if (value === undefined || value === null) continue
      if (typeof value === "string" && value.trim() === "") continue
      if (Array.isArray(value)) {
        const items = value.map((x) => String(x).trim()).filter(Boolean)
        if (items.length === 0) continue
        out[field] = items
        continue
      }
      if (typeof value === "object") {
        const nested = prune(value as Input)
        if (Object.keys(nested).length === 0) continue
        out[field] = nested
        continue
      }
      out[field] = value
    }
    return out as Input
  }

  /**
   * Fields the caller explicitly blanked out. `prune` drops them from the
   * patch, which on a merge would silently keep the old value — so a "clear
   * this field" edit has to be carried separately.
   */
  function cleared(input: Input): string[] {
    return Object.entries(input)
      .filter(([, value]) => value === null || (typeof value === "string" && value.trim() === ""))
      .map(([field]) => field)
      .concat(
        Object.entries(input)
          .filter(([, value]) => Array.isArray(value) && value.filter((x) => String(x).trim()).length === 0)
          .map(([field]) => field),
      )
  }

  async function saveImpl(input: Input, merge: boolean): Promise<Info> {
    const key = activeKey()
    const previous = merge ? await readImpl() : undefined
    const next: Info = {
      ...previous,
      ...prune(input),
      version: VERSION,
      key,
      updatedAt: Date.now(),
    } as Info
    for (const field of cleared(input)) delete (next as Record<string, unknown>)[field]
    // A merge that blanks a field has to be able to remove it, so re-prune the
    // merged result rather than trusting `previous` to already be clean.
    const cleaned = prune(next as Input)
    return writeImpl({ ...cleaned, version: VERSION, key, updatedAt: next.updatedAt } as Info)
  }

  async function clearImpl(): Promise<boolean> {
    const key = activeKey()
    invalidate(key)
    return fs
      .rm(file(key))
      .then(() => true)
      .catch(() => false)
  }

  // ==========================================================================
  // Learned habits
  // ==========================================================================

  /**
   * Where nikcli records what it has *observed* about how the user works, as
   * opposed to what they declared in `/profile`.
   *
   * Project-local on purpose: habits are learned from the work done in a
   * repository, they read like documentation of that work, and keeping them in
   * `.nikcli/` means a team can share them (or gitignore them) by choice — the
   * same call every project already makes for `.nikcli/agent`, `.nikcli/command`
   * and friends. The declared profile stays global and per-account.
   *
   * Written by the Brain consolidation pass (see `src/brain/index.ts`), which is
   * also what keeps `.github/instructions/memory.instruction.md` current.
   */
  export function habitsFile(worktree: string) {
    return path.join(worktree, ".nikcli", "habits.md")
  }

  /**
   * Habits are read on every turn but rewritten only by an occasional Brain
   * pass, so a short TTL keeps the prompt path off the disk without letting a
   * fresh consolidation go unnoticed for long.
   */
  const habitsCache = new Map<string, { value: string; at: number }>()

  /**
   * A worktree equal to its own filesystem root is nikcli's "not in a project"
   * fallback. There is no `.nikcli` to read there, and looking anyway would let
   * a stray `/.nikcli/habits.md` leak into every session on the machine.
   */
  function isProjectRoot(worktree: string) {
    return Boolean(worktree) && path.parse(worktree).root !== worktree
  }

  /**
   * Which directory owns `.nikcli/habits.md` for an instance.
   *
   * The worktree is the right answer whenever there is one, so every directory
   * inside a repository shares a single habits file. Outside a repository the
   * worktree degrades to the filesystem root, and the working directory is the
   * only sensible project root left.
   */
  export function projectRoot(input: { directory: string; worktree?: string }): string {
    return input.worktree && isProjectRoot(input.worktree) ? input.worktree : input.directory
  }

  async function readHabitsImpl(worktree: string): Promise<string> {
    if (!isProjectRoot(worktree)) return ""
    const target = habitsFile(worktree)
    const hit = habitsCache.get(target)
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value
    const value = await Bun.file(target)
      .text()
      .catch(() => "")
    habitsCache.set(target, { value, at: Date.now() })
    return value
  }

  async function clearHabitsImpl(worktree: string): Promise<boolean> {
    const target = habitsFile(worktree)
    habitsCache.delete(target)
    return fs
      .rm(target)
      .then(() => true)
      .catch(() => false)
  }

  /** Guard against a runaway habits file crowding out the actual conversation. */
  const HABITS_MAX_CHARS = 4_000

  /**
   * The learned half of the reminder.
   *
   * Deliberately labelled as inferred: these lines were written by a model
   * reading past sessions, not by the user, so an agent must be willing to drop
   * one the moment the user contradicts it.
   */
  export function renderHabits(content: string): string[] {
    const body = content
      // Strip a leading markdown title — the block already says what this is.
      .replace(/^#\s+.*\n+/, "")
      .trim()
    if (!body) return []
    const clipped = body.length > HABITS_MAX_CHARS ? `${body.slice(0, HABITS_MAX_CHARS).trimEnd()}\n…(truncated)` : body
    return [
      [
        "<user_habits>",
        "Habits nikcli observed in this project's past sessions, not stated by the user.",
        "Treat them as a good prior, never as a rule: if the user says otherwise, they are wrong and the user is right.",
        clipped,
        "</user_habits>",
      ].join("\n"),
    ]
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================

  function list(values: readonly string[] | undefined): string | undefined {
    if (!values || values.length === 0) return undefined
    return values.join(", ")
  }

  /** True when the profile carries nothing the model could act on. */
  export function isEmpty(info: Info | undefined): boolean {
    if (!info) return true
    return render(info).length === 0
  }

  /**
   * The block injected into the system prompt.
   *
   * Framed as standing context rather than as instructions: a profile says who
   * the user is, and must never outrank the project's AGENTS.md or what the
   * user just asked for. Kept short on purpose — it is paid for in every
   * request of every session, including subagents.
   */
  export function render(info: Info): string[] {
    const lines: string[] = []
    const push = (label: string, value: string | undefined) => {
      if (value && value.trim()) lines.push(`${label}: ${value.trim()}`)
    }

    push("Name", info.name)
    push("Role", info.role)
    push("About", info.about)
    push("Works with", list(info.stack))
    push("Already knows well", list(info.expertise))
    push("Currently learning", list(info.learning))

    if (info.skills?.length) {
      lines.push(
        `Preferred skills: ${info.skills.join(", ")} — load one with the skill tool when it fits the task, do not force it otherwise.`,
      )
    }
    if (info.tools?.preferred?.length) {
      lines.push(`Preferred tools: ${info.tools.preferred.join(", ")} — reach for these first when several would work.`)
    }
    if (info.tools?.avoid?.length) {
      lines.push(`Tools to avoid: ${info.tools.avoid.join(", ")} — use another tool unless there is no alternative.`)
    }
    if (info.conventions?.length) {
      lines.push("Standing conventions:")
      lines.push(...info.conventions.map((rule) => `- ${rule}`))
    }

    const comms: string[] = []
    if (info.communication?.verbosity) {
      comms.push(
        {
          concise: "keep answers short and skip preamble",
          balanced: "keep answers moderately detailed",
          detailed: "give thorough answers with context",
        }[info.communication.verbosity],
      )
    }
    if (info.communication?.explain !== undefined) {
      comms.push(
        info.communication.explain
          ? "briefly explain the reasoning behind non-obvious changes"
          : "skip explanations unless asked",
      )
    }
    if (info.communication?.language) {
      comms.push(`write prose in ${info.communication.language} (code and identifiers stay as-is)`)
    }
    if (comms.length) lines.push(`Communication: ${comms.join("; ")}.`)

    push("Also", info.custom)

    if (lines.length === 0) return []
    return [
      [
        "<user_profile>",
        "Standing context about the person you are working with, configured by them in nikcli.",
        "Use it to pitch your answers and tool choices. It never overrides project instructions or the user's current request.",
        ...lines,
        "</user_profile>",
      ].join("\n"),
    ]
  }

  // ==========================================================================
  // Service
  // ==========================================================================

  async function reminderImpl(worktree?: string): Promise<string[]> {
    const info = await readImpl()
    const declared = info ? render(info) : []
    // `habits: false` is the opt-out; an absent profile still gets habits,
    // because learning does not depend on having filled the form in.
    if (!worktree || info?.habits === false) return declared
    const habits = await readHabitsImpl(worktree)
    return [...declared, ...renderHabits(habits)]
  }

  function io<A>(thunk: () => Promise<A>) {
    return Effect.tryPromise({
      try: thunk,
      catch: (cause) => new IOError({ message: cause instanceof Error ? cause.message : String(cause), cause }),
    })
  }

  export const layer = Layer.succeed(
    Service,
    Service.of({
      get: () => io(() => readImpl()),
      patch: (input) => io(() => saveImpl(input, true)),
      save: (input) => io(() => saveImpl(input, false)),
      clear: () => io(() => clearImpl()),
      habits: (worktree) => Effect.promise(() => readHabitsImpl(worktree).catch(() => "")),
      clearHabits: (worktree) => Effect.promise(() => clearHabitsImpl(worktree).catch(() => false)),
      reminder: (worktree) =>
        Effect.promise(() =>
          reminderImpl(worktree).catch((cause) => {
            log.warn("failed to build profile reminder", { cause })
            return [] as string[]
          }),
        ),
    }),
  )

  export const defaultLayer = layer
}
