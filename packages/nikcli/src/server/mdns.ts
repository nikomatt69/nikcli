import { Log } from "@/util/log"
import { Bonjour } from "bonjour-service"

const log = Log.create({ service: "mdns" })

export namespace MDNS {
  let bonjour: Bonjour | undefined
  let currentPort: number | undefined

  export function publish(port: number): void {
    if (currentPort === port) return
    if (bonjour) unpublish()

    try {
      const name = `nikcli-${port}`
      bonjour = new Bonjour()
      const service = bonjour.publish({
        name,
        type: "http",
        host: "nikcli.local",
        port,
        txt: { path: "/" },
      })

      service.on("up", () => {
        log.info("mDNS service published", { name, port })
      })

      service.on("error", (err: unknown) => {
        log.error("mDNS service error", { error: err instanceof Error ? err.message : String(err) })
      })

      currentPort = port
    } catch (err) {
      log.error("mDNS publish failed", { error: err instanceof Error ? err.message : String(err) })
      if (bonjour) {
        try {
          bonjour.destroy()
        } catch (destroyErr) {
          log.warn("mDNS destroy after publish failure", {
            error: destroyErr instanceof Error ? destroyErr.message : String(destroyErr),
          })
        }
      }
      bonjour = undefined
      currentPort = undefined
    }
  }

  export function unpublish(): void {
    if (bonjour) {
      try {
        bonjour.unpublishAll()
        bonjour.destroy()
      } catch (err) {
        log.error("mDNS unpublish failed", { error: err instanceof Error ? err.message : String(err) })
      }
      bonjour = undefined
      currentPort = undefined
      log.info("mDNS service unpublished")
    }
  }
}
