import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"

// Intentionally Zod-pinned: TuiEvent types feed directly into TUI component
// type inference (ToastInput, ToastParsed) and the hono-openapi validator in
// server/routes/tui.ts. The BusEvent.Definition generics need precise Zod
// field types to preserve variant/enum discrimination at the call sites.
// Revisit once the zodObject typed overload preserves field-level inference
// through BusEvent.define (see schema.md — "It is fine to keep a Zod-native
// schema temporarily when... the validator depends on Zod-only transforms or
// behavior not yet covered by zod()").

export const TuiEvent = {
  PromptAppend: BusEvent.define("tui.prompt.append", z.object({ text: z.string() })),
  CommandExecute: BusEvent.define(
    "tui.command.execute",
    z.object({
      command: z.union([
        z.enum([
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
        z.string(),
      ]),
    }),
  ),
  ToastShow: BusEvent.define(
    "tui.toast.show",
    z.object({
      title: z.string().optional(),
      message: z.string(),
      variant: z.enum(["info", "success", "warning", "error"]),
      duration: z.number().int().positive().default(5000).describe("Duration in milliseconds"),
    }),
  ),
  SessionSelect: BusEvent.define(
    "tui.session.select",
    z.object({
      sessionID: z.string().regex(/^ses/).describe("Session ID to navigate to"),
    }),
  ),
}
