import type { Hooks } from "@nikcli-ai/plugin"

export type HookName = Extract<keyof Required<Hooks>, string>

export type HookMatcher = {
  include?: HookMatcherPattern
  exclude?: HookMatcherPattern
}

export type HookMatcherPattern = {
  hook?: string | string[]
  path?: string | string[]
  tool?: string | string[]
  sessionID?: string | string[]
  agent?: string | string[]
  command?: string | string[]
  model?: string | string[]
}

export type HookContext = {
  hook: string
  sessionID?: string
  agent?: string
  tool?: string
  command?: string
  path?: string
  model?: { providerID?: string; modelID?: string }
}

function matchesPattern(value: string | undefined, patterns: string | string[] | undefined): boolean {
  if (!value || !patterns) return true
  const list = Array.isArray(patterns) ? patterns : [patterns]
  return list.some((pattern) => {
    if (pattern.startsWith("!")) {
      const negated = pattern.slice(1)
      return !globMatch(value, negated)
    }
    return globMatch(value, pattern)
  })
}

function globMatch(value: string, pattern: string): boolean {
  if (pattern === "*") return true
  if (pattern === "**") return true
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$")
    return regex.test(value)
  }
  if (pattern.includes("?")) {
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\?/g, ".") + "$")
    return regex.test(value)
  }
  return value === pattern
}

function matchesContext(ctx: HookContext, pattern: HookMatcherPattern): boolean {
  if (!matchesPattern(ctx.hook, pattern.hook)) return false
  if (!matchesPattern(ctx.sessionID, pattern.sessionID)) return false
  if (!matchesPattern(ctx.agent, pattern.agent)) return false
  if (!matchesPattern(ctx.tool, pattern.tool)) return false
  if (!matchesPattern(ctx.command, pattern.command)) return false
  if (!matchesPattern(ctx.path, pattern.path)) return false
  if (pattern.model) {
    const modelStr = ctx.model ? `${ctx.model.providerID}/${ctx.model.modelID}` : undefined
    if (!matchesPattern(modelStr, Array.isArray(pattern.model) ? pattern.model : [pattern.model])) {
      return false
    }
  }
  return true
}

export function shouldRunHook(matcher: HookMatcher | undefined, ctx: HookContext): boolean {
  if (!matcher) return true
  if (matcher.exclude) {
    if (matchesContext(ctx, matcher.exclude)) return false
  }
  if (matcher.include) {
    if (!matchesContext(ctx, matcher.include)) return false
  }
  return true
}

export type HookRegistration<Name extends HookName = HookName> = {
  name: Name
  handler: Required<Hooks>[Name]
  matcher?: HookMatcher
  plugin?: string
  priority?: number
}

export class HookRegistry {
  #hooks: Map<string, HookRegistration[]> = new Map()
  #sorted: boolean = false

  register(registration: HookRegistration): void {
    const list = this.#hooks.get(registration.name) ?? []
    list.push(registration)
    this.#hooks.set(registration.name, list)
    this.#sorted = false
  }

  get(hook: HookName): HookRegistration<HookName>[] {
    if (!this.#sorted) {
      for (const list of this.#hooks.values()) {
        list.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))
      }
      this.#sorted = true
    }
    return (this.#hooks.get(hook) ?? []) as HookRegistration<HookName>[]
  }

  getMatching(hook: HookName, ctx: HookContext): Array<{ registration: HookRegistration; skip: boolean }> {
    const all = this.get(hook)
    return all.map((reg) => ({
      registration: reg,
      skip: !shouldRunHook(reg.matcher, ctx),
    }))
  }

  unregister(plugin: string): void {
    for (const [name, list] of this.#hooks.entries()) {
      const filtered = list.filter((r) => r.plugin !== plugin)
      if (filtered.length === 0) {
        this.#hooks.delete(name)
      } else {
        this.#hooks.set(name, filtered)
      }
    }
    this.#sorted = false
  }

  clear(): void {
    this.#hooks.clear()
    this.#sorted = false
  }

  size(): number {
    let total = 0
    for (const list of this.#hooks.values()) {
      total += list.length
    }
    return total
  }
}

export function createHookMatcher(input: HookMatcherPattern | undefined): HookMatcher | undefined {
  if (!input) return undefined
  if (Object.keys(input).length === 0) return undefined
  return { include: input }
}

export function parseHookPattern(pattern: string): HookMatcherPattern {
  const result: HookMatcherPattern = {}
  const parts = pattern.split(":")
  for (const part of parts) {
    const [key, ...valueParts] = part.split("=")
    const value = valueParts.join("=")
    if (!key || !value) continue
    const values = value.split(",")
    switch (key) {
      case "hook":
      case "h":
        result.hook = values
        break
      case "path":
      case "p":
        result.path = values
        break
      case "tool":
      case "t":
        result.tool = values
        break
      case "session":
      case "s":
        result.sessionID = values
        break
      case "agent":
      case "a":
        result.agent = values
        break
      case "command":
      case "cmd":
        result.command = values
        break
      case "model":
      case "m":
        result.model = values
        break
    }
  }
  return result
}

export function serializeHookMatcher(matcher: HookMatcher | undefined): string | undefined {
  if (!matcher) return undefined
  const parts: string[] = []
  if (matcher.include) {
    for (const [key, value] of Object.entries(matcher.include)) {
      if (value) {
        const k = key === "sessionID" ? "session" : key === "tool" ? "tool" : key
        parts.push(`${k}=${Array.isArray(value) ? value.join(",") : value}`)
      }
    }
  }
  if (matcher.exclude) {
    for (const [key, value] of Object.entries(matcher.exclude)) {
      if (value) {
        const k = key === "sessionID" ? "session" : key === "tool" ? "tool" : key
        parts.push(`!${k}=${Array.isArray(value) ? value.join(",") : value}`)
      }
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined
}
