import { BusEvent } from "@/bus/bus-event"
import { Schema } from "effect"

export const Event = {
  Connected: BusEvent.schema("server.connected", Schema.Struct({})),
  Disposed: BusEvent.schema("global.disposed", Schema.Struct({})),
}
