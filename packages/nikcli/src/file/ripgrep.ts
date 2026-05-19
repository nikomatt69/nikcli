import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Log } from "../util/log"
import { lazyAsync } from "../util/lazy"

export namespace Ripgrep {
  const log = Log.create({ service: "ripgrep" })

  const Begin = z.object({
    type: z.literal("begin"),
    data: z.object({ path: z.object({ text: z.string() }) }),
  })

  export const Match = z.object({
    type: z.literal("match"),
    data: z.object({
      path: z.object({ text: z.string() }),
      lines: z.object({ text: z.string() }),
      line_number: z.number(),
      absolute_offset: z.number(),
      submatches: z.array(
        z.object({
          match: z.object({ text: z.string() }),
          start: z.number(),
          end: z.number(),
        }),
      ),
    }),
  })
  export type Match = z.infer<typeof Match>

  const End = z.object({
    type: z.literal("end"),
    data: z.object({ path: z.object({ text: z.string() }) }).passthrough(),
  })
  const Summary = z.object({ type: z.literal("summary") }).passthrough()
  const Context = z.object({ type: z.literal("context") }).passthrough()
  const Result = z.discriminatedUnion("type", [Begin, Match, End, Summary, Context])

  const state = lazyAsync(async (): Promise<{ filepath: string } | undefined> => {
    const filepath = Bun.which("rg")
    if (filepath) {
      log.info("found", { filepath })
      return { filepath }
    }
    log.info("not found on PATH; ripgrep tier disabled")
    return undefined
  })

  function env() {
    const env = { ...process.env }
    delete env.RIPGREP_CONFIG_PATH
    return env
  }

  function clean(file: string) {
    return path.normalize(file.replace(/^\.[\\/]/, "")).replaceAll(path.sep, "/")
  }

  async function checkDirectory(cwd: string) {
    const stat = await fs.stat(cwd).catch(() => undefined)
    if (stat?.isDirectory()) return
    throw Object.assign(new Error(`No such file or directory: '${cwd}'`), {
      code: "ENOENT",
      errno: -2,
      path: cwd,
    })
  }

  export async function filepath(): Promise<string | undefined> {
    return (await state())?.filepath
  }

  export async function available(): Promise<boolean> {
    return Boolean(await filepath())
  }

  export type FilesInput = {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
    limit?: number
  }

  export async function files(input: FilesInput): Promise<string[] | undefined> {
    const bin = await filepath()
    if (!bin) return undefined

    await checkDirectory(input.cwd)

    const args = [bin, "--no-config", "--files", "--glob=!.git/*"]
    if (input.follow !== false) args.push("--follow")
    if (input.hidden !== false) args.push("--hidden")
    if (input.hidden === false) args.push("--glob=!.*")
    if (input.maxDepth !== undefined) args.push(`--max-depth=${input.maxDepth}`)
    if (input.glob) {
      for (const g of input.glob) args.push(`--glob=${g}`)
    }
    args.push(".")

    const proc = Bun.spawn(args, { cwd: input.cwd, env: env(), stdout: "pipe", stderr: "ignore" })
    const out: string[] = []
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ""
        for (const line of lines) {
          if (!line) continue
          out.push(clean(line))
          if (input.limit && out.length >= input.limit) {
            try {
              proc.kill()
            } catch {}
            return out
          }
        }
      }
      if (buffer) out.push(clean(buffer))
    } finally {
      try {
        reader.releaseLock()
      } catch {}
      await proc.exited.catch(() => undefined)
    }
    return out
  }

  export type SearchInput = {
    cwd: string
    pattern: string
    glob?: string[]
    limit?: number
    follow?: boolean
    before?: number
    after?: number
    hidden?: boolean
  }

  export async function search(input: SearchInput): Promise<Match["data"][] | undefined> {
    const bin = await filepath()
    if (!bin) return undefined
    await checkDirectory(input.cwd)

    const args = [bin, "--no-config", "--json", "--no-messages", "--glob=!.git/*"]
    if (input.hidden !== false) args.push("--hidden")
    if (input.hidden === false) args.push("--glob=!.*")
    if (input.follow !== false) args.push("--follow")
    if (input.glob) {
      for (const g of input.glob) args.push(`--glob=${g}`)
    }
    if (input.limit) args.push(`--max-count=${input.limit}`)
    if (input.before) args.push(`--before-context=${input.before}`)
    if (input.after) args.push(`--after-context=${input.after}`)
    args.push("--", input.pattern)

    const proc = Bun.spawn(args, { cwd: input.cwd, env: env(), stdout: "pipe", stderr: "pipe" })
    const matches: Match["data"][] = []
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ""
        for (const line of lines) {
          if (!line) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(line)
          } catch {
            continue
          }
          const result = Result.safeParse(parsed)
          if (!result.success) continue
          if (result.data.type === "match") {
            matches.push({
              ...result.data.data,
              path: { text: clean(result.data.data.path.text) },
            })
          }
        }
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {}
      await proc.exited.catch(() => undefined)
    }

    const code = proc.exitCode ?? 0
    // rg exits 1 when no matches found - that's expected, not an error.
    if (code === 2) {
      const stderr = await new Response(proc.stderr).text().catch(() => "")
      log.warn("ripgrep search returned partial results", { stderr: stderr.slice(0, 200) })
    } else if (code !== 0 && code !== 1) {
      const stderr = await new Response(proc.stderr).text().catch(() => "")
      log.warn("ripgrep failed", { exitCode: code, stderr: stderr.slice(0, 200) })
      return undefined
    }
    return matches
  }
}
