import { expect, test } from "bun:test"
import { SimulationProtocol } from "../src/protocol"

test("decodes deterministic frontend and backend requests", () => {
  expect(
    SimulationProtocol.Frontend.decodeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ui.matches",
      params: { text: "nikcli ready" },
    }),
  ).toMatchObject({ method: "ui.matches", params: { text: "nikcli ready" } })

  expect(
    SimulationProtocol.Backend.decodeRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "llm.finish",
      params: { id: "ex_1" },
    }),
  ).toMatchObject({ method: "llm.finish", params: { id: "ex_1", reason: "stop" } })
})

test("rejects regex-shaped ui.matches params instead of interpreting them", () => {
  expect(() =>
    SimulationProtocol.Frontend.decodeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ui.matches",
      params: { pattern: "nikcli.*" },
    }),
  ).toThrow()
})
