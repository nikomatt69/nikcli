import { describe, expect, it } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"
import { Storage } from "../../src/storage/storage"

function createMockSessionID(): string {
  return Identifier.descending("session")
}

function createMockMessageID(): string {
  return Identifier.ascending("message")
}

function createMockPartID(): string {
  return Identifier.ascending("part")
}

function createMockTextPart(sessionID: string, messageID: string): MessageV2.TextPart {
  return {
    id: createMockPartID(),
    sessionID,
    messageID,
    type: "text",
    text: "This is a sample text part for benchmarking purposes. It contains some content to test performance.",
    synthetic: false,
    time: {
      start: Date.now(),
      end: Date.now() + 100,
    },
    metadata: {
      source: "benchmark",
      index: Math.floor(Math.random() * 1000),
    },
  }
}

function createMockToolPart(sessionID: string, messageID: string): MessageV2.ToolPart {
  return {
    id: createMockPartID(),
    sessionID,
    messageID,
    type: "tool",
    callID: Identifier.ascending("tool"),
    tool: "Read",
    state: {
      status: "completed",
      input: { filePath: "/path/to/file.ts" },
      output: "File content here...",
      title: "Read file",
      metadata: { linesRead: 150 },
      time: {
        start: Date.now() - 500,
        end: Date.now(),
      },
    },
  }
}

function createMockFilePart(sessionID: string, messageID: string): MessageV2.FilePart {
  return {
    id: createMockPartID(),
    sessionID,
    messageID,
    type: "file",
    mime: "text/typescript",
    filename: "example.ts",
    url: "file:///path/to/example.ts",
    source: {
      type: "file",
      path: "/path/to/example.ts",
      text: {
        value: "const x = 1;",
        start: 0,
        end: 11,
      },
    },
  }
}

function createMockUserMessage(sessionID: string): MessageV2.User {
  return {
    id: createMockMessageID(),
    sessionID,
    role: "user",
    time: {
      created: Date.now(),
    },
    format: { type: "text" },
    agent: "test-agent",
    model: {
      providerID: "openai",
      modelID: "gpt-4",
    },
  }
}

