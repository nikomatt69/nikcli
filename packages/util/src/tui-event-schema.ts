import { Schema } from "effect"
import z from "zod"
import { zod, zodOverride } from "./effect-zod"

/**
 * The wire contract for events aimed at the terminal.
 *
 * One definition, two projections: the server wraps these structs with `BusEvent.schema` to
 * publish them, and the terminal takes the names to subscribe over SSE and the zod projection to
 * parse a payload before sending it. Keeping the payloads here is what stops those two from
 * drifting — the alternative was the TUI importing a bus module to learn a string.
 */
export const TuiEventName = {
  promptAppend: "tui.prompt.append",
  commandExecute: "tui.command.execute",
  toastShow: "tui.toast.show",
  sessionSelect: "tui.session.select",
} as const

export const TuiEventPayload = {
  promptAppend: Schema.Struct({ text: Schema.String }),
  commandExecute: Schema.Struct({
    command: Schema.Union([
      Schema.Literals([
        "session.list",
        "session.new",
        "session.share",
        "session.interrupt",
        "session.compact",
        "session.page.up",
        "session.page.down",
        "session.line.up",
        "session.line.down",
        "session.half.page.up",
        "session.half.page.down",
        "session.first",
        "session.last",
        "prompt.clear",
        "prompt.submit",
        "agent.cycle",
      ]),
      Schema.String,
    ]),
  }),
  toastShow: Schema.Struct({
    title: Schema.optionalKey(Schema.String),
    message: Schema.String,
    variant: Schema.Literals(["info", "success", "warning", "error"]),
    // zodOverride keeps the legacy `.default(5000)` parse semantics and its
    // exact JSON Schema (a `default` on a checked number drops schemaIds).
    duration: Schema.Number.annotate({
      ...zodOverride(() => z.number().int().positive().default(5000).describe("Duration in milliseconds")),
    }),
  }),
  sessionSelect: Schema.Struct({
    // zodOverride is the sole source here: pairing it with an Effect-side
    // isPattern check makes the walker emit the pattern twice (allOf), and
    // a description annotation on a checked string is dropped in the walk.
    sessionID: Schema.String.annotate({
      ...zodOverride(() => z.string().regex(/^ses/).describe("Session ID to navigate to")),
    }),
  }),
}

/**
 * The same payloads as zod, which is what a caller needs to parse one. Built
 * lazily so the server-side definition can use `Schema.optionalKey` for
 * encoding while the terminal still parses with zod — the wire is identical
 * (absent keys vs explicit `undefined` round-tripped through JSON).
 */
export const TuiEventZod = {
  toastShow: zod(TuiEventPayload.toastShow),
}
