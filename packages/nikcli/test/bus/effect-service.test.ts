import { describe, expect, it } from "bun:test"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { locallyInstance } from "@/effect"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"

/**
 * Legacy zod-only `define`, on purpose: this suite covers that path.
 *
 * Marked internal so it stays out of `BusEvent.schemas()`. The registry is
 * process-wide, and that union throws listing any **public** event without an
 * Effect Schema — so before visibility existed, this one fixture broke
 * `schemas()` for every other test file sharing the process. A test fixture has
 * no business on the public contract either way.
 */
const TestEvent = BusEvent.define(
  "test.bus.effect",
  z.object({
    value: z.string(),
  }),
  { visibility: "internal" },
)

describe("Bus.Service", () => {
  it("publishes and unsubscribes inside an Effect instance scope", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-bus-effect-project-"))

    try {
      const seen = await Effect.runPromise(
        locallyInstance(
          { directory, worktree: directory, project: { id: "test" } as any },
          Effect.gen(function* () {
            const bus = yield* Bus.Service
            const values: string[] = []
            const unsubscribe = yield* bus.subscribe(TestEvent, (event) => {
              values.push(event.properties.value)
            })

            yield* bus.publish(TestEvent, { value: "first" })
            unsubscribe()
            yield* bus.publish(TestEvent, { value: "second" })

            return values
          }).pipe(Effect.provide(Bus.defaultLayer)),
        ),
      )

      expect(seen).toEqual(["first"])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
