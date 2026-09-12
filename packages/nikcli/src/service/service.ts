import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import { Global } from "@nikcli-ai/util/global"
import { Log } from "@nikcli-ai/util/log"
import { Installation } from "@/installation"

const log = Log.create({ service: "background-service" })

/**
 * The persistent background server every client shares.
 *
 * nikcli used to evaluate its whole engine graph per invocation, in the client
 * process *and* again in the TUI's worker isolate. A long-lived service pays it
 * once per machine and leaves clients as thin HTTP consumers — the shape
 * `nikcli attach <url>` has always run in.
 *
 * The lifecycle here follows opencode v2's `services/service-{config,registration}.ts`,
 * including the parts that are not obvious:
 *
 * - **Per-channel registration and port.** A `local` dev build and an installed
 *   release must not fight over one service; each channel gets its own file and
 *   its own default port.
 * - **Atomic registration writes** (temp file + rename), so a client polling
 *   during startup never parses a half-written file.
 * - **A service that loses ownership shuts itself down.** Each instance stamps a
 *   random `id`; a watchdog re-reads the file every 5s and exits if the entry is
 *   no longer its own. That, not locking, is what keeps two services from
 *   serving the same channel indefinitely.
 * - **Ownership-checked cleanup**, so an older instance exiting cannot delete a
 *   newer one's registration.
 *
 * Deliberate difference from opencode: no per-service password. nikcli binds
 * loopback and already has `NIKCLI_SERVER_PASSWORD` for its own auth, and adding
 * one would change what every client has to send. Any local process can read the
 * registration file either way.
 *
 * See `specs/background-service.md`.
 */
export namespace BackgroundService {
  export interface Registration {
    readonly id: string
    readonly pid: number
    readonly url: string
    readonly version: string
    readonly startedAt: number
  }

  const START_TIMEOUT_MS = 30_000
  const HEALTH_TIMEOUT_MS = 2_000
  const POLL_INTERVAL_MS = 100
  const STOP_TIMEOUT_MS = 10_000
  const OWNERSHIP_INTERVAL_MS = 5_000

  /** Channels that share the default name, mirroring opencode's list. */
  const SHARED_CHANNELS = new Set(["latest", "dev", "beta", "next"])

