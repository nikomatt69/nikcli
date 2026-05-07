import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { PermissionNext } from "../permission/next"
import { Session } from "../session"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

function runSkill<A, E>(effect: Effect.Effect<A, E, Skill.Service>) {
  return runPromiseWithLayer(Skill.defaultLayer, effect)
}

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

export const SkillTool = Tool.define("skill", async (ctx) => {
  const allSkills = await runSkill(
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      return yield* skill.all()
    }),
  )

  const agent = ctx?.agent
  const accessibleSkills = agent
    ? allSkills.filter((skill) => {
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        return rule.action !== "deny"
      })
    : allSkills

  const description =
    accessibleSkills.length === 0
      ? "Load a skill to get detailed instructions for a specific task. No skills are currently available."
      : [
          "Load a skill to get detailed instructions for a specific task.",
          "Skills provide specialized knowledge and step-by-step guidance.",
          "Use this when a task matches an available skill's description.",
          "Only the skills listed here are available:",
          "<available_skills>",
          ...accessibleSkills.flatMap((skill) =>
            [
              `  <skill>`,
              `    <name>${skill.name}</name>`,
              `    <description>${skill.description}</description>`,
              skill.category ? `    <category>${skill.category}</category>` : null,
              skill.tags?.length ? `    <tags>${skill.tags.join(", ")}</tags>` : null,
            ].filter(Boolean),
          ),
          "</available_skills>",
        ].join(" ")

  const examples = accessibleSkills
    .map((skill) => `'${skill.name}'`)
    .slice(0, 3)
    .join(", ")
  const hint = examples.length > 0 ? ` (e.g., ${examples}, ...)` : ""

  const parameters = z.object({
    name: z.string().optional().describe(`The skill identifier from available_skills${hint}`),
    search: z.string().optional().describe("Filter skills by name or description"),
    category: z.string().optional().describe("Filter skills by category"),
    tags: z.string().optional().describe("Filter by comma-separated tags"),
  })

  return {
    description,
    parameters,
    formatValidationError(error) {
      const formattedErrors = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""
          return `  - ${path}${issue.message}`
        })
        .join("\n")
      return `Invalid parameters for skill tool:\n${formattedErrors}`
    },
    async execute(
      params: z.infer<typeof parameters>,
      ctx: Tool.Context,
    ): Promise<{ title: string; output: string; metadata: Record<string, any> }> {
      let skills = accessibleSkills

      if (params.search) {
        const searchLower = params.search.toLowerCase()
        skills = skills.filter((s) =>
          [s.name, s.description, s.category ?? "", ...(s.tags ?? [])].some((value) =>
            value.toLowerCase().includes(searchLower),
          ),
        )
      }

      if (params.category) {
        skills = skills.filter((s) => s.category === params.category)
      }

      if (params.tags) {
        const tagList = params.tags.split(",").map((t) => t.trim().toLowerCase())
        skills = skills.filter((s) => s.tags?.some((t) => tagList.includes(t.toLowerCase())))
      }

      if (params.name) {
        const resolved = await runSkill(
          Effect.gen(function* () {
            const skill = yield* Skill.Service
            return yield* skill.resolve(params.name!, accessibleSkills)
          }),
        )
        if (!resolved.skill) {
          const suggestions = resolved.suggestions.join(", ")
          const available = accessibleSkills.map((skill) => skill.name).join(", ")
          const hint = suggestions ? ` Did you mean: ${suggestions}?` : ""
          throw new Error(`Skill "${params.name}" not found.${hint} Available skills: ${available || "none"}`)
        }
        const resolvedSkill = resolved.skill

        await ctx.ask({
          permission: "skill",
          patterns: [resolvedSkill.name],
          always: [resolvedSkill.name],
          metadata: {},
        })

        const loaded = await runSkill(
          Effect.gen(function* () {
            const skill = yield* Skill.Service
            return yield* skill.load(resolvedSkill.name)
          }),
        )
        if (!loaded) {
          throw new Error(`Skill "${resolved.skill.name}" could not be loaded.`)
        }

        if (ctx.sessionID) {
          await runSession(
            Effect.gen(function* () {
              const session = yield* Session.Service
              yield* session.update(ctx.sessionID!, (draft) => {
                const next = new Set(draft.skills ?? [])
                next.add(loaded.name)
                draft.skills = [...next]
              })
            }),
          )
        }

        const dir = loaded.dir

        const meta = [
          `**Slash command**: /${Skill.commandName(loaded.name)}`,
          `**Base directory**: ${dir}`,
          loaded.category ? `**Category**: ${loaded.category}` : null,
          loaded.tags?.length ? `**Tags**: ${loaded.tags.join(", ")}` : null,
          loaded.version ? `**Version**: ${loaded.version}` : null,
        ].filter(Boolean)

        const output = [`## Skill: ${loaded.name}`, "", meta.join("\n"), "", loaded.content].join("\n")

        return {
          title: `Loaded skill: ${loaded.name}`,
          output,
          metadata: {
            name: loaded.name,
            dir,
            category: loaded.category,
            tags: loaded.tags,
            version: loaded.version,
            command: Skill.commandName(loaded.name),
          },
        }
      }

      if (skills.length === 0) {
        return {
          title: "No skills found",
          output: "No skills match the specified filters.",
          metadata: { count: 0 },
        }
      }

      return {
        title: `Found ${skills.length} skill(s)`,
        output: [
          "## Matching Skills",
          "",
          ...skills.map((s) => `- **${s.name}**: ${s.description}${s.category ? ` (${s.category})` : ""}`),
        ].join("\n"),
        metadata: {
          count: skills.length,
          skills: skills.map((s) => ({
            name: s.name,
            category: s.category,
            tags: s.tags,
          })),
        },
      }
    },
  }
})
