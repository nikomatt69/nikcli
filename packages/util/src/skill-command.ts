import { createHash } from "crypto"

/**
 * How a skill's name becomes its slash command.
 *
 * Both the server (which registers the command and writes it into the system prompt) and the
 * terminal (which shows it in the skills dialog) have to spell it the same way, so the rule lives
 * on its own. `Skill.commandName` re-exports it — reaching for that name pulled in the whole skill
 * loader, and with it `@/session`, `@/bus` and the Effect runtime, to format a string.
 *
 * The hash disambiguates two skills whose names slug identically.
 */
export const SKILL_COMMAND_PREFIX = "skill:"

/** The same slugging used for a skill's on-disk directory, so the two never disagree. */
export function skillSlug(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function skillCommandName(name: string) {
  const suffix = skillSlug(name) || "skill"
  const hash = createHash("sha1").update(name).digest("hex").slice(0, 6)
  return `${SKILL_COMMAND_PREFIX}${suffix}-${hash}`
}

export function isSkillCommandName(name: string) {
  return name.startsWith(SKILL_COMMAND_PREFIX)
}