  /**
   * One registration per channel.
   *
   * Without this a `local` build and an installed release discover each other's
   * service and restart it on every version check, forever.
   */
  export function filename(channel = Installation.CHANNEL): string {
    if (SHARED_CHANNELS.has(channel)) return "service.json"
    return `service-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
  }

  /**
   * A stable, per-channel default port instead of an ephemeral one.
   *
   * Predictable enough to curl by hand, and distinct per channel so two builds
   * never race for the same socket. `serve` still falls back to an ephemeral
   * port if it is taken, and the registration records whatever was actually
   * bound, so nothing depends on getting this port.
   */
  export function defaultPort(channel = Installation.CHANNEL): number {
    if (SHARED_CHANNELS.has(channel)) return 0xc0de
    if (channel === "local") return 0xc0df
    let hash = 0
    for (const char of channel) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    return 10_000 + (hash % 50_000)
  }

  /**
   * Whether a discovered service's version counts as "this build".
   *
   * Exact equality is wrong for preview channels, whose versions carry a build
   * counter (`0.0.0-<channel>-<n>`): every rebuild would look like skew and
   * restart the service, so the engine would never actually stay warm.
   */
  export function versionBelongsToChannel(
    version: string | undefined,
    channel = Installation.CHANNEL,
    installed = Installation.VERSION,
  ): boolean {
    if (version === undefined) return false
    if (version === installed) return true
    const prefix = `0.0.0-${channel}-`
    if (!version.startsWith(prefix)) return false
    return /^\d+(?:\.\d+)?$/.test(version.slice(prefix.length))
  }

  /**
   * Resolved per call, never cached: `Global.Path.state` is a getter that follows
   * `NIKCLI_TEST_HOME`, which tests swap per file.
   */
  function registrationPath() {
    return path.join(Global.Path.state, filename())
  }

  function lockPath() {
    return path.join(Global.Path.state, `${filename()}.lock`)
  }

  async function readRegistration(): Promise<Registration | undefined> {
    try {
      const raw = await fs.readFile(registrationPath(), "utf8")
      const parsed = JSON.parse(raw) as Partial<Registration>
      if (typeof parsed.pid !== "number" || typeof parsed.url !== "string") return undefined
      return {
        id: typeof parsed.id === "string" ? parsed.id : "",
        pid: parsed.pid,
        url: parsed.url,
        version: typeof parsed.version === "string" ? parsed.version : "",
        startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
      }
    } catch {
      return undefined
    }
  }

  function owns(found: Registration | undefined, mine: Registration): boolean {
    return found !== undefined && found.id === mine.id && found.pid === mine.pid && found.url === mine.url
  }

  /**
   * Publish this process as the service for its channel, and start the watchdog
   * that stands it down if another instance takes over.
   *
   * Returns the disposer `serve` calls on shutdown — it removes the file only if
   * this instance still owns it, so an older process exiting cannot delete a
   * newer one's entry.
   */
  export async function register(url: string, onEvicted?: () => void): Promise<() => Promise<void>> {
    const registration: Registration = {
      id: randomUUID(),
      pid: process.pid,
      url,
      version: Installation.VERSION,
      startedAt: Date.now(),
    }

    const file = registrationPath()
    await fs.mkdir(path.dirname(file), { recursive: true })
    // Temp + rename: a client polling `discover()` during startup must never
    // parse a partially written file.
    const temp = `${file}.${registration.id}.tmp`
    await fs.writeFile(temp, JSON.stringify(registration), { mode: 0o600 })
    await fs.rename(temp, file)
    log.info("service registered", registration)

    const watchdog = setInterval(() => {
      void readRegistration().then((found) => {
        if (owns(found, registration)) return
        log.warn("service registration replaced; standing down", {
          id: registration.id,
          pid: registration.pid,
          observedId: found?.id,
          observedPid: found?.pid,
        })
        clearInterval(watchdog)
        onEvicted?.()
      })
    }, OWNERSHIP_INTERVAL_MS)
    // Never hold the process open on our own account.
    watchdog.unref?.()

    return async () => {
      clearInterval(watchdog)
      const found = await readRegistration()
      if (owns(found, registration)) await fs.rm(file, { force: true }).catch(() => {})
    }
  }

  /** Drop the registration unconditionally. For stale entries and for `stop`. */
  export async function unregister(): Promise<void> {
    await fs.rm(registrationPath(), { force: true }).catch(() => {})
  }

  function alive(pid: number): boolean {
    try {
      // Signal 0 performs the existence and permission checks without delivering.
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /** `undefined` when the server does not answer; never throws. */
  export async function health(url: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<{ version: string } | undefined> {
    try {
      const response = await fetch(new URL("/global/health", url), {
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) return undefined
      const body = (await response.json()) as { healthy?: boolean; version?: string }
      if (body.healthy !== true) return undefined
      return { version: typeof body.version === "string" ? body.version : "" }
    } catch {
      return undefined
    }
  }

  /**
   * The live service for this channel, or `undefined`.
   *
   * Believed only after the file parses, the pid is alive and health answers —
   * cheapest check first. Anything else means the entry is stale, and a stale
   * entry is removed rather than reported: a machine that crashed mid-session
   * must start cleanly, not fail.
   */
  export async function discover(): Promise<Registration | undefined> {
    const registration = await readRegistration()
    if (!registration) return undefined
    if (!alive(registration.pid)) {
      log.info("removing stale registration (process gone)", { pid: registration.pid })
      await unregister()
      return undefined
    }
    const probe = await health(registration.url)
    if (!probe) {
      log.info("removing stale registration (unhealthy)", { pid: registration.pid, url: registration.url })
      await unregister()
      return undefined
    }
    return { ...registration, version: probe.version || registration.version }
  }

  /**
   * The argv that re-runs this same build.
   *
   * A standalone executable is its own interpreter; from source the interpreter
   * is bun and the entry has to be passed along or the child starts a REPL.
   */
  function selfCommand(extra: string[]): string[] {
    if (Installation.isStandaloneExecutable()) return [process.execPath, ...extra]
    const entry = process.argv[1]
    if (!entry) throw new Error("cannot locate the nikcli entrypoint to spawn a background service")
    return [process.execPath, entry, ...extra]
  }

  async function acquireLock(): Promise<boolean> {
    await fs.mkdir(path.dirname(lockPath()), { recursive: true })
    try {
      // `wx` fails if the file exists, which is the atomic part.
      const handle = await fs.open(lockPath(), "wx")
      await handle.writeFile(String(process.pid))
      await handle.close()
      return true
    } catch {
      // A lock older than a whole start timeout belongs to a client that died
      // mid-spawn. Leaving it would wedge every later start.
      try {
        const stat = await fs.stat(lockPath())
        if (Date.now() - stat.mtimeMs > START_TIMEOUT_MS) {
          log.warn("removing abandoned service lock", { ageMs: Date.now() - stat.mtimeMs })
          await fs.rm(lockPath(), { force: true })
          return acquireLock()
        }
      } catch {}
      return false
    }
  }

  async function releaseLock(): Promise<void> {
    await fs.rm(lockPath(), { force: true }).catch(() => {})
  }

  async function waitFor(predicate: () => Promise<Registration | undefined>, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const found = await predicate()
      if (found) return found
      await Bun.sleep(POLL_INTERVAL_MS)
    }
    return undefined
  }

  /**
   * Spawn a service and wait for it to register.
   *
   * `detached` puts the child in its own process group, so a Ctrl+C aimed at the
   * client's foreground group does not reach it; every stdio stream is ignored,
   * because a daemon whose stdout stays piped to a parent that then exits takes
   * EPIPE on its next write.
   */
  export async function start(): Promise<Registration> {
    const held = await acquireLock()
    if (!held) {
      // Someone else is spawning. Wait for their service rather than starting a
      // second engine.
      const found = await waitFor(discover, START_TIMEOUT_MS)
      if (found) return found
      throw new Error("timed out waiting for another client to start the background service")
    }

    try {
      // Imported here, not at module scope: `config.ts` imports this module
      // back, and a client that only discovers a running service never needs it.
      const { ServiceConfig } = await import("./config")
      const settings = await ServiceConfig.read()
      const args = [
        "serve",
        "--service",
        "--port",
        String(settings.port ?? defaultPort()),
        "--hostname",
        settings.hostname ?? "127.0.0.1",
      ]
      for (const origin of settings.cors ?? []) args.push("--cors", origin)
      const command = selfCommand(args)
      log.info("starting background service", { command })
      const child = Bun.spawn(command, {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        detached: true,
        env: { ...process.env, ...settings.env },
      })
      child.unref()

      const found = await waitFor(discover, START_TIMEOUT_MS)
      if (!found) {
        child.kill()
        throw new Error(`background service did not become healthy within ${START_TIMEOUT_MS}ms`)
      }
      return found
    } finally {
      await releaseLock()
    }
  }

  /**
   * The service to talk to, starting one if needed.
   *
   * Version skew is restarted, not tolerated: both sides of the HTTP contract are
   * generated from the same source tree, so a client must never drive a service
   * built from different code.
   */
  export async function ensure(): Promise<Registration> {
    const existing = await discover()
    if (existing) {
      if (versionBelongsToChannel(existing.version)) return existing
      log.info("restarting background service for version mismatch", {
        service: existing.version,
        client: Installation.VERSION,
      })
      await stop()
    }
    return start()
  }

  /** `false` when there was nothing to stop. */
  export async function stop(): Promise<boolean> {
    const registration = await readRegistration()
    if (!registration) return false
    if (!alive(registration.pid)) {
      await unregister()
      return false
    }

    // SIGTERM, not SIGKILL: `serve` handles it by suspending live sessions so
    // the next start can resume them.
    try {
      process.kill(registration.pid, "SIGTERM")
    } catch {
      await unregister()
      return false
    }

    const deadline = Date.now() + STOP_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (!alive(registration.pid)) {
        await unregister()
        return true
      }
      await Bun.sleep(POLL_INTERVAL_MS)
    }

    log.warn("background service did not exit on SIGTERM; sending SIGKILL", { pid: registration.pid })
    try {
      process.kill(registration.pid, "SIGKILL")
    } catch {}
    await unregister()
    return true
  }

  export interface Status {
    readonly running: boolean
    readonly registration?: Registration
    readonly versionMatches?: boolean
    readonly channel: string
    readonly file: string
  }

  export async function status(): Promise<Status> {
    const registration = await discover()
    const base = { channel: Installation.CHANNEL, file: registrationPath() }
    if (!registration) return { running: false, ...base }
    return {
      running: true,
      registration,
      versionMatches: versionBelongsToChannel(registration.version),
      ...base,
    }
  }
}
