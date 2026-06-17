/**
 * Ensures packages/web/src/pages/docs/tools.astro toolIndex IDs stay in sync
 * with Tool.define IDs under packages/nikcli/src/tool/*.ts
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const monoRoot = path.resolve(webRoot, "../..")
const toolsPagePath = path.join(webRoot, "src/pages/docs/tools.astro")
const toolDir = path.join(monoRoot, "packages/nikcli/src/tool")

/** Matches Tool.define("id") and Tool.define<...>("id", */
const toolDefineRe = /Tool\.define(?:<[^>]*>)?\(\s*["']([^"']+)["']/g

const registryIds = new Set<string>()
for (const name of readdirSync(toolDir)) {
  if (!name.endsWith(".ts")) continue
  const src = readFileSync(path.join(toolDir, name), "utf8")
  let m: RegExpExecArray | null
  while ((m = toolDefineRe.exec(src)) !== null) {
    registryIds.add(m[1])
  }
}

const toolsPage = readFileSync(toolsPagePath, "utf8")
const indexMatch = toolsPage.match(/const toolIndex = \[([\s\S]*?)\];/)
if (!indexMatch) {
  console.error("Could not parse toolIndex in tools.astro")
  process.exit(1)
}

const docIds = new Set<string>()
const idRe = /id:\s*["']([^"']+)["']/g
let dm: RegExpExecArray | null
while ((dm = idRe.exec(indexMatch[1])) !== null) {
  docIds.add(dm[1])
}

const skipRegistry = new Set(["voice", "list", "multiedit"])
const missingInDocs = [...registryIds].filter((id) => !docIds.has(id) && !skipRegistry.has(id))
const extraInDocs = [...docIds].filter((id) => !registryIds.has(id))

if (missingInDocs.length > 0) {
  console.error("Tool IDs in src/tool but missing from docs toolIndex:", missingInDocs.sort().join(", "))
  process.exit(1)
}

if (extraInDocs.length > 0) {
  console.error("Docs toolIndex IDs not found in src/tool Tool.define:", extraInDocs.sort().join(", "))
  process.exit(1)
}

console.log(`docs tool index OK (${docIds.size} entries)`)
