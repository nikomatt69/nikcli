import { EOL } from "os"
import { Schema } from "effect"
import { remoteService } from "./remote"
import { logo as cliLogo } from "./logo"
import { Log } from "@nikcli-ai/util/log"

const log = Log.create({ service: "ui" })

export namespace UI {
  export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("UICancelledError", {}) {}

  export const Style = {
    TEXT_HIGHLIGHT: "\x1b[96m",
    TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
    TEXT_DIM: "\x1b[90m",
    TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
    TEXT_NORMAL: "\x1b[0m",
    TEXT_NORMAL_BOLD: "\x1b[1m",
    TEXT_WARNING: "\x1b[93m",
    TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
    TEXT_DANGER: "\x1b[91m",
    TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
    TEXT_SUCCESS: "\x1b[92m",
    TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
    TEXT_INFO: "\x1b[94m",
    TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
  } as const

  export function println(...message: string[]): void {
    print(...message)
    const eol = EOL
    try {
      Bun.stderr.write(eol)
      forwardToRemote(eol)
    } catch (error) {
      log.error("Failed to write EOL", { error })
    }
  }

  export function print(...message: string[]): void {
    blank = false
    const text = message.join(" ")
    try {
      Bun.stderr.write(text)
      forwardToRemote(text)
    } catch (error) {
      log.error("Failed to write to stderr", { error })
    }
  }

  let blank = false

  export function empty(): void {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  export function logo(pad?: string): string {
    return cliLogo(pad)
  }

  export async function input(prompt: string): Promise<string> {
    try {
      const readline = await import("readline")
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      return new Promise<string>((resolve, reject) => {
        rl.question(prompt, (answer: string) => {
          rl.close()
          if (blank) {
            blank = false
          }
          resolve(answer.trim())
        })
        rl.on("error", (error) => {
          reject(error)
        })
      })
    } catch (error) {
      log.error("Failed to create readline interface", { error })
      throw error
    }
  }

  export function error(message: string): void {
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function markdown(text: string): string {
    return text
  }

  function forwardToRemote(text: string): void {
    if (!text) return
    try {
      if (!remoteService.hasActiveSession()) return
      remoteService.writeToTerminal(text)
    } catch (error) {
      log.debug("Failed to forward to remote", { error })
    }
  }
}
