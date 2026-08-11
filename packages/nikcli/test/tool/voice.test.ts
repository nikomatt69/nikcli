import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Voice } from "@/tool/voice"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

describe("Voice", () => {
  let projectDir: string
  let binDir: string
  let originalPath: string | undefined
  let def: Awaited<ReturnType<typeof Voice.init>>

  beforeAll(async () => {
    projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-voice-test-")))
    // A stub `rec` on PATH so the permission gate is exercised on machines
    // without sox/ffmpeg. It is never executed: the ask rejects first, and a
    // recording that did start would prove the gate is in the wrong place.
    binDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-voice-bin-")))
    await fs.writeFile(path.join(binDir, "rec"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    originalPath = process.env.PATH
    process.env.PATH = `${binDir}:${originalPath ?? ""}`
    def = await withProjectDirectory(projectDir, () => Voice.init())
  })

  afterAll(async () => {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(binDir, { recursive: true, force: true }).catch(() => {})
  })

  it("reports status without asking for anything", async () => {
    const { ctx, asked } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ action: "status", duration: 30, language: "en" }, ctx),
    )
    expect(result.output).toContain("Not recording")
    expect(asked).toEqual([])
  })

  it("asks for the voice permission before opening the microphone, and stops when denied", async () => {
    const { ctx, asked } = makeToolContext({ denyAsk: true })
    const run = withProjectDirectory(projectDir, () =>
      def.executeAsync({ action: "start", duration: 5, language: "en" }, ctx),
    )
    await expect(run).rejects.toThrow(/Permission denied/)
    expect(asked.map((entry) => entry.permission)).toEqual(["voice"])

    // Denied means nothing was recorded: a follow-up stop has no session to end.
    const { ctx: after } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ action: "stop", duration: 30, language: "en" }, after),
    )
    expect(result.output).toContain("No recording in progress")
  })

  it("stops cleanly when nothing is recording", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ action: "stop", duration: 30, language: "en" }, ctx),
    )
    expect(result.output).toContain("No recording in progress")
  })
})
