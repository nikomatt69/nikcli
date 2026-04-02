import { describe, expect, it } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"

function createMockSessionID(): string {
  return Identifier.descending("session")
}

function createMockMessageID(): string {
  return Identifier.ascending("message")
}

function createMockPartID(): string {
  return Identifier.ascending("part")
}

function createMockSessionInfo(
  overrides?: Partial<{
    id: string
    slug: string
    projectID: string
    directory: string
    parentID?: string
    workspaceID?: string
    summary?: { additions: number; deletions: number; files: number }
    share?: { url: string }
    github?: {
      owner: string
      repo: string
      fullName: string
      baseBranch: string
      headBranch: string
      worktree: { name: string; branch: string; directory: string }
    }
    title: string
    version: string
    time: { created: number; updated: number; compacting?: number; archived?: number }
    permission?: unknown[]
    skills?: string[]
    revert?: { messageID: string; partID?: string; snapshot?: string; diff?: string }
  }>,
): {
  id: string
  slug: string
  projectID: string
  directory: string
  title: string
  version: string
  time: { created: number; updated: number }
} {
  const now = Date.now()
  return {
    id: createMockSessionID(),
    slug: "benchmark-session",
    projectID: "bench_project",
    directory: "/bench/test/dir",
    title: "Benchmark Session",
    version: "1.0.0",
    time: {
      created: now - 3600000,
      updated: now,
    },
    ...overrides,
  }
}

function createMockTextPart(sessionID: string, messageID: string): MessageV2.TextPart {
  return {
    id: createMockPartID(),
    sessionID,
    messageID,
    type: "text",
    text: "Sample text content for benchmarking",
    synthetic: false,
    time: {
      start: Date.now(),
      end: Date.now() + 100,
    },
  }
}

describe("Session Performance Benchmarks", () => {
  describe("Session.Info Schema Parsing", () => {
    it("should benchmark basic session info object creation", () => {
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const session = createMockSessionInfo()
        expect(session.id).toBeDefined()
        expect(session.slug).toBe("benchmark-session")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Session info object creation basic (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
      console.log(`   Avg per op: ${(elapsed / iterations).toFixed(4)}ms`)
    })

    it("should benchmark session info with optional fields", () => {
      const now = Date.now()
      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const session = createMockSessionInfo({
          parentID: createMockSessionID(),
          workspaceID: "workspace_456",
          summary: {
            additions: 150,
            deletions: 50,
            files: 10,
          },
          github: {
            owner: "testuser",
            repo: "testrepo",
            fullName: "testuser/testrepo",
            baseBranch: "main",
            headBranch: "feature-branch",
            worktree: {
              name: "feature-worktree",
              branch: "feature-branch",
              directory: "/path/to/worktree",
            },
          },
          skills: ["code", "debug", "refactor"],
          time: {
            created: now - 86400000,
            updated: now,
            compacting: now - 3600000,
          },
        })
        expect(session.id).toBeDefined()
        expect(session.slug).toBeDefined()
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Session info with full schema (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark identifier generation for session IDs", () => {
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const id = Identifier.descending("session")
        expect(id).toContain("ses")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Session ID generation (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark identifier ascending generation for message IDs", () => {
      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const id = Identifier.ascending("message")
        expect(id).toContain("msg")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Message ID ascending generation (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })
  })

  describe("Message Append Operations", () => {
    it("should benchmark message info object creation", () => {
      const sessionID = createMockSessionID()
      const iterations = 30000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const msg: MessageV2.User = {
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
        expect(msg.role).toBe("user")
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 MessageV2.User object creation (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark part creation and append", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const iterations = 20000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const part: MessageV2.TextPart = {
          id: Identifier.ascending("part"),
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
        MessageV2.TextPart.parse(part)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Part creation + parse (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark batch part creation", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const batchSizes = [1, 5, 10, 25, 50]

      for (const batchSize of batchSizes) {
        const iterations = 2000

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const parts: MessageV2.Part[] = []
          for (let j = 0; j < batchSize; j++) {
            parts.push({
              id: Identifier.ascending("part"),
              sessionID,
              messageID,
              type: "text",
              text: `Part ${j} content`,
              synthetic: false,
              time: {
                start: Date.now(),
                end: Date.now() + 50,
              },
            })
          }
          MessageV2.Part.array().parse(parts)
        }
        const elapsed = performance.now() - start
        const opsPerSecond = Math.round((iterations / elapsed) * 1000)
        const partsPerSecond = opsPerSecond * batchSize

        console.log(`\n📊 Batch create ${batchSize} parts (${iterations} batches):`)
        console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
        console.log(`   Batch ops/s: ${opsPerSecond.toLocaleString()}`)
        console.log(`   Parts/s: ${partsPerSecond.toLocaleString()}`)
      }
    })

    it("should benchmark message serialization for storage", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const msg: MessageV2.WithParts = {
        info: {
          id: messageID,
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
        },
        parts: [
          {
            id: createMockPartID(),
            sessionID,
            messageID,
            type: "text",
            text: "Sample text",
            time: { start: Date.now() },
          },
        ],
      }
      const iterations = 20000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const serialized = JSON.stringify(msg)
        expect(serialized.length).toBeGreaterThan(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Message serialization for storage (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })
  })

  describe("Token Calculations", () => {
    it("should benchmark token object construction", () => {
      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const tokens = {
          total: 1500,
          input: 500,
          output: 1000,
          reasoning: 0,
          cache: {
            read: 0,
            write: 0,
          },
        }
        expect(tokens.total).toBeDefined()
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Token object construction (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark message token extraction from parsed message", () => {
      const sessionID = createMockSessionID()
      const msg: MessageV2.Assistant = {
        id: createMockMessageID(),
        sessionID,
        role: "assistant",
        time: {
          created: Date.now(),
          completed: Date.now() + 2000,
        },
        parentID: createMockMessageID(),
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
            read: 100,
            write: 50,
          },
        },
      }
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const parsed = MessageV2.Assistant.parse(msg)
        const tokenData = parsed.tokens
        const total = tokenData.input + tokenData.output + tokenData.cache.read + tokenData.cache.write
        expect(total).toBeGreaterThanOrEqual(0)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 Token extraction from parsed message (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })
  })

  describe("WithParts Creation", () => {
    it("should benchmark WithParts object creation", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const iterations = 20000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const withParts: MessageV2.WithParts = {
          info: {
            id: messageID,
            sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "test-agent",
            model: { providerID: "openai", modelID: "gpt-4" },
          },
          parts: [createMockTextPart(sessionID, messageID)],
        }
        expect(withParts.info).toBeDefined()
        expect(withParts.parts.length).toBe(1)
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations / elapsed) * 1000)

      console.log(`\n📊 WithParts object creation (${iterations} iterations):`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Ops/second: ${opsPerSecond.toLocaleString()}`)
    })

    it("should benchmark WithParts with many parts", () => {
      const sessionID = createMockSessionID()
      const messageID = createMockMessageID()
      const partCounts = [1, 5, 10, 50, 100]

      for (const count of partCounts) {
        const withParts: MessageV2.WithParts = {
          info: {
            id: messageID,
            sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "test-agent",
            model: { providerID: "openai", modelID: "gpt-4" },
          },
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
})
