/**
 * Row model for the session message list.
 *
 * The renderer used to map parts 1:1 onto rows, so a run of ten `read`/`grep`
 * calls cost ten blocks of vertical space and pushed the actual answer off
 * screen. This module folds consecutive *exploration* calls into a single row
 * the view can collapse once the run is over.
 *
 * Deliberately dependency-free: no Solid, no SDK types, no data-layer access.
 * It takes parts and returns rows, which is the whole reason it can be tested
 * without standing up a TUI. Ported from opencode's `routes/session/rows.ts`
 * (commit e6f660f), adapted to nikcli's flat per-message parts array — nikcli
 * groups within one assistant message rather than across a whole session.
 */

/**
 * Minimum shape `groupParts` needs. Real parts carry much more.
 *
 * `tool` is the v1 part's field, `name` the v2 entry's. Both are accepted so
 * this module works unchanged on either source — it is the one piece of the
 * render pipeline that was already shaped to be portable.
 */
export type RowPart = {
  readonly type: string
  readonly callID?: string
  readonly tool?: string
  readonly name?: string
  readonly state?: { readonly status?: string }
}

/** The tool a row refers to, whichever source it came from. */
export function toolOf(part: RowPart): string | undefined {
  return part.tool ?? part.name
}

export type ExplorationGroup<Part> = {
  readonly type: "group"
  readonly kind: "exploration"
  /** Every call in the run, in order — `pending` entries included. */
  readonly parts: Part[]
  /**
   * The subset of `parts` blocked on the user. Kept as a separate view rather
   * than a separate list so collapsing can never reorder or drop a call.
   */
  readonly pending: Part[]
  /** True once a non-exploration part followed, i.e. the run is over. */
  completed: boolean
}

export type SessionRow<Part> = { readonly type: "part"; readonly part: Part } | ExplorationGroup<Part>

/**
 * Read-only tools whose output is scaffolding for the answer rather than the
 * answer. Anything that mutates state (`edit`, `write`, `bash`, …) is excluded
 * on purpose: a user skimming a collapsed run must never miss a side effect.
 */
const EXPLORATION_TOOLS = new Set(["read", "grep", "glob", "list", "codesearch", "webfetch"])

export function isExplorationTool(tool: string | undefined): boolean {
  return tool !== undefined && EXPLORATION_TOOLS.has(tool)
}

export type GroupOptions<Part> = {
  /**
   * True when a call is blocked on the user (a pending permission request).
   * Such calls stay individually visible: a prompt the user has to answer
   * cannot be hidden behind a collapsed summary.
   */
  readonly isPending?: (part: Part) => boolean
  /** Minimum consecutive calls before folding is worth the indirection. */
  readonly minimum?: number
  /**
   * True when no further parts are coming (the message finished). Without it a
   * run that ends a message would stay "live", and so never collapse.
   */
  readonly closed?: boolean
}

/**
 * Folds a message's parts into rows.
 *
 * Only *consecutive* exploration tool calls group together; any other part ends
 * the run and marks the group complete. A group shorter than `minimum` is
 * unfolded back into plain part rows, so a lone `read` still renders as itself.
 */
export function groupParts<Part extends RowPart>(
  parts: readonly Part[],
  options: GroupOptions<Part> = {},
): SessionRow<Part>[] {
  const isPending = options.isPending ?? (() => false)
  const minimum = Math.max(2, options.minimum ?? 2)
  const rows: SessionRow<Part>[] = []

  const closeRun = () => {
    const previous = rows.at(-1)
    if (previous?.type === "group") previous.completed = true
  }

  for (const part of parts) {
    if (part.type !== "tool" || !isExplorationTool(toolOf(part))) {
      closeRun()
      rows.push({ type: "part", part })
      continue
    }

    const last = rows.at(-1)
    let group: ExplorationGroup<Part>
    if (last?.type === "group" && !last.completed) {
      group = last
    } else {
      closeRun()
      group = { type: "group", kind: "exploration", parts: [], pending: [], completed: false }
      rows.push(group)
    }
    group.parts.push(part)
    if (isPending(part)) group.pending.push(part)
  }

  if (options.closed) closeRun()

  return rows.flatMap((row) => (row.type === "group" && row.parts.length < minimum ? unfold(row) : [row]))
}

/** Expands a group back into individual part rows, preserving order. */
function unfold<Part>(row: ExplorationGroup<Part>): SessionRow<Part>[] {
  return row.parts.map((part) => ({ type: "part", part }) as const)
}

/**
 * One-line label for a collapsed group, e.g. `Explored 7 locations`.
 *
 * Counts calls rather than distinct paths: the row summarizes work done, and
 * de-duplicating would need input parsing this module deliberately avoids.
 */
export function groupLabel<Part>(row: ExplorationGroup<Part>): string {
  const count = row.parts.length
  return `Explored ${count} ${count === 1 ? "location" : "locations"}`
}
