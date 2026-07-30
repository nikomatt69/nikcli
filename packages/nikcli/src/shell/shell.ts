import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import path from "path"
import { spawn, type ChildProcess } from "child_process"

const SIGKILL_TIMEOUT_MS = 200

export namespace Shell {
  const POWERSHELL_MARKERS: RegExp[] = [
    /\$\w+\s*=/,
    /\$env:/i,
    /\$(?:\w+|{[^}]+})/,
    /\b(Get|Set|New|Copy|Move|Rename|Remove|Test|Select|Where|ForEach|Sort)-[A-Za-z]+\b/i,
    /\b(ForEach-Object|Where-Object|ForEach|Where)\b/i,
    /\b(ErrorAction|WhatIf|Confirm|Verbose|InformationAction)\b/i,
  ]

  function parseCommand(command: string) {
    return command.replace(/\s+/g, " ").trim()
  }

  function hasPowerShellMarkers(command: string) {
    if (process.platform !== "win32") return false
    const value = parseCommand(command)
    return POWERSHELL_MARKERS.some((marker) => marker.test(value))
  }

  /**
   * Whether {@link select} would route this command to PowerShell.
   *
   * Permission analysis needs to know, because the Bash grammar mis-reads PowerShell syntax and
   * would derive the wrong set of commands to authorize.
   */
  export function isPowerShell(command: string) {
    return hasPowerShellMarkers(command)
  }

  function selectBinary(candidates: string[]) {
    for (const candidate of candidates) {
      const bin = Bun.which(candidate)
      if (bin) return bin
    }
  }

  function powershellBinary() {
    const configured = process.env["NIKCLI_POWERSHELL_PATH"]
    return selectBinary([configured, "pwsh", "powershell"].filter(Boolean) as string[])
  }

  export async function killTree(proc: ChildProcess, opts?: { exited?: () => boolean }): Promise<void> {
    const pid = proc.pid
    if (!pid || opts?.exited?.()) return

    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { windowsHide: true, stdio: "ignore" })
        killer.once("exit", () => resolve())
        killer.once("error", () => resolve())
      })
      return
    }

    try {
      process.kill(-pid, "SIGTERM")
      await Bun.sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        process.kill(-pid, "SIGKILL")
      }
    } catch {
      proc.kill("SIGTERM")
      await Bun.sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        proc.kill("SIGKILL")
      }
    }
  }
  const BLACKLIST = new Set(["fish", "nu"])

  function fallback() {
    if (process.platform === "win32") {
      if (Flag.NIKCLI_GIT_BASH_PATH) return Flag.NIKCLI_GIT_BASH_PATH
      const git = Bun.which("git")
      if (git) {
        const bash = path.join(git, "..", "..", "bin", "bash.exe")
        if (Bun.file(bash).size) return bash
      }
      return process.env.COMSPEC || "cmd.exe"
    }
    if (process.platform === "darwin") return "/bin/zsh"
    const bash = Bun.which("bash")
    if (bash) return bash
    return "/bin/sh"
  }

  export function select(command?: string) {
    if (command && hasPowerShellMarkers(command)) {
      const binary = powershellBinary()
      if (binary) return binary
    }
    return acceptable()
  }

  function isPowerShellBinary(binary: string) {
    const name = path
      .basename(binary)
      .toLowerCase()
      .replace(/\.exe$/, "")
    return name === "pwsh" || name === "powershell"
  }

  /**
   * Explicit argv for shells that need flags Node's `shell:` option cannot supply.
   *
   * PowerShell otherwise prints a startup banner into the captured output and stays interactive,
   * so a command that hits a confirmation prompt would hang until the tool's timeout instead of
   * failing. Returns `undefined` for shells that Node's own handling covers correctly.
   */
  export function directInvocation(binary: string, command: string): { file: string; args: string[] } | undefined {
    if (!isPowerShellBinary(binary)) return undefined
    return { file: binary, args: ["-NoLogo", "-NonInteractive", "-Command", command] }
  }

  /**
   * Human-readable name of the shell commands will actually run under.
   *
   * Reported to the model so it writes commands in the right dialect instead of assuming the
   * platform default. Falls back to the raw path when the basename is not informative.
   */
  export function describe() {
    const binary = acceptable()
    const name = path
      .basename(binary)
      .toLowerCase()
      .replace(/\.exe$/, "")
    if (name === "pwsh" || name === "powershell") return "PowerShell"
    if (name === "cmd") return "cmd.exe"
    return name || binary
  }

  export const preferred = lazy(() => {
    const s = process.env.SHELL
    if (s) return s
    return fallback()
  })

  export const acceptable = lazy(() => {
    const s = process.env.SHELL
    if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s
    return fallback()
  })
}
