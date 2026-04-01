import semver from "semver"
import { isRecord } from "@/util/record"
import { readPluginPackage, parsePluginSpecifier } from "./shared"
import type { HookMatcherPattern } from "./hooks"

export type ManifestHooks = {
  [key: string]: HookMatcherPattern | boolean | undefined
}

export type ManifestCommand = {
  name: string
  description?: string
  handler: string
  args?: string[]
}

export type ManifestAgent = {
  name: string
  description?: string
  instructions?: string
  tools?: string[]
}

export type ManifestSkill = {
  name: string
  description?: string
  command: string
  args?: string[]
}

export type ManifestOutputStyle = {
  name: string
  template: string
  colors?: Record<string, string>
}

export type ManifestEntry = {
  name?: string
  version?: string
  description?: string
  nikcliPlugin?: string | boolean
  engines?: {
    nikcli?: string
  }
  hooks?: ManifestHooks
  commands?: ManifestCommand[]
  agents?: ManifestAgent[]
  skills?: ManifestSkill[]
  outputStyles?: ManifestOutputStyle[]
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export type ManifestValidationError = {
  field: string
  message: string
}

export type ManifestValidationResult = {
  valid: boolean
  errors: ManifestValidationError[]
  warnings: string[]
  manifest: ManifestEntry | null
}

const RESERVED_HOOKS = [
  "event",
  "config",
  "tool",
  "auth",
  "chat.message",
  "chat.params",
  "permission.ask",
  "command.execute.before",
  "tool.execute.before",
  "tool.execute.after",
  "experimental.chat.messages.transform",
  "experimental.chat.system.transform",
  "experimental.session.compacting",
  "experimental.text.complete",
]

const VALID_HOOKS = new Set(RESERVED_HOOKS)

const NAME_PATTERN = /^[a-z0-9][a-z0-9-._]*$/

function validateName(value: unknown, field: string, errors: ManifestValidationError[]): string | undefined {
  if (typeof value !== "string") {
    errors.push({ field, message: `${field} must be a string` })
    return
  }
  if (value.length === 0) {
    errors.push({ field, message: `${field} cannot be empty` })
    return
  }
  if (value.length > 214) {
    errors.push({ field, message: `${field} must be 214 characters or less` })
    return
  }
  if (!NAME_PATTERN.test(value)) {
    errors.push({
      field,
      message: `${field} must start with a letter or number and contain only lowercase letters, numbers, hyphens, dots, and underscores`,
    })
    return
  }
  return value
}

function validateVersion(value: unknown, field: string, errors: ManifestValidationError[]): string | undefined {
  if (typeof value !== "string") {
    errors.push({ field, message: `${field} must be a string` })
    return
  }
  if (!semver.valid(value)) {
    errors.push({ field, message: `${field} must be a valid semver` })
    return
  }
  return value
}

function validateEngines(engines: unknown, errors: ManifestValidationError[]): void {
  if (!isRecord(engines)) {
    errors.push({ field: "engines", message: "engines must be an object" })
    return
  }
  const nikcli = engines.nikcli
  if (typeof nikcli !== "string") return
  if (!semver.validRange(nikcli)) {
    errors.push({ field: "engines.nikcli", message: "engines.nikcli must be a valid semver range" })
  }
}

function validateHookName(name: string, errors: ManifestValidationError[]): void {
  if (name.startsWith("experimental.") && !RESERVED_HOOKS.includes(name)) return
  if (!VALID_HOOKS.has(name)) {
    errors.push({
      field: `hooks.${name}`,
      message: `Unknown hook '${name}'. Valid hooks: ${RESERVED_HOOKS.join(", ")}`,
    })
  }
}

function validateHookValue(key: string, value: unknown, errors: ManifestValidationError[], warnings: string[]): void {
  validateHookName(key, errors)
  if (typeof value === "boolean") return
  if (value === undefined) return
  if (!isRecord(value)) {
    errors.push({ field: `hooks.${key}`, message: `hooks.${key} must be a boolean or an object` })
    return
  }
  const allowed = ["hook", "path", "tool", "sessionID", "agent", "command", "model"]
  for (const k of Object.keys(value)) {
    if (!allowed.includes(k)) {
      warnings.push(`hooks.${key} contains unknown field '${k}'. Valid fields: ${allowed.join(", ")}`)
    }
  }
}

function validateHooks(hooks: unknown, errors: ManifestValidationError[], warnings: string[]): void {
  if (!hooks) return
  if (!isRecord(hooks)) {
    errors.push({ field: "hooks", message: "hooks must be an object" })
    return
  }
  for (const [key, value] of Object.entries(hooks)) {
    validateHookValue(key, value, errors, warnings)
  }
}

function validateCommand(cmd: unknown, index: number, errors: ManifestValidationError[]): void {
  if (!isRecord(cmd)) {
    errors.push({ field: `commands[${index}]`, message: "Command must be an object" })
    return
  }
  const name = cmd.name
  if (typeof name !== "string" || !name.trim()) {
    errors.push({ field: `commands[${index}].name`, message: "Command name is required" })
  }
  const handler = cmd.handler
  if (typeof handler !== "string" || !handler.trim()) {
    errors.push({ field: `commands[${index}].handler`, message: "Command handler is required" })
  }
}

function validateCommands(commands: unknown, errors: ManifestValidationError[]): void {
  if (!commands) return
  if (!Array.isArray(commands)) {
    errors.push({ field: "commands", message: "commands must be an array" })
    return
  }
  commands.forEach((cmd, i) => validateCommand(cmd, i, errors))
}

function validateAgent(agent: unknown, index: number, errors: ManifestValidationError[]): void {
  if (!isRecord(agent)) {
    errors.push({ field: `agents[${index}]`, message: "Agent must be an object" })
    return
  }
  const name = agent.name
  if (typeof name !== "string" || !name.trim()) {
    errors.push({ field: `agents[${index}].name`, message: "Agent name is required" })
  }
}

function validateAgents(agents: unknown, errors: ManifestValidationError[]): void {
  if (!agents) return
  if (!Array.isArray(agents)) {
    errors.push({ field: "agents", message: "agents must be an array" })
    return
  }
  agents.forEach((agent, i) => validateAgent(agent, i, errors))
}

function validateDependencies(deps: unknown, field: string, errors: ManifestValidationError[]): void {
  if (!deps) return
  if (!isRecord(deps)) {
    errors.push({ field, message: `${field} must be an object` })
    return
  }
  for (const [key, value] of Object.entries(deps)) {
    if (typeof key !== "string") {
      errors.push({ field, message: `${field} contains non-string key` })
    }
    if (typeof value !== "string") {
      errors.push({ field, message: `${field}.${key} must be a string` })
    }
  }
}

export function validateManifest(manifest: unknown): ManifestValidationResult {
  const errors: ManifestValidationError[] = []
  const warnings: string[] = []

  if (!isRecord(manifest)) {
    return {
      valid: false,
      errors: [{ field: "", message: "Plugin manifest must be an object" }],
      warnings: [],
      manifest: null,
    }
  }

  validateHooks(manifest.hooks, errors, warnings)
  validateCommands(manifest.commands, errors)
  validateAgents(manifest.agents, errors)
  validateDependencies(manifest.dependencies, "dependencies", errors)
  validateDependencies(manifest.devDependencies, "devDependencies", errors)
  validateEngines(manifest.engines, errors)

  if (manifest.name !== undefined) {
    validateName(manifest.name, "name", errors)
  }
  if (manifest.version !== undefined) {
    validateVersion(manifest.version, "version", errors)
  }

  if (manifest.nikcliPlugin !== undefined) {
    if (typeof manifest.nikcliPlugin !== "string" && typeof manifest.nikcliPlugin !== "boolean") {
      errors.push({ field: "nikcliPlugin", message: "nikcliPlugin must be a string or boolean" })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest: manifest as ManifestEntry,
  }
}

export async function validatePluginManifest(spec: string, currentVersion?: string): Promise<ManifestValidationResult> {
  const errors: ManifestValidationError[] = []
  const warnings: string[] = []

  try {
    const pkg = await readPluginPackage(spec)
    const manifest = pkg.json.nikcliPlugin ?? pkg.json["oc-plugin"]
    if (!manifest) {
      return {
        valid: true,
        errors: [],
        warnings: ["No nikcliPlugin field found - plugin will be auto-detected"],
        manifest: null,
      }
    }

    const parsed = parsePluginSpecifier(spec)
    const manifestObj = manifest as ManifestEntry
    const manifestData: ManifestEntry = { ...manifestObj, name: manifestObj.name ?? parsed.pkg }
    const result = validateManifest(manifestData)
    errors.push(...result.errors)
    warnings.push(...result.warnings)

    if (currentVersion && manifestData.engines?.nikcli) {
      if (!semver.satisfies(currentVersion, manifestData.engines.nikcli)) {
        errors.push({
          field: "engines.nikcli",
          message: `Plugin requires nikcli ${manifestData.engines.nikcli}, but running ${currentVersion}`,
        })
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      manifest: result.manifest,
    }
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err)
    return {
      valid: false,
      errors: [{ field: "", message: `Failed to read plugin manifest: ${cause}` }],
      warnings: [],
      manifest: null,
    }
  }
}

export function getManifestEntry(manifest: ManifestEntry): string {
  if (manifest.name) return manifest.name
  if (manifest.description) return manifest.description.slice(0, 50)
  return "Unknown plugin"
}

export function getPluginInfo(manifest: ManifestEntry | null): {
  name: string
  version: string
  description: string
} {
  if (!manifest) {
    return { name: "Unknown", version: "*", description: "" }
  }
  return {
    name: manifest.name ?? "Unknown",
    version: manifest.version ?? "*",
    description: manifest.description ?? "",
  }
}
