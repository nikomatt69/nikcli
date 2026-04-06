import os from "os"
import { Log } from "@/util/log"
import { Tophat } from "./tophat"
import { Expo } from "./expo"
import { ReactNative } from "./react-native"

const log = Log.create({ service: "tophat-doctor" })

export namespace MobileDoctor {
  export interface CheckResult {
    name: string
    ok: boolean
    detail?: string
  }

  export interface DoctorReport {
    checks: CheckResult[]
    tophatAvailable: boolean
    expoAvailable: boolean
    reactNativeAvailable: boolean
    mobileReady: boolean
  }

  async function checkTophatctl(): Promise<CheckResult> {
    const bin = await Tophat.cliPath()
    if (bin) {
      return { name: "tophatctl", ok: true, detail: bin }
    }
    return {
      name: "tophatctl",
      ok: false,
      detail: "Install from https://github.com/Shopify/tophat",
    }
  }

  async function checkMacOS(): Promise<CheckResult> {
    if (os.platform() !== "darwin") {
      return { name: "macOS", ok: false, detail: `Platform is ${os.platform()}, Tophat requires macOS 15+` }
    }
    const release = os.release()
    const major = Number.parseInt(release.split(".")[0], 10)
    if (major >= 24) {
      return { name: "macOS", ok: true, detail: `macOS ${release}` }
    }
    return { name: "macOS", ok: false, detail: `macOS ${release}, requires 15+ (major 24+)` }
  }

