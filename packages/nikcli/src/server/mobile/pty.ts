import { Effect } from "effect"
import { Pty } from "@/pty"
import { runPty } from "./helpers"

export function list() {
  return runPty(
    Effect.gen(function* () {
      return yield* (yield* Pty.Service).list()
    }),
  )
}

export function create(input: {
  command?: string
  args?: readonly string[]
  cwd?: string
  title?: string
  env?: Readonly<Record<string, string>>
}) {
  return runPty(
    Effect.gen(function* () {
      return yield* (yield* Pty.Service).create({
        command: input.command,
        args: input.args ? [...input.args] : undefined,
        cwd: input.cwd,
        title: input.title,
        env: input.env,
      })
    }),
  )
}

export async function get(ptyID: string): Promise<Pty.Info> {
  const info = await runPty(
    Effect.gen(function* () {
      return yield* (yield* Pty.Service).get(ptyID)
    }),
  )
  if (!info) throw new Pty.NotFoundError({ message: "Session not found" })
  return info
}

export async function update(ptyID: string, input: typeof Pty.UpdateInput._output): Promise<Pty.Info> {
  const info = await runPty(
    Effect.gen(function* () {
      return yield* (yield* Pty.Service).update(ptyID, input)
    }),
  )
  if (!info) throw new Pty.NotFoundError({ message: "Session not found" })
  return info
}

export async function remove(ptyID: string) {
  await runPty(
    Effect.gen(function* () {
      yield* (yield* Pty.Service).remove(ptyID)
    }),
  )
  return true
}
