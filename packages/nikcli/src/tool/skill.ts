import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { ConfigMarkdown } from "../config/markdown"
import { PermissionNext } from "../permission/next"

export const SkillTool = Tool.define("skill", async (ctx) => {
  const allSkills = await Skill.all()

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
        skills = skills.filter(
          (s) => s.name.toLowerCase().includes(searchLower) || s.description.toLowerCase().includes(searchLower),
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
        const skill = await Skill.get(params.name)
        if (!skill) {
          const available = await Skill.all().then((x) => Object.keys(x).join(", "))
          throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
        }

        await ctx.ask({
          permission: "skill",
          patterns: [params.name],
          always: [params.name],
          metadata: {},
        })

        const parsed = await ConfigMarkdown.parse(skill.location)
        const dir = path.dirname(skill.location)

        const meta = [
          `**Base directory**: ${dir}`,
          skill.category ? `**Category**: ${skill.category}` : null,
          skill.tags?.length ? `**Tags**: ${skill.tags.join(", ")}` : null,
          skill.version ? `**Version**: ${skill.version}` : null,
        ].filter(Boolean)

        const output = [`## Skill: ${skill.name}`, "", meta.join("\n"), "", parsed.content.trim()].join("\n")

        return {
          title: `Loaded skill: ${skill.name}`,
          output,
          metadata: {
            name: skill.name,
            dir,
            category: skill.category,
            tags: skill.tags,
            version: skill.version,
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
