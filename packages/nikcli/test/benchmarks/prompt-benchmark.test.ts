import { describe, expect, it } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"

function createMockSessionID(): string {
  return Identifier.descending("session")
}

function createMockUserMessage(sessionID: string): MessageV2.User {
  return {
    id: Identifier.ascending("message"),
    sessionID,
    role: "user",
    time: {
      created: Date.now(),
    },
    agent: "test-agent",
    model: {
      providerID: "openai",
      modelID: "gpt-4",
    },
  }
}

function createMockAssistantMessage(sessionID: string, parentID: string): MessageV2.Assistant {
  return {
    id: Identifier.ascending("message"),
    sessionID,
    role: "assistant",
    time: {
      created: Date.now(),
      completed: Date.now() + 2000,
    },
    parentID,
    modelID: "gpt-4",
    providerID: "openai",
    mode: "test-agent",
    agent: "test-agent",
    path: {
      cwd: "/test/cwd",
      root: "/test/root",
    },
    cost: 0.05,
    tokens: {
      total: 1500,
      input: 500,
      output: 1000,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  }
}

function createMockTextPart(sessionID: string, messageID: string, text: string): MessageV2.TextPart {
  return {
    id: Identifier.ascending("part"),
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: false,
    time: {
      start: Date.now(),
      end: Date.now() + 100,
    },
  }
}

function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token for English text
  return Math.ceil(text.length / 4)
}

function estimateTokensFromWords(text: string): number {
  // Alternative: ~0.75 tokens per word
  const words = text.split(/\s+/).length
  return Math.ceil(words * 0.75)
}

function estimateTokensFromChars(text: string): number {
  // Character-based estimation with special handling
  let count = 0
  for (const char of text) {
    if (char === " " || char === "\n" || char === "\t") {
      count += 0.5
    } else if (/[a-zA-Z0-9]/.test(char)) {
      count += 1
    } else {
      count += 2
    }
  }
  return Math.ceil(count / 4)
}

