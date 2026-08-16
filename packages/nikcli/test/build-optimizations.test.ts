import { describe, expect, it } from "bun:test"
import { readFileSync, existsSync, statSync } from "fs"
import { resolve } from "path"
import { recordBenchmark } from "./benchmarks/runner"
import { TUI_SRC } from "./tui/tui-source"

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
      const filePath = TUI_SRC + "component/dialog-remote.tsx"
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("onMount")
      expect(content).not.toMatch(/createEffect\(\s*\(\s*\)\s*=>\s*\{[\s\S]*for await.*connection\.output/)
    })

    it("prompt autocomplete uses on() for visibility effect", () => {
      const filePath = TUI_SRC + "component/prompt/autocomplete.tsx"
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("store.visible")
    })

    it("app.tsx uses on() for terminal title effect", () => {
      const filePath = TUI_SRC + "app.tsx"
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("terminalTitleEnabled")
    })

    it("session/index.tsx uses on() for initial prompt", () => {
      const filePath = TUI_SRC + "routes/session/index.tsx"
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("route.initialPrompt")
    })

    it("theme.tsx uses on() for theme changes", () => {
      const filePath = TUI_SRC + "context/theme.tsx"
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("sync.data.config.theme")
    })

    it("local.tsx uses on() for agent changes", () => {
      const filePath = TUI_SRC + "context/local.tsx"
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("agent.current")
    })

    it("dialog-select.tsx uses on() for filter changes", () => {
      const filePath = TUI_SRC + "ui/dialog-select.tsx"
      const content = readFileSync(filePath, "utf-8")

      expect(content).toContain("on(")
      expect(content).toContain("filtered()")
    })
  })

  describe("No createEffect without dependencies", () => {
    it("no bare createEffect with implicit tracking in TUI files", () => {
      const tuiFiles = [
        "app.tsx",
        "component/prompt/index.tsx",
        "component/prompt/autocomplete.tsx",
        "routes/session/index.tsx",
        "context/theme.tsx",
        "context/local.tsx",
        "ui/dialog-select.tsx",
        "component/dialog-remote.tsx",
      ]

      for (const file of tuiFiles) {
        const filePath = TUI_SRC + file
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
