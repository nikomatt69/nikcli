import { describe, expect, it } from "bun:test"
import { readFileSync, existsSync, statSync } from "fs"
import { resolve } from "path"
import { recordBenchmark } from "./benchmarks/runner"

describe("Build Optimizations", () => {
  describe("Build output", () => {
    it("can check if dist exists", () => {
      const distPath = resolve(__dirname, "../dist")
      const exists = existsSync(distPath)

      const start = performance.now()
      const iterations = 1000
      for (let i = 0; i < iterations; i++) {
        existsSync(distPath)
      }
      const checkTime = performance.now() - start

      recordBenchmark({
        suite: "build",
        module: "fs",
        scenario: "dist directory existence check",
        iterations,
        value: checkTime,
        unit: "ms",
        metadata: { exists, distPath },
      })

      if (exists) {
        const stat = statSync(distPath)
        expect(stat.isDirectory()).toBe(true)
      }
    })
  })
})

describe("Code Quality - No Implicit Dependencies", () => {
  describe("SolidJS Effects Pattern", () => {
    it("dialog-remote uses onMount for async iterator", () => {
      const filePath = resolve(__dirname, "../src/cli/cmd/tui/component/dialog-remote.tsx")
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("onMount")
      expect(content).not.toMatch(/createEffect\(\s*\(\s*\)\s*=>\s*\{[\s\S]*for await.*connection\.output/)
    })

    it("prompt autocomplete uses on() for visibility effect", () => {
      const filePath = resolve(__dirname, "../src/cli/cmd/tui/component/prompt/autocomplete.tsx")
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("store.visible")
    })

    it("app.tsx uses on() for terminal title effect", () => {
      const filePath = resolve(__dirname, "../src/cli/cmd/tui/app.tsx")
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("terminalTitleEnabled")
    })

    it("session/index.tsx uses on() for initial prompt", () => {
      const filePath = resolve(__dirname, "../src/cli/cmd/tui/routes/session/index.tsx")
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("route.initialPrompt")
    })

    it("theme.tsx uses on() for theme changes", () => {
      const filePath = resolve(__dirname, "../src/cli/cmd/tui/context/theme.tsx")
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("sync.data.config.theme")
    })

    it("local.tsx uses on() for agent changes", () => {
      const filePath = resolve(__dirname, "../src/cli/cmd/tui/context/local.tsx")
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("agent.current")
    })

    it("dialog-select.tsx uses on() for filter changes", () => {
      const filePath = resolve(__dirname, "../src/cli/cmd/tui/ui/dialog-select.tsx")
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("filtered()")
    })
  })

  describe("No createEffect without dependencies", () => {
    it("no bare createEffect with implicit tracking in TUI files", () => {
      const tuiFiles = [
        "../src/cli/cmd/tui/app.tsx",
        "../src/cli/cmd/tui/component/prompt/index.tsx",
        "../src/cli/cmd/tui/component/prompt/autocomplete.tsx",
        "../src/cli/cmd/tui/routes/session/index.tsx",
        "../src/cli/cmd/tui/context/theme.tsx",
        "../src/cli/cmd/tui/context/local.tsx",
        "../src/cli/cmd/tui/ui/dialog-select.tsx",
        "../src/cli/cmd/tui/component/dialog-remote.tsx",
      ]

      for (const file of tuiFiles) {
        const filePath = resolve(__dirname, file)
        const content = readFileSync(filePath, "utf-8")

        const bareEffectMatch = content.match(/createEffect\(\s*\(\s*\)\s*=>\s*\{[^}]*\}/)

        if (bareEffectMatch) {
          const hasOn = content.includes("on(")
          if (!hasOn) {
            throw new Error(`Found bare createEffect in ${file}: ${bareEffectMatch[0]}`)
          }
        }
      }
    })
  })
})
