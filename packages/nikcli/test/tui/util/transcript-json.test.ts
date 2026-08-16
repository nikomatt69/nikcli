import { describe, expect, it } from "bun:test"
import {
  formatTranscriptJson,
  type MessageWithParts,
  type SessionInfo,
  type TranscriptOptions,
} from "@tui/util/transcript"

const session: SessionInfo = {
  id: "ses_abc",
  title: "Export me",
  time: { created: 1_000, updated: 2_000 },
}

const all: TranscriptOptions = { thinking: true, toolDetails: true, assistantMetadata: true }

/** Minimal message/part shapes; the formatter only reads these fields. */
const messages = [
  {
    info: { id: "msg_1", role: "user", sessionID: "ses_abc" },
    parts: [
      { id: "prt_1", type: "text", text: "hello" },
      { id: "prt_2", type: "text", text: "injected", synthetic: true },
    ],
  },
  {
    info: {
      id: "msg_2",
      role: "assistant",
      sessionID: "ses_abc",
      agent: "build",
      modelID: "claude-opus-5",
      providerID: "anthropic",
      time: { created: 1_100, completed: 3_600 },
    },
    parts: [
      { id: "prt_3", type: "reasoning", text: "secret chain of thought" },
      {
        id: "prt_4",
        type: "tool",
        tool: "read",
        state: { status: "completed", input: { filePath: "/etc/hosts" }, output: "127.0.0.1 localhost" },
      },
      { id: "prt_5", type: "text", text: "done" },
    ],
  },
] as unknown as MessageWithParts[]

const parse = (options: TranscriptOptions) => JSON.parse(formatTranscriptJson(session, messages, options))

describe("formatTranscriptJson", () => {
  it("emits the session envelope and keeps messages in order", () => {
    const doc = parse(all)
    expect(doc.session).toEqual(session)
    expect(doc.messages.map((message: any) => message.info.id)).toEqual(["msg_1", "msg_2"])
  })

  it("drops synthetic text the markdown transcript also hides", () => {
    const doc = parse(all)
    expect(doc.messages[0].parts.map((part: any) => part.id)).toEqual(["prt_1"])
  })

  it("omits reasoning when thinking is off", () => {
    const doc = parse({ ...all, thinking: false })
    expect(doc.messages[1].parts.some((part: any) => part.type === "reasoning")).toBe(false)
    expect(doc.messages[1].parts.some((part: any) => part.type === "tool")).toBe(true)
  })

  it("keeps the tool call but never its input or output when details are off", () => {
    const doc = parse({ ...all, toolDetails: false })
    const tool = doc.messages[1].parts.find((part: any) => part.type === "tool")
    expect(tool).toEqual({ type: "tool", tool: "read", state: { status: "completed" } })
    expect(formatTranscriptJson(session, messages, { ...all, toolDetails: false })).not.toContain("127.0.0.1")
  })

  it("strips assistant provenance when metadata is off, leaving user messages intact", () => {
    const doc = parse({ ...all, assistantMetadata: false })
    expect(doc.messages[1].info.agent).toBeUndefined()
    expect(doc.messages[1].info.modelID).toBeUndefined()
    expect(doc.messages[1].info.providerID).toBeUndefined()
    expect(doc.messages[1].info.id).toBe("msg_2")
    expect(doc.messages[0].info.role).toBe("user")
  })

  it("keeps assistant provenance when metadata is on", () => {
    const doc = parse(all)
    expect(doc.messages[1].info.agent).toBe("build")
    expect(doc.messages[1].info.modelID).toBe("claude-opus-5")
  })

  it("ends with a newline so the file concatenates cleanly", () => {
    expect(formatTranscriptJson(session, messages, all).endsWith("\n")).toBe(true)
  })
})
