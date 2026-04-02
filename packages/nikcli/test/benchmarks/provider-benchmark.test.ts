import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { randomBytes } from "crypto"
import { mkdirSync, rmSync } from "fs"
import { join } from "path"
import { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"

const tempDir = join("/tmp", `nikcli-provider-bench-${randomBytes(8).toString("hex")}`)

describe("Provider Performance Benchmark", () => {
  beforeAll(async () => {
    mkdirSync(tempDir, { recursive: true })
    await Instance.provide({
      directory: tempDir,
      fn: () => {},
    })
  })

  afterAll(async () => {
    await Instance.disposeAll()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("Provider.get() retrieval", () => {
    it("should benchmark single provider retrieval", async () => {
      const iterations = 10000

      // Warm up the state
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          await Provider.list()
          await Provider.list()
          await Provider.list()
        },
      })

      const start = performance.now()
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          for (let i = 0; i < iterations; i++) {
            await Provider.getProvider("openai")
          }
        },
      })
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Provider.getProvider() - Single retrieval:`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per call: ${(time / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(5000)
    })

    it("should benchmark multiple provider retrievals", async () => {
      const iterations = 5000
      const testProviderIDs = [
        "openai",
        "anthropic",
        "google",
        "github-copilot",
        "openrouter",
        "groq",
        "mistral",
        "cerebras",
        "xai",
        "deepinfra",
      ]

      // Warm up
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          await Provider.list()
          await Provider.list()
        },
      })

      const start = performance.now()
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          for (let i = 0; i < iterations; i++) {
            for (const providerID of testProviderIDs) {
              await Provider.getProvider(providerID)
            }
          }
        },
      })
      const time = performance.now() - start

      const totalOps = iterations * testProviderIDs.length
      const opsPerSecond = Math.round((totalOps / time) * 1000)
      console.log(`\n📊 Provider.getProvider() - Multiple retrievals:`)
      console.log(`   ${totalOps} total operations (${iterations} x ${testProviderIDs.length} providers)`)
      console.log(`   Total time: ${time.toFixed(2)}ms`)
      console.log(`   Average per call: ${(time / totalOps).toFixed(4)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(10000)
    })

    it("should benchmark Provider.list() with caching", async () => {
      const iterations = 10000

      // First call initializes state
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          await Provider.list()
        },
      })

      const start = performance.now()
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          for (let i = 0; i < iterations; i++) {
            await Provider.list()
          }
        },
      })
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Provider.list() - Cached retrieval:`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per call: ${(time / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(2000)
    })
  })

  describe("Model filtering by capabilities", () => {
    it("should benchmark filtering models by toolcall capability", async () => {
      const iterations = 5000

      let allModels: Provider.Model[] = []
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          const providers = await Provider.list()
          for (const provider of Object.values(providers)) {
            allModels.push(...Object.values(provider.models))
          }
        },
      })

      // Filter toolcall-capable models
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        allModels.filter((m) => m.capabilities.toolcall)
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      const toolcallModels = allModels.filter((m) => m.capabilities.toolcall).length
      console.log(`\n📊 Filter by toolcall capability:`)
      console.log(`   Total models in database: ${allModels.length}`)
      console.log(`   Toolcall-capable models: ${toolcallModels}`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per filter: ${(time / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(3000)
    })

    it("should benchmark filtering models by multimodal input", async () => {
      const iterations = 5000

      let allModels: Provider.Model[] = []
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          const providers = await Provider.list()
          for (const provider of Object.values(providers)) {
            allModels.push(...Object.values(provider.models))
          }
        },
      })

      // Filter image input capable models
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        allModels.filter((m) => m.capabilities.input.image)
      }
      const time = performance.now() - start

      const imageCapable = allModels.filter((m) => m.capabilities.input.image).length
      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Filter by image input capability:`)
      console.log(`   Total models: ${allModels.length}`)
      console.log(`   Image-capable models: ${imageCapable}`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per filter: ${(time / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(3000)
    })

    it("should benchmark filtering models by reasoning capability", async () => {
      const iterations = 5000

      let allModels: Provider.Model[] = []
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          const providers = await Provider.list()
          for (const provider of Object.values(providers)) {
            allModels.push(...Object.values(provider.models))
          }
        },
      })

      // Filter reasoning capable models
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        allModels.filter((m) => m.capabilities.reasoning)
      }
      const time = performance.now() - start

      const reasoningCapable = allModels.filter((m) => m.capabilities.reasoning).length
      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Filter by reasoning capability:`)
      console.log(`   Total models: ${allModels.length}`)
      console.log(`   Reasoning-capable models: ${reasoningCapable}`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per filter: ${(time / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(3000)
    })

    it("should benchmark combined capability filtering", async () => {
      const iterations = 3000

      let allModels: Provider.Model[] = []
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          const providers = await Provider.list()
          for (const provider of Object.values(providers)) {
            allModels.push(...Object.values(provider.models))
          }
        },
      })

      // Complex filter: toolcall + image input + text output
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        allModels.filter((m) => m.capabilities.toolcall && m.capabilities.input.image && m.capabilities.output.text)
      }
      const time = performance.now() - start

      const filtered = allModels.filter(
        (m) => m.capabilities.toolcall && m.capabilities.input.image && m.capabilities.output.text,
      ).length
      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Combined capability filtering (toolcall + image input + text output):`)
      console.log(`   Total models: ${allModels.length}`)
      console.log(`   Matching models: ${filtered}`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per filter: ${(time / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(5000)
    })
  })

  describe("Provider SDK instantiation overhead", () => {
    it("should benchmark SDK cache lookup", async () => {
      const iterations = 10000

      // Get a model and warm up the SDK cache
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          const model = await Provider.getModel("openai", "gpt-4o")
          await Provider.getLanguage(model)
        },
      })

      const start = performance.now()
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          for (let i = 0; i < iterations; i++) {
            const model = await Provider.getModel("openai", "gpt-4o")
            await Provider.getLanguage(model)
          }
        },
      })
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 SDK cache lookup (cached provider):`)
      console.log(`   Model: openai/gpt-4o`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per call: ${(time / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(2000)
    })
  })

  describe("Provider sorting", () => {
    it("should benchmark model sorting", async () => {
      const iterations = 2000

      let allModels: Provider.Model[] = []
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          const providers = await Provider.list()
          for (const provider of Object.values(providers)) {
            allModels.push(...Object.values(provider.models))
          }
        },
      })

      // Sort models
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Provider.sort([...allModels])
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Provider.sort() - Model sorting:`)
      console.log(`   Total models: ${allModels.length}`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per sort: ${(time / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(5000)
    })
  })

  describe("Provider state initialization", () => {
    it("should measure initial Provider.list() state build time", async () => {
      const start = performance.now()
      let providers: Record<string, unknown> = {}
      await Instance.provide({
        directory: tempDir,
        fn: async () => {
          providers = await Provider.list()
        },
      })
      const buildTime = performance.now() - start

      const providerCount = Object.keys(providers).length
      let modelCount = 0
      for (const provider of Object.values(providers)) {
        const p = provider as { models?: Record<string, unknown> }
        modelCount += Object.keys(p.models ?? {}).length
      }

      console.log(`\n📊 Provider state initialization:`)
      console.log(`   Providers loaded: ${providerCount}`)
      console.log(`   Total models: ${modelCount}`)
      console.log(`   Build time: ${buildTime.toFixed(2)}ms`)
      console.log(`   Models per second: ${Math.round((modelCount / buildTime) * 1000).toLocaleString()}`)

      expect(buildTime).toBeLessThan(30000)
      expect(providerCount).toBeGreaterThan(0)
    })
  })
})
