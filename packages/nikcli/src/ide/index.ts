import { BusEvent } from "@/bus/bus-event"
import { spawn } from "bun"
import z from "zod"
import { Schema } from "effect"
import { Log } from "../util/log"

const SUPPORTED_IDES = [
  { name: "Windsurf" as const, cmd: "windsurf" },
  { name: "Visual Studio Code - Insiders" as const, cmd: "code-insiders" },
  { name: "Visual Studio Code" as const, cmd: "code" },
  { name: "Cursor" as const, cmd: "cursor" },
  { name: "VSCodium" as const, cmd: "codium" },
]

export namespace Ide {
  const log = Log.create({ service: "ide" })

  export const Event = {
    Installed: BusEvent.schema(
      "ide.installed",
      Schema.Struct({
        ide: Schema.String,
      }),
    ),
  }

  export class AlreadyInstalledError extends Schema.TaggedErrorClass<AlreadyInstalledError>()(
    "AlreadyInstalledError",
    {},
  ) {}

  export class InstallFailedError extends Schema.TaggedErrorClass<InstallFailedError>()("InstallFailedError", {
    stderr: Schema.String,
  }) {}

  /**
   * Thrown when the IDE identifier passed to `install` does not match any
   * entry in `SUPPORTED_IDES`. Tagged so the call site can use
   * `Effect.catchTag("UnknownIdeError", ...)` and the existing `instanceof
   * Ide.UnknownIdeError` continues to work.
   */
  export class UnknownIdeError extends Schema.TaggedErrorClass<UnknownIdeError>()("UnknownIdeError", {
    ide: Schema.String,
  }) {}

  /**
   * Union of all errors that `Ide.install` can fail with. Use this in the
   * Effect error channel of downstream consumers so they can
   * `Effect.catchTag` against the specific error class.
   */
  export type Error = UnknownIdeError | InstallFailedError | AlreadyInstalledError

  export function ide() {
    if (process.env["TERM_PROGRAM"] === "vscode") {
      const v = process.env["GIT_ASKPASS"]
      for (const ide of SUPPORTED_IDES) {
        if (v?.includes(ide.name)) return ide.name
      }
    }
    return "unknown"
  }

  export function alreadyInstalled() {
    return process.env["NIKCLI_CALLER"] === "vscode" || process.env["NIKCLI_CALLER"] === "vscode-insiders"
  }

  export async function install(ide: (typeof SUPPORTED_IDES)[number]["name"]) {
    const cmd = SUPPORTED_IDES.find((i) => i.name === ide)?.cmd
    if (!cmd) throw new Error(`Unknown IDE: ${ide}`)

    const p = spawn([cmd, "--install-extension", "sst-dev.nikcli"], {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    })
    await p.exited
    const stdout = await new Response(p.stdout).text()
    const stderr = await new Response(p.stderr).text()

    log.info("installed", {
      ide,
      stdout,
      stderr,
    })

    if (p.exitCode !== 0) {
      throw new InstallFailedError({ stderr })
    }
    if (stdout.includes("already installed")) {
      throw new AlreadyInstalledError({})
    }
  }
}
