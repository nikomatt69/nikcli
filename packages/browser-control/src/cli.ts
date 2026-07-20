#!/usr/bin/env bun
/**
 * browser-control CLI — every command except `bundle`/`install-skill` is a
 * thin RPC call against the per-workspace background daemon (auto-spawned on
 * first use). This is what lets `start`, then a later `wait`, then a later
 * `stop` work as three separate process invocations, e.g. from shell scripts
 * or CI steps.
 */
import { lstat, mkdir, readFile, readlink, realpath, symlink, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { homedir } from "node:os"
import { ensureDaemon, rpc, shutdownDaemon, socketPathFor } from "./daemon-client"
import { createEvidenceBundle, type EvidenceBundleOptions, type VerificationResult } from "./evidence"
import type { SessionInfo } from "./session"
import type { JSONFrame } from "./render/json"

const HELP = `browser-control COMMAND [options]

Background headless-browser sessions, driven the way terminal-control drives
PTY sessions — but for web pages. A per-workspace daemon holds one shared
Chromium process; sessions persist across separate CLI invocations and the
daemon exits on its own after 10 idle minutes.

Session commands:
  browser-control start [NAME] --url URL [--viewport WxH] [--record]
  browser-control list
  browser-control goto NAME URL
  browser-control send NAME (text|keys) VALUE
  browser-control click NAME SELECTOR
  browser-control fill NAME SELECTOR VALUE
  browser-control hover NAME SELECTOR
  browser-control scroll NAME DX DY
  browser-control wait NAME --text VALUE | --selector SEL [--state STATE] | --idle |
                             --stable [--ms N] | --timeout MS [--timeout MS]
  browser-control resize NAME WIDTHxHEIGHT
  browser-control snapshot NAME [--out FILE] [--format png|text|json]
  browser-control stop NAME       stops the browser context but keeps the
                                   session queryable (e.g. for --record video,
                                   only readable after stop) until removed
  browser-control remove NAME     forgets a stopped session
  browser-control restart NAME
  browser-control close-all

Recording:
  browser-control start-recording NAME [--fps N]

    --fps enables periodic real-screenshot sampling, usable for a video and
    for exact-marker frame lookup at any time — even before stop, unlike the
    --record webm which only finalizes on stop. Omit for trace-only recording.

  browser-control marker NAME LABEL
  browser-control stop-recording NAME
  browser-control recording-data NAME   current recording state, without stopping
  browser-control videoPath NAME        path to the --record webm; only after stop

Evidence:
  browser-control bundle (--screenshot FILE | --recording FILE) --out DIR --result passed|failed|unverified [options]

    --recording FILE takes JSON from \`stop-recording\`/\`recording-data\` and
    derives the screenshot/video from its sampled frames — mirrors
    terminal-control's --at-marker/--at-ms capture-from-recording flow.

    Options:
      --at-marker NAME         with --recording: screenshot at this marker
      --at-ms MS                with --recording: screenshot nearest this timestamp
      --fps NUMBER              with --recording: video fps (default: as sampled)
      --video FILE              webm from a --record session (after stop); takes
                                 priority over frames in --recording
      --trace FILE              trace.zip from stop-recording
      --title TEXT              PR section title
      --summary TEXT            Verification summary
      --link-base PATH          Repository-relative artifact path used by pr.md
      --include-trace           Copy the trace into the bundle (can contain page content)
      --no-preview              Do not produce an inline GIF preview
      --json                    Print the resulting bundle as JSON

Other:
  browser-control install-skill [--workspace DIR | --global] [--json]

    --global installs into ~/.agents/skills so nikcli discovers it in every
    workspace on this machine, not just the current one.
  browser-control shutdown        Stop the background daemon for this workspace
  -h, --help
`

function take(args: string[], name: string): string {
  const value = args.shift()
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value.`)
  return value
}

function parseViewport(value: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(value)
  if (!m) throw new Error(`Invalid viewport "${value}", expected WIDTHxHEIGHT.`)
  return { width: Number(m[1]), height: Number(m[2]) }
}

class HelpRequested extends Error {}

async function withDaemon<T>(fn: (socket: string) => Promise<T>): Promise<T> {
  const socket = await socketPathFor()
  await ensureDaemon(socket)
  return fn(socket)
}

function printInfo(info: SessionInfo): void {
  process.stdout.write(`${JSON.stringify(info, null, 2)}\n`)
}

async function cmdStart(args: string[]): Promise<void> {
  let name: string | undefined
  let url: string | undefined
  let viewport: { width: number; height: number } | undefined
  let record = false
  if (args[0] && !args[0].startsWith("--")) name = args.shift()
  while (args.length > 0) {
    const arg = args.shift()!
    switch (arg) {
      case "--url":
        url = take(args, arg)
        break
      case "--viewport":
        viewport = parseViewport(take(args, arg))
        break
      case "--record":
        record = true
        break
      case "-h":
      case "--help":
        throw new HelpRequested()
      default:
        throw new Error(`Unknown start option: ${arg}`)
    }
  }
  const info = await withDaemon((socket) => rpc<SessionInfo>(socket, "start", { name, url, viewport, record }))
  printInfo(info)
}

async function cmdWait(name: string, args: string[]): Promise<void> {
  let condition: Record<string, unknown> | undefined
  let timeout: number | undefined
  while (args.length > 0) {
    const arg = args.shift()!
    switch (arg) {
      case "--text":
        condition = { type: "text", value: take(args, arg) }
        break
      case "--selector":
        condition = { type: "selector", value: take(args, arg) }
        break
      case "--state":
        if (condition?.type === "selector") condition.state = take(args, arg)
        else take(args, arg)
        break
      case "--idle":
        condition = { type: "idle" }
        break
      case "--stable":
        condition = { type: "stable" }
        break
      case "--ms":
        if (condition?.type === "stable") condition.ms = Number(take(args, arg))
        else take(args, arg)
        break
      case "--timeout":
        timeout = Number(take(args, arg))
        break
      case "-h":
      case "--help":
        throw new HelpRequested()
      default:
        throw new Error(`Unknown wait option: ${arg}`)
    }
  }
  if (!condition) condition = { type: "timeout", ms: timeout ?? 1000 }
  else if (timeout !== undefined) condition.timeout = timeout
  const result = await withDaemon((socket) => rpc(socket, "wait", { name, condition }))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

async function cmdSnapshot(name: string, args: string[]): Promise<void> {
  let out: string | undefined
  let format: "png" | "text" | "json" = "png"
  while (args.length > 0) {
    const arg = args.shift()!
    switch (arg) {
      case "--out":
        out = take(args, arg)
        break
      case "--format":
        format = take(args, arg) as "png" | "text" | "json"
        break
      case "-h":
      case "--help":
        throw new HelpRequested()
      default:
        throw new Error(`Unknown snapshot option: ${arg}`)
    }
  }
  const frame = await withDaemon((socket) => rpc<JSONFrame>(socket, "snapshot", { name }))
  switch (format) {
    case "text": {
      const text = frame.text
      if (out) await writeFile(out, text)
      else process.stdout.write(`${text}\n`)
      return
    }
    case "json": {
      const json = JSON.stringify(frame, null, 2)
      if (out) await writeFile(out, json)
      else process.stdout.write(`${json}\n`)
      return
    }
    case "png": {
      const png = Buffer.from(frame.screenshotBase64, "base64")
      if (!out) throw new Error("snapshot --format png requires --out FILE.")
      await writeFile(out, png)
      process.stdout.write(`${out}\n`)
      return
    }
  }
}

export function renderAgentBundleOutput(bundle: Awaited<ReturnType<typeof createEvidenceBundle>>, prMarkdown: string): string {
  const preview = bundle.preview ?? bundle.screenshot
  const previewUrl = pathToFileURL(preview).href
  const lines = [
    "Browser evidence created.",
    "",
    `PR Markdown: ${bundle.prMarkdown}`,
    `Manifest: ${bundle.manifest}`,
    `Full MP4: ${bundle.video ?? "not generated"}`,
    `Trace: ${bundle.trace ?? "not included"}`,
    "",
    "Inline preview (include this exact line in the assistant response):",
    `![Browser verification preview](<${previewUrl}>)`,
    "",
    "PR section:",
    prMarkdown.trimEnd(),
    "",
  ]
  return lines.join("\n")
}

function result(value: string): VerificationResult {
  if (value === "passed" || value === "failed" || value === "unverified") return value
  throw new Error("--result must be passed, failed or unverified.")
}

async function parseBundleOptions(argv: readonly string[]): Promise<EvidenceBundleOptions & { readonly json: boolean }> {
  const args = [...argv]
  type MutableOptions = { -readonly [K in keyof EvidenceBundleOptions]?: EvidenceBundleOptions[K] }
  const options: MutableOptions & { json?: boolean } = {}
  let recordingPath: string | undefined
  while (args.length > 0) {
    const arg = args.shift()!
    switch (arg) {
      case "--screenshot":
        options.screenshotPath = take(args, arg)
        break
      case "--recording":
        recordingPath = take(args, arg)
        break
      case "--at-marker":
        options.atMarker = take(args, arg)
        break
      case "--at-ms":
        options.atMs = Number(take(args, arg))
        break
      case "--fps":
        options.fps = Number(take(args, arg))
        break
      case "--video":
        options.videoPath = take(args, arg)
        break
      case "--trace":
        options.tracePath = take(args, arg)
        break
      case "--out":
        options.outputDirectory = take(args, arg)
        break
      case "--result":
        options.result = result(take(args, arg))
        break
      case "--title":
        options.title = take(args, arg)
        break
      case "--summary":
        options.summary = take(args, arg)
        break
      case "--link-base":
        options.linkBase = take(args, arg)
        break
      case "--include-trace":
        options.includeTrace = true
        break
      case "--no-preview":
        options.preview = false
        break
      case "--json":
        options.json = true
        break
      case "-h":
      case "--help":
        throw new HelpRequested()
      default:
        throw new Error(`Unknown bundle option: ${arg}`)
    }
  }
  if (recordingPath) {
    options.recordingData = JSON.parse(await readFile(resolve(recordingPath), "utf8"))
  }
  if (!options.screenshotPath && !options.recordingData) {
    throw new Error("bundle requires --screenshot FILE or --recording FILE (from `stop-recording`/`recording-data`).")
  }
  if (!options.outputDirectory) throw new Error("bundle requires --out DIR.")
  if (!options.result) throw new Error("bundle requires --result passed|failed|unverified.")
  return {
    ...options,
    outputDirectory: options.outputDirectory,
    result: options.result,
    json: options.json ?? false,
  }
}

// --- install-skill -----------------------------------------------------

export interface SkillInstallation {
  readonly source: string
  readonly target: string
  readonly installed: boolean
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right)
}

async function findWorkspaceRoot(start = process.cwd()): Promise<string> {
  let current = resolve(start)
  while (true) {
    if (await lstat(join(current, ".git")).catch(() => undefined)) return current
    const parent = dirname(current)
    if (parent === current) return resolve(start)
    current = parent
  }
}

/**
 * `global: true` targets `~/.agents/skills/browser-control` — the home-rooted
 * external skill directory nikcli's Skill loader scans unconditionally for
 * every workspace on this machine, making the skill available by default
 * rather than opt-in per project.
 */
export async function installWorkspaceSkill(workspace?: string, global?: boolean): Promise<SkillInstallation> {
  const root = global ? homedir() : workspace ? resolve(workspace) : await findWorkspaceRoot()
  const source = resolve(import.meta.dir, "../skills/browser-control")
  const sourceManifest = join(source, "SKILL.md")
  const target = join(root, ".agents/skills/browser-control")

  const manifest = await lstat(sourceManifest).catch(() => undefined)
  if (!manifest?.isFile()) throw new Error(`Bundled browser-control skill is missing: ${sourceManifest}`)

  const existing = await lstat(target).catch(() => undefined)
  if (existing) {
    if (!existing.isSymbolicLink()) throw new Error(`Skill target already exists and is not a symlink: ${target}`)
    const linked = await readlink(target)
    const targetParent = await realpath(dirname(target)).catch(() => dirname(target))
    const linkedPath = resolve(targetParent, linked)
    const [actualSource, actualTarget] = await Promise.all([
      realpath(source).catch(() => source),
      realpath(linkedPath).catch(() => linkedPath),
    ])
    if (!samePath(actualSource, actualTarget)) throw new Error(`Skill target points somewhere else: ${target} -> ${linked}`)
    return { source, target, installed: false }
  }

  await mkdir(dirname(target), { recursive: true })
  const targetParent = await realpath(dirname(target)).catch(() => dirname(target))
  const link = relative(targetParent, source) || "."
  await symlink(link, target, process.platform === "win32" ? "junction" : "dir")
  return { source, target, installed: true }
}

function parseInstallOptions(argv: readonly string[]): { workspace?: string; global: boolean; json: boolean } {
  const args = [...argv]
  let workspace: string | undefined
  let global = false
  let json = false
  while (args.length > 0) {
    const arg = args.shift()!
    switch (arg) {
      case "--workspace":
        workspace = take(args, arg)
        break
      case "--global":
        global = true
        break
      case "--json":
        json = true
        break
      case "-h":
      case "--help":
        throw new HelpRequested()
      default:
        throw new Error(`Unknown install-skill option: ${arg}`)
    }
  }
  return { ...(workspace ? { workspace } : {}), global, json }
}

// --- main ----------------------------------------------------------------

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv
  const args = [...rest]

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP)
    return
  }

  try {
    switch (command) {
      case "start":
        return await cmdStart(args)
      case "list": {
        const list = await withDaemon((socket) => rpc<SessionInfo[]>(socket, "list"))
        process.stdout.write(`${JSON.stringify(list, null, 2)}\n`)
        return
      }
      case "goto": {
        const name = take(args, "goto")
        const url = take(args, "goto")
        printInfo(await withDaemon((socket) => rpc<SessionInfo>(socket, "goto", { name, url })))
        return
      }
      case "send": {
        const name = take(args, "send")
        const mode = take(args, "send") as "text" | "keys"
        const input = take(args, "send")
        printInfo(await withDaemon((socket) => rpc<SessionInfo>(socket, "send", { name, mode, input })))
        return
      }
      case "click": {
        const name = take(args, "click")
        const selector = take(args, "click")
        printInfo(await withDaemon((socket) => rpc<SessionInfo>(socket, "click", { name, selector })))
        return
      }
      case "fill": {
        const name = take(args, "fill")
        const selector = take(args, "fill")
        const value = take(args, "fill")
        printInfo(await withDaemon((socket) => rpc<SessionInfo>(socket, "fill", { name, selector, value })))
        return
      }
      case "hover": {
        const name = take(args, "hover")
        const selector = take(args, "hover")
        printInfo(await withDaemon((socket) => rpc<SessionInfo>(socket, "hover", { name, selector })))
        return
      }
      case "scroll": {
        const name = take(args, "scroll")
        const dx = Number(take(args, "scroll"))
        const dy = Number(take(args, "scroll"))
        printInfo(await withDaemon((socket) => rpc<SessionInfo>(socket, "scroll", { name, dx, dy })))
        return
      }
      case "wait":
        return await cmdWait(take(args, "wait"), args)
      case "resize": {
        const name = take(args, "resize")
        const { width, height } = parseViewport(take(args, "resize"))
        printInfo(await withDaemon((socket) => rpc<SessionInfo>(socket, "resize", { name, width, height })))
        return
      }
      case "snapshot":
        return await cmdSnapshot(take(args, "snapshot"), args)
      case "stop": {
        const name = take(args, "stop")
        await withDaemon((socket) => rpc(socket, "stop", { name }))
        process.stdout.write(`Stopped: ${name}\n`)
        return
      }
      case "remove": {
        const name = take(args, "remove")
        await withDaemon((socket) => rpc(socket, "remove", { name }))
        process.stdout.write(`Removed: ${name}\n`)
        return
      }
      case "restart": {
        const name = take(args, "restart")
        printInfo(await withDaemon((socket) => rpc<SessionInfo>(socket, "restart", { name })))
        return
      }
      case "close-all": {
        const socket = await socketPathFor()
        await shutdownDaemon(socket)
        process.stdout.write("Closed all sessions and stopped the daemon.\n")
        return
      }
      case "start-recording": {
        const name = take(args, "start-recording")
        let sampleFps: number | undefined
        while (args.length > 0) {
          const arg = args.shift()!
          if (arg === "--fps") sampleFps = Number(take(args, arg))
          else if (arg === "-h" || arg === "--help") throw new HelpRequested()
          else throw new Error(`Unknown start-recording option: ${arg}`)
        }
        await withDaemon((socket) => rpc(socket, "startRecording", { name, sampleFps }))
        process.stdout.write(`Recording: ${name}${sampleFps ? ` @ ${sampleFps}fps` : ""}\n`)
        return
      }
      case "marker": {
        const name = take(args, "marker")
        const markerName = take(args, "marker")
        const marker = await withDaemon((socket) => rpc(socket, "marker", { name, markerName }))
        process.stdout.write(`${JSON.stringify(marker, null, 2)}\n`)
        return
      }
      case "stop-recording": {
        const name = take(args, "stop-recording")
        const data = await withDaemon((socket) => rpc(socket, "stopRecording", { name }))
        process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
        return
      }
      case "recording-data": {
        const name = take(args, "recording-data")
        const data = await withDaemon((socket) => rpc(socket, "recordingData", { name }))
        process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
        return
      }
      case "shutdown": {
        const socket = await socketPathFor()
        await shutdownDaemon(socket)
        process.stdout.write("Daemon stopped.\n")
        return
      }
      case "install-skill": {
        const options = parseInstallOptions(args)
        const installation = await installWorkspaceSkill(options.workspace, options.global)
        if (options.json) {
          process.stdout.write(`${JSON.stringify(installation, null, 2)}\n`)
          return
        }
        const action = installation.installed ? "Installed" : "Already installed"
        process.stdout.write(`${action}: ${installation.target}\nRestart nikcli to load the skill.\n`)
        return
      }
      case "bundle": {
        const { json, ...options } = await parseBundleOptions(args)
        const bundle = await createEvidenceBundle(options)
        if (json) {
          process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`)
          return
        }
        const prMarkdown = await readFile(bundle.prMarkdown, "utf8")
        process.stdout.write(renderAgentBundleOutput(bundle, prMarkdown))
        return
      }
      default:
        throw new Error(`Unknown command: ${command}`)
    }
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(HELP)
      return
    }
    throw error
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
