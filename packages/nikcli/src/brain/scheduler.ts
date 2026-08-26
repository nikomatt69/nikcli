import { Scheduler } from "@/scheduler"
import { InstanceState } from "@/effect"
import { Brain } from "./index"
import { Log } from "@nikcli-ai/util/log"

const log = Log.create({ service: "brain-scheduler" })

export function initBrainScheduler(): void {
  // Captured at registration, not read inside `run`. `Scheduler.run` starts no
  // instance scope of its own — the task only ever found one because
  // AsyncLocalStorage propagates into a timer created inside the scope.
  const instance = InstanceState.ambient()
  Scheduler.register({
    id: "brain",
    interval: 60 * 60 * 1000,
    scope: "instance",
    async run() {
      try {
        const shouldTrigger = await Brain.shouldTrigger(instance)
        if (shouldTrigger) {
          log.info("brain conditions met, triggering")
          const result = await Brain.trigger(instance)
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
