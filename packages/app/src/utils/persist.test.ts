import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"

let persisted: typeof import("./persist").persisted
let Persist: typeof import("./persist").Persist

beforeAll(async () => {
  mock.module("@/context/platform", () => ({
    usePlatform: () => ({ platform: "web" }),
  }))
  const module = await import("./persist")
  persisted = module.persisted
  Persist = module.Persist
})

beforeEach(() => {
  localStorage.clear()
})

describe("persisted readiness", () => {
  test("sync storage is ready without a persisted value", () => {
    createRoot((dispose) => {
      const [, , init, ready] = persisted(Persist.global("server"), createStore({ list: [] as string[] }))

      expect(init).toBeNull()
      expect(ready()).toBe(true)

      dispose()
    })
  })
})
