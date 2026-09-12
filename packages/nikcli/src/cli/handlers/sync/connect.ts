import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { withInstanceAsync } from "@/effect"
import { RemoteSync } from "@/sync/remote-sync"
import { SyncConfig } from "@/sync/sync-config"
import { readRemote, runSyncConnect } from "./shared"

export default Runtime.handler(Commands.commands["sync"].commands["connect"], async (_input) => {
  
  await runSyncConnect({
    readRemote,
    withInstance: withInstanceAsync,
    getProjectId: (instance) => instance.project.id,
    remoteStart: (opts) =>
      RemoteSync.start({
        ...opts,
        resolveToken: SyncConfig.refreshToken,
      }),
    onSignal: (signal, handler) => process.once(signal, handler),
    offSignal: (signal, handler) => process.off(signal, handler),
  })
})
