import { Log } from "@nikcli-ai/util/log"
import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { withInstanceAsync, type InstanceContext } from "@/effect"

const log = Log.create({ service: "bootstrap" })

/**
 * Run a CLI command body inside a bootstrapped instance.
 *
 * The body receives the instance. Every command used to reach back into the
 * ambient scope for the directory, worktree or project it was already standing
 * in — which is the same value, arrived at without saying so.
 */
export async function bootstrap<T>(directory: string, cb: (instance: InstanceContext) => Promise<T>): Promise<T> {
  log.debug("Initializing bootstrap", { directory })

  return withInstanceAsync({ directory, init: InstanceBootstrap }, async (instance) => {
    try {
      log.debug("Executing bootstrap callback")
      const result = await cb(instance)
      log.debug("Bootstrap callback completed successfully")
      return result
    } catch (error) {
      log.error("Bootstrap callback failed", { error })
      throw error
    } finally {
      log.debug("Disposing instance")
      await Instance.dispose()
    }
  })
}
