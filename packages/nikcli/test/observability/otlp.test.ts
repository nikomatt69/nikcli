import { describe, expect, it } from "bun:test"
import path from "path"
import { resource } from "@/observability/otlp"

/**
 * The three states of the observability layer
 * ([specs/v2/observability-otlp-and-in-process-panel.md](../../../../specs/v2/observability-otlp-and-in-process-panel.md)).
 *
 * `enabled`, `liveEnabled` and `layer` are decided once, at module load, from
 * `Flag` values that are themselves snapshots of the environment. Flipping a
 * variable inside a test therefore cannot move them — the only honest way to
 * observe a different configuration is a fresh process, which is what the
 * `probe` helper below does. `resource()` reads `process.env` on every call and
 * is checked in-process.
 */

const packageRoot = path.join(import.meta.dir, "../..")

async function probe(env: Record<string, string | undefined>): Promise<{
  enabled: boolean
  live: boolean
  layerIsEmpty: boolean
}> {
  const proc = Bun.spawn(
    [
      "bun",
      "-e",
      'const m = await import("./src/observability/otlp.ts");' +
        'const { Layer } = await import("effect");' +
        "console.log(JSON.stringify({ enabled: m.enabled, live: m.liveEnabled, layerIsEmpty: m.layer === Layer.empty }))",
    ],
    {
      cwd: packageRoot,
      // Start from a copy with the observability variables cleared, so the
      // probe reflects `env` and not whatever the outer shell exported.
      env: Object.fromEntries(
        Object.entries({
          ...process.env,
          OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
          OTEL_EXPORTER_OTLP_HEADERS: undefined,
          NIKCLI_DISABLE_OTEL_LIVE: undefined,
          ...env,
        }).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`probe exited ${code}: ${stderr}`)
  return JSON.parse(stdout.trim().split("\n").at(-1)!)
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe("observability layer states", () => {
  it("captures in-process with no collector configured", async () => {
    const state = await probe({})
    expect(state.live).toBe(true)
    expect(state.enabled).toBe(false)
    // Live capture alone still builds a layer: the bus tracer is what feeds
    // the TUI panel.
    expect(state.layerIsEmpty).toBe(false)
  })

  it("turns OTLP export on only when an endpoint is configured", async () => {
    const state = await probe({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318" })
    expect(state.enabled).toBe(true)
    expect(state.live).toBe(true)
  })

  it("is the empty layer — not a disabled one — when nothing is active", async () => {
    const state = await probe({ NIKCLI_DISABLE_OTEL_LIVE: "1" })
    expect(state.enabled).toBe(false)
    expect(state.live).toBe(false)
    // Identity against `Layer.empty`, so "no-op" means the runtime merges
    // nothing rather than merging something that does nothing.
    expect(state.layerIsEmpty).toBe(true)
  })
})

describe("observability resource attributes", () => {
  it("defaults the service name and falls back to the build channel", () => {
    const info = withEnv({ OTEL_SERVICE_NAME: undefined, OTEL_RESOURCE_ATTRIBUTES: undefined }, () =>
      resource("run1234"),
    )
    expect(info.serviceName).toBe("nikcli")
    expect(info.attributes["nikcli.run"]).toBe("run1234")
    expect(info.attributes["service.instance.id"]).toBe("run1234")
    expect(info.attributes["deployment.environment.name"]).toBeTruthy()
  })

  it("lets OTEL_SERVICE_NAME win over the nikcli default", () => {
    const info = withEnv({ OTEL_SERVICE_NAME: "jaeger-named-me" }, () => resource("run1234"))
    expect(info.serviceName).toBe("jaeger-named-me")
  })

  it("parses OTEL_RESOURCE_ATTRIBUTES and url-decodes both halves", () => {
    const info = withEnv({ OTEL_RESOURCE_ATTRIBUTES: "team%20name=platform%20eng,host.name=box-1" }, () =>
      resource("run1234"),
    )
    expect(info.attributes["team name"]).toBe("platform eng")
    expect(info.attributes["host.name"]).toBe("box-1")
  })

  it("lets an operator-set deployment environment win over the build channel", () => {
    const info = withEnv({ OTEL_RESOURCE_ATTRIBUTES: "deployment.environment.name=staging" }, () => resource("run1234"))
    expect(info.attributes["deployment.environment.name"]).toBe("staging")
  })

  it("ignores a malformed OTEL_RESOURCE_ATTRIBUTES instead of failing the run", () => {
    const info = withEnv({ OTEL_RESOURCE_ATTRIBUTES: "=novalue,alsobroken" }, () => resource("run1234"))
    expect(info.attributes["deployment.environment.name"]).toBeTruthy()
    expect(info.serviceName).toBe("nikcli")
  })
})
