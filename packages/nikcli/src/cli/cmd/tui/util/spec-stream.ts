/**
 * Streaming spec compiler — the real-time engine behind generative TUIs.
 *
 * This is nikcli's analogue to json-render's `createSpecStreamCompiler`: it
 * takes the *partial* JSON text of an `opentui` tool call as it streams from the
 * model and projects it into a best-effort {@link PartialVizSpec} that the
 * existing `DialogOpenTUIViz` renderer can mount incrementally.
 *
 * Two ideas make it safe to render half-finished model output:
 *
 *  1. **Tolerant repair.** `parsePartialJson` closes dangling strings, brackets,
 *     trailing commas and half-written keys so a truncated stream still yields a
 *     structurally valid object.
 *
 *  2. **Catalog validation.** Each candidate component is validated against the
 *     same catalog the model is constrained to (`decodeVizComponent`). A
 *     component only enters the snapshot once it is complete enough to render,
 *     so the trailing in-flight component simply waits — never crashes the UI.
 *
 * The compiler is framework-agnostic: it returns plain snapshots. The Solid
 * layer wraps the latest snapshot in a store so SolidJS reactivity re-renders
 * only what changed.
 */
import { decodeVizComponent, type VizComponent } from "@/tool/opentui"

export type PartialVizSpec = {
  title: string
  subtitle?: string
  /** Components that have streamed in far enough to render safely. */
  components: VizComponent[]
  /** True while the underlying JSON is still incomplete (a component is in-flight). */
  streaming: boolean
}

export type SpecSnapshot = PartialVizSpec & {
  /** Monotonic version; bumps only when the rendered projection actually changes. */
  version: number
}

/**
 * A minimal RFC-6902-flavored patch describing how the render-safe projection
 * changed between two snapshots. This mirrors json-render's SpecStream patch
 * stream (`SpecStreamLine`): a renderer can mount just the `add`ed component
 * rows instead of re-diffing the whole list on every delta.
 */
export type VizPatch =
  | { op: "replace"; path: "/title" | "/subtitle" | "/streaming"; value: unknown }
  | { op: "add"; path: `/components/${number}`; value: VizComponent }
  | { op: "replace"; path: `/components/${number}`; value: VizComponent }
  | { op: "remove"; path: `/components/${number}` }

const EMPTY: SpecSnapshot = { title: "", components: [], streaming: true, version: 0 }

// ──────────────────────────────────────────────────────────────────────────
// Tolerant partial-JSON parser
// ──────────────────────────────────────────────────────────────────────────

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Slice off a complete trailing `"..."` token (respecting escapes). Returns null when none. */
function splitTrailingString(text: string): { token: string; before: string } | null {
  if (!text.endsWith('"')) return null
  let i = text.length - 2
  while (i >= 0) {
    if (text[i] === '"') {
      // count preceding backslashes to know if this quote is escaped
      let bs = 0
      let j = i - 1
      while (j >= 0 && text[j] === "\\") {
        bs++
        j--
      }
      if (bs % 2 === 0) return { token: text.slice(i), before: text.slice(0, i) }
    }
    i--
  }
  return null
}

/** Drop a structurally un-completable tail: trailing commas, dangling keys, half keys. */
function trimDanglingTail(input: string): string {
  let s = input.replace(/\s+$/, "")
  // Loop because removing one fragment can expose another (e.g. `,"key":`).
  for (let guard = 0; guard < 64; guard++) {
    if (s.endsWith(",")) {
      s = s.slice(0, -1).replace(/\s+$/, "")
      continue
    }
    if (s.endsWith(":")) {
      // `"key":` with no value — remove the colon, then the key token.
      s = s.slice(0, -1).replace(/\s+$/, "")
      const split = splitTrailingString(s)
      if (split) s = split.before.replace(/\s+$/, "")
      continue
    }
    const split = splitTrailingString(s)
    if (split) {
      const prev = split.before.replace(/\s+$/, "").slice(-1)
      // A string directly after `{` or `,` is a key still awaiting its colon.
      if (prev === "{" || prev === "," || prev === "[") {
        s = split.before.replace(/\s+$/, "")
        continue
      }
    }
    break
  }
  return s
}

/**
 * Parse possibly-truncated JSON. Returns the closest structurally valid value,
 * or undefined when nothing usable can be recovered yet.
 */
export function parsePartialJson(raw: string): unknown | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined

  const direct = tryParse(trimmed)
  if (direct !== undefined) return direct

  // Scan once to learn open brackets and whether we ended mid-string.
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") stack.push("}")
    else if (ch === "[") stack.push("]")
    else if (ch === "}" || ch === "]") stack.pop()
  }

  let body = trimmed
  if (escaped) body = body.slice(0, -1) // dangling escape char
  if (inString) body += '"' // close the open string

  body = trimDanglingTail(body)

  for (let i = stack.length - 1; i >= 0; i--) body += stack[i]

  return tryParse(body)
}

// ──────────────────────────────────────────────────────────────────────────
// Projection: partial JSON → render-safe spec
// ──────────────────────────────────────────────────────────────────────────

