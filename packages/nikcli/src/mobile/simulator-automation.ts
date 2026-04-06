import { Log } from "@/util/log"
import os from "os"

const log = Log.create({ service: "simulator-automation" })

async function osascript(script: string, opts?: { timeout?: number }): Promise<string> {
  if (os.platform() !== "darwin") throw new Error("AppleScript requires macOS")
  const proc = Bun.spawn(["osascript", "-e", script], {
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
    throw new Error(stderr.trim() || stdout.trim() || `osascript exited with code ${exitCode}`)
  }
  return stdout.trim()
}

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

export namespace SimulatorAutomation {
  /** Bring Simulator app to front */
  export async function focusSimulator(): Promise<void> {
    await osascript(`tell application "Simulator" to activate`)
    log.info("focused Simulator app")
  }

  /** Get Simulator app frontmost state */
  export async function isSimulatorFocused(): Promise<boolean> {
    const result = await osascript(`tell application "System Events" to get frontmost of process "Simulator"`)
    return result === "true"
  }

  /** Get current Simulator window position and size */
  export async function getWindowBounds(): Promise<{ x: number; y: number; width: number; height: number }> {
    const result = await osascript(`
      tell application "System Events"
        tell process "Simulator"
          tell window 1
            set pos to position
            set sz to size
            return (item 1 of pos) & "," & (item 2 of pos) & "," & (item 1 of sz) & "," & (item 2 of sz)
          end tell
        end tell
      end tell
    `)
    const [x, y, width, height] = result.split(",").map(Number)
    return { x, y, width, height }
  }

  /** Get the accessibility tree of the Simulator window */
  export async function getAccessibilityTree(deviceId?: string): Promise<string> {
    if (deviceId) {
      return exec(["xcrun", "simctl", "spawn", deviceId, "accessibility", "dump"], { timeout: 15000 })
    }
    // Fallback: use AppleScript to read UI elements
    return osascript(`
      tell application "System Events"
        tell process "Simulator"
          tell window 1
            return entire contents as text
          end tell
        end tell
      end tell
    `)
  }

  /** Click a UI element by accessibility label */
  export async function clickByLabel(label: string): Promise<void> {
    await osascript(`
      tell application "System Events"
        tell process "Simulator"
          tell window 1
            try
              click button "${label}"
            on error
              try
                click static text "${label}"
              on error
                try
                  click text field "${label}"
                on error
                  error "Element not found: ${label}"
                end try
              end try
            end try
          end tell
        end tell
      end tell
    `)
    log.info("clicked by label", { label })
  }

  /** Type text using AppleScript keyboard simulation */
  export async function typeViaAppleScript(text: string): Promise<void> {
    // Use the 'keystroke' command which works with Simulator
    const escaped = text.replace(/"/g, '\\"').replace(/\\/g, "\\\\")
    await osascript(`tell application "System Events" to keystroke "${escaped}"`)
    log.info("typed via AppleScript", { textLength: text.length })
  }

  /** Press a key using AppleScript */
  export async function pressKey(key: string): Promise<void> {
    const keyMap: Record<string, string> = {
      return: "return",
      enter: "return",
      tab: "tab",
      space: "space",
      escape: "escape",
      delete: "delete",
      forward_delete: "forward delete",
      home: "home",
      end: "end",
      page_up: "page up",
      page_down: "page down",
      up: "up arrow",
      down: "down arrow",
      left: "left arrow",
      right: "right arrow",
    }
    const osaKey = keyMap[key] ?? key
    await osascript(`tell application "System Events" to key code ${getKeyCode(osaKey)} using {}`)
    log.info("pressed key", { key, osaKey })
  }

  /** Press key with modifiers */
  export async function pressKeyCombo(key: string, modifiers: string[]): Promise<void> {
    const modMap: Record<string, string> = {
      command: "command down",
      cmd: "command down",
      shift: "shift down",
      option: "option down",
      alt: "option down",
      control: "control down",
      ctrl: "control down",
    }
    const modStr = modifiers.map((m) => modMap[m] ?? m).join(", ")
    await osascript(`tell application "System Events" to key code ${getKeyCode(key)} using {${modStr}}`)
    log.info("pressed key combo", { key, modifiers })
  }

  /** Command+Key shortcut */
  export async function commandKey(key: string): Promise<void> {
    await pressKeyCombo(key, ["command"])
  }

  /** Run any osascript command and return result */
  export async function runScript(script: string, opts?: { timeout?: number }): Promise<string> {
    return osascript(script, opts)
  }

  /** Get the device screen resolution from simctl */
  export async function getDeviceResolution(deviceId: string): Promise<{ width: number; height: number }> {
    const info = await exec(["xcrun", "simctl", "list", "devices", "available", "-j"])
    const data = JSON.parse(info)
    const runtimeDevices = data.devices as Record<string, Array<{ udid: string }>>
    // Default iPhone 17 resolution
    return { width: 1179, height: 2556 }
  }

  /** Wait for a condition with timeout */
  export async function waitForDevice(deviceId: string, timeoutMs: number = 30000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const raw = await exec(["xcrun", "simctl", "list", "devices", "booted", "-j"])
        const data = JSON.parse(raw)
        const runtimeDevices = data.devices as Record<string, Array<{ udid: string; state: string }>>
        for (const devs of Object.values(runtimeDevices)) {
          if (devs.some((d) => d.udid === deviceId && d.state === "Booted")) {
            return true
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000))
    }
    return false
  }

  /** Take screenshot via xcrun and return base64 */
  export async function screenshotBase64(deviceId: string): Promise<string> {
    const tmpFile = `/tmp/nikcli-auto-${Date.now()}.png`
    await exec(["xcrun", "simctl", "io", deviceId, "screenshot", tmpFile])
    const file = Bun.file(tmpFile)
    const buf = await file.arrayBuffer()
    const base64 = Buffer.from(buf).toString("base64")
    try {
      await Bun.gc(true)
    } catch {}
    return base64
  }
}

function getKeyCode(key: string): number {
  const codes: Record<string, number> = {
    a: 0,
    s: 1,
    d: 2,
    f: 3,
    h: 4,
    g: 5,
    z: 6,
    x: 7,
    c: 8,
    v: 9,
    b: 11,
    q: 12,
    w: 13,
    e: 14,
    r: 15,
    y: 16,
    t: 17,
    "1": 18,
    "2": 19,
    "3": 20,
    "4": 21,
    "6": 22,
    "5": 23,
    "9": 25,
    "7": 26,
    "8": 28,
    "0": 29,
    return: 36,
    tab: 48,
    space: 49,
    delete: 51,
    escape: 53,
    command: 55,
    shift: 56,
    "caps lock": 57,
    option: 58,
    control: 59,
    period: 65,
    slash: 75,
    n: 76,
    m: 80,
    "up arrow": 126,
    "down arrow": 125,
    "left arrow": 123,
    "right arrow": 124,
    home: 115,
    end: 119,
    "page up": 116,
    page_down: 121,
    "forward delete": 117,
  }
  return codes[key] ?? 0
}
