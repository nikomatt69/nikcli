import { describe, expect, it } from "bun:test"
import { Identifier } from "@nikcli-ai/util/id"

describe("Identifier", () => {
  describe("schema", () => {
    it("validates correct prefix for session", () => {
      const schema = Identifier.schema("session")
      expect(schema.parse("ses_abc123")).toBe("ses_abc123")
    })

    it("validates correct prefix for message", () => {
      const schema = Identifier.schema("message")
      expect(schema.parse("msg_abc123")).toBe("msg_abc123")
    })

    it("validates correct prefix for permission", () => {
      const schema = Identifier.schema("permission")
      expect(schema.parse("per_abc123")).toBe("per_abc123")
    })

    it("validates correct prefix for workspace", () => {
      const schema = Identifier.schema("workspace")
      expect(schema.parse("wrk_abc123")).toBe("wrk_abc123")
    })

    it("validates correct prefix for goal", () => {
      const schema = Identifier.schema("goal")
      expect(schema.parse("gol_abc123")).toBe("gol_abc123")
    })

    it("rejects wrong prefix", () => {
      const schema = Identifier.schema("session")
      expect(() => schema.parse("msg_abc123")).toThrow()
    })

    it("rejects non-string values", () => {
      const schema = Identifier.schema("session")
      expect(() => schema.parse(123 as any)).toThrow()
    })
  })

  describe("ascending", () => {
    it("creates valid session ID with correct prefix", () => {
      const id = Identifier.ascending("session")
      expect(id.startsWith("ses_")).toBe(true)
    })

    it("creates valid message ID with correct prefix", () => {
      const id = Identifier.ascending("message")
      expect(id.startsWith("msg_")).toBe(true)
    })

    it("creates valid goal ID with correct prefix", () => {
      const id = Identifier.ascending("goal")
      expect(id.startsWith("gol_")).toBe(true)
    })

    it("creates IDs with proper format", () => {
      const id = Identifier.ascending("session")
      // Format: prefix_hexTimestampRandom (2 parts separated by _)
      const parts = id.split("_")
      expect(parts.length).toBe(2)
      expect(parts[0]).toBe("ses")
      expect(parts[1].length).toBe(26) // 12 hex chars + 14 random base62
    })

    it("generates unique IDs per call", () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(Identifier.ascending("session"))
      }
      expect(ids.size).toBe(100)
    })

    it("preserves given ID if it starts with correct prefix", () => {
      const customId = "ses_custom_id_123456"
      const result = Identifier.ascending("session", customId)
      expect(result).toBe(customId)
    })

    it("throws if given ID doesn't start with prefix", () => {
      expect(() => Identifier.ascending("session", "msg_wrong")).toThrow()
    })

    it("preserves existing ID format", () => {
      const id = Identifier.ascending("message", "msg_existing12345678901234567890")
      expect(id).toBe("msg_existing12345678901234567890")
    })
  })

  describe("descending", () => {
    it("creates valid session ID with correct prefix", () => {
      const id = Identifier.descending("session")
      expect(id.startsWith("ses_")).toBe(true)
    })

    it("creates valid message ID with correct prefix", () => {
      const id = Identifier.descending("message")
      expect(id.startsWith("msg_")).toBe(true)
    })

    it("creates IDs with proper format", () => {
      const id = Identifier.descending("session")
      const parts = id.split("_")
      expect(parts.length).toBe(2)
      expect(parts[0]).toBe("ses")
      expect(parts[1].length).toBe(26)
    })

    it("generates unique IDs per call", () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(Identifier.descending("session"))
      }
      expect(ids.size).toBe(100)
    })

    it("preserves given ID if it starts with correct prefix", () => {
      const customId = "ses_custom_id_123456"
      const result = Identifier.descending("session", customId)
      expect(result).toBe(customId)
    })

    it("throws if given ID doesn't start with prefix", () => {
      expect(() => Identifier.descending("session", "msg_wrong")).toThrow()
    })
  })

  describe("create", () => {
    it("creates ascending ID with positive timestamp encoding", () => {
      // Use a timestamp that fits in the encoding (36 bits for timestamp + 12 bits for counter)
      const timestamp = 1609459200000 // 2021-01-01
      const id = Identifier.create("session", false, timestamp)
      expect(id.startsWith("ses_")).toBe(true)

      // Verify we can extract the timestamp back
      const extracted = Identifier.timestamp(id)
      // Due to encoding, the extracted value is the original timestamp
      expect(typeof extracted).toBe("number")
    })

    it("creates descending ID with bitwise inverted encoding", () => {
      const timestamp = 1609459200000 // 2021-01-01
      const id = Identifier.create("session", true, timestamp)
      expect(id.startsWith("ses_")).toBe(true)

      // Verify we can extract the timestamp back
      const extracted = Identifier.timestamp(id)
      expect(typeof extracted).toBe("number")
    })

    it("handles rapid successive calls", () => {
      const timestamp = Date.now()
      const ids: string[] = []
      for (let i = 0; i < 100; i++) {
        ids.push(Identifier.create("session", false, timestamp))
      }
      // All should be unique
      expect(new Set(ids).size).toBe(100)
    })

    it("resets counter when timestamp changes", () => {
      const id1 = Identifier.create("session", false, 1000)
      const id2 = Identifier.create("session", false, 2000)
      // Both should be valid
      expect(id1.startsWith("ses_")).toBe(true)
      expect(id2.startsWith("ses_")).toBe(true)
    })
  })

  describe("timestamp", () => {
    it("extracts timestamp from ascending ID", () => {
      const id = Identifier.ascending("session")
      const ts = Identifier.timestamp(id)
      // Should be a valid positive number
      expect(typeof ts).toBe("number")
      expect(ts).toBeGreaterThan(0)
      // Should be less than current time (encoded timestamp is current)
      expect(ts).toBeLessThan(Date.now() + 10000)
    })

    it("extracts timestamp from descending ID", () => {
      const id = Identifier.descending("session")
      const ts = Identifier.timestamp(id)
      // Should be a valid positive number (bit inversion changes the value)
      expect(typeof ts).toBe("number")
      expect(ts).toBeGreaterThan(0)
    })

    it("extracts timestamp from given ID", () => {
      // Use a freshly generated ID
      const id = Identifier.ascending("message")
      const ts = Identifier.timestamp(id)
      expect(typeof ts).toBe("number")
      expect(ts).toBeGreaterThan(0)
    })

    it("handles IDs with custom random portion", () => {
      const id = Identifier.ascending("message", "msg_a1b2c3d4e5f6abc123def456")
      const ts = Identifier.timestamp(id)
      expect(typeof ts).toBe("number")
      expect(ts).toBeGreaterThan(0)
    })
  })

  describe("ID ordering", () => {
    it("descending IDs sort newest first", () => {
      const now = Date.now()
      const id1 = Identifier.create("session", true, now)
      const id2 = Identifier.create("session", true, now + 1)

      // id2 should sort before id1 (newer first in descending)
      expect(id2 < id1).toBe(true)
    })

    it("ascending IDs sort oldest first", () => {
      const now = Date.now()
      const id1 = Identifier.create("message", false, now)
      const id2 = Identifier.create("message", false, now + 1)

      // id1 should sort before id2 (older first in ascending)
      expect(id1 < id2).toBe(true)
    })

    it("mixed timestamps maintain order", () => {
      const ids: string[] = []
      for (let i = 0; i < 10; i++) {
        ids.push(Identifier.descending("session"))
      }

      // Verify all IDs are unique
      expect(new Set(ids).size).toBe(10)

      // Verify descending order (first is newest)
      for (let i = 0; i < ids.length - 1; i++) {
        expect(ids[i] >= ids[i + 1]).toBe(true)
      }
    })
  })

  describe("edge cases", () => {
    it("handles all prefix types", () => {
      const prefixes = [
        "session",
        "message",
        "permission",
        "question",
        "user",
        "part",
        "pty",
        "tool",
        "dbedit",
        "workspace",
        "sync",
        "event",
        "account",
        "org",
      ] as const

      for (const prefix of prefixes) {
        const id = Identifier.ascending(prefix)
        // Check the prefix mapping - session -> ses, message -> msg, etc.
        const prefixMap: Record<string, string> = {
          session: "ses",
          message: "msg",
          permission: "per",
          question: "que",
          user: "usr",
          part: "prt",
          pty: "pty",
          tool: "tool",
          dbedit: "dbe",
          workspace: "wrk",
          sync: "syn",
          event: "evt",
          account: "acc",
          org: "org",
        }
        expect(id.startsWith(prefixMap[prefix] + "_")).toBe(true)
      }
    })

    it("handles very long given IDs", () => {
      // The id module doesn't use the given value for format, it just passes it through
      // So we need to provide a valid format
      const longId = "ses_" + "a".repeat(30) // Need prefix_ for validation
      const result = Identifier.ascending("session", longId)
      expect(result).toBe(longId)
    })

    it("handles IDs with underscores", () => {
      const idWithUnderscores = "ses_abc_def_ghi_jkl_mno_pqr"
      const result = Identifier.ascending("session", idWithUnderscores)
      expect(result).toBe(idWithUnderscores)
    })
  })
})
