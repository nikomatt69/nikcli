import { Instance } from "../project/instance"
import { Log } from "../util/log"

export namespace Scheduler {
  const log = Log.create({ service: "scheduler" })

  export type Task = {
    id: string
    interval: number
    run: () => Promise<void>
    scope?: "instance" | "global"
  }

  type Timer = ReturnType<typeof setInterval>
  type Entry = {
    tasks: Map<string, Task>
    timers: Map<string, Timer>
  }

  const create = (): Entry => {
    const tasks = new Map<string, Task>()
    const timers = new Map<string, Timer>()
    return { tasks, timers }
  }

  const shared = create()

  const state = Instance.state(
    () => create(),
    async (entry) => {
      for (const timer of entry.timers.values()) {
        clearInterval(timer)
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
    if (current) clearInterval(current)
    const directory = scope === "global" ? undefined : Instance.directory
    const execute = async (): Promise<void> => {
      if (!directory) {
        await task.run()
        return
      }
      await Instance.provide({
        directory,
        fn: task.run,
      })
    }

    entry.tasks.set(task.id, task)
    void run(task.id, execute)
    const timer = setInterval(() => {
      void run(task.id, execute)
    }, task.interval)
    timer.unref()
    entry.timers.set(task.id, timer)
  }

  async function run(id: string, execute: () => Promise<void>) {
    log.info("run", { id })
    await execute().catch((error) => {
      log.error("run failed", { id, error })
    })
  }
}
