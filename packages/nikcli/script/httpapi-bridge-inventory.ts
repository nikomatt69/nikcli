import {
  handlerRoutes,
  inventoryFailures,
  publicRoutes,
  rawRouteImplementations,
  routeKey,
} from "../src/server/httpapi/inventory.ts"

const handlers = new Set(handlerRoutes().map(routeKey))
for (const route of publicRoutes().sort((a, b) => routeKey(a).localeCompare(routeKey(b)))) {
  const key = routeKey(route)
  const implementation = handlers.has(key) ? "handler" : rawRouteImplementations.has(key) ? "raw" : "missing"
  console.log(
    `${implementation.padEnd(7)} ${key} operationId=${route.operationId} statuses=${route.statuses.join(",")}`,
  )
}

const failures = inventoryFailures()
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  process.exit(1)
}
