import { Scheduler } from "@/scheduler"
import { Dream } from "./index"
import { Log } from "@/util/log"

const log = Log.create({ service: "dream-scheduler" })

export function initDreamScheduler(): void {
  Scheduler.register({
    id: "dream",
    interval: 60 * 60 * 1000,
    scope: "instance",
    async run() {
      try {
        const shouldTrigger = await Dream.shouldTrigger()
        if (shouldTrigger) {
          log.info("dream conditions met, triggering")
          const result = await Dream.trigger()
          if (result.success) {
            log.info("dream completed", {
              sessionsReviewed: result.sessionsReviewed,
              hoursSinceLastDream: result.hoursSinceLastDream,
            })
          } else {
            log.warn("dream failed", { error: result.error })
          }
        }
      } catch (e) {
        log.error("dream scheduler error", { error: String(e) })
      }
    },
  })
}