function createMockAssistantMessage(sessionID: string, parentID: string): MessageV2.Assistant {
  return {
    id: createMockMessageID(),
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

function createLargeTextContent(sizeKB: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890 !@#$%^&*()_+-=[]{}|;':\",./<>?"
  let result = ""
  const targetLength = sizeKB * 1024
  while (result.length < targetLength) {
    result += chars.repeat(10)
  }
  return result.slice(0, targetLength)
}

describe("MessageV2 Performance Benchmarks", () => {
  describe("MessageV2.Info.parse() Speed", () => {
    it("should benchmark user message parsing", () => {
      const sessionID = createMockSessionID()
      const userMsg = createMockUserMessage(sessionID)
      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const parsed = MessageV2.User.parse(userMsg)
        expect(parsed.role).toBe("user")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 MessageV2.User.parse() (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
      console.log(`   Avg per op: ${(elapsed / iterations).toFixed(4)}ms`)
    })

    it("should benchmark assistant message parsing", () => {
      const sessionID = createMockSessionID()
      const parentID = createMockMessageID()
      const assistantMsg = createMockAssistantMessage(sessionID, parentID)
      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const parsed = MessageV2.Assistant.parse(assistantMsg)
        expect(parsed.role).toBe("assistant")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 MessageV2.Assistant.parse() (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
      console.log(`   Avg per op: ${(elapsed / iterations).toFixed(4)}ms`)
    })

    it("should benchmark discriminated union parsing", () => {
      const sessionID = createMockSessionID()
      const parentID = createMockMessageID()
      const userMsg = createMockUserMessage(sessionID)
      const assistantMsg = createMockAssistantMessage(sessionID, parentID)
      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const parsed = MessageV2.Info.parse(i % 2 === 0 ? userMsg : assistantMsg)
        expect(["user", "assistant"]).toContain(parsed.role)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 MessageV2.Info.parse() discriminated union (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
      console.log(`   Avg per op: ${(elapsed / iterations).toFixed(4)}ms`)
    })

    it("should benchmark safeParse vs parse performance", () => {
      const sessionID = createMockSessionID()
      const validMsg = createMockUserMessage(sessionID)
      const iterations = 50000

      const startParse = performance.now()
      for (let i = 0; i < iterations; i++) {
        MessageV2.User.parse(validMsg)
      }
      const parseTime = performance.now() - startParse

      const startSafeParse = performance.now()
      for (let i = 0; i < iterations; i++) {
        MessageV2.User.safeParse(validMsg)
      }
      const safeParseTime = performance.now() - startSafeParse

      console.log(`\n📊 parse() vs safeParse() (${iterations} iterations):`)
      console.log(
        `   parse():     ${parseTime.toFixed(2)}ms (${Math.round((iterations / parseTime) * 1000).toLocaleString()} ops/s)`,
      )
      console.log(
        `   safeParse(): ${safeParseTime.toFixed(2)}ms (${Math.round((iterations / safeParseTime) * 1000).toLocaleString()} ops/s)`,
      )
      console.log(`   Ratio: ${(safeParseTime / parseTime).toFixed(2)}x`)
    })
  })

  describe("Part Creation Performance", () => {
    it("should benchmark TextPart creation", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const part: MessageV2.TextPart = {
          id: createMockPartID(),
          sessionID,
          messageID,
          type: "text",
          text: `Text content ${i}`,
          synthetic: i % 2 === 0,
          time: {
            start: Date.now(),
            end: Date.now() + 50,
          },
        }
        const parsed = MessageV2.TextPart.parse(part)
        expect(parsed.type).toBe("text")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 TextPart creation + parse (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark ToolPart creation", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const iterations = 20000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const part: MessageV2.ToolPart = {
          id: createMockPartID(),
          sessionID,
          messageID,
          type: "tool",
          callID: Identifier.ascending("tool"),
          tool: i % 2 === 0 ? "Read" : "Write",
          state: {
            status: "completed",
            input: { filePath: "/path/to/file.ts", line: i },
            output: "Success",
            title: "Tool execution",
            metadata: { attempt: i },
            time: {
              start: Date.now() - 100,
              end: Date.now(),
            },
          },
        }
        const parsed = MessageV2.ToolPart.parse(part)
        expect(parsed.type).toBe("tool")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 ToolPart creation + parse (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark FilePart creation", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const part: MessageV2.FilePart = {
          id: createMockPartID(),
          sessionID,
          messageID,
          type: "file",
          mime: "text/typescript",
          filename: `file_${i}.ts`,
          url: `file:///path/to/file_${i}.ts`,
          source: {
            type: "file",
            path: `/path/to/file_${i}.ts`,
            text: {
              value: "const x = 1;",
              start: 0,
              end: 11,
            },
          },
        }
        const parsed = MessageV2.FilePart.parse(part)
        expect(parsed.type).toBe("file")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 FilePart creation + parse (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark Part discriminated union parsing", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const iterations = 30000

      const parts: MessageV2.Part[] = []
      for (let i = 0; i < 5; i++) {
        parts.push(createMockTextPart(sessionID, messageID))
        parts.push(createMockToolPart(sessionID, messageID))
        parts.push(createMockFilePart(sessionID, messageID))
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const part = parts[i % parts.length]
        const parsed = MessageV2.Part.parse(part)
        expect(parsed.type).toBeDefined()
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Part discriminated union parse (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })
  })

  describe("Message Serialization", () => {
    it("should benchmark JSON.stringify for user messages", () => {
      const sessionID = createMockSessionID()
      const msg = createMockUserMessage(sessionID)
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const json = JSON.stringify(msg)
        expect(json.length).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)
      const mbPerSecond = (iterations * jsonByteSize(msg)) / (elapsed / 1000) / (1024 * 1024)

      console.log(`\n📊 User message JSON.stringify (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
      console.log(`   Throughput: ${mbPerSecond.toFixed(2)} MB/s`)
    })

    it("should benchmark JSON.stringify for messages with parts", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const msg: MessageV2.WithParts = {
        info: createMockUserMessage(sessionID),
        parts: Array.from({ length: 10 }, () => createMockTextPart(sessionID, messageID)),
      }
      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const json = JSON.stringify(msg)
        expect(json.length).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Message with 10 parts JSON.stringify (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
      console.log(`   Avg message size: ${(JSON.stringify(msg).length / 1024).toFixed(2)} KB`)
    })

    it("should benchmark large text content serialization", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const sizes = [1, 10, 100] // KB

      for (const sizeKB of sizes) {
        const largeText = createLargeTextContent(sizeKB)
        const msg: MessageV2.TextPart = {
          id: createMockPartID(),
          sessionID,
          messageID,
          type: "text",
          text: largeText,
        }
        const iterations = 5000

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const json = JSON.stringify(msg)
          expect(json.length).toBeGreaterThan(0)
        }
        const elapsed = performance.now() - start
        const opsPerSecond = Math.round((iterations / elapsed) * 1000)
        const mbPerSecond = (iterations * sizeKB) / (elapsed / 1000) / 1024

        console.log(`\n📊 Large text (${sizeKB}KB) serialization (${iterations} iterations):`)
        console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
        console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
        console.log(`   Throughput: ${mbPerSecond.toFixed(2)} MB/s`)
      }
    })

    it("should benchmark JSON.parse performance", () => {
      const sessionID = createMockSessionID()
      const msg = createMockUserMessage(sessionID)
      const json = JSON.stringify(msg)
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const parsed = JSON.parse(json)
        expect(parsed.role).toBe("user")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 JSON.parse (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })
  })

  describe("WithParts Schema", () => {
    it("should benchmark WithParts parsing", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const withParts: MessageV2.WithParts = {
        info: createMockUserMessage(sessionID),
        parts: [
          createMockTextPart(sessionID, messageID),
          createMockToolPart(sessionID, messageID),
          createMockFilePart(sessionID, messageID),
        ],
      }
      const iterations = 20000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const parsed = MessageV2.WithParts.parse(withParts)
        expect(parsed.info).toBeDefined()
        expect(parsed.parts.length).toBe(3)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 MessageV2.WithParts.parse() (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark WithParts with many parts", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const partCounts = [1, 5, 10, 50, 100]

      for (const count of partCounts) {
        const withParts: MessageV2.WithParts = {
          info: createMockUserMessage(sessionID),
          parts: Array.from({ length: count }, (_, i) => ({
            ...createMockTextPart(sessionID, messageID),
            text: `Part ${i} content`,
          })),
        }
        const iterations = 5000

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const parsed = MessageV2.WithParts.parse(withParts)
          expect(parsed.parts.length).toBe(count)
        }
        const elapsed = performance.now() - start
        const opsPerSecond = Math.round((iterations / elapsed) * 1000)

        console.log(`\n📊 WithParts with ${count} parts parse (${iterations} iterations):`)
        console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
        console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
      }
    })
  })

  describe("OutputFormat Parsing", () => {
    it("should benchmark OutputFormatText parsing", () => {
      const format = { type: "text" as const }
      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const parsed = MessageV2.OutputFormatText.parse(format)
        expect(parsed.type).toBe("text")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 OutputFormatText.parse() (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark OutputFormatJsonSchema parsing", () => {
      const format = {
        type: "json_schema" as const,
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
        },
        retryCount: 3,
      }
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const parsed = MessageV2.OutputFormatJsonSchema.parse(format)
        expect(parsed.type).toBe("json_schema")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 OutputFormatJsonSchema.parse() (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark Format discriminated union parsing", () => {
      const formats = [
        { type: "text" as const },
        {
          type: "json_schema" as const,
          schema: { type: "object" },
          retryCount: 2,
        },
      ]
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const parsed = MessageV2.Format.parse(formats[i % formats.length])
        expect(parsed.type).toBeDefined()
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Format discriminated union parse (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })
  })
})

function jsonByteSize(obj: unknown): number {
  return new Blob([JSON.stringify(obj)]).size
}
