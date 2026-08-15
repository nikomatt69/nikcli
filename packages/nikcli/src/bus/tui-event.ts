import { BusEvent } from "@/bus/bus-event"
import { TuiEventName, TuiEventPayload } from "@nikcli-ai/util/tui-event-schema"

/**
 * Bus definitions for the events aimed at the terminal.
 *
 * Names and payloads come from `@nikcli-ai/util/tui-event-schema`, which the terminal reads too:
 * it needs the names to subscribe and the zod projection to parse a toast before publishing it.
 * Only the `BusEvent` wrapping is server-side, so only that lives here.
 */
export const TuiEvent = {
  PromptAppend: BusEvent.schema(TuiEventName.promptAppend, TuiEventPayload.promptAppend),
  CommandExecute: BusEvent.schema(TuiEventName.commandExecute, TuiEventPayload.commandExecute),
  ToastShow: BusEvent.schema(TuiEventName.toastShow, TuiEventPayload.toastShow),
  SessionSelect: BusEvent.schema(TuiEventName.sessionSelect, TuiEventPayload.sessionSelect),
}
