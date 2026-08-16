import { createSignal } from "solid-js"
import { useSDK } from "./sdk"
import { createSimpleContext } from "./helper"

export type TelemetryRecord = {
  id: string
  traceId: string
  parentId?: string
  name: string
  kind: string
  startTime: number
  durationMs: number
  statusCode?: number
  statusMessage?: string
  attributes?: Record<string, string>
}

const MAX_RECORDS = 2000

// Records telemetry spans in the background from app start, so the live panel
// shows the whole conversation's spans the moment it is opened (not only the
// ones emitted while it is on screen).
export const { use: useTelemetry, provider: TelemetryProvider } = createSimpleContext({
  name: "Telemetry",
  init: () => {
    const sdk = useSDK()
    const [records, setRecords] = createSignal<TelemetryRecord[]>([])

    sdk.event.on("telemetry.record", (event) => {
      setRecords((prev) => {
        const next = prev.concat(event.properties)
        return next.length > MAX_RECORDS ? next.slice(next.length - MAX_RECORDS) : next
      })
    })

    return {
      records,
      clear: () => setRecords([]),
    }
  },
})