export function projectComponents(value: unknown): VizComponent[] {
  if (!value || typeof value !== "object") return []
  const raw = (value as { components?: unknown }).components
  if (!Array.isArray(raw)) return []
  const out: VizComponent[] = []
  for (const candidate of raw) {
    const decoded = decodeVizComponent(candidate)
    if (decoded) out.push(decoded)
  }
  return out
}

export function compilePartialSpec(raw: string): PartialVizSpec {
  const value = parsePartialJson(raw)
  const obj = (value && typeof value === "object" ? value : {}) as Record<string, unknown>
  const components = projectComponents(value)
  // Streaming until the raw text parses as a whole and isn't obviously truncated.
  const settled = tryParse(raw.trim()) !== undefined
  return {
    title: typeof obj.title === "string" ? obj.title : "",
    subtitle: typeof obj.subtitle === "string" ? obj.subtitle : undefined,
    components,
    streaming: !settled,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Stateful compiler with change detection
// ──────────────────────────────────────────────────────────────────────────

/** Cheap structural fingerprint to suppress no-op snapshots between deltas. */
function fingerprint(spec: PartialVizSpec): string {
  return JSON.stringify([spec.title, spec.subtitle ?? "", spec.streaming, spec.components])
}

export type SpecStreamCompiler = {
  /** Feed the full accumulated raw input text; returns the current snapshot. */
  push(rawAccumulated: string): SpecSnapshot
  /**
   * Feed an already-parsed partial object (e.g. AI SDK `partialObjectStream`).
   * Skips the JSON-repair step; still validates each component against the catalog.
   */
  pushObject(partial: unknown, streaming?: boolean): SpecSnapshot
  /** Mark the stream complete with the final validated input (skips repair). */
  finalize(finalInput: unknown): SpecSnapshot
  /** The current snapshot (json-render: `getResult()`). Alias of `snapshot()`. */
  getResult(): SpecSnapshot
  /** Every patch accumulated so far (json-render: `getPatches()`). */
  getPatches(): ReadonlyArray<VizPatch>
  /** Drop all state — reuse the compiler for a fresh stream (json-render: `reset()`). */
  reset(): void
  snapshot(): SpecSnapshot
}

const sameComponent = (a: VizComponent, b: VizComponent): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Diff two render-safe projections into RFC-6902-flavored patches. */
function diffSpec(prev: PartialVizSpec, next: PartialVizSpec): VizPatch[] {
  const patches: VizPatch[] = []
  if (prev.title !== next.title) patches.push({ op: "replace", path: "/title", value: next.title })
  if ((prev.subtitle ?? "") !== (next.subtitle ?? ""))
    patches.push({ op: "replace", path: "/subtitle", value: next.subtitle ?? "" })
  const shared = Math.min(prev.components.length, next.components.length)
  for (let i = 0; i < shared; i++) {
    if (!sameComponent(prev.components[i]!, next.components[i]!))
      patches.push({ op: "replace", path: `/components/${i}`, value: next.components[i]! })
  }
  for (let i = prev.components.length; i < next.components.length; i++)
    patches.push({ op: "add", path: `/components/${i}`, value: next.components[i]! })
  for (let i = next.components.length; i < prev.components.length; i++)
    patches.push({ op: "remove", path: `/components/${i}` })
  if (prev.streaming !== next.streaming) patches.push({ op: "replace", path: "/streaming", value: next.streaming })
  return patches
}

/**
 * Create a stateful compiler that only bumps its `version` when the projected,
 * render-safe spec actually changes — so a flood of `tool-input-delta` chunks
 * that don't yet complete a new component won't thrash the renderer. It also
 * records a json-render-style patch stream (`getPatches()`) so consumers can
 * react to incremental component adds without re-diffing the whole list.
 */
export function createSpecStreamCompiler(): SpecStreamCompiler {
  let current: SpecSnapshot = EMPTY
  let lastPrint = ""
  const patches: VizPatch[] = []

  const commit = (spec: PartialVizSpec): SpecSnapshot => {
    const print = fingerprint(spec)
    if (print === lastPrint) return current
    lastPrint = print
    patches.push(...diffSpec(current, spec))
    current = { ...spec, version: current.version + 1 }
    return current
  }

  return {
    push(rawAccumulated) {
      return commit(compilePartialSpec(rawAccumulated))
    },
    pushObject(partial, streaming = true) {
      const obj = (partial && typeof partial === "object" ? partial : {}) as Record<string, unknown>
      return commit({
        title: typeof obj.title === "string" ? obj.title : current.title,
        subtitle: typeof obj.subtitle === "string" ? obj.subtitle : current.subtitle,
        components: projectComponents(partial),
        streaming,
      })
    },
    finalize(finalInput) {
      const obj = (finalInput && typeof finalInput === "object" ? finalInput : {}) as Record<string, unknown>
      return commit({
        title: typeof obj.title === "string" ? obj.title : current.title,
        subtitle: typeof obj.subtitle === "string" ? obj.subtitle : current.subtitle,
        components: projectComponents(finalInput),
        streaming: false,
      })
    },
    getResult() {
      return current
    },
    getPatches() {
      return patches
    },
    reset() {
      current = EMPTY
      lastPrint = ""
      patches.length = 0
    },
    snapshot() {
      return current
    },
  }
}
