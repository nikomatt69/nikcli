export * as NikCli from "./generated/client.js"
export * from "./client.js"
export * from "../server.js"
export { NikCli as client } from "./generated/index.js"

import { createNikcliClient } from "./client.js"
import { createNikcliServer, type ServerOptions } from "../server.js"

/** Starts a local `nikcli serve` and returns a client bound to it. */
export async function createNikcli(options?: ServerOptions) {
  const server = await createNikcliServer(options)
  return {
    client: createNikcliClient({ baseUrl: server.url }),
    server,
  }
}
