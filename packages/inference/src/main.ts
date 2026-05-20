import app from "./server"
import { loadEnv } from "./config/env"
import { getLogger } from "./middleware/logger"
import { getRegistry } from "./providers/registry"

const env = loadEnv()
const log = getLogger()

const server = Bun.serve({
  port: env.PORT,
  hostname: env.HOST,
  fetch: app.fetch,
  error(error: Error) {
    log.error("server.fatal", { message: error.message, stack: error.stack })
    return new Response("internal server error", { status: 500 })
  },
})

const registry = getRegistry()
log.info("server.start", {
  port: env.PORT,
  host: env.HOST,
  nodeEnv: env.NODE_ENV,
  providers: registry.list().map((p) => ({ name: p.name, enabled: p.enabled })),
})

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  log.info("server.shutdown", { signal })
  server.stop(true)
  setTimeout(() => process.exit(0), 250)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
