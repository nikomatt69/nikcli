import { OpenApi } from "effect/unstable/httpapi"
import { PublicApi, PublicHttpApi } from "./public"

const methods = ["get", "post", "put", "delete", "patch"] as const

export type PublicRoute = {
  readonly method: string
  readonly path: string
  readonly operationId: string
  readonly statuses: readonly string[]
}

/** Routes declared by PublicApi but implemented outside PublicHttpApi handlers. */
export const rawRouteImplementations = new Set<string>([
  "DELETE /auth/{providerID}",
  "DELETE /config/mcp/{name}",
  "GET /api/share/{shareID}",
  "GET /api/share/{shareID}/data",
  "GET /config/profiles",
  "GET /event",
  "GET /experimental/workspace/{id}/events",
  "GET /global/event",
  "GET /s/{shareID}",
  "GET /share/{shareID}",
  "PATCH /config/mcp/{name}",
  "PATCH /user/{id}",
  "POST /config/mcp",
  "POST /config/profiles",
  "POST /config/profiles/activate/{name}",
  "POST /config/reload",
  "POST /experimental/workspace/session/{sessionID}/warp",
  "POST /session/{sessionID}/message",
  "POST /session/{sessionID}/prompt_async",
  "POST /user/login",
  "POST /user/register",
  "PUT /auth/{providerID}",
  "GET /pty/{ptyID}/connect",
])

function routes(api: typeof PublicApi): PublicRoute[] {
  const spec = OpenApi.fromApi(api)
  return Object.entries(spec.paths ?? {}).flatMap(([path, item]) =>
    methods.flatMap((method) => {
      const operation = item?.[method]
      if (!operation) return []
      return [
        {
          method: method.toUpperCase(),
          path,
          operationId: operation.operationId ?? "",
          statuses: Object.keys(operation.responses ?? {}).sort(),
        },
      ]
    }),
  )
}

export function publicRoutes(): PublicRoute[] {
  return routes(PublicApi)
}

export function handlerRoutes(): PublicRoute[] {
  return routes(PublicHttpApi.Api as typeof PublicApi)
}

export function routeKey(route: Pick<PublicRoute, "method" | "path">): string {
  return `${route.method} ${route.path}`
}

export function inventoryFailures(): string[] {
  const contracts = publicRoutes()
  const contractKeys = new Set(contracts.map(routeKey))
  const handlers = handlerRoutes()
  const handlerKeys = new Set(handlers.map(routeKey))
  const failures: string[] = []

  for (const route of contracts) {
    const key = routeKey(route)
    if (!handlerKeys.has(key) && !rawRouteImplementations.has(key))
      failures.push(`contract without implementation: ${key}`)
    if (!route.operationId) failures.push(`contract without operationId: ${key}`)
  }
  for (const route of handlers) {
    const key = routeKey(route)
    if (!contractKeys.has(key)) failures.push(`handler without contract: ${key}`)
  }
  for (const key of rawRouteImplementations) {
    if (!contractKeys.has(key)) failures.push(`raw implementation without contract: ${key}`)
    if (handlerKeys.has(key)) failures.push(`route declared as handler and raw: ${key}`)
  }

  const operationIds = new Map<string, string>()
  for (const route of contracts) {
    const key = routeKey(route)
    const previous = operationIds.get(route.operationId)
    if (previous) failures.push(`duplicate operationId ${route.operationId}: ${previous}, ${key}`)
    else operationIds.set(route.operationId, key)
  }
  return failures
}
