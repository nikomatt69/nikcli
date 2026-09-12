import { randomBytes } from "crypto"
import { Routine } from "@/mobile/routine"

/** Helpers shared by the `routine` commands. */

export function formatDate(ts: number) {
  return new Date(ts).toLocaleString()
}

export function formatTriggers(triggers: Routine.Trigger[]) {
  if (!triggers.length) return "none"
  return triggers
    .map((t) => {
      if (t.type === "schedule") return `schedule(${t.cron})${t.enabled ? "" : " [disabled]"}`
      return `api${t.enabled ? "" : " [disabled]"}`
    })
    .join(", ")
}

export function generateApiToken() {
  return `nkr_${randomBytes(32).toString("hex")}`
}
