import { describe, expect, it } from "bun:test"
import { Schema } from "effect"
import { MessageV2 } from "@/session/message-v2"

/**
 * `MessageV2.Part` is derived from `MessageV2.PartSchema` by the Effect→zod
 * walker (`packages/util/src/effect-zod.ts`), and `PATCH /session/:id/message/
 * :id/part/:id` runs a body through **both**: the endpoint decodes it with the
 * Effect payload schema, then `httpapi/session.ts` calls `MessageV2.Part.parse`
 * on the decoded value before handing it to the service.
 *
 * So the wire behaviour of that endpoint depends on an invariant nobody had
 * checked: whatever the Effect schema accepts, the derived zod must accept too.
 * A gap there is not a 400 — the request already passed the contract — it is a
 * **500**, because the zod throw arrives as a defect. ROADMAP recorded the
 * concern in E9's wake and left it open with "no divergence in the tree today
 * to pin a test on"; this is that test.
 */

const base = { id: "prt_1", sessionID: "ses_1", messageID: "msg_1" } as const
const tokens = { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } as const
const apiError = {
  name: "APIError",
  data: { message: "upstream said no", isRetryable: true },
} as const

/**
 * One sample per member of `PartSchema`, plus the shapes most likely to fall
 * through a translation gap: an optional key present, a `Schema.Record` with a
 * mixed value type, a record holding `undefined`, a checked integer, and an
 * extra key the `strip` annotation is supposed to drop.
 */
const samples: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["text", { ...base, type: "text", text: "hi" }],
  ["text with an extra key", { ...base, type: "text", text: "hi", surprise: 1 }],
  ["step-start", { ...base, type: "step-start" }],
  ["step-finish", { ...base, type: "step-finish", reason: "stop", cost: 0.01, tokens }],
  [
    "step-finish with the optional total",
    { ...base, type: "step-finish", reason: "stop", cost: 1, tokens: { ...tokens, total: 3 } },
  ],
  ["snapshot", { ...base, type: "snapshot", snapshot: "snap" }],
  ["patch", { ...base, type: "patch", hash: "h", files: ["a.ts"] }],
  ["compaction", { ...base, type: "compaction", auto: true }],
  ["reasoning", { ...base, type: "reasoning", text: "why", time: { start: 1 } }],
  [
    "reasoning with a mixed metadata record",
    { ...base, type: "reasoning", text: "why", time: { start: 1, end: 2 }, metadata: { a: 1, b: "x", c: null } },
  ],
  [
    "reasoning whose metadata holds undefined",
    { ...base, type: "reasoning", text: "why", time: { start: 1 }, metadata: { a: undefined } },
  ],
  ["file", { ...base, type: "file", mime: "text/plain", url: "file:///a.txt" }],
  [
    "file with the optional filename",
    { ...base, type: "file", mime: "text/plain", url: "file:///a.txt", filename: "a.txt" },
  ],
  ["agent", { ...base, type: "agent", name: "build" }],
  [
    "agent with a checked-integer source",
    { ...base, type: "agent", name: "build", source: { value: "v", start: 0, end: 3 } },
  ],
  ["subtask", { ...base, type: "subtask", prompt: "p", description: "d", agent: "build" }],
  [
    "subtask with a model",
    {
      ...base,
      type: "subtask",
      prompt: "p",
      description: "d",
      agent: "build",
      model: { providerID: "x", modelID: "y" },
    },
  ],
  ["retry", { ...base, type: "retry", attempt: 1, error: apiError, time: { created: 1 } }],
  [
    "tool pending",
    {
      ...base,
      type: "tool",
      callID: "call_1",
      tool: "read",
      state: { status: "pending", input: { path: "a.ts" }, raw: "{}" },
    },
  ],
  [
    "tool running with progress content",
    {
      ...base,
      type: "tool",
      callID: "call_2",
      tool: "bash",
      state: {
        status: "running",
        input: { command: "ls" },
        title: "ls",
        content: [{ type: "text", text: "listing" }],
        time: { start: 1 },
      },
    },
  ],
  [
    "tool completed with an attachment",
    {
      ...base,
      type: "tool",
      callID: "call_3",
      tool: "read",
      state: {
        status: "completed",
        input: { path: "a.ts" },
        output: "contents",
        title: "a.ts",
        metadata: { lines: 3 },
        time: { start: 1, end: 2 },
        attachments: [{ ...base, id: "prt_att", type: "file", mime: "text/plain", url: "file:///a.txt" }],
      },
    },
  ],
  [
    "tool error",
    {
      ...base,
      type: "tool",
      callID: "call_4",
      tool: "bash",
      state: { status: "error", input: { command: "nope" }, error: "exit 127", time: { start: 1, end: 2 } },
    },
  ],
]

/** The union's own member list, read from its AST rather than restated here. */
function unionMemberTypes(): string[] {
  const ast = (MessageV2.PartSchema as unknown as { ast: { types: ReadonlyArray<Record<string, any>> } }).ast
  return ast.types.map((member) => {
    const property = (member["propertySignatures"] as ReadonlyArray<any>).find((p) => p.name === "type")
    return String(property.type.literal)
  })
}

describe("MessageV2.Part — the Effect schema and its derived zod agree", () => {
  it("covers every member of the union", () => {
    // Read the expected set out of the schema, not out of a list beside the
    // samples: a hand-written list would agree with the samples by
    // construction and would have hidden that `tool` was missing.
    const declared = unionMemberTypes()
    expect(declared.length).toBe(12)
    const covered = new Set(samples.map(([, value]) => value["type"]))
    expect(declared.filter((type) => !covered.has(type))).toEqual([])
  })

  for (const [label, value] of samples) {
    it(`accepts ${label} on both sides`, () => {
      // Decode first, exactly as the endpoint does: zod never sees the raw
      // body, only what the Effect payload schema produced.
      const decoded = Schema.decodeUnknownSync(MessageV2.PartSchema)(value)
      expect(() => MessageV2.Part.parse(decoded)).not.toThrow()
    })
  }

  it("still rejects a body neither side should accept", () => {
    // A guard on the guard: if the samples above passed because the schemas
    // had stopped checking anything, this would pass too.
    expect(() => Schema.decodeUnknownSync(MessageV2.PartSchema)({ ...base, type: "text" })).toThrow()
    expect(() => MessageV2.Part.parse({ ...base, type: "text" })).toThrow()
  })
})
