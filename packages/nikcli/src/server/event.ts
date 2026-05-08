import { BusEvent } from "@/bus/bus-event"
import { Schema } from "effect"
import { zodObjectMode } from "@/util/effect-zod"

const strip = zodObjectMode("strip")
export const Event = {
  Connected: BusEvent.define("server.connected", Schema.Struct({}).annotations(strip)),
  Disposed: BusEvent.define("global.disposed", Schema.Struct({}).annotations(strip)),
}
