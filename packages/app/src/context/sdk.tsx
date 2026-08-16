import { createNikcliClient, type Event, type NikcliClient } from "@nikcli-ai/sdk/httpapi"
import { createSimpleContext } from "@nikcli-ai/ui/context"
import { createGlobalEmitter, type GlobalEmitter } from "@solid-primitives/event-bus"
import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js"
import { useGlobalSDK } from "./global-sdk"
import { usePlatform } from "./platform"

export interface SDK {
  readonly directory: string
  readonly client: NikcliClient
  readonly event: GlobalEmitter<{
    [key in Event["type"]]: Extract<Event, { type: key }>
  }>
  readonly url: string
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext<
  SDK,
  {
    directory: Accessor<string>
  }
>({
  name: "SDK",
  init: (props) => {
    const platform = usePlatform()
    const globalSDK = useGlobalSDK()

    const directory = createMemo(props.directory)
    const client = createMemo(() =>
      createNikcliClient({
        baseUrl: globalSDK.url,
        fetch: platform.fetch,
        directory: directory(),
        throwOnError: true,
      }),
    )

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    createEffect(() => {
      const unsub = globalSDK.event.on(directory(), (event) => {
        emitter.emit(event.type, event)
      })
      onCleanup(unsub)
    })

    return {
      get directory() {
        return directory()
      },
      get client() {
        return client()
      },
      event: emitter,
      get url() {
        return globalSDK.url
      },
    } satisfies SDK
  },
})
