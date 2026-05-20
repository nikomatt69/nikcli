// @nikcli-ai/inference - Multi-provider AI inference gateway

export * from "./types"
export * from "./providers"
export {
  PROVIDER_DEFS,
  OpenAICompatProvider,
  type ProviderName,
  type ProviderDefinition,
} from "./providers/openai-compat"
export { getRegistry, resetRegistryForTests, type RegisteredProvider } from "./providers/registry"
export {
  Router,
  getRouter,
  resetRouterForTests,
  RouterError,
  type RouteSelection,
  type RouterChatResult,
  type RouterOptions,
} from "./providers/router"
export { CachedProvider, UpstreamError } from "./providers/cached"
export type { CachedChatOptions, CachedChatResult } from "./providers/cached"

export { ROUTES, getRoutesForModel, blendedCost, type ProviderRoute } from "./config/routing"
export { loadEnv, resetEnvForTests, type Env } from "./config/env"
export { CircuitBreaker, type CircuitState, type CircuitConfig } from "./health/circuit"

export { hashKey, isDeterministic } from "./cache/hash"
export { getCacheStore, resetCacheStoreForTests, type CacheStore, type CachedEntry } from "./cache/store"
export { Coalescer } from "./cache/coalesce"

export * from "./middleware"
export { default as app } from "./server"
