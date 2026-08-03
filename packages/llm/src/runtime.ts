import { Layer, ManagedRuntime, Stream } from "effect"
import { LLMClient, Service as LLMClientService } from "./route/client"
import { RequestExecutor } from "./route/executor"
import type { LLMEvent, LLMRequest, PreparedRequest } from "./schema"
import type { StreamOptions } from "./route/client"

const llmLayer = Layer.provide(LLMClient.layer, RequestExecutor.defaultLayer)

type Runtime = ManagedRuntime.ManagedRuntime<LLMClientService, never>
let _runtime: Runtime | undefined
const getRuntime = (): Runtime => {
  if (!_runtime) _runtime = ManagedRuntime.make(llmLayer)
  return _runtime
}

export const prepareRequest = (request: LLMRequest): Promise<PreparedRequest> =>
  getRuntime().runPromise(LLMClient.prepare(request))

export const streamRequest = (request: LLMRequest, options?: StreamOptions): AsyncIterable<LLMEvent> => {
  const provided = LLMClient.stream(request, options).pipe(Stream.provide(llmLayer))
  return Stream.toAsyncIterable(provided)
}

export const dispose = async (): Promise<void> => {
  if (_runtime) {
    await _runtime.dispose()
    _runtime = undefined
  }
}
