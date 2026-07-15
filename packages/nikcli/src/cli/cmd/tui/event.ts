import { BusEvent } from "@/bus/bus-event"
import { Schema } from "effect"
import { zodOverride } from "@/util/effect-zod"
import z from "zod"

export const TuiEvent = {
  PromptAppend: BusEvent.schema("tui.prompt.append", Schema.Struct({ text: Schema.String })),
  CommandExecute: BusEvent.schema(
    "tui.command.execute",
    Schema.Struct({
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
  ),
  ToastShow: BusEvent.schema(
    "tui.toast.show",
    Schema.Struct({
      title: Schema.optional(Schema.String),
      message: Schema.String,
      variant: Schema.Literals(["info", "success", "warning", "error"]),
      // zodOverride keeps the legacy `.default(5000)` parse semantics and its
      // exact JSON Schema (a `default` on a checked number drops schemaIds).
      duration: Schema.Number.annotate({
        ...zodOverride(() => z.number().int().positive().default(5000).describe("Duration in milliseconds")),
      }),
    }),
  ),
  SessionSelect: BusEvent.schema(
    "tui.session.select",
    Schema.Struct({
      // zodOverride is the sole source here: pairing it with an Effect-side
      // isPattern check makes the walker emit the pattern twice (allOf), and
      // a description annotation on a checked string is dropped in the walk.
      sessionID: Schema.String.annotate({
        ...zodOverride(() => z.string().regex(/^ses/).describe("Session ID to navigate to")),
      }),
    }),
  ),
}
