/**
 * Bridge to @nikcli-ai/llm's route-based provider stack.
 *
 * nikcli runs on effect@3.21.2 while @nikcli-ai/llm runs on effect@4.x, so the
 * raw Effect/Layer surface from the route package cannot be wired into nikcli
 * directly. Instead, @nikcli-ai/llm exposes a Promise/AsyncIterable runtime
 * (`@nikcli-ai/llm/runtime`) which provisions `LLMClient.layer` with
 * `RequestExecutor.defaultLayer` internally and exports plain-JS helpers:
 *
 * - `Runtime.prepareRequest(LLMRequest) -> Promise<PreparedRequest>`
 * - `Runtime.streamRequest(LLMRequest) -> AsyncIterable<LLMEvent>`
 *
 * `session/llm.ts` calls `Runtime.prepareRequest(...)` to compile the request
 * through the registered route's body builder + transport prepare. The HTTP
 * dispatch still flows through the AI SDK path (`LLMCore.stream`) until the
 * `processor.ts` consumer is migrated from AI SDK's `fullStream` shape to the
 * `LLMEvent` stream.
 */
