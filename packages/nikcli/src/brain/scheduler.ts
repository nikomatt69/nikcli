import { Scheduler } from "@/scheduler"
import { Brain } from "./index"
import { Log } from "@nikcli-ai/util/log"

const log = Log.create({ service: "brain-scheduler" })

export function initBrainScheduler(): void {
  Scheduler.register({
    id: "brain",
    interval: 60 * 60 * 1000,
    scope: "instance",
    async run() {
      try {
        const shouldTrigger = await Brain.shouldTrigger()
        if (shouldTrigger) {
          log.info("brain conditions met, triggering")
          const result = await Brain.trigger()
          if (result.success) {
            log.info("brain completed", {
              sessionsReviewed: result.sessionsReviewed,
              hoursSinceLastBrain: result.hoursSinceLastBrain,
            })
          } else {
            log.warn("brain failed", { error: result.error })
          }
        }
      } catch (e) {
        log.error("brain scheduler error", { error: String(e) })
      }
    },
  })
}
