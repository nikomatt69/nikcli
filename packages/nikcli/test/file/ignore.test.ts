import { describe, expect, it } from "bun:test"
import { FileIgnore } from "@/file/ignore"

describe("FileIgnore (opencode #20905: dotenv exclusion)", () => {
  const variants = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".env.development.local",
    ".env.test",
    ".env.example",
    ".env.template",
    ".env.sample",
  ]

  it("excludes all dotenv variants", () => {
    for (const file of variants) {
      expect(FileIgnore.match(`/${file}`)).toBe(true)
    }
  })

  it("excludes dotenv files in nested directories", () => {
    const nested = ["config/.env", "apps/web/.env.production", "deep/nested/dir/.env", "services/auth/.env.local"]
    for (const file of nested) {
      expect(FileIgnore.match(`/${file}`)).toBe(true)
    }
  })

  it("does NOT exclude unrelated dotenv-like filenames", () => {
    const unrelated = [
      ".envrc",
      "env.ts",
      "src/env/config.ts",
      "environment.yaml",
      ".environment",
      "docker.env",
      ".env-example",
    ]
    for (const file of unrelated) {
      expect(FileIgnore.match(`/${file}`)).toBe(false)
    }
  })
})
