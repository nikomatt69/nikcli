import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-format-runtime-home-"))
process.env.NIKCLI_TEST_MODE = "1"
process.env.NIKCLI_TEST_HOME = testHome
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")
delete process.env.NIKCLI_DISABLE_PROJECT_CONFIG

const { Effect } = await import("effect")
const { InstanceScope } = await import("@/effect")
const { Format } = await import("@/format")
const { FileTime } = await import("@/file/time")
const { Instance } = await import("@/project/instance")
const { WriteTool } = await import("@/tool/write")
const { EditTool } = await import("@/tool/edit")
const { ApplyPatchTool } = await import("@/tool/apply_patch")
const { makeToolContext, withProjectDirectory } = await import("../helpers/tool-context")

const projectDirs: string[] = []

async function makeProject(formatter: Record<string, unknown>) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-format-runtime-project-")))
  projectDirs.push(directory)
  await fs.writeFile(path.join(directory, "nikcli.json"), JSON.stringify({ formatter }))
  return directory
}

async function script(directory: string, name: string, source: string) {
  const file = path.join(directory, name)
  await fs.writeFile(file, source)
  return file
}

function command(file: string) {
  return [process.execPath, file, "$FILE"]
}

async function runFormat<A>(
  directory: string,
  effect: import("effect").Effect.Effect<A, never, InstanceType<(typeof Format)["Service"]>>,
) {
  return Effect.runPromise(InstanceScope.with({ directory }, effect.pipe(Effect.provide(Format.defaultLayer))))
}

async function mutationFormatter(directory: string) {
  return script(
    directory,
    "mutation-formatter.ts",
    [
      'import fs from "node:fs"',
      "const file = process.argv[2]",
      'const text = fs.readFileSync(file, "utf8").replace(/^\\uFEFF/, "").replaceAll("_raw", "_FORMATTED")',
      'fs.writeFileSync(file, text, "utf8")',
    ].join("\n"),
  )
}

describe("Format runtime (opencode #39564)", () => {
  it("accepts formatter true to enable built-ins", async () => {
    const directory = await makeProject({})
    await fs.writeFile(path.join(directory, "nikcli.json"), JSON.stringify({ formatter: true }))

    const status = await runFormat(
      directory,
      Effect.gen(function* () {
        const format = yield* Format.Service
        return yield* format.status()
      }),
    )

    expect(status.some((item) => item.name === "gofmt")).toBe(true)
  })

  it("runs the first successful matching formatter and stops", async () => {
    const directory = await makeProject({})
    const first = await script(
      directory,
      "first.ts",
      'import fs from "node:fs"; fs.writeFileSync(process.argv[2], "FIRST\\n")',
    )
    const second = await script(
      directory,
      "second.ts",
      'import fs from "node:fs"; fs.appendFileSync(process.argv[2], "SECOND\\n")',
    )
    await fs.writeFile(
      path.join(directory, "nikcli.json"),
      JSON.stringify({
        formatter: {
          first: { command: command(first), extensions: [".seq"] },
          second: { command: command(second), extensions: [".seq"] },
        },
      }),
    )
    const target = path.join(directory, "file.seq")
    await fs.writeFile(target, "before\n")

    const formatted = await runFormat(
      directory,
      Effect.gen(function* () {
        const format = yield* Format.Service
        return yield* format.file(target)
      }),
    )

    expect(formatted).toBe(true)
    expect(await fs.readFile(target, "utf8")).toBe("FIRST\n")
  })

  it("falls through when the first matching formatter fails", async () => {
    const directory = await makeProject({})
    const failing = await script(directory, "failing.ts", "process.exit(2)")
    const fallback = await script(
      directory,
      "fallback.ts",
      'import fs from "node:fs"; fs.writeFileSync(process.argv[2], "FALLBACK\\n")',
    )
    await fs.writeFile(
      path.join(directory, "nikcli.json"),
      JSON.stringify({
        formatter: {
          failing: { command: command(failing), extensions: [".fails"] },
          fallback: { command: command(fallback), extensions: [".fails"] },
        },
      }),
    )
    const target = path.join(directory, "file.fails")
    await fs.writeFile(target, "before\n")

    const formatted = await runFormat(
      directory,
      Effect.gen(function* () {
        const format = yield* Format.Service
        return yield* format.file(target)
      }),
    )

    expect(formatted).toBe(true)
    expect(await fs.readFile(target, "utf8")).toBe("FALLBACK\n")
  })

  it("keeps built-ins without command overrides and disables the ruff/uv pair", async () => {
    const directory = await makeProject({
      gofmt: {},
      ruff: { disabled: true },
    })

    const status = await runFormat(
      directory,
      Effect.gen(function* () {
        const format = yield* Format.Service
        return yield* format.status()
      }),
    )

    expect(status.some((item) => item.name === "gofmt")).toBe(true)
    expect(status.some((item) => item.name === "ruff")).toBe(false)
    expect(status.some((item) => item.name === "uv")).toBe(false)
  })
})

