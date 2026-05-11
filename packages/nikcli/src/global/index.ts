import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"

const app = "nikcli"

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

function testPath(name: string, fallback: string) {
  return process.env.NIKCLI_TEST_HOME ? path.join(process.env.NIKCLI_TEST_HOME, name) : fallback
}

/** Primary data root: `<XDG_DATA_HOME>/nikcli/` — holds `storage/`, `snapshot/`, DBs, etc. */
function resolveDataDir(): string {
  if (process.env.NIKCLI_TEST_HOME) {
    return path.join(process.env.NIKCLI_TEST_HOME, "data")
  }
  const override = process.env.NIKCLI_DATA_DIR?.trim()
  if (override) {
    return path.resolve(override)
  }
  return data
}

export namespace Global {
  export const Path = {
    // Allow override via NIKCLI_TEST_HOME for test isolation
    get home() {
      return process.env.NIKCLI_TEST_HOME || os.homedir()
    },
    get data() {
      return resolveDataDir()
    },
    get bin() {
      return path.join(Global.Path.data, "bin")
    },
    get log() {
      return path.join(Global.Path.data, "log")
    },
    get cache() {
      return testPath("cache", cache)
    },
    get config() {
      return testPath("config", config)
    },
    get state() {
      return testPath("state", state)
    },
    get modelsDevUrl() {
      return process.env.NIKCLI_MODELS_URL || "https://models.dev"
    },
  }
}

export async function initialize() {
  // Run migration before setting up directories


  await Promise.all([
    fs.mkdir(Global.Path.data, { recursive: true }),
    fs.mkdir(Global.Path.cache, { recursive: true }),
    fs.mkdir(Global.Path.config, { recursive: true }),
    fs.mkdir(Global.Path.state, { recursive: true }),
    fs.mkdir(Global.Path.log, { recursive: true }),
    fs.mkdir(Global.Path.bin, { recursive: true }),
  ])

  const CACHE_VERSION = "14"

  const version = await Bun.file(path.join(Global.Path.cache, "version"))
    .text()
    .catch(() => "0")

  if (version !== CACHE_VERSION) {
    try {
      const contents = await fs.readdir(Global.Path.cache)
      await Promise.all(
        contents.map((item) =>
          fs.rm(path.join(Global.Path.cache, item), {
            recursive: true,
            force: true,
          }),
        ),
      )
    } catch (e) {
      console.debug("[global] failed to clear cache, ignoring:", e)
    }
    await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
  }
}
