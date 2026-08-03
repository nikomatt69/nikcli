import { beforeEach } from "bun:test"

const extra = new Set(["AUR_KEY", "ISLAND_SUPPORT_DIR", "NPM_TOKEN", "OPENAI_API_KEY", "PORT", "SST_GITHUB_TOKEN"])

const managed = (key: string) => key.startsWith("NIKCLI_") || key.startsWith("XDG_") || extra.has(key)

let baseline: Record<string, string | undefined> | undefined

function restore(values: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) {
    if (managed(key)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value
  }
}

export function setTestEnvBaseline() {
  baseline = Object.fromEntries(Object.entries(process.env).filter(([key]) => managed(key)))
  beforeEach(() => restore(baseline!))
}

export function preserveTestEnv(keys: readonly string[]) {
  if (!baseline) throw new Error("Test environment baseline has not been initialized")
  const overrides = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

  beforeEach(() => {
    restore(baseline!)
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}
