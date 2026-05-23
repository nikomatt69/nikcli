import matter from "gray-matter"
import { Schema } from "effect"

export namespace ConfigMarkdown {
  export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
  export const SHELL_REGEX = /!`([^`]+)`/g

  export function files(template: string) {
    return Array.from(template.matchAll(FILE_REGEX))
  }

  export function shell(template: string) {
    return Array.from(template.matchAll(SHELL_REGEX))
  }

  export function preprocessFrontmatter(content: string): string {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return content

    const frontmatter = match[1]
    const lines = frontmatter.split("\n")
    const result: string[] = []

    for (const line of lines) {
      if (line.trim().startsWith("#") || line.trim() === "") {
        result.push(line)
        continue
      }

      if (line.match(/^\s+/)) {
        result.push(line)
        continue
      }

      const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
      if (!kvMatch) {
        result.push(line)
        continue
      }

      const key = kvMatch[1]
      const value = kvMatch[2].trim()

      if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) {
        result.push(line)
        continue
      }

      if (value.includes(":")) {
        result.push(`${key}: |`)
        result.push(`  ${value}`)
        continue
      }

      result.push(line)
    }

    const processed = result.join("\n")
    return content.replace(frontmatter, () => processed)
  }

  export async function parse(filePath: string) {
    const raw = await Bun.file(filePath).text()
    const template = preprocessFrontmatter(raw)

    try {
      const md = matter(template)
      return md
    } catch (err) {
      throw Object.assign(
        new FrontmatterError({
          path: filePath,
          message: `${filePath}: Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        }),
        { cause: err },
      )
    }
  }

  export class FrontmatterError extends Schema.TaggedErrorClass<FrontmatterError>()("ConfigFrontmatterError", {
    path: Schema.String,
    message: Schema.String,
  }) {}
}
