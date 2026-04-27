import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ConfigPaths } from "@/config/paths"

describe("ConfigPaths", () => {
  describe("fileInDirectory", () => {
    it("prefers jsonc then json filenames", () => {
      const base = path.join("/tmp", "proj")
      expect(ConfigPaths.fileInDirectory(base, "nikcli")).toEqual([
        path.join(base, "nikcli.jsonc"),
        path.join(base, "nikcli.json"),
      ])
    })
  })

  describe("parseText", () => {
    let testDir: string
    const envKey = "NIKCLI_PATHS_TEST_ENV_1"

    beforeEach(async () => {
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-config-paths-"))
    })

    afterEach(async () => {
      await fs.rm(testDir, { recursive: true, force: true })
      delete process.env[envKey]
    })

    it("parses JSONC with trailing commas", async () => {
      const cfg = path.join(testDir, "c.jsonc")
      const data = await ConfigPaths.parseText(`{\n  "a": 1,\n}`, cfg)
      expect(data).toEqual({ a: 1 })
    })

    it("substitutes {env:NAME} from process.env", async () => {
      process.env[envKey] = "from-env"
      const cfg = path.join(testDir, "c.jsonc")
      const data = await ConfigPaths.parseText(`{ "x": "{env:${envKey}}" }`, cfg)
      expect(data).toEqual({ x: "from-env" })
    })

    it("uses empty string for missing env vars", async () => {
      const cfg = path.join(testDir, "c.jsonc")
      const data = await ConfigPaths.parseText(`{ "x": "{env:NIKCLI_PATHS_DEFINITELY_MISSING_XYZ}" }`, cfg)
      expect(data).toEqual({ x: "" })
    })

    it("inlines {file:relative} content as a JSON string", async () => {
      await fs.writeFile(path.join(testDir, "inc.txt"), "hello\nworld", "utf8")
      const cfg = path.join(testDir, "main.jsonc")
      const data = await ConfigPaths.parseText(`{ "msg": "{file:inc.txt}" }`, cfg)
      expect(data).toEqual({ msg: "hello\nworld" })
    })

    it("throws InvalidError when file reference is missing", async () => {
      const cfg = path.join(testDir, "main.jsonc")
      await expect(ConfigPaths.parseText(`{ "msg": "{file:nope.txt}" }`, cfg)).rejects.toMatchObject({
        name: "ConfigInvalidError",
      })
    })

    it("treats missing file as empty when missing mode is empty", async () => {
      const cfg = path.join(testDir, "main.jsonc")
      const data = await ConfigPaths.parseText(`{ "msg": "{file:nope.txt}" }`, cfg, "empty")
      expect(data).toEqual({ msg: "" })
    })

    it("throws JsonError on invalid JSON after substitution", async () => {
      const cfg = path.join(testDir, "bad.jsonc")
      await expect(ConfigPaths.parseText(`{ not json`, cfg)).rejects.toMatchObject({
        name: "ConfigJsonError",
      })
    })
  })
})
