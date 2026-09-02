import { Instance } from "../project/instance"
import { bunUtils, type CronJob } from "@/bun"
import { Log } from "@nikcli-ai/util/log"

export namespace Scheduler {
  const log = Log.create({ service: "scheduler" })

  export type Task = {
    id: string
    interval?: number
    cron?: string
    tz?: string
    run: () => Promise<void>
    scope?: "instance" | "global"
    skipInitialRun?: boolean
  }

  type Handle = Timer | CronJob
  type Entry = {
    tasks: Map<string, Task>
    timers: Map<string, Handle>
  }

  const create = (): Entry => {
    const tasks = new Map<string, Task>()
    const timers = new Map<string, Handle>()
    return { tasks, timers }
  }

  const shared = create()

  function isCronJob(handle: Handle): handle is CronJob {
    return typeof handle === "object" && handle !== null && "stop" in handle && typeof handle.stop === "function"
  }

  function clearHandle(handle: Handle) {
    if (isCronJob(handle)) {
      handle.stop()
      return
    }
    clearInterval(handle)
  }

  const state = Instance.state(
    () => create(),
    async (entry) => {
      for (const timer of entry.timers.values()) {
        clearHandle(timer)
      }
      entry.tasks.clear()
      entry.timers.clear()
    },
  )

  export function register(task: Task) {
    const scope = task.scope ?? "instance"
    const entry = scope === "global" ? shared : state()
    const current = entry.timers.get(task.id)
    if (current && scope === "global") return
    if (current) clearHandle(current)

    entry.tasks.set(task.id, task)
    if (task.cron) {
      const job = bunUtils.cron(task.cron, () => run(task), task.tz ? { tz: task.tz } : undefined)
      job.unref()
      entry.timers.set(task.id, job)
      return
    }

    if (!task.interval || task.interval <= 0) {
      log.warn("scheduler task missing interval and cron", { id: task.id })
      return
    }

    if (!task.skipInitialRun) {
      void run(task)
    }
    const timer = setInterval(() => {
      void run(task)
    }, task.interval)
    timer.unref()
    entry.timers.set(task.id, timer)
  }

  export function unregister(id: string, scope: Task["scope"] = "instance") {
    const entry = scope === "global" ? shared : state()
    const timer = entry.timers.get(id)
    if (timer) clearHandle(timer)
    entry.timers.delete(id)
    entry.tasks.delete(id)
  }

  async function run(task: Task) {
    log.info("run", { id: task.id })
    await task.run().catch((error) => {
      log.error("run failed", { id: task.id, error })
    })
  }
}
