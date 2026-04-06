import { Log } from "@/util/log"
import os from "os"

const log = Log.create({ service: "simulator-interact" })

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

export namespace SimulatorInteract {
  /** Tap on coordinates */
  export async function touch(deviceId: string, x: number, y: number): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "io", deviceId, "touch", `${x}`, `${y}`])
    log.info("touched", { deviceId, x, y })
  }

  /** Swipe from (x1,y1) to (x2,y2) */
  export async function swipe(deviceId: string, x1: number, y1: number, x2: number, y2: number): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "io", deviceId, "swipe", `${x1}`, `${y1}`, `${x2}`, `${y2}`])
    log.info("swiped", { deviceId, x1, y1, x2, y2 })
  }

  /** Tap with hold duration (long press) */
  export async function longPress(deviceId: string, x: number, y: number, durationMs: number = 500): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "io", deviceId, "touch", `${x}`, `${y}`, "--duration", `${durationMs / 1000}`])
    log.info("long press", { deviceId, x, y, durationMs })
  }

  /** Open a URL in the simulator (opens in Safari or the target app) */
  export async function openURL(deviceId: string, url: string): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "openurl", deviceId, url], { timeout: 15000 })
    log.info("opened URL", { deviceId, url })
  }

  /** Launch an app by bundle ID */
  export async function launchApp(
    deviceId: string,
    bundleId: string,
    opts?: { args?: string[]; wait?: boolean },
  ): Promise<string> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    const cmd = ["xcrun", "simctl", "launch"]
    if (opts?.wait) cmd.push("--wait-for-debugger")
    cmd.push(deviceId, bundleId)
    if (opts?.args) cmd.push(...opts.args)
    const result = await exec(cmd, { timeout: 15000 })
    log.info("launched app", { deviceId, bundleId })
    return result
  }

  /** Terminate an app by bundle ID */
  export async function terminateApp(deviceId: string, bundleId: string): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "terminate", deviceId, bundleId])
    log.info("terminated app", { deviceId, bundleId })
  }

  /** Install and launch an app */
  export async function installAndLaunch(deviceId: string, appPath: string, bundleId?: string): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "install", deviceId, appPath], { timeout: 60000 })
    log.info("installed app", { deviceId, appPath })
    if (bundleId) {
      await launchApp(deviceId, bundleId)
    }
  }

  /** Type text by sending keyboard events */
  export async function typeText(deviceId: string, text: string): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "spawn", deviceId, "keyboard", "input", text], { timeout: 10000 })
    log.info("typed text", { deviceId, textLength: text.length })
  }

  /** Send a key event (e.g., "home", "volume_up", "volume_down", "lock", "shake") */
  export async function sendKey(deviceId: string, key: string): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")

    const keyMap: Record<string, string[]> = {
      home: ["xcrun", "simctl", "io", deviceId, "homebutton"],
      lock: ["xcrun", "simctl", "io", deviceId, "hold", "btn_lock"],
      volume_up: ["xcrun", "simctl", "io", deviceId, "press", "btn_volume_up"],
      volume_down: ["xcrun", "simctl", "io", deviceId, "press", "btn_volume_down"],
      siri: ["xcrun", "simctl", "io", deviceId, "press", "btn_siri"],
      apple_pay: ["xcrun", "simctl", "io", deviceId, "press", "btn_apple_pay"],
    }

    const cmd = keyMap[key]
    if (!cmd) throw new Error(`Unknown key: ${key}. Available: ${Object.keys(keyMap).join(", ")}`)

    await exec(cmd)
    log.info("sent key", { deviceId, key })
  }

  /** Override status bar for screenshots */
  export async function statusBar(
    deviceId: string,
    opts?: {
      time?: string
      batteryLevel?: number
      batteryState?: "charging" | "charged" | "discharging"
      wifiBars?: number
      cellularBars?: number
      operatorName?: string
    },
  ): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    const cmd = ["xcrun", "simctl", "status_bar", deviceId, "override"]
    if (opts?.time) cmd.push("--time", opts.time)
    if (opts?.batteryLevel !== undefined) cmd.push("--batteryLevel", String(opts.batteryLevel))
    if (opts?.batteryState) cmd.push("--batteryState", opts.batteryState)
    if (opts?.wifiBars !== undefined) cmd.push("--wifiBars", String(opts.wifiBars))
    if (opts?.cellularBars !== undefined) cmd.push("--cellularBars", String(opts.cellularBars))
    if (opts?.operatorName) cmd.push("--operatorName", opts.operatorName)

    await exec(cmd)
    log.info("status bar overridden", { deviceId, opts })
  }

  /** Clear status bar overrides */
  export async function clearStatusBar(deviceId: string): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "status_bar", deviceId, "clear"])
    log.info("status bar cleared", { deviceId })
  }

  /** Start recording a video */
  export async function recordStart(
    deviceId: string,
    outputPath: string,
    opts?: { codec?: string; display?: string },
  ): Promise<string> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    const cmd = ["xcrun", "simctl", "io", deviceId, "recordVideo"]
    if (opts?.codec) cmd.push("--codec", opts.codec)
    if (opts?.display) cmd.push("--display", opts.display)
    cmd.push(outputPath)

    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env as Record<string, string>,
    })

    log.info("recording started", { deviceId, outputPath, pid: proc.pid })
    return String(proc.pid ?? "unknown")
  }

  /** Get device info (UDID, name, runtime, state) */
  export async function deviceInfo(deviceId: string): Promise<{
    udid: string
    name: string
    runtime: string
    state: string
  } | null> {
    if (os.platform() !== "darwin") return null
    try {
      const raw = await exec(["xcrun", "simctl", "list", "devices", "available", "-j"])
      const data = JSON.parse(raw)
      const runtimeDevices = data.devices as Record<string, Array<{ udid: string; name: string; state: string }>>
      for (const [runtime, devs] of Object.entries(runtimeDevices)) {
        const dev = devs.find((d) => d.udid === deviceId)
        if (dev) return { udid: dev.udid, name: dev.name, runtime, state: dev.state }
      }
      return null
    } catch {
      return null
    }
  }

  /** Pasteboard operations */
  export async function pasteboard(deviceId: string, opts?: { copy?: string }): Promise<string> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    if (opts?.copy) {
      await exec(["xcrun", "simctl", "pbcopy", deviceId], { timeout: 5000 })
      return opts.copy
    }
    return exec(["xcrun", "simctl", "pbpaste", deviceId], { timeout: 5000 })
  }

  /** Spawn a process inside the simulator */
  export async function spawn(deviceId: string, command: string, args?: string[]): Promise<string> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    return exec(["xcrun", "simctl", "spawn", deviceId, command, ...(args ?? [])], { timeout: 15000 })
  }

  /** Push a local notification */
  export async function pushNotification(deviceId: string, payloadPath: string): Promise<void> {
    if (os.platform() !== "darwin") throw new Error("iOS Simulator requires macOS")
    await exec(["xcrun", "simctl", "push", deviceId, "com.apple.mobilesafari", payloadPath])
    log.info("notification pushed", { deviceId, payloadPath })
  }
}
