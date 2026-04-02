import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { randomBytes } from "crypto"
import { mkdirSync, rmSync } from "fs"
import { join } from "path"
import { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"

const tempDir = join("/tmp", `nikcli-model-bench-${randomBytes(8).toString("hex")}`)

describe("Model Performance Benchmark", () => {
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
  describe("Model.Info schema parsing", () => {
    it("should benchmark Zod schema parsing for valid model", async () => {
      const iterations = 50000

      const validModel = {
        id: "gpt-4o",
        providerID: "openai",
        api: {
          id: "gpt-4o",
          url: "https://api.openai.com/v1",
          npm: "@ai-sdk/openai",
        },
        name: "GPT-4o",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, audio: false, image: true, video: false, pdf: false },
          interleaved: false,
        },
        cost: {
          input: 5,
          output: 15,
          cache: { read: 1.25, write: 3.75 },
        },
        limit: {
          context: 128000,
          input: 128000,
          output: 16384,
        },
        status: "active" as const,
        options: {},
        headers: {},
        release_date: "2024-05-13",
        variants: {},
      }

      const start = performance.now()
      let parsedCount = 0
      for (let i = 0; i < iterations; i++) {
        const result = Provider.Model.safeParse(validModel)
        if (result.success) parsedCount++
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Zod schema parse (valid model):`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per parse: ${(time / iterations).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      console.log(`   Success rate: ${((parsedCount / iterations) * 100).toFixed(1)}%`)

      expect(parsedCount).toBe(iterations)
      expect(time).toBeLessThan(10000)
    })

    it("should benchmark Zod schema parsing for complex model", async () => {
      const iterations = 20000

      const complexModel = {
        id: "claude-sonnet-4-5",
        providerID: "anthropic",
        api: {
          id: "claude-sonnet-4-5",
          url: "https://api.anthropic.com/v1",
          npm: "@ai-sdk/anthropic",
        },
        name: "Claude Sonnet 4.5",
        family: "claude",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: { field: "reasoning_content" as const },
        },
        cost: {
          input: 3,
          output: 15,
          cache: { read: 0.3, write: 3.75 },
          experimentalOver200K: {
            input: 3.75,
            output: 18.75,
            cache: { read: 0.36, write: 4.5 },
          },
        },
        limit: {
          context: 200000,
          input: 200000,
          output: 8192,
        },
        status: "active" as const,
        options: { thinking: { type: "enabled", budgetTokens: 10000 } },
        headers: { "anthropic-beta": "interleaved-thinking-2025-05-14" },
        release_date: "2025-02-24",
        variants: {
          "extended-thinking": { thinking: { type: "enabled", budgetTokens: 32000 } },
          default: {},
        },
      }

      const start = performance.now()
      let parsedCount = 0
      for (let i = 0; i < iterations; i++) {
        const result = Provider.Model.safeParse(complexModel)
        if (result.success) parsedCount++
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Zod schema parse (complex model with nested objects):`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per parse: ${(time / iterations).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(parsedCount).toBe(iterations)
      expect(time).toBeLessThan(10000)
    })

    it("should benchmark failed schema parsing (invalid data)", async () => {
      const iterations = 10000

      const invalidModel = {
        id: "test",
        providerID: "openai",
        // Missing required fields
        api: { id: "test" },
        // Invalid capabilities structure
        capabilities: { temperature: "yes" }, // should be boolean
        // Invalid cost
        cost: { input: "free", output: 10 },
        limit: { context: "big" },
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Provider.Model.safeParse(invalidModel)
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Zod schema parse (invalid model - rejection path):`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per parse: ${(time / iterations).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(10000)
    })
  })

  describe("Cost calculation", () => {
    it("should benchmark cost calculation for basic usage", async () => {
      const iterations = 100000

      const model = {
        cost: {
          input: 5,
          output: 15,
          cache: { read: 1.25, write: 3.75 },
        },
      }

      const inputTokens = 1000
      const outputTokens = 500
      const cacheReadTokens = 2000
      const cacheWriteTokens = 100

      const start = performance.now()
      let totalCost = 0
      for (let i = 0; i < iterations; i++) {
        const cost =
          (inputTokens * model.cost.input) / 1_000_000 +
          (outputTokens * model.cost.output) / 1_000_000 +
          (cacheReadTokens * model.cost.cache.read) / 1_000_000 +
          (cacheWriteTokens * model.cost.cache.write) / 1_000_000
        totalCost += cost
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Cost calculation (basic usage):`)
      console.log(`   Input: ${inputTokens} tokens @ $${model.cost.input}/M`)
      console.log(`   Output: ${outputTokens} tokens @ $${model.cost.output}/M`)
      console.log(`   Cache read: ${cacheReadTokens} tokens @ $${model.cost.cache.read}/M`)
      console.log(`   Cache write: ${cacheWriteTokens} tokens @ $${model.cost.cache.write}/M`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per calculation: ${(time / iterations).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(2000)
    })

    it("should benchmark cost calculation for experimental over-200k context", async () => {
      const iterations = 50000

      const model = {
        cost: {
          input: 5,
          output: 15,
          cache: { read: 1.25, write: 3.75 },
          experimentalOver200K: {
            input: 3.75,
            output: 18.75,
            cache: { read: 0.36, write: 4.5 },
          },
        },
      }

      const inputTokens = 250000
      const outputTokens = 10000

      const start = performance.now()
      let totalCost = 0
      for (let i = 0; i < iterations; i++) {
        const isOver200K = inputTokens > 200000
        const baseCost = model.cost.experimentalOver200K ?? model.cost
        const cost = (inputTokens * baseCost.input) / 1_000_000 + (outputTokens * baseCost.output) / 1_000_000
        totalCost += cost
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Cost calculation (over-200K context with conditional pricing):`)
      console.log(`   Input: ${inputTokens} tokens`)
      console.log(`   Output: ${outputTokens} tokens`)
      console.log(`   Using experimental pricing: true`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per calculation: ${(time / iterations).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(3000)
    })

    it("should benchmark batch cost calculation for multiple prompts", async () => {
      const iterations = 5000
      const prompts = 100

      const model = {
        cost: {
          input: 5,
          output: 15,
          cache: { read: 1.25, write: 3.75 },
        },
      }

      const promptCosts = Array.from({ length: prompts }, (_, i) => ({
        input: 500 + i * 10,
        output: 200 + i * 5,
        cacheRead: 1000 + i * 20,
      }))

      const start = performance.now()
      let totalCost = 0
      for (let i = 0; i < iterations; i++) {
        let batchCost = 0
        for (const prompt of promptCosts) {
          batchCost +=
            (prompt.input * model.cost.input) / 1_000_000 +
            (prompt.output * model.cost.output) / 1_000_000 +
            (prompt.cacheRead * model.cost.cache.read) / 1_000_000
        }
        totalCost += batchCost
      }
      const time = performance.now() - start

      const totalOps = iterations * prompts
      const opsPerSecond = Math.round((totalOps / time) * 1000)
      console.log(`\n📊 Batch cost calculation (${prompts} prompts per batch):`)
      console.log(`   Total operations: ${totalOps} (${iterations} batches x ${prompts} prompts)`)
      console.log(`   Total time: ${time.toFixed(2)}ms`)
      console.log(`   Average per prompt: ${((time / totalOps) * 1000).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} prompts/sec`)

      expect(time).toBeLessThan(5000)
    })
  })

  describe("Token limit checks", () => {
    it("should benchmark context limit validation", async () => {
      const iterations = 100000

      const model = {
        limit: {
          context: 128000,
          input: 128000,
          output: 16384,
        },
      }

      const testInputs = [
        { tokens: 5000, expected: true },
        { tokens: 100000, expected: true },
        { tokens: 150000, expected: false },
        { tokens: 128000, expected: true },
      ]

      const start = performance.now()
      let checksPerformed = 0
      for (let i = 0; i < iterations; i++) {
        for (const input of testInputs) {
          const isValid = input.tokens <= model.limit.context
          checksPerformed++
        }
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((checksPerformed / time) * 1000)
      console.log(`\n📊 Context limit validation:`)
      console.log(`   ${checksPerformed} total checks`)
      console.log(`   Total time: ${time.toFixed(2)}ms`)
      console.log(`   Average per check: ${((time / checksPerformed) * 1000).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} checks/sec`)

      expect(time).toBeLessThan(2000)
    })

    it("should benchmark output limit validation", async () => {
      const iterations = 100000

      const model = {
        limit: {
          output: 16384,
        },
      }

      const testOutputs = [
        { tokens: 1000, expected: true },
        { tokens: 16000, expected: true },
        { tokens: 20000, expected: false },
        { tokens: 16384, expected: true },
      ]

      const start = performance.now()
      let checksPerformed = 0
      for (let i = 0; i < iterations; i++) {
        for (const output of testOutputs) {
          const isValid = output.tokens <= model.limit.output
          checksPerformed++
        }
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((checksPerformed / time) * 1000)
      console.log(`\n📊 Output limit validation:`)
      console.log(`   ${checksPerformed} total checks`)
      console.log(`   Total time: ${time.toFixed(2)}ms`)
      console.log(`   Average per check: ${((time / checksPerformed) * 1000).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} checks/sec`)

      expect(time).toBeLessThan(2000)
    })

    it("should benchmark combined limit validation (context + output)", async () => {
      const iterations = 50000

      const model = {
        limit: {
          context: 128000,
          input: 128000,
          output: 16384,
        },
      }

      const testCases = [
        { context: 100000, output: 5000 },
        { context: 128000, output: 16384 },
        { context: 150000, output: 5000 },
        { context: 100000, output: 20000 },
      ]

      const start = performance.now()
      let checksPerformed = 0
      for (let i = 0; i < iterations; i++) {
        for (const testCase of testCases) {
          const isValid = testCase.context <= model.limit.context && testCase.output <= model.limit.output
          checksPerformed++
        }
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((checksPerformed / time) * 1000)
      console.log(`\n📊 Combined limit validation (context + output):`)
      console.log(`   ${checksPerformed} total checks`)
      console.log(`   Total time: ${time.toFixed(2)}ms`)
      console.log(`   Average per check: ${((time / checksPerformed) * 1000).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} checks/sec`)

      expect(time).toBeLessThan(3000)
    })

    it("should benchmark limit checks across all models", async () => {
      const iterations = 10000
      const providers = await Provider.list()
      const allModels: Array<{ id: string; limit: { context: number; output: number } }> = []

      for (const provider of Object.values(providers)) {
        for (const model of Object.values(provider.models)) {
          allModels.push({ id: model.id, limit: model.limit })
        }
      }

      const testInput = 50000

      const start = performance.now()
      let validCount = 0
      for (let i = 0; i < iterations; i++) {
        for (const model of allModels) {
          if (testInput <= model.limit.context) {
            validCount++
          }
        }
      }
      const time = performance.now() - start

      const totalOps = iterations * allModels.length
      const opsPerSecond = Math.round((totalOps / time) * 1000)
      const validModels = allModels.filter((m) => testInput <= m.limit.context).length

      console.log(`\n📊 Limit checks across all models:`)
      console.log(`   Total models: ${allModels.length}`)
      console.log(`   Models supporting ${testInput} token input: ${validModels}`)
      console.log(`   ${totalOps} total operations`)
      console.log(`   Total time: ${time.toFixed(2)}ms`)
      console.log(`   Average per check: ${((time / totalOps) * 1000).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} checks/sec`)

      expect(time).toBeLessThan(5000)
    })
  })

  describe("Model capability checks", () => {
    it("should benchmark single capability check", async () => {
      const iterations = 100000

      const model = {
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
      }

      const start = performance.now()
      let checksPassed = 0
      for (let i = 0; i < iterations; i++) {
        if (model.capabilities.toolcall) checksPassed++
        if (model.capabilities.reasoning) checksPassed++
        if (model.capabilities.attachment) checksPassed++
      }
      const time = performance.now() - start

      const totalChecks = iterations * 3
      const opsPerSecond = Math.round((totalChecks / time) * 1000)
      console.log(`\n📊 Single capability checks (toolcall, reasoning, attachment):`)
      console.log(`   ${totalChecks} total checks`)
      console.log(`   Total time: ${time.toFixed(2)}ms`)
      console.log(`   Average per check: ${((time / totalChecks) * 1000).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} checks/sec`)

      expect(time).toBeLessThan(2000)
    })

    it("should benchmark multimodal capability check", async () => {
      const iterations = 50000

      const model = {
        capabilities: {
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, audio: false, image: true, video: false, pdf: false },
        },
      }

      const start = performance.now()
      let checksPassed = 0
      for (let i = 0; i < iterations; i++) {
        const canHandleInput =
          model.capabilities.input.text ||
          model.capabilities.input.image ||
          model.capabilities.input.audio ||
          model.capabilities.input.video ||
          model.capabilities.input.pdf
        if (canHandleInput) checksPassed++
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Multimodal input capability check:`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per check: ${((time / iterations) * 1000).toFixed(6)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} checks/sec`)

      expect(time).toBeLessThan(2000)
    })

    it("should benchmark capability matching for model selection", async () => {
      const iterations = 2000
      const providers = await Provider.list()
      const allModels: Provider.Model[] = []

      for (const provider of Object.values(providers)) {
        allModels.push(...Object.values(provider.models))
      }

      const requiredCapabilities = {
        toolcall: true,
        input: { image: true, text: true },
        output: { text: true },
      }

      const start = performance.now()
      let matchCount = 0
      for (let i = 0; i < iterations; i++) {
        const matches = allModels.filter(
          (m) =>
            m.capabilities.toolcall === requiredCapabilities.toolcall &&
            m.capabilities.input.image === requiredCapabilities.input.image &&
            m.capabilities.input.text === requiredCapabilities.input.text &&
            m.capabilities.output.text === requiredCapabilities.output.text,
        )
        matchCount += matches.length
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Capability matching for model selection:`)
      console.log(`   Total models: ${allModels.length}`)
      console.log(`   Required: toolcall=true, image+text input, text output`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Average per match: ${(time / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} matches/sec`)

      expect(time).toBeLessThan(5000)
    })
  })

  describe("Model data access patterns", () => {
    it("should benchmark direct property access vs destructuring", async () => {
      const iterations = 100000

      const model = {
        id: "gpt-4o",
        providerID: "openai",
        name: "GPT-4o",
        cost: { input: 5, output: 15, cache: { read: 1.25, write: 3.75 } },
        limit: { context: 128000, output: 16384 },
        capabilities: {
          temperature: true,
          reasoning: false,
          toolcall: true,
          input: { text: true, image: true },
          output: { text: true },
        },
      }

      // Direct property access
      const startDirect = performance.now()
      for (let i = 0; i < iterations; i++) {
        const _ = model.id + model.cost.input + model.limit.context + model.capabilities.toolcall
      }
      const directTime = performance.now() - startDirect

      // Destructuring
      const startDestructure = performance.now()
      for (let i = 0; i < iterations; i++) {
        const { id, cost, limit, capabilities } = model
        const _ = id + cost.input + limit.context + capabilities.toolcall
      }
      const destructureTime = performance.now() - startDestructure

      console.log(`\n📊 Property access patterns:`)
      console.log(`   Direct access: ${directTime.toFixed(2)}ms`)
      console.log(`   Destructuring: ${destructureTime.toFixed(2)}ms`)
      console.log(
        `   Difference: ${directTime < destructureTime ? "direct is" : "destructuring is"} ${Math.abs(directTime - destructureTime).toFixed(2)}ms faster`,
      )

      expect(directTime).toBeLessThan(2000)
      expect(destructureTime).toBeLessThan(2000)
    })

    it("should benchmark model info retrieval and access", async () => {
      const iterations = 10000

      const start = performance.now()
      let accessCount = 0
      for (let i = 0; i < iterations; i++) {
        const model = await Provider.getModel("openai", "gpt-4o").catch(
          async () => await Provider.getModel("openai", "gpt-4o"),
        )
        if (model) {
          const _ = model.id + model.cost.input + model.limit.context + model.capabilities.toolcall
          accessCount++
        }
      }
      const time = performance.now() - start

      const opsPerSecond = Math.round((iterations / time) * 1000)
      console.log(`\n📊 Model info retrieval and property access:`)
      console.log(`   ${iterations} iterations: ${time.toFixed(2)}ms`)
      console.log(`   Successful accesses: ${accessCount}`)
      console.log(`   Average per retrieval: ${(time / iterations).toFixed(4)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)

      expect(time).toBeLessThan(5000)
    })
  })
})
