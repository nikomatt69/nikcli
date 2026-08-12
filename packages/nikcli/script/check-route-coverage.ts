import {
  handlerRoutes,
  inventoryFailures,
  publicRoutes,
  rawRouteImplementations,
} from "../src/server/httpapi/inventory.ts"

const contracts = publicRoutes()
const handlers = handlerRoutes()
const failures = inventoryFailures()

console.log(`PublicApi contracts: ${contracts.length}`)
console.log(`HttpApi handlers: ${handlers.length}`)
console.log(`raw implementations: ${rawRouteImplementations.size}`)

for (const failure of failures) console.error(`FAIL ${failure}`)
if (failures.length > 0) process.exit(1)

console.log("route inventory coverage ok")
