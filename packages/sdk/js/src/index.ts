export * from "./client.js"
export * from "./server.js"

import { createNikcliClient } from "./client.js"
import { createNikcliServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createNikcli(options?: ServerOptions) {
  const server = await createNikcliServer({
    ...options,
  })

  const client = createNikcliClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
