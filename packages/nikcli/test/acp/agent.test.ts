import { describe, expect, test } from "bun:test"
import { ACP } from "@/acp/agent"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"

function makeSdkStub(): any {
  return {
    permission: { reply: async () => ({}) },
    session: { create: async () => ({ data: { id: "test-session" } }) },
    global: { event: async () => ({ stream: (async function* () {})() }) },
    config: { providers: async () => ({ data: { providers: [] } }) },
    app: { agents: async () => ({ data: [] }) },
    command: { list: async () => ({ data: [] }) },
    mcp: { add: async () => ({}) },
  }
}

async function runOnce(payload: string): Promise<unknown[]> {
  let received = ""
  const stdout = new WritableStream<Uint8Array>({
    write(chunk) {
      received += new TextDecoder().decode(chunk)
      return Promise.resolve()
    },
  })
  const stdin = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      controller.close()
    },
  })
  const stream = ndJsonStream(stdout, stdin)

  const factory = await ACP.init({ sdk: makeSdkStub() })
  new AgentSideConnection((conn) => factory.create(conn, { sdk: makeSdkStub() }), stream)
  await new Promise((resolve) => setTimeout(resolve, 500))

  return received
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

describe("acp/agent integration", () => {
  test("initialize handshake returns the expected capabilities", async () => {
    const messages = await runOnce(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "smoke", version: "0.1.0" },
        },
      }) + "\n",
    )
    const parsed = messages.find((msg: any) => msg.id === 1) as any
    expect(parsed).toBeDefined()
    expect(parsed.result.protocolVersion).toBe(1)
    expect(parsed.result.agentCapabilities.loadSession).toBe(true)
    expect(parsed.result.agentCapabilities.mcpCapabilities).toEqual({
      http: true,
      sse: true,
    })
    expect(parsed.result.agentCapabilities.promptCapabilities).toEqual({
      embeddedContext: true,
      image: true,
    })
    expect(parsed.result.agentCapabilities.sessionCapabilities).toEqual({
      close: {},
      fork: {},
      list: {},
      resume: {},
    })
    expect(parsed.result.authMethods[0].id).toBe("nikcli-login")
    expect(parsed.result.agentInfo.name).toBe("Nikcli")
  })

  test("unknown auth method is rejected as an invalid params error", async () => {
    const messages = await runOnce(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "authenticate",
        params: { methodId: "unknown" },
      }) + "\n",
    )
    const responseLine = messages.find((msg: any) => msg.id === 2) as any
    expect(responseLine).toBeDefined()
    expect(responseLine.error?.code).toBe(-32602)
  })
})
