import z from "zod"
import { Log } from "@/util/log"
import os from "os"

const log = Log.create({ service: "simulator" })

export namespace Simulator {
  export const DeviceInfo = z.object({
    id: z.string(),
    name: z.string(),
    platform: z.enum(["ios", "android"]),
    state: z.enum(["booted", "booting", "shutdown", "unavailable", "unknown"]),
    runtime: z.string().optional(),
    type: z.string().optional(),
  })
  export type DeviceInfo = z.infer<typeof DeviceInfo>

  async function exec(args: string[], opts?: { timeout?: number }): Promise<string> {
    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env as Record<string, string>,
    })

    const timeout = opts?.timeout ?? 30000
    const timer = setTimeout(() => proc.kill(), timeout)
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    clearTimeout(timer)

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || `${args[0]} exited with code ${exitCode}`)
    }

    return stdout.trim()
  }

  export async function listIOS(): Promise<DeviceInfo[]> {
    if (os.platform() !== "darwin") return []

    try {
      const raw = await exec(["xcrun", "simctl", "list", "devices", "available", "-j"])
      const data = JSON.parse(raw)
      const devices: DeviceInfo[] = []
      const runtimeDevices = data.devices as
        | Record<string, Array<{ udid: string; name: string; state: string }>>
        | undefined

      if (runtimeDevices) {
        for (const [runtime, devs] of Object.entries(runtimeDevices)) {
          for (const d of devs) {
            const stateMap: Record<string, DeviceInfo["state"]> = {
              Booted: "booted",
              Booting: "booting",
              Shutdown: "shutdown",
              Unavailable: "unavailable",
            }
            devices.push({
              id: d.udid,
              name: d.name,
              platform: "ios",
              state: stateMap[d.state] ?? "unknown",
              runtime: runtime,
            })
          }
        }
      }

      return devices
    } catch (error) {
      log.warn("failed to list iOS simulators", { error })
      return []
    }
  }

  export async function listAndroid(): Promise<DeviceInfo[]> {
    const devices: DeviceInfo[] = []

    try {
      const avdproc = Bun.spawn(["emulator", "-list-avds"], {
        stdout: "pipe",
        stderr: "pipe",
        env: process.env as Record<string, string>,
      })
      const [avdCode, avdOut] = await Promise.all([avdproc.exited, new Response(avdproc.stdout).text()])
      if (avdCode === 0 && avdOut.trim()) {
        const avds = avdOut.trim().split("\n")
        for (const avd of avds) {
          devices.push({
            id: avd.trim(),
            name: avd.trim(),
            platform: "android",
            state: "shutdown",
          })
        }
      }
    } catch {}

    try {
      const adbBin = await Bun.which("adb")
      if (!adbBin) return devices

      const result = await exec([adbBin, "devices"])
      const lines = result.split("\n").slice(1)
      for (const line of lines) {
        const match = line.match(/^(\S+)\t(device|emulator|unauthorized|offline)/)
        if (!match) continue

        const id = match[1]
        const adbState = match[2]
        const existing = devices.find((d) => d.id === id)

        if (existing) {
          existing.state = adbState === "device" ? "booted" : "shutdown"
        } else {
          devices.push({
            id,
            name: id.startsWith("emulator-") ? `Emulator ${id}` : id,
            platform: "android",
            state: adbState === "device" ? "booted" : "shutdown",
          })
        }
      }
    } catch (error) {
      log.warn("failed to list Android devices", { error })
    }

    return devices
  }

  export async function list(platform: "ios" | "android"): Promise<DeviceInfo[]> {
    return platform === "ios" ? listIOS() : listAndroid()
  }

  export async function listAll(): Promise<DeviceInfo[]> {
    const [ios, android] = await Promise.all([listIOS(), listAndroid()])
    return [...ios, ...android]
  }

  export async function bootIOS(deviceId: string): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "boot", deviceId], { timeout: 60000 })
    log.info("booted iOS simulator", { deviceId })
  }

  export async function bootAndroid(avdName: string): Promise<void> {
    const proc = Bun.spawn(["emulator", "-avd", avdName, "-no-snapshot-load", "-no-audio", "-no-window"], {
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
      env: process.env as Record<string, string>,
    })
    proc.unref()
    log.info("launched Android emulator", { avdName, pid: proc.pid })

    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  export async function boot(deviceId: string, platform: "ios" | "android"): Promise<void> {
    if (platform === "ios") {
      await bootIOS(deviceId)
    } else {
      await bootAndroid(deviceId)
    }
  }

  export async function shutdownIOS(deviceId: string): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "shutdown", deviceId])
    log.info("shut down iOS simulator", { deviceId })
  }

  export async function shutdownAndroid(deviceId: string): Promise<void> {
    const adbBin = await Bun.which("adb")
    if (!adbBin) throw new Error("adb not found")
    await exec([adbBin, "-s", deviceId, "emu", "kill"])
    log.info("shut down Android emulator", { deviceId })
  }

  export async function shutdown(deviceId: string, platform: "ios" | "android"): Promise<void> {
    if (platform === "ios") {
      await shutdownIOS(deviceId)
    } else {
      await shutdownAndroid(deviceId)
    }
  }

  export async function installIOS(deviceId: string, path: string): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "install", deviceId, path], { timeout: 60000 })
    log.info("installed app on iOS simulator", { deviceId, path })
  }

  export async function installAndroid(deviceId: string, path: string): Promise<void> {
    const adbBin = await Bun.which("adb")
    if (!adbBin) throw new Error("adb not found")
    await exec([adbBin, "-s", deviceId, "install", "-r", path], { timeout: 60000 })
    log.info("installed app on Android emulator", { deviceId, path })
  }

  export async function install(deviceId: string, path: string, platform: "ios" | "android"): Promise<void> {
    if (platform === "ios") {
      await installIOS(deviceId, path)
    } else {
      await installAndroid(deviceId, path)
    }
  }

  export async function screenshotIOS(deviceId: string, outputPath: string): Promise<string> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "io", deviceId, "screenshot", outputPath])
    return outputPath
  }

  export async function screenshotAndroid(deviceId: string, outputPath: string): Promise<string> {
    const adbBin = await Bun.which("adb")
    if (!adbBin) throw new Error("adb not found")
    await exec([adbBin, "-s", deviceId, "shell", "screencap", "-p", "/sdcard/screenshot.png"])
    await exec([adbBin, "-s", deviceId, "pull", "/sdcard/screenshot.png", outputPath])
    await exec([adbBin, "-s", deviceId, "shell", "rm", "/sdcard/screenshot.png"])
    return outputPath
  }

  export async function screenshot(deviceId: string, outputPath: string, platform: "ios" | "android"): Promise<string> {
    return platform === "ios" ? screenshotIOS(deviceId, outputPath) : screenshotAndroid(deviceId, outputPath)
  }

  export async function logsIOS(deviceId: string, opts?: { lines?: number }): Promise<string> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    const lines = opts?.lines ?? 100
    const proc = Bun.spawn(
      [
        "xcrun",
        "simctl",
        "spawn",
        deviceId,
        "log",
        "stream",
        "--process",
        " SpringBoard",
        "--style",
        "compact",
        "--last",
        `${lines}`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10000,
      },
    )
    const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
    if (exitCode === 0) return stdout.trim()
    return ""
  }

  export async function logsAndroid(deviceId: string, opts?: { lines?: number; filter?: string }): Promise<string> {
    const adbBin = await Bun.which("adb")
    if (!adbBin) throw new Error("adb not found")
    const lines = opts?.lines ?? 100
    const args = [adbBin, "-s", deviceId, "logcat", "-d", "-t", String(lines)]
    if (opts?.filter) args.push(opts.filter)
    return exec(args)
  }

  export async function logs(
    deviceId: string,
    platform: "ios" | "android",
    opts?: { lines?: number; filter?: string },
  ): Promise<string> {
    return platform === "ios" ? logsIOS(deviceId, opts) : logsAndroid(deviceId, opts)
  }

  export async function wipeIOS(deviceId: string): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "erase", deviceId], { timeout: 60000 })
    log.info("wiped iOS simulator", { deviceId })
  }

  export async function wipeAndroid(deviceId: string): Promise<void> {
    const adbBin = await Bun.which("adb")
    if (!adbBin) throw new Error("adb not found")
    await exec([adbBin, "-s", deviceId, "shell", "wipe", "data"], { timeout: 60000 })
    log.info("wiped Android emulator", { deviceId })
  }

  export async function wipe(deviceId: string, platform: "ios" | "android"): Promise<void> {
    if (platform === "ios") {
      await wipeIOS(deviceId)
    } else {
      await wipeAndroid(deviceId)
    }
  }

  export async function openIOS(): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    const proc = Bun.spawn(["open", "-a", "Simulator"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
  }

  export async function openAndroid(): Promise<void> {
    const proc = Bun.spawn(["emulator", "-list-avds"], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env as Record<string, string>,
    })
    const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
    if (exitCode === 0 && stdout.trim()) {
      const avds = stdout.trim().split("\n")
      if (avds.length > 0) {
        await bootAndroid(avds[0].trim())
      }
    }
  }

  export async function open(platform: "ios" | "android"): Promise<void> {
    if (platform === "ios") {
      await openIOS()
    } else {
      await openAndroid()
    }
  }
}
