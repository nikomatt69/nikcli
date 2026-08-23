import { isSkillCommandName, skillCommandName, skillSlug as slug } from "@nikcli-ai/util/skill-command"
import path from "path"
import { Config } from "../config/config"
import { EventError } from "@/session/event-error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "@nikcli-ai/util/log"
import { Global } from "@nikcli-ai/util/global"
import { Filesystem } from "@nikcli-ai/util/filesystem"
import { Flag } from "@nikcli-ai/util/flag"
import { Bus } from "@/bus"
import { Session } from "@/session"
import fs from "fs/promises"
import { InstanceState, locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"
import { zodObject } from "@nikcli-ai/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"

export namespace Skill {
  const log = Log.create({ service: "skill" })

  const InfoSchema = Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    location: Schema.String,
    category: Schema.optional(Schema.String),
    tags: Schema.optional(Schema.Array(Schema.String)),
    version: Schema.optional(Schema.String),
  })
  export const Info = zodObject(InfoSchema)
  const Metadata = Info.omit({
    location: true,
  })
  export type Info = Schema.Schema.Type<typeof InfoSchema>
  export type Loaded = Info & {
    dir: string
    content: string
  }

  export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("SkillInvalidError", {
    path: Schema.String,
    message: Schema.optional(Schema.String),
    issues: Schema.optional(Schema.Unknown),
  }) {}

  export class NameMismatchError extends Schema.TaggedErrorClass<NameMismatchError>()("SkillNameMismatchError", {
    path: Schema.String,
    expected: Schema.String,
    actual: Schema.String,
  }) {}

  export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SkillNotFoundError", {
    name: Schema.String,
  }) {}

  export class AlreadyExistsError extends Schema.TaggedErrorClass<AlreadyExistsError>()("SkillAlreadyExistsError", {
    name: Schema.String,
    location: Schema.String,
  }) {}

  /**
   * Union of all errors that any `Skill.Service` method can fail with. Use
   * this in the Effect error channel of downstream consumers so they can
   * `Effect.catchTag` against the specific error class.
   *
   * `ConfigMarkdown.FrontmatterError` is included because `Skill.load` parses
   * the skill file through `ConfigMarkdown.parse`, which throws a tagged
   * frontmatter error on YAML failure.
   */
  export type Error =
    | InvalidError
    | NameMismatchError
    | NotFoundError
    | AlreadyExistsError
    | ConfigMarkdown.FrontmatterError

  /**
   * Map an arbitrary thrown value from a Skill operation to a tagged
   * `Skill.Error`. The frontmatter error is recognized first (the
   * `ConfigMarkdown.parse` call throws a tagged error directly); anything
   * else becomes `InvalidError` so the error channel stays typed.
   */
  function mapError(e: unknown): Error {
    if (e instanceof ConfigMarkdown.FrontmatterError) return e
    if (e instanceof Error) {
      return new InvalidError({
        path: "skill",
        message: e.message,
        issues: { cause: e },
      })
    }
    return new InvalidError({
      path: "skill",
      message: String(e),
    })
  }

  // External skill directories to search for (project-level and global)
  // These follow the directory layout used by Claude Code and other agents.
  const EXTERNAL_DIRS = [".claude", ".agents"]
  const EXTERNAL_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")

  const NIKCLI_SKILL_GLOB = new Bun.Glob("{skill,skills}/**/SKILL.md")

  function normalizeName(input: string) {
    return input.toLowerCase().replace(/[^a-z0-9]+/g, "")
  }

  // The naming rule lives in @nikcli-ai/util/skill-command so clients can spell a command
  // without loading the skill runtime.
  export const commandName = skillCommandName
  export const isCommandName = isSkillCommandName

  type State = Record<string, Info>

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined, never>
    readonly all: () => Effect.Effect<Info[], never>
    readonly resolve: (
      name: string,
      candidates?: Info[],
    ) => Effect.Effect<{ skill: Info | undefined; suggestions: string[] }, never>
    readonly load: (name: string) => Effect.Effect<Loaded | undefined, Error>
    readonly create: (input: CreateInput) => Effect.Effect<Info, Error>
    readonly remove: (name: string) => Effect.Effect<boolean, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/Skill") {}

  function configDirectories(ctx: InstanceContext) {
    return runPromiseWithLayer(
      Config.defaultLayer,
      locallyInstance(
        ctx,
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.directories()
        }),
      ),
    )
  }

  const CreateInputSchema = Schema.Struct({
    name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))).annotate({
      description: "Skill name (kebab-case recommended)",
    }),
    description: Schema.String.pipe(Schema.check(Schema.isMinLength(1))).annotate({
      description: "Short description of the skill",
    }),
    category: Schema.optional(Schema.String).annotate({ description: "Optional category" }),
    tags: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Optional tags" }),
    content: Schema.optional(Schema.String).annotate({ description: "Optional markdown content body" }),
    scope: Schema.Literals(["workspace", "global"])
      .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("workspace" as const)))
      .annotate({ description: "Where to create the skill" }),
  })
  const CreateInput = zodObject(CreateInputSchema)

  export type CreateInput = Schema.Codec.Encoded<typeof CreateInputSchema>
  export type CreateParsedInput = Schema.Schema.Type<typeof CreateInputSchema>

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        (ctx) =>
          Effect.promise(async () => {
            const skills: State = {}

            const addSkill = async (match: string) => {
              const md = await ConfigMarkdown.parse(match).catch((err) => {
                const message =
                  err instanceof ConfigMarkdown.FrontmatterError ? err.message : `Failed to parse skill ${match}`
                Bus.publish(Session.Event.Error, { error: EventError.unknown(message) })
                log.error("failed to load skill", { skill: match, err })
                return undefined
              })

              if (!md) return

              const parsed = Metadata.safeParse(md.data)
              if (!parsed.success) return

              if (skills[parsed.data.name]) {
                log.warn("duplicate skill name", {
                  name: parsed.data.name,
                  existing: skills[parsed.data.name].location,
                  duplicate: match,
                })
              }

              skills[parsed.data.name] = {
                name: parsed.data.name,
                description: parsed.data.description,
                location: match,
                category: parsed.data.category,
                tags: parsed.data.tags,
                version: parsed.data.version,
              }
            }

            const scanExternal = async (root: string, scope: "global" | "project") => {
              return Array.fromAsync(
                EXTERNAL_SKILL_GLOB.scan({
                  cwd: root,
                  absolute: true,
                  onlyFiles: true,
                  followSymlinks: true,
                  dot: true,
                }),
              )
                .then((matches) => Promise.all(matches.map(addSkill)))
                .catch((error) => {
                  log.error(`failed to scan ${scope} skills`, { dir: root, error })
                })
            }

            if (!Flag.NIKCLI_DISABLE_EXTERNAL_SKILLS) {
              for (const dir of EXTERNAL_DIRS) {
                const root = path.join(Global.Path.home, dir)
                if (!(await Filesystem.isDir(root))) continue
                await scanExternal(root, "global")
              }

              for await (const root of Filesystem.up({
                targets: EXTERNAL_DIRS,
                start: ctx.directory,
                stop: ctx.worktree,
              })) {
                await scanExternal(root, "project")
              }
            }

            for (const dir of await configDirectories(ctx)) {
              // The config dir may not exist yet; scanning a missing dir throws
              // ENOENT and would crash instance creation, so skip/tolerate it.
              if (!(await Filesystem.isDir(dir))) continue
              await Array.fromAsync(
                NIKCLI_SKILL_GLOB.scan({
                  cwd: dir,
                  absolute: true,
                  onlyFiles: true,
                  followSymlinks: true,
                }),
              )
                .then((matches) => Promise.all(matches.map(addSkill)))
                .catch((error) => {
                  log.error("failed to scan nikcli skills", { dir, error })
                })
            }

            return skills
          }),
        // Pure derivation of the skill files on disk, so it joins instance hot
        // reload instead of pinning the set read at first access.
        { reloadable: true },
      )

      const get: Interface["get"] = Effect.fn("Skill.get")(function* (name: string) {
        return yield* InstanceState.get(state).pipe(Effect.map((skills) => skills[name]))
      })

      const all: Interface["all"] = Effect.fn("Skill.all")(function* () {
        return yield* InstanceState.get(state).pipe(Effect.map((skills) => Object.values(skills)))
      })

      const resolve: Interface["resolve"] = Effect.fn("Skill.resolve")(function* (name: string, candidates?: Info[]) {
        const query = name.trim()
        if (!query) return { skill: undefined, suggestions: [] as string[] }

        const list = candidates ?? (yield* all())
        const lower = query.toLowerCase()
        const normalized = normalizeName(query)

        const exact =
          list.find((skill) => skill.name === query) ??
          list.find((skill) => skill.name.toLowerCase() === lower) ??
          (() => {
            const matches = list.filter((skill) => normalizeName(skill.name) === normalized)
            return matches.length === 1 ? matches[0] : undefined
          })()

        if (exact) {
          return { skill: exact, suggestions: [exact.name] }
        }

        const partial = list.filter((skill) => {
          const skillName = skill.name.toLowerCase()
          const normalizedName = normalizeName(skill.name)
          return skillName.includes(lower) || normalizedName.includes(normalized)
        })

        if (partial.length === 1) {
          return { skill: partial[0], suggestions: partial.map((skill) => skill.name) }
        }

        const related = partial.length
          ? partial
          : list.filter((skill) =>
              [skill.description, skill.category ?? "", ...(skill.tags ?? [])].some((value) =>
                value.toLowerCase().includes(lower),
              ),
            )

        return {
          skill: undefined,
          suggestions: related.slice(0, 5).map((skill) => skill.name),
        }
      })

      const load: Interface["load"] = Effect.fn("Skill.load")(function* (name: string) {
        const skill = yield* get(name)
        if (!skill) return undefined

        const parsed = yield* Effect.tryPromise({
          try: () => ConfigMarkdown.parse(skill.location),
          catch: mapError,
        })
        return {
          ...skill,
          dir: path.dirname(skill.location),
          content: parsed.content.trim(),
        }
      })

      const create: Interface["create"] = Effect.fn("Skill.create")(function* (input: CreateInput) {
        const parsed = CreateInput.parse(input)
        const skills = yield* InstanceState.get(state)

        if (skills[parsed.name]) {
          return yield* Effect.fail(
            new AlreadyExistsError({
              name: parsed.name,
              location: skills[parsed.name].location,
            }),
          )
        }

        const directory = yield* InstanceState.directory
        const skillDir =
          parsed.scope === "global"
            ? path.join(Global.Path.config, "skills", slug(parsed.name))
            : path.join(directory, ".nikcli", "skill", slug(parsed.name))

        yield* Effect.tryPromise({
          try: () => fs.mkdir(skillDir, { recursive: true }),
          catch: mapError,
        })
        const skillFile = path.join(skillDir, "SKILL.md")

        const frontmatter: string[] = [
          "---",
          `name: |`,
          `  ${parsed.name}`,
          `description: |`,
          `  ${parsed.description}`,
        ]
        if (parsed.category) frontmatter.push(`category: |`, `  ${parsed.category}`)
        if (parsed.tags?.length) frontmatter.push(`tags:`, ...parsed.tags.map((t) => `  - ${t}`))
        frontmatter.push("---", "")

        const body = parsed.content ?? `# ${parsed.name}\n\n${parsed.description}\n`
        yield* Effect.tryPromise({
          try: () => Bun.write(skillFile, frontmatter.join("\n") + body),
          catch: mapError,
        })

        const info: Info = {
          name: parsed.name,
          description: parsed.description,
          location: skillFile,
          category: parsed.category,
          tags: parsed.tags,
        }
        skills[parsed.name] = info

        return info
      })

      const remove: Interface["remove"] = Effect.fn("Skill.remove")(function* (name: string) {
        const skills = yield* InstanceState.get(state)
        const skill = skills[name]
        if (!skill) {
          return yield* Effect.fail(new NotFoundError({ name }))
        }

        yield* Effect.tryPromise({
          try: () => fs.rm(path.dirname(skill.location), { recursive: true, force: true }),
          catch: mapError,
        })
        delete skills[name]
        return true
      })

      return Service.of({
        get,
        all,
        resolve,
        load,
        create,
        remove,
      })
    }),
  )

  export const defaultLayer = layer
}
