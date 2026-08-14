// Quick smoke test for the support docs indexer.
// Run with: bun run scripts/support-docs-smoke.ts
import { buildSupportDocsIndex, clearSupportDocsCache } from "../src/cli/cmd/tui/util/support-docs"

const root = "/Volumes/SSD/Projects/nikcli"

console.log("Building support docs index for:", root)
console.log("---")
const start = performance.now()
const index = await buildSupportDocsIndex(root)
const ms = Math.round(performance.now() - start)
console.log(index)
console.log("---")
console.log(`built in ${ms}ms, length=${index.length} chars`)

// Second call should hit the cache
const start2 = performance.now()
await buildSupportDocsIndex(root)
const ms2 = Math.round(performance.now() - start2)
console.log(`cached rebuild: ${ms2}ms`)

clearSupportDocsCache(root)
const start3 = performance.now()
await buildSupportDocsIndex(root)
const ms3 = Math.round(performance.now() - start3)
console.log(`rebuild after clear: ${ms3}ms`)
