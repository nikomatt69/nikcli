import { mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import pulseA from "../asset/pulse-a.wav" with { type: "file" }
import pulseB from "../asset/pulse-b.wav" with { type: "file" }
import pulseC from "../asset/pulse-c.wav" with { type: "file" }
import charge from "../asset/charge.wav" with { type: "file" }

const FILE = [pulseA, pulseB, pulseC]

const HUM = charge
const DIR = join(tmpdir(), "nikcli-sfx")

const LIST = [
  "ffplay",
  "mpv",
  "mpg123",
  "mpg321",
  "mplayer",
  "afplay",
  "play",
  "omxplayer",
  "aplay",
  "cmdmp3",
  "cvlc",
  "powershell.exe",
] as const

type Kind = (typeof LIST)[number]

function args(kind: Kind, file: string, volume: number) {
  if (kind === "ffplay") return [kind, "-autoexit", "-nodisp", "-af", `volume=${volume}`, file]
  if (kind === "mpv")
    return [kind, "--no-video", "--audio-display=no", "--volume", String(Math.round(volume * 100)), file]
  if (kind === "mpg123" || kind === "mpg321") return [kind, "-g", String(Math.round(volume * 100)), file]
  if (kind === "mplayer") return [kind, "-vo", "null", "-volume", String(Math.round(volume * 100)), file]
  if (kind === "afplay" || kind === "omxplayer" || kind === "aplay" || kind === "cmdmp3") return [kind, file]
  if (kind === "play") return [kind, "-v", String(volume), file]
  if (kind === "cvlc") return [kind, `--gain=${volume}`, "--play-and-exit", file]
  return [kind, "-c", `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`]
}

type Child = ReturnType<typeof Bun.spawn>

let kind: Kind | null | undefined
let proc: Child | undefined
let tail: ReturnType<typeof setTimeout> | undefined
let cache: Promise<{ hum: string; pulse: string[] }> | undefined
let seq = 0
let shot = 0

async function file(p: string) {
  mkdirSync(DIR, { recursive: true })
  const next = join(DIR, basename(p))
  const out = Bun.file(next)
  if (await out.exists()) return next
  await Bun.write(out, Bun.file(p))
  return next
}

function asset() {
  cache ??= Promise.all([file(HUM), Promise.all(FILE.map(file))]).then(([hum, pulse]) => ({ hum, pulse }))
  return cache
}

function pick() {
  if (kind !== undefined) return kind
  kind = LIST.find((item) => !!Bun.which(item)) ?? null
  return kind
}

function run(file: string, volume: number): Child | undefined {
  const k = pick()
  if (!k) return
  try {
    return Bun.spawn(args(k, file, volume), {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
  } catch {
    return undefined
  }
}

function clear() {
  if (!tail) return
  clearTimeout(tail)
  tail = undefined
}

function kill(child: Child) {
  try {
    child.kill()
  } catch {}
}

export function start() {
  stop()
  const id = ++seq
  void asset().then(({ hum }) => {
    if (id !== seq) return
    const next = run(hum, 0.24)
    if (!next) return
    proc = next
    void next.exited.then(
      () => {
        if (id !== seq) return
        if (proc === next) proc = undefined
      },
      () => {
        if (id !== seq) return
        if (proc === next) proc = undefined
      },
    )
  })
}

export function stop(delay = 0) {
  seq++
  clear()
  if (!proc) return
  const next = proc
  if (delay <= 0) {
    proc = undefined
    kill(next)
    return
  }
  tail = setTimeout(() => {
    tail = undefined
    if (proc === next) proc = undefined
    kill(next)
  }, delay)
}

export function pulse(scale = 1) {
  stop(140)
  const index = shot++ % FILE.length
  void asset()
    .then(({ pulse }) => {
      run(pulse[index], 0.26 + 0.14 * scale)
    })
    .catch(() => undefined)
}

export function dispose() {
  stop()
}
