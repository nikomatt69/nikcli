import { describe, expect, it } from "bun:test"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { locallyInstance } from "@/effect"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"

const TestEvent = BusEvent.define(
  "test.bus.effect",
  z.object({
    value: z.string(),
  }),
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
