/**
 * Ensures the docs assistant retrieval index (src/data/docsIndex.ts) covers
 * every page in the docs sidebar, and does not reference pages that are gone.
 */
import { docsIndex, docsIndexGaps } from "../src/data/docsIndex"

const { missing, orphaned } = docsIndexGaps()

if (missing.length > 0) {
  console.error("Docs pages missing from the assistant index:", missing.sort().join(", "))
}

if (orphaned.length > 0) {
  console.error("Assistant index entries with no sidebar page:", orphaned.sort().join(", "))
}

if (missing.length > 0 || orphaned.length > 0) process.exit(1)

console.log(`docs assistant index OK (${docsIndex.length} pages)`)
