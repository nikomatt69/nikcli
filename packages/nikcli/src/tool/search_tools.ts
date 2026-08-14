import { Schema } from "effect"
import { zod } from "@nikcli-ai/util/effect-zod"
import { Tool } from "./tool"
// Type-only: erased at build time, so it cannot reintroduce the import cycle the
// runtime `await import(...)` calls below exist to avoid.
import type { PermissionNext } from "@/permission/next"
import type { Agent } from "@/agent/agent"
import DESCRIPTION from "./search_tools.txt"

const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description:
      "A tool name or a capability keyword (e.g. 'image', 'memory', 'git', 'browser'). Matched against both tool names and their descriptions.",
  }),
})

/**
 * Never worth returning:
 *
 * - `invalid` is an internal shim the model is explicitly told not to call; it
 *   exists so a malformed tool call has somewhere to land.
 * - `search_tools` is the tool being run. Its own description names the
 *   capabilities it helps you find ("image", "git", "screenshot", …), so
 *   leaving it in would make it a false positive for almost every query.
 */
const HIDDEN = new Set(["invalid", "search_tools"])

/** Enough to choose a tool; not so many that discovery costs more than the toolset. */
const MAX_MATCHES = 20

/** One line per tool. The full description arrives with the tool's own schema if it gets used. */
const SUMMARY_LENGTH = 160

function summarize(description: string | undefined): string {
  const line =
    (description ?? "")
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0) ?? ""
  if (line.length <= SUMMARY_LENGTH) return line
  return line.slice(0, SUMMARY_LENGTH - 1).trimEnd() + "…"
}

type Candidate = { id: string; summary: string; haystack: string }

function occurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return count
    count++
    from = at + needle.length
  }
}

/**
 * How strongly a tool answers the query. Higher sorts first; 0 means "no match".
 *
 * Density, not hit count. A few tools build their description at init time by
 * embedding a catalog — `code_mode` documents the tools its scripts can call,
 * `skill` lists the installed skills — so almost any capability word appears
 * somewhere inside them. Scoring by the share of the description given over to
 * the term keeps `computer` ahead of `code_mode` for "screenshot" without
 * having to special-case either tool by name.
 */
function score(entry: Candidate, query: string): number {
  const id = entry.id.toLowerCase()
  const hits = occurrences(entry.haystack, query)
  if (!id.includes(query) && hits === 0) return 0
  const density = (hits * query.length) / Math.max(entry.haystack.length, 1)
  // Three bands, each of which beats everything below it outright; density only
  // orders tools within a band. Asking for "read" must return `read` before
  // `todoread`, and both before whatever merely mentions reading.
  const band = id === query ? 2 : id.includes(query) ? 1 : 0
  // Density is a fraction of the description, so it can never reach the gap
  // between two bands — a band always wins outright.
  return band * 2 + density
}

export const SearchToolsTool = Tool.define("search_tools", async (initCtx) => {
  const agent = initCtx?.agent

  return {
    description: DESCRIPTION,
    parameters: zod(Parameters),

    async execute({ query }, ctx) {
      const { runPromiseWithLayer, withCurrentInstance } = await import("@/effect")
      const { Effect } = await import("effect")
      const { ToolRegistry } = await import("./registry")

      // The model this session is running against decides part of the toolset
      // (apply_patch vs edit/write, the Exa-backed search tools). Falling back to
      // an empty descriptor keeps the tool answering rather than throwing when it
      // is driven outside the normal session path.
      const model = ctx.extra?.["model"] as { providerID?: string; api?: { id?: string } } | undefined
      const descriptor = {
        providerID: model?.providerID ?? "",
        modelID: model?.api?.id ?? "",
      }

      const resolved = await runPromiseWithLayer(
        ToolRegistry.defaultLayer,
        withCurrentInstance(
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            return yield* registry.tools(descriptor, agent)
          }),
        ),
      )

      // Session-level visibility, evaluated exactly the way `resolveTools` does
      // when it hands the toolset to the model — otherwise this tool would name
      // tools the model has no schema for.
      const ruleset = await sessionRuleset(ctx.sessionID, agent)
      const disabledTools = ruleset.disabledTools

      const candidates: Candidate[] = []
      for (const tool of resolved) {
        if (HIDDEN.has(tool.id)) continue
        if (!ToolRegistry.visible(tool.id, { disabledTools, ruleset: ruleset.rules })) continue
        const summary = summarize(tool.description)
        candidates.push({
          id: tool.id,
          summary,
          // Descriptions are what make a capability keyword like "git" or
          // "screenshot" findable at all: no tool id contains either word.
          haystack: (tool.id + " " + (tool.description ?? "")).toLowerCase(),
        })
      }
      candidates.sort((left, right) => ToolRegistry.compareIds(left.id, right.id))

      const q = query.trim().toLowerCase()
      const matches = candidates
        .map((entry) => ({ entry, score: score(entry, q) }))
        .filter((scored) => scored.score > 0)
        // Ties break on id so the same query always returns the same order.
        .sort((left, right) => right.score - left.score || ToolRegistry.compareIds(left.entry.id, right.entry.id))
        .map((scored) => scored.entry)

      if (matches.length === 0) {
        return {
          title: `search_tools: ${query}`,
          output: [
            `No tool matches "${query}".`,
            "",
            // Names only. A miss is the cheap branch: the model needs to see the
            // shape of the toolset to retry, not 35 summaries it did not ask for.
            `Available tools (${candidates.length}): ${candidates.map((entry) => entry.id).join(", ")}`,
          ].join("\n"),
          metadata: { query, matches: 0, available: candidates.length, truncated: false },
        }
      }

      const shown = matches.slice(0, MAX_MATCHES)
      const overflow = matches.length - shown.length
      return {
        title: `search_tools: ${query}`,
        output: [
          `${matches.length} tool${matches.length === 1 ? "" : "s"} match "${query}" (of ${candidates.length} available in this session):`,
          "",
          ...shown.map((entry) => `- ${entry.id}: ${entry.summary}`),
          ...(overflow > 0 ? ["", `…and ${overflow} more. Narrow the query to see them.`] : []),
        ].join("\n"),
        metadata: { query, matches: matches.length, available: candidates.length, truncated: false },
      }
    },
  }
})

/**
 * The effective ruleset plus the session's disabled-tool map — the same pair
 * `resolveTools` builds. A session that cannot be read (no session at all, or a
 * transient store error) degrades to "nothing disabled" rather than failing the
 * search: an over-broad catalog is a far better outcome here than an error.
 */
async function sessionRuleset(sessionID: string, agent?: Agent.Info) {
  const { runPromiseWithLayer, withCurrentInstance } = await import("@/effect")
  const { Effect } = await import("effect")
  const { PermissionNext } = await import("@/permission/next")
  const { Flag } = await import("@nikcli-ai/util/flag")
  const { Session } = await import("@/session")

  const agentRules: PermissionNext.Ruleset = agent?.permission ?? []

  const info = await runPromiseWithLayer(
    Session.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.get(sessionID)
      }),
    ),
  ).catch(() => undefined)

  const merged = PermissionNext.merge(agentRules, info?.permission ?? [])
  return {
    rules: Flag.autoApprove() ? PermissionNext.autoApprove(merged) : merged,
    disabledTools: info?.disabledTools ?? {},
  }
}
