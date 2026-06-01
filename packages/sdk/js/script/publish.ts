#!/usr/bin/env bun

import { Script } from "@nikcli-ai/script"
import { $ } from "bun"

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

await import("./build")

const pkg = await import("../package.json").then((m) => m.default)
const tgzFile = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`
const original = JSON.parse(JSON.stringify(pkg))
for (const [key, value] of Object.entries(pkg.exports)) {
  const file = value.replace("./src/", "./dist/").replace(".ts", "")
  /// @ts-expect-error
  pkg.exports[key] = {
    import: file + ".js",
    types: file + ".d.ts",
  }
}
await Bun.write("package.json", JSON.stringify(pkg, null, 2))

function getStderr(err: any): string {
  const s = err?.stderr
  if (!s) return ""
  if (s instanceof Uint8Array) return Buffer.from(s).toString()
  return String(s)
}

try {
  await $`bun pm pack`
  await $`npm publish ${tgzFile} --tag ${Script.channel} --access public`
} catch (err: any) {
  // Bun's ShellError puts the npm output in err.stderr, not err.message, so the
  // "already published" guard must inspect stderr to stay idempotent on re-runs.
  const msg = String(err?.message ?? err) + getStderr(err)
  if (!msg.includes("E409") && !msg.includes("previously published versions")) {
    await Bun.write("package.json", JSON.stringify(original, null, 2))
    throw err
  }
  console.log("  already published, skipping")
}
await Bun.write("package.json", JSON.stringify(original, null, 2))