  async function checkXcode(): Promise<CheckResult> {
    if (os.platform() !== "darwin") {
      return { name: "Xcode", ok: false, detail: "Not available on this platform" }
    }
    try {
      const proc = Bun.spawn(["xcode-select", "-p"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
      if (exitCode === 0) {
        const devDir = stdout.trim()
        return { name: "Xcode", ok: true, detail: devDir }
      }
      return { name: "Xcode", ok: false, detail: "xcode-select -p failed" }
    } catch {
      return { name: "Xcode", ok: false, detail: "xcode-select not found" }
    }
  }

  async function checkAdb(): Promise<CheckResult> {
    const bin = await Bun.which("adb")
    if (bin) {
      try {
        const proc = Bun.spawn([bin, "version"], {
          stdout: "pipe",
          stderr: "pipe",
        })
        const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
        if (exitCode === 0) {
          return { name: "adb", ok: true, detail: stdout.trim().split("\n")[0] }
        }
        return { name: "adb", ok: true, detail: bin }
      } catch {
        return { name: "adb", ok: true, detail: bin }
      }
    }
    return { name: "adb", ok: false, detail: "Install Android SDK platform-tools" }
  }

  async function checkIOSDevices(): Promise<CheckResult> {
    if (os.platform() !== "darwin") {
      return { name: "iOS devices/simulators", ok: false, detail: "Not available on this platform" }
    }
    try {
      const proc = Bun.spawn(["xcrun", "simctl", "list", "devices", "available", "-j"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
      if (exitCode === 0) {
        const data = JSON.parse(stdout)
        const devices = data?.devices as Array<Array<{ name: string; state: string }>> | undefined
        const count = devices?.flat().filter((d) => d.state === "Booted" || d.state === "Shutdown").length ?? 0
        const booted = devices?.flat().filter((d) => d.state === "Booted").length ?? 0
        return {
          name: "iOS devices/simulators",
          ok: count > 0,
          detail: `${count} available (${booted} booted)`,
        }
      }
      return { name: "iOS devices/simulators", ok: false, detail: "xcrun simctl failed" }
    } catch {
      return { name: "iOS devices/simulators", ok: false, detail: "xcrun not found" }
    }
  }

  async function checkAndroidDevices(): Promise<CheckResult> {
    const adbBin = await Bun.which("adb")
    if (!adbBin) {
      return { name: "Android devices/emulators", ok: false, detail: "adb not found" }
    }
    try {
      const proc = Bun.spawn([adbBin, "devices"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
      if (exitCode === 0) {
        const lines = stdout.trim().split("\n").slice(1)
        const connected = lines.filter((l) => l.includes("\tdevice")).length
        const unauthorized = lines.filter((l) => l.includes("\tunauthorized")).length
        const detail =
          connected > 0
            ? `${connected} connected`
            : unauthorized > 0
              ? `${unauthorized} unauthorized (check device)`
              : "None connected"
        return { name: "Android devices/emulators", ok: connected > 0, detail }
      }
      return { name: "Android devices/emulators", ok: false, detail: "adb devices failed" }
    } catch {
      return { name: "Android devices/emulators", ok: false, detail: "Failed to query adb" }
    }
  }

  async function checkNode(): Promise<CheckResult> {
    try {
      const proc = Bun.spawn(["node", "--version"], { stdout: "pipe", stderr: "pipe" })
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
      if (exitCode === 0) {
        return { name: "Node.js", ok: true, detail: stdout.trim() }
      }
      return { name: "Node.js", ok: false, detail: "node not found" }
    } catch {
      return { name: "Node.js", ok: false, detail: "node not found" }
    }
  }

  async function checkExpo(): Promise<CheckResult> {
    try {
      const available = await Expo.available()
      if (!available) return { name: "Expo CLI", ok: false, detail: "npx not found" }
      const version = await Expo.version()
      if (version === "not available") return { name: "Expo CLI", ok: false, detail: "npx expo not found" }
      return { name: "Expo CLI", ok: true, detail: version }
    } catch {
      return { name: "Expo CLI", ok: false, detail: "Failed to check" }
    }
  }

  async function checkReactNative(): Promise<CheckResult> {
    try {
      const available = await ReactNative.available()
      if (!available) return { name: "React Native CLI", ok: false, detail: "npx not found" }
      const version = await ReactNative.version()
      if (version === "not available") return { name: "React Native CLI", ok: false, detail: "react-native not found" }
      return { name: "React Native CLI", ok: true, detail: version }
    } catch {
      return { name: "React Native CLI", ok: false, detail: "Failed to check" }
    }
  }

  async function checkEAS(): Promise<CheckResult> {
    try {
      const proc = Bun.spawn(["npx", "eas", "--version"], {
        stdout: "pipe",
        stderr: "pipe",
        env: process.env as Record<string, string>,
      })
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
      if (exitCode === 0) {
        return { name: "EAS CLI", ok: true, detail: stdout.trim() }
      }
      return { name: "EAS CLI", ok: false, detail: "npx eas not found" }
    } catch {
      return { name: "EAS CLI", ok: false, detail: "Failed to check" }
    }
  }

  async function checkTophatProviders(): Promise<CheckResult> {
    const isAvailable = await Tophat.available()
    if (!isAvailable) {
      return { name: "Tophat providers", ok: false, detail: "tophatctl not available" }
    }
    try {
      const status = await Tophat.status()
      if (status.providers.length > 0) {
        return { name: "Tophat providers", ok: true, detail: status.providers.map((p) => p.id).join(", ") }
      }
      return { name: "Tophat providers", ok: false, detail: "No providers configured in Tophat" }
    } catch (error) {
      log.warn("failed to check tophat providers", { error })
      return { name: "Tophat providers", ok: false, detail: "Failed to query providers" }
    }
  }

  export async function run(): Promise<DoctorReport> {
    const checks = await Promise.all([
      checkTophatctl(),
      checkMacOS(),
      checkXcode(),
      checkAdb(),
      checkIOSDevices(),
      checkAndroidDevices(),
      checkTophatProviders(),
      checkNode(),
      checkExpo(),
      checkReactNative(),
      checkEAS(),
    ])

    const tophatAvailable = checks[0].ok
    const hasXcode = checks[2].ok
    const hasAdb = checks[3].ok
    const expoAvailable = checks[8].ok
    const reactNativeAvailable = checks[9].ok
    const mobileReady = (tophatAvailable || expoAvailable || reactNativeAvailable) && (hasXcode || hasAdb)

    return { checks, tophatAvailable, expoAvailable, reactNativeAvailable, mobileReady }
  }

  export function formatReport(report: DoctorReport): string {
    const lines: string[] = []
    lines.push("")
    lines.push("Mobile Development Doctor")
    lines.push("=".repeat(40))

    for (const check of report.checks) {
      const icon = check.ok ? "+" : "-"
      const detail = check.detail ? ` (${check.detail})` : ""
      lines.push(`  [${icon}] ${check.name}${detail}`)
    }

    lines.push("")
    if (report.mobileReady) {
      lines.push("Ready: Mobile development environment is configured.")
    } else if (report.expoAvailable || report.reactNativeAvailable || report.tophatAvailable) {
      lines.push("Partial: Some tools are available but mobile tooling (Xcode/ADB) is missing.")
    } else {
      lines.push("Not ready: Install Node.js, Expo, or React Native to get started.")
    }
    lines.push("")

    return lines.join("\n")
  }
}

/** @deprecated Use MobileDoctor instead */
export const TophatDoctor = MobileDoctor
