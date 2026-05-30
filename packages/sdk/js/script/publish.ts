#!/usr/bin/env bun

import { Script } from "@nikcli-ai/script"
import { $ } from "bun"

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

await import("./build")

const pkg = await import("../package.json").then((m) => m.default)
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

// Remove any stale tarballs so the glob below resolves to exactly one file.
// `npm publish` only accepts a single package-spec, and a leftover .tgz from a
// previous version would make `npm publish *.tgz` fail with EUSAGE.
await $`rm -f *.tgz`

await $`bun pm pack`
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`
await $`npm publish ${tarball} --tag ${Script.channel} --access public`
await Bun.write("package.json", JSON.stringify(original, null, 2))
