import { describe, expect, it } from "bun:test"
import { Config } from "../../src/config/config"
import path from "path"
import fs from "fs/promises"
import { mergeDeep } from "remeda"
import z from "zod"

describe("Config Benchmark", () => {
  const TEST_DATA_DIR = path.join(import.meta.dir, ".test-config-temp")

  // Setup helper
  async function setupTestDir() {
    await fs.mkdir(TEST_DATA_DIR, { recursive: true })
  }

  // Cleanup helper
  async function cleanupTestDir() {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true })
  }

  // Helper to create valid config data
  function createValidConfig(overrides: Record<string, unknown> = {}) {
    return {
      model: "anthropic/claude-3-sonnet",
      agent: {
        build: {
          model: "anthropic/claude-3-opus",
          temperature: 0.7,
          prompt: "You are a helpful coding assistant.",
        },
        plan: {
          model: "anthropic/claude-3-haiku",
          temperature: 0.5,
        },
      },
      plugin: ["@nikcli-ai/plugin"],
      permission: {
        read: "allow",
        edit: "ask",
        bash: "deny",
      },
      ...overrides,
    }
  }

  describe("Config.get() Retrieval", () => {
    it("measures Config.Info.parse() performance", () => {
      const iterations = 1000
      const configData = createValidConfig()

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Config.Info.parse(configData)
      }
      const duration = performance.now() - start

      console.log(`\n📊 Config.Info.parse() (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

      expect(duration).toBeLessThan(5000)
    })

    it("measures Config.Info.safeParse() performance (with validation)", () => {
      const iterations = 1000
      const configData = createValidConfig()

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Config.Info.safeParse(configData)
      }
      const duration = performance.now() - start

      console.log(`\n📊 Config.Info.safeParse() (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

      expect(duration).toBeLessThan(5000)
    })

    it("measures Config.Info.parse() with deep nesting", () => {
      const iterations = 500
      const deepConfig = createValidConfig({
        agent: {
          build: {
            model: "anthropic/claude-3-opus",
            options: {
              custom: {
                nested: {
                  deep: {
                    very: {
                      deep: {
                        value: "test",
                      },
                    },
                  },
                },
              },
            },
          },
          plan: {
            model: "anthropic/claude-3-haiku",
          },
        },
      })

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Config.Info.parse(deepConfig)
      }
      const duration = performance.now() - start

      console.log(`\n📊 Config.Info.parse() with deep nesting (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

      expect(duration).toBeLessThan(5000)
    })
  })

  describe("Config Merging Performance", () => {
    const iterations = 500

    it("mergeDeep with simple objects", () => {
      const base = createValidConfig()
      const override = {
        model: "openai/gpt-4",
        agent: {
          build: {
            temperature: 0.9,
          },
        },
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        mergeDeep(base, override)
      }
      const duration = performance.now() - start

      console.log(`\n📊 mergeDeep() - Simple objects (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

      expect(duration).toBeLessThan(3000)
    })

    it("mergeDeep with deeply nested objects", () => {
      const base = createValidConfig({
        agent: {
          build: {
            options: {
              featureFlags: Array.from({ length: 20 }, (_, i) => ({ name: `flag-${i}`, enabled: i % 2 === 0 })),
            },
          },
        },
      })
      const override = {
        agent: {
          build: {
            options: {
              featureFlags: [{ name: "new-flag", enabled: true }],
            },
          },
        },
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        mergeDeep(base, override)
      }
      const duration = performance.now() - start

      console.log(`\n📊 mergeDeep() - Deeply nested (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

      expect(duration).toBeLessThan(5000)
    })

    it("mergeDeep with large arrays", () => {
      const base = createValidConfig({
        plugin: Array.from({ length: 50 }, (_, i) => `@plugin/plugin-${i}`),
      })
      const override = {
        plugin: ["@new/plugin-1", "@new/plugin-2"],
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        mergeDeep(base, override)
      }
      const duration = performance.now() - start

      console.log(`\n📊 mergeDeep() - Large arrays (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

      expect(duration).toBeLessThan(5000)
    })

    it("cascading merges (5 layers)", () => {
      const configs = [
        createValidConfig({ model: "base-model" }),
        createValidConfig({ model: "layer-1" }),
        createValidConfig({ model: "layer-2" }),
        createValidConfig({ model: "layer-3" }),
        createValidConfig({ model: "layer-4" }),
      ]

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        let merged = configs[0]
        for (let j = 1; j < configs.length; j++) {
          merged = mergeDeep(merged, configs[j])
        }
      }
      const duration = performance.now() - start

      console.log(`\n📊 Cascading mergeDeep() - 5 layers (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

      expect(duration).toBeLessThan(5000)
    })
  })

  describe("Schema Validation Performance", () => {
    it("valid config validation", () => {
      const iterations = 1000
      const validConfig = createValidConfig()

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Config.Info.parse(validConfig)
      }
      const duration = performance.now() - start

      console.log(`\n📊 Schema validation - Valid config (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} validations/sec`)

      expect(duration).toBeLessThan(5000)
    })

    it("invalid config validation (with error path)", () => {
      const iterations = 500
      const invalidConfig = {
        model: 123, // Should be string
        agent: {
          build: {
            temperature: "high", // Should be number
          },
        },
        permission: "invalid", // Should be object or enum
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        try {
          Config.Info.parse(invalidConfig)
        } catch {
          // Expected
        }
      }
      const duration = performance.now() - start

      console.log(`\n📊 Schema validation - Invalid config (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} validations/sec`)

      expect(duration).toBeLessThan(5000)
    })

    it("partial config validation (many optional fields)", () => {
      const iterations = 1000
      const partialConfig = {
        model: "anthropic/claude-3-sonnet",
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Config.Info.parse(partialConfig)
      }
      const duration = performance.now() - start

      console.log(`\n📊 Schema validation - Partial config (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} validations/sec`)

      expect(duration).toBeLessThan(5000)
    })

    it("complex permission object validation", () => {
      const iterations = 500
      const configWithPermissions = createValidConfig({
        permission: {
          read: "allow",
          edit: "ask",
          bash: "deny",
          glob: { "*": "allow", "/secret/**": "deny" },
          grep: "allow",
          list: "allow",
          tree: "allow",
          task: "ask",
          subagents: "deny",
          docs_add: "ask",
          docs_search: "allow",
          docs_load: "allow",
          docs_unload: "ask",
          docs_context: "allow",
          docs_request: "ask",
          docs_gap_report: "allow",
          smart_docs: "ask",
          context_collect: "allow",
          context_search: "allow",
          context_related: "ask",
          context_diagnostics: "allow",
          memory_search: "ask",
          rag_index: "deny",
          rag_search: "allow",
          rag_status: "ask",
          rag_reset: "deny",
          generate_image: "ask",
          external_directory: "deny",
          todowrite: "ask",
          todoread: "allow",
          question: "allow",
          webfetch: "ask",
          websearch: "deny",
          codesearch: "allow",
          speak: "ask",
          lsp: { "**/*.ts": "allow", "**/*.js": "allow" },
          doom_loop: "deny",
        },
      })

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Config.Info.parse(configWithPermissions)
      }
      const duration = performance.now() - start

      console.log(`\n📊 Schema validation - Complex permissions (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} validations/sec`)

      expect(duration).toBeLessThan(5000)
    })

    it("MCP server config validation", () => {
      const iterations = 500
      const configWithMCP = createValidConfig({
        mcp: {
          "filesystem-server": {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/test/Projects"],
            enabled: true,
            timeout: 10000,
          },
          "github-server": {
            type: "remote",
            url: "https://github.com/modelcontextprotocol/servers",
            enabled: true,
            headers: {
              Authorization: "Bearer test-token",
            },
            oauth: {
              clientId: "test-client-id",
              scope: "repo gist",
            },
            timeout: 30000,
          },
        },
      })

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Config.Info.parse(configWithMCP)
      }
      const duration = performance.now() - start

      console.log(`\n📊 Schema validation - MCP config (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} validations/sec`)

      expect(duration).toBeLessThan(5000)
    })

    it("provider config with many models", () => {
      const iterations = 200
      const configWithProviders = createValidConfig({
        provider: {
          openai: {
            models: Object.fromEntries(
              Array.from({ length: 50 }, (_, i) => [
                `gpt-${4 + i * 0.5}`,
                {
                  disabled: i % 5 === 0,
                  variants: Object.fromEntries(Array.from({ length: 5 }, (_, j) => [`variant-${j}`, {}])),
                },
              ]),
            ),
          },
          anthropic: {
            models: Object.fromEntries(
              Array.from({ length: 30 }, (_, i) => [
                `claude-${3 + i * 0.1}`,
                {
                  disabled: false,
                  variants: Object.fromEntries([
                    ["20240229", {}],
                    ["20240307", {}],
                  ]),
                },
              ]),
            ),
          },
        },
      })

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Config.Info.parse(configWithProviders)
      }
      const duration = performance.now() - start

      console.log(`\n📊 Schema validation - Many models (${iterations} iterations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} validations/sec`)

      expect(duration).toBeLessThan(5000)
    })
  })

  describe("Config File I/O Performance", () => {
    const iterations = 100

    it("read and parse config file", async () => {
      await setupTestDir()
      try {
        const configFile = path.join(TEST_DATA_DIR, "test-config.json")
        const configData = createValidConfig({
          model: "benchmark-model",
          agent: {
            build: {
              prompt: "Test prompt for benchmarking",
            },
          },
        })
        await Bun.write(configFile, JSON.stringify(configData, null, 2))

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const text = await Bun.file(configFile).text()
          const parsed = JSON.parse(text)
          Config.Info.parse(parsed)
        }
        const duration = performance.now() - start

        console.log(`\n📊 Read + parse config file (${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

        await fs.unlink(configFile)
        expect(duration).toBeLessThan(5000)
      } finally {
        await cleanupTestDir()
      }
    })

    it("read large config file", async () => {
      await setupTestDir()
      try {
        const configFile = path.join(TEST_DATA_DIR, "large-config.json")
        const largeConfig = createValidConfig({
          provider: {
            openai: {
              models: Object.fromEntries(
                Array.from({ length: 100 }, (_, i) => [
                  `model-${i}`,
                  {
                    disabled: false,
                    variants: Object.fromEntries(Array.from({ length: 5 }, (_, j) => [`variant-${j}`, {}])),
                  },
                ]),
              ),
            },
          },
        })
        await Bun.write(configFile, JSON.stringify(largeConfig, null, 2))

        const iterations = 50

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const text = await Bun.file(configFile).text()
          const parsed = JSON.parse(text)
          Config.Info.parse(parsed)
        }
        const duration = performance.now() - start

        console.log(`\n📊 Read + parse large config (${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

        await fs.unlink(configFile)
        expect(duration).toBeLessThan(10000)
      } finally {
        await cleanupTestDir()
      }
    })

    it("write config file with formatting", async () => {
      await setupTestDir()
      try {
        const configData = createValidConfig()

        const start = performance.now()
        const files: string[] = []
        for (let i = 0; i < iterations; i++) {
          const configFile = path.join(TEST_DATA_DIR, `write-config-${i}.json`)
          files.push(configFile)
          await Bun.write(configFile, JSON.stringify(configData, null, 2))
        }
        const duration = performance.now() - start

        // Cleanup
        for (const file of files) {
          await fs.unlink(file).catch(() => {})
        }

        console.log(`\n📊 Write config file (${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} writes/sec`)

        expect(duration).toBeLessThan(5000)
      } finally {
        await cleanupTestDir()
      }
    })
  })

  describe("Concurrent Config Operations", () => {
    it("concurrent validation of different configs", async () => {
      const numConfigs = 10
      const validationsPerConfig = 50
      const configs = Array.from({ length: numConfigs }, (_, i) =>
        createValidConfig({ model: `model-${i}`, agent: { build: { temperature: i / 10 } } }),
      )

      const start = performance.now()
      await Promise.all(
        configs.map((config) =>
          Promise.resolve().then(async () => {
            for (let i = 0; i < validationsPerConfig; i++) {
              Config.Info.parse(config)
            }
          }),
        ),
      )
      const duration = performance.now() - start

      const totalValidations = numConfigs * validationsPerConfig

      console.log(`\n📊 Concurrent validation - ${numConfigs} configs, ${totalValidations} total:`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / totalValidations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((totalValidations / duration) * 1000).toLocaleString()} validations/sec`)

      expect(duration).toBeLessThan(5000)
    })

    it("concurrent merge + validation", async () => {
      const numOperations = 20
      const base = createValidConfig()
      const overrides = Array.from({ length: numOperations }, (_, i) => ({
        model: `model-${i}`,
        agent: { build: { temperature: i / 10 } },
      }))

      const start = performance.now()
      await Promise.all(
        overrides.map((override) =>
          Promise.resolve().then(async () => {
            const merged = mergeDeep(base, override)
            Config.Info.parse(merged)
          }),
        ),
      )
      const duration = performance.now() - start

      console.log(`\n📊 Concurrent merge + validate (${numOperations} operations):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per operation: ${(duration / numOperations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((numOperations / duration) * 1000).toLocaleString()} ops/sec`)

      expect(duration).toBeLessThan(5000)
    })
  })

  describe("Real-world Scenario Simulation", () => {
    it("session config initialization", () => {
      const iterations = 100

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        // Simulate what happens during session initialization
        const sessionConfig = mergeDeep(
          createValidConfig({ model: "base-model" }),
          createValidConfig({
            agent: {
              build: {
                prompt: `Session ${i} specific prompt`,
              },
            },
          }),
        )
        Config.Info.parse(sessionConfig)
      }
      const duration = performance.now() - start

      console.log(`\n📊 Session config init simulation (${iterations} sessions):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per session: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} sessions/sec`)

      expect(duration).toBeLessThan(3000)
    })

    it("agent config hot-reload simulation", () => {
      const iterations = 200
      let currentConfig: Record<string, unknown> = createValidConfig()

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        // Simulate config hot-reload
        const newConfig = mergeDeep(currentConfig, {
          agent: {
            build: {
              temperature: (i % 10) / 10,
            },
          },
        })
        const validated = Config.Info.parse(newConfig)
        currentConfig = validated as Record<string, unknown>
      }
      const duration = performance.now() - start

      console.log(`\n📊 Agent config hot-reload (${iterations} reloads):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per reload: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} reloads/sec`)

      expect(duration).toBeLessThan(3000)
    })

    it("permission check in hot path", () => {
      const iterations = 10000
      const config = createValidConfig({
        permission: {
          read: "allow",
          edit: "ask",
          bash: "deny",
        },
      })
      const parsed = Config.Info.parse(config)

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        // Simulate permission check (direct property access)
        const action = ["read", "edit", "bash", "glob", "grep"][i % 5]
        const permission = parsed.permission?.[action as keyof typeof parsed.permission]
        const isAllowed = permission === "allow"
      }
      const duration = performance.now() - start

      console.log(`\n📊 Permission check hot-path (${iterations} checks):`)
      console.log(`   Total time: ${duration.toFixed(2)}ms`)
      console.log(`   Per check: ${(duration / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} checks/sec`)

      expect(duration).toBeLessThan(2000)
    })
  })
})