describe("Prompt Performance Benchmarks", () => {
  describe("Token Counting for Prompts", () => {
    it("should benchmark token estimation with char-based method", () => {
      const samples = [
        "Short text",
        "Medium length text with some content for testing purposes.",
        "This is a much longer piece of text that contains multiple sentences and paragraphs. It should help us understand how token estimation performs with varying input lengths. The quick brown fox jumps over the lazy dog.",
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
      ]
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const sample = samples[i % samples.length]
        const tokens = estimateTokens(sample)
        expect(tokens).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Token estimation (char-based) (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark token estimation with word-based method", () => {
      const samples = [
        "Short text",
        "Medium length text with some content for testing purposes.",
        "This is a much longer piece of text that contains multiple sentences and paragraphs. It should help us understand how token estimation performs with varying input lengths. The quick brown fox jumps over the lazy dog.",
      ]
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const sample = samples[i % samples.length]
        const tokens = estimateTokensFromWords(sample)
        expect(tokens).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Token estimation (word-based) (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark token estimation with detailed char analysis", () => {
      const samples = [
        "Short text",
        "Medium length text with some content for testing purposes.",
        "Code: const x = 1; function foo() { return x + 2; }",
        "Mixed: English text with numbers 12345 and symbols @#$%",
      ]
      const iterations = 30000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const sample = samples[i % samples.length]
        const tokens = estimateTokensFromChars(sample)
        expect(tokens).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Token estimation (detailed char analysis) (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should compare different token estimation methods", () => {
      const testText =
        "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet and is commonly used for testing purposes. Let's add some more content here to make it a bit longer and more realistic for benchmarking token estimation algorithms."

      const iterations = 20000

      const startChar = performance.now()
      for (let i = 0; i < iterations; i++) {
        estimateTokens(testText)
      }
      const charTime = performance.now() - startChar

      const startWord = performance.now()
      for (let i = 0; i < iterations; i++) {
        estimateTokensFromWords(testText)
      }
      const wordTime = performance.now() - startWord

      const startDetailed = performance.now()
      for (let i = 0; i < iterations; i++) {
        estimateTokensFromChars(testText)
      }
      const detailedTime = performance.now() - startDetailed

      console.log(`\n📊 Token estimation comparison (${iterations} iterations):`)
      console.log(`   Char-based (simple):  ${charTime.toFixed(2)}ms`)
      console.log(`   Word-based:           ${wordTime.toFixed(2)}ms`)
      console.log(`   Detailed char:        ${detailedTime.toFixed(2)}ms`)
      console.log(
        `   Results: char=${estimateTokens(testText)}, word=${estimateTokensFromWords(testText)}, detailed=${estimateTokensFromChars(testText)}`,
      )
    })

    it("should benchmark token counting for large prompts", () => {
      const largePrompt = "The quick brown fox jumps over the lazy dog. ".repeat(1000)
      const iterations = 5000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const tokens = estimateTokens(largePrompt)
        expect(tokens).toBeGreaterThan(1000)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)
      const charsPerSecond = (iterations * largePrompt.length) / (elapsed / 1000) / 1024

      console.log(
        `\n📊 Large prompt token counting (${iterations} iterations, ${(largePrompt.length / 1024).toFixed(1)}KB):`,
      )
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
      console.log(`   Throughput: ${charsPerSecond.toFixed(0)} KB/s`)
    })
  })

  describe("Prompt Template Parsing", () => {
    it("should benchmark simple template variable substitution", () => {
      const iterations = 50000
      const template = "Hello, {name}! You have {count} messages."
      const variables = { name: "Alice", count: "5" }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        let result = template
        for (const [key, value] of Object.entries(variables)) {
          result = result.replace(`{${key}}`, value)
        }
        expect(result).toContain("Alice")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Template variable substitution (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark template with multiple replacements", () => {
      const iterations = 20000
      const template = `
        System: {system_prompt}
        User: {user_message}
        Model: {model_id}
        Provider: {provider_id}
        Time: {timestamp}
        Session: {session_id}
      `.trim()
      const variables = {
        system_prompt: "You are helpful",
        user_message: "Hello world",
        model_id: "gpt-4",
        provider_id: "openai",
        timestamp: new Date().toISOString(),
        session_id: "session_123",
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        let result = template
        for (const [key, value] of Object.entries(variables)) {
          result = result.replace(`{${key}}`, value)
        }
        expect(result.length).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Multi-variable template (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark template parsing with regex", () => {
      const iterations = 30000
      const template = "Hello, {name}! Your score is {score}."
      const variables = { name: "Bob", score: "42" }
      const regex = /\{(\w+)\}/g

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const result = template.replace(regex, (match, key) => variables[key as keyof typeof variables] ?? match)
        expect(result).toContain("Bob")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Template with regex replacement (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark environment info string generation", () => {
      const iterations = 50000
      const mockEnv = {
        cwd: "/test/working/directory",
        isGitRepo: true,
        platform: "darwin",
        date: "Thu Apr 02 2026",
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const envBlock = [
          `Here is some useful information about the environment you are running in:`,
          `<env>`,
          `  Working directory: ${mockEnv.cwd}`,
          `  Is directory a git repo: ${mockEnv.isGitRepo ? "yes" : "no"}`,
          `  Platform: ${mockEnv.platform}`,
          `  Today's date: ${mockEnv.date}`,
          `</env>`,
          `<files>`,
          `</files>`,
        ].join("\n")
        expect(envBlock).toContain("<env>")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Environment info string generation (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark concatenated prompt assembly", () => {
      const iterations = 10000
      const parts = [
        "System prompt section 1 with detailed instructions...",
        "System prompt section 2 with more content...",
        "System prompt section 3 with additional rules...",
        "System prompt section 4 with final guidelines...",
      ]

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const assembled = parts.join("\n\n")
        expect(assembled.length).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Prompt assembly (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark complex prompt composition", () => {
      const iterations = 5000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const prompt = [
          "# Instructions",
          "You are a helpful coding assistant.",
          "",
          "## Guidelines",
          "1. Always write clean code",
          "2. Follow best practices",
          "3. Include tests",
          "",
          "## Constraints",
          "- Maximum 100 lines per function",
          "- Use TypeScript",
          "- No TODO comments",
          "",
          "## Output Format",
          "Provide code with explanations.",
        ].join("\n")
        expect(prompt.length).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Complex prompt composition (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
      console.log(`   Avg prompt size: ${Math.round((elapsed / iterations) * 1000)} chars`)
    })
  })

  describe("Prompt Processing for Messages", () => {
    it("should benchmark message history tokenization", () => {
      const sessionID = Identifier.descending("session")
      const parentID = Identifier.ascending("message")
      const iterations = 5000
      const messageCount = 10

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const messages: MessageV2.WithParts[] = []
        for (let j = 0; j < messageCount; j++) {
          const msgId = Identifier.ascending("message")
          const msg: MessageV2.WithParts = {
            info: j % 2 === 0 ? createMockUserMessage(sessionID) : createMockAssistantMessage(sessionID, parentID),
            parts: [
              createMockTextPart(
                sessionID,
                msgId,
                `This is message ${j} with some content for testing token counting.`,
              ),
            ],
          }
          messages.push(msg)
        }

        let totalTokens = 0
        for (const msg of messages) {
          for (const part of msg.parts) {
            if (part.type === "text") {
              totalTokens += estimateTokens(part.text)
            }
          }
          totalTokens += 10 // Overhead per message
        }
        expect(totalTokens).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Message history tokenization (${iterations} x ${messageCount} msgs):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Batch ops/s: ${opsPerSecond.toLocaleString()}`)
      console.log(`   Messages/s: ${(opsPerSecond * messageCount).toLocaleString()}`)
    })

    it("should benchmark system prompt + context assembly", () => {
      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const systemParts = [
          "# System Instructions",
          "You are a helpful coding assistant.",
          "## Guidelines",
          "- Write clean code",
          "- Follow best practices",
        ]
        const contextParts = [
          "## Current Context",
          `Working directory: /project/src`,
          `Current file: main.ts`,
          `Lines modified: 42`,
        ]
        const fullPrompt = [...systemParts, "", ...contextParts].join("\n")
        expect(fullPrompt.length).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 System + context prompt assembly (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark skills prompt insertion", () => {
      const iterations = 10000
      const skillNames = ["code", "debug", "refactor", "test", "review"]

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const skills = skillNames.slice(0, (i % skillNames.length) + 1)
        const skillBlock = [
          "<active_skills>",
          "The user explicitly loaded the following skills earlier in this session.",
          "Use them as reference and follow them when they help with the current request.",
          ...skills.map(
            (name) => `
## Skill: ${name}
**Slash command**: /${name}
This is a ${name} skill with some instructions.
`,
          ),
          "</active_skills>",
        ].join("\n")
        expect(skillBlock).toContain("<active_skills>")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Skills prompt insertion (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })
  })

  describe("Prompt Validation", () => {
    it("should benchmark Format schema validation", () => {
      const formats = [
        { type: "text" as const },
        { type: "json_schema", schema: { type: "object" }, retryCount: 2 },
        { type: "text" as const },
      ]
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const parsed = MessageV2.Format.parse(formats[i % formats.length])
        expect(parsed.type).toBeDefined()
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Format schema validation (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark MessageV2.Info schema validation for prompts", () => {
      const sessionID = Identifier.descending("session")
      const messages = [
        createMockUserMessage(sessionID),
        createMockAssistantMessage(sessionID, Identifier.ascending("message")),
      ]
      const iterations = 30000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const msg = messages[i % messages.length]
        const parsed = MessageV2.Info.parse(msg)
        expect(parsed.role).toBeDefined()
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 MessageV2.Info validation for prompts (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })
  })

  describe("Large Scale Prompt Operations", () => {
    it("should benchmark prompt concatenation with many sections", () => {
      const iterations = 2000
      const sectionCount = 50

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const sections: string[] = []
        for (let j = 0; j < sectionCount; j++) {
          sections.push(`## Section ${j}\nThis is section content number ${j}.\n`)
        }
        const fullPrompt = sections.join("\n---\n")
        expect(fullPrompt.length).toBeGreaterThan(1000)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Large prompt concatenation (${iterations} x ${sectionCount} sections):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark streaming token counting", () => {
      const iterations = 10000
      const chunkSize = 100
      const totalSize = 10000
      const chunk = "x".repeat(chunkSize)

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        let totalTokens = 0
        for (let j = 0; j < totalSize / chunkSize; j++) {
          totalTokens += estimateTokens(chunk)
        }
        expect(totalTokens).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const charsPerSecond = (iterations * totalSize) / (elapsed / 1000) / 1024

      console.log(`\n📊 Streaming token counting (${iterations} iterations of ${totalSize} chars):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${charsPerSecond.toFixed(0)} KB/s`)
    })
  })
})
