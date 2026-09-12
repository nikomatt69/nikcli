/// <reference types="@types/bun" />

import { describe, expect, test } from "bun:test"
import {
  activeDevice,
  configForDevice,
  deviceFromConfig,
  deviceLabelFor,
  isSameDevice,
  normalizeDeviceUrl,
  removeDevice,
  renameDevice,
  sortDevices,
  upsertDevice,
  type SavedDevice,
} from "./devices"

function device(url: string, overrides: Partial<SavedDevice> = {}): SavedDevice {
  const base = deviceFromConfig({ url }, 1_000)
  if (!base) throw new Error("expected a device")
  return { ...base, ...overrides }
}

describe("normalizeDeviceUrl", () => {
  test("one host has one spelling", () => {
    expect(normalizeDeviceUrl(" https://s.nikcli.store/ ")).toBe("https://s.nikcli.store")
    expect(isSameDevice("https://s.nikcli.store", "https://s.nikcli.store//")).toBe(true)
    expect(isSameDevice("https://s.nikcli.store", "http://s.nikcli.store")).toBe(false)
  })
})

describe("deviceLabelFor", () => {
  test("names a device by its host", () => {
    expect(deviceLabelFor("https://s.nikcli.store")).toBe("s.nikcli.store")
    expect(deviceLabelFor("http://192.168.1.4:4096")).toBe("192.168.1.4:4096")
  })

  test("falls back to the raw value when it is not a URL", () => {
    expect(deviceLabelFor("not a url")).toBe("not a url")
  })
})

describe("deviceFromConfig", () => {
  test("carries the credentials the connection used", () => {
    expect(deviceFromConfig({ url: "https://host", token: "t", directory: "/app" }, 5)).toMatchObject({
      url: "https://host",
      label: "host",
      token: "t",
      directory: "/app",
      addedAt: 5,
      lastUsedAt: 5,
    })
  })

  test("there is nothing to remember without a URL", () => {
    expect(deviceFromConfig({ url: "   " })).toBeNull()
  })
})

describe("upsertDevice", () => {
  test("adds a host that is new", () => {
    const devices = upsertDevice([], device("https://a"))
    expect(devices).toHaveLength(1)
  })

  test("re-connecting refreshes credentials without duplicating the host", () => {
    const first = upsertDevice([], device("https://a", { token: "old", addedAt: 1, lastUsedAt: 1 }))
    const renamed = renameDevice(first, first[0]!.id, "Laptop")
    const second = upsertDevice(renamed, device("https://a/", { token: "new", addedAt: 9, lastUsedAt: 9 }))

    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ token: "new", lastUsedAt: 9 })
    // The name the user gave it, and when they first added it, are theirs.
    expect(second[0]).toMatchObject({ label: "Laptop", addedAt: 1 })
  })
})

describe("removeDevice", () => {
  test("drops only the one asked for", () => {
    const devices = upsertDevice(upsertDevice([], device("https://a")), device("https://b"))
    expect(removeDevice(devices, devices[0]!.id).map((item) => item.url)).toEqual(["https://b"])
  })
})

describe("sortDevices", () => {
  test("most recently used first", () => {
    const devices = [
      device("https://a", { lastUsedAt: 10 }),
      device("https://b", { lastUsedAt: 30 }),
      device("https://c", { lastUsedAt: undefined, addedAt: 20 }),
    ]
    expect(sortDevices(devices).map((item) => item.url)).toEqual(["https://b", "https://c", "https://a"])
  })
})

describe("configForDevice", () => {
  test("points the config at the device, keeping app-level choices", () => {
    const next = configForDevice(device("https://b", { token: "t2", directory: "/b" }), {
      url: "https://a",
      token: "t1",
      directory: "/a",
      modelID: "claude",
      executionTarget: "container",
    })

    expect(next).toMatchObject({
      url: "https://b",
      token: "t2",
      directory: "/b",
      modelID: "claude",
      executionTarget: "container",
    })
  })
})

describe("activeDevice", () => {
  test("matches the saved device the config points at", () => {
    const devices = [device("https://a"), device("https://b")]
    expect(activeDevice(devices, { url: "https://b/" })?.url).toBe("https://b")
    expect(activeDevice(devices, { url: "https://c" })).toBeUndefined()
    expect(activeDevice(devices, null)).toBeUndefined()
  })
})
