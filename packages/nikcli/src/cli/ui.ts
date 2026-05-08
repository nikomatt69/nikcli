import z from "zod"
import { EOL } from "os"
import { NamedError } from "@nikcli-ai/util/error"
import { remoteService } from "./remote"
import { logo as cliLogo } from "./logo"

export namespace UI {
  // Intentionally Zod-pinned: NamedError.create forwards `z.input<Data>` as
  // the constructor's `data` parameter. `z.void()` collapses to `void`, so
  // call sites can throw `new UI.CancelledError()` with no args.
  // `zod(Schema.Undefined)` maps to `z.undefined()` which requires an
  // explicit `undefined` argument and breaks every existing call site.
  // Revisit when Effect Schema gains a Void primitive matching z.void()'s
  // no-arg ergonomics or when NamedError.create accepts a payload-optional
  // schema kind.
  export const CancelledError = NamedError.create("UICancelledError", z.void())

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
  }

  export function println(...message: string[]) {
    print(...message)
    Bun.stderr.write(EOL)
    forwardToRemote(EOL)
  }

  export function print(...message: string[]) {
    blank = false
    const text = message.join(" ")
    Bun.stderr.write(text)
    forwardToRemote(text)
  }

  let blank = false
  export function empty() {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  export function logo(pad?: string) {
    return cliLogo(pad)
  }

  export async function input(prompt: string): Promise<string> {
    const readline = require("readline")
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(prompt, (answer: string) => {
        rl.close()
        resolve(answer.trim())
      })
    })
  }

  export function error(message: string) {
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function markdown(text: string): string {
    return text
  }

  function forwardToRemote(text: string) {
    if (!text) return
    if (!remoteService.hasActiveSession()) return
    remoteService.writeToTerminal(text)
  }
}
