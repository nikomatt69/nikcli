#!/usr/bin/env bun
import { renderHtmlCompare } from "../test/helpers/bench-report.ts"

const [, , baselinePath, currentPath, outPath] = process.argv
if (!baselinePath || !currentPath) {
  console.error("Usage: bun run script/bench-compare.ts <baseline.json> <current.json> [out.html]")
  process.exit(1)
}

const baselineJson = await Bun.file(baselinePath).text()
const currentJson = await Bun.file(currentPath).text()
const html = renderHtmlCompare(baselineJson, currentJson)
if (outPath) {
  await Bun.write(outPath, html)
  console.error(`Wrote ${outPath}`)
} else {
  console.log(html)
}
