import { Log } from "@/util/log"
import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"

const log = Log.create({ service: "bootstrap" })

export async function bootstrap<T>(directory: string, cb: () => Promise<T>): Promise<T> {
  log.debug("Initializing bootstrap", { directory })

  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      try {
        log.debug("Executing bootstrap callback")
        const result = await cb()
        log.debug("Bootstrap callback completed successfully")
        return result
      } catch (error) {
        log.error("Bootstrap callback failed", { error })
        throw error
      } finally {
        log.debug("Disposing instance")
        await Instance.dispose()
      }
    },
  })
}