describe("mutation tool formatting (opencode #39564)", () => {
  it("write returns a diff from final formatted content", async () => {
    const directory = await makeProject({})
    const formatter = await mutationFormatter(directory)
    await fs.writeFile(
      path.join(directory, "nikcli.json"),
      JSON.stringify({
        formatter: {
          mutation: { command: command(formatter), extensions: [".mut"] },
        },
      }),
    )
    const target = path.join(directory, "write.mut")
    const def = await withProjectDirectory(directory, () => WriteTool.init())
    const { ctx } = makeToolContext()

    const result = await withProjectDirectory(directory, () =>
      def.executeAsync({ filePath: target, content: "write_raw\n" }, ctx),
    )

    expect(await fs.readFile(target, "utf8")).toBe("write_FORMATTED\n")
    expect(result.metadata.diff).toContain("+write_FORMATTED")
  })

  it("edit preserves BOM and returns a diff from final formatted content", async () => {
    const directory = await makeProject({})
    const formatter = await mutationFormatter(directory)
    await fs.writeFile(
      path.join(directory, "nikcli.json"),
      JSON.stringify({
        formatter: {
          mutation: { command: command(formatter), extensions: [".mut"] },
        },
      }),
    )
    const target = path.join(directory, "edit.mut")
    await fs.writeFile(target, "\uFEFFbefore\r\nrest\r\n")
    const def = await withProjectDirectory(directory, () => EditTool.init())
    const { ctx, sessionID } = makeToolContext()

    const result = await withProjectDirectory(directory, async () => {
      await FileTime.read(sessionID, target)
      return def.executeAsync({ filePath: target, oldString: "before", newString: "after_raw" }, ctx)
    })

    expect(await fs.readFile(target, "utf8")).toBe("\uFEFFafter_FORMATTED\r\nrest\r\n")
    expect(result.metadata.diff).toContain("+after_FORMATTED")
  })

  it("edit create reports final formatted content", async () => {
    const directory = await makeProject({})
    const formatter = await mutationFormatter(directory)
    await fs.writeFile(
      path.join(directory, "nikcli.json"),
      JSON.stringify({
        formatter: {
          mutation: { command: command(formatter), extensions: [".mut"] },
        },
      }),
    )
    const target = path.join(directory, "created.mut")
    const def = await withProjectDirectory(directory, () => EditTool.init())
    const { ctx } = makeToolContext()

    const result = await withProjectDirectory(directory, () =>
      def.executeAsync({ filePath: target, oldString: "", newString: "created_raw\n" }, ctx),
    )

    expect(await fs.readFile(target, "utf8")).toBe("created_FORMATTED\n")
    expect(result.metadata.diff).toContain("+created_FORMATTED")
  })

  it("apply_patch preserves BOM and reports final formatted content", async () => {
    const directory = await makeProject({})
    const formatter = await mutationFormatter(directory)
    await fs.writeFile(
      path.join(directory, "nikcli.json"),
      JSON.stringify({
        formatter: {
          mutation: { command: command(formatter), extensions: [".mut"] },
        },
      }),
    )
    const target = path.join(directory, "patch.mut")
    await fs.writeFile(target, "\uFEFFbefore\n")
    const def = await withProjectDirectory(directory, () => ApplyPatchTool.init())
    const { ctx } = makeToolContext()

    const result = await withProjectDirectory(directory, () =>
      def.executeAsync(
        {
          patchText: "*** Begin Patch\n*** Update File: patch.mut\n@@\n-before\n+after_raw\n*** End Patch",
        },
        ctx,
      ),
    )

    expect(await fs.readFile(target, "utf8")).toBe("\uFEFFafter_FORMATTED\n")
    expect(result.metadata.diff).toContain("+after_FORMATTED")
  })
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((directory) => fs.rm(directory, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
